import { TasksService } from '../tasks/tasks.service.js';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { BrowserService } from '../browser/browser.service.js';
import { EventsService } from '../events/events.service.js';
import { ApplicationError } from '../application/contracts/errors.js';
import { BitwardenService, type CredentialInput } from './bitwarden.service.js';
import { LoginRepository } from './login.repository.js';
import { LoginBrowser } from './login-browser.js';

@Injectable()
export class LoginService implements OnModuleDestroy {
  private readonly inspector = new LoginBrowser();
  private notify?: (taskId: string, text: string) => Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private notifying = false;
  constructor(
    @Inject(BrowserService) private readonly browser: BrowserService,
    @Inject(BitwardenService) private readonly vault: BitwardenService,
    @Inject(LoginRepository) private readonly repository: LoginRepository,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(TasksService) private readonly tasks: TasksService,
  ) {}
  private owner(taskId: string, workerId?: string) {
    return taskId + ':' + (workerId ?? 'task');
  }
  bindNotifier(notify: (taskId: string, text: string) => Promise<void>) {
    this.notify = notify;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.flushNotifications();
    }, 30_000);
    this.timer.unref();
    void this.flushNotifications();
  }
  async flushNotifications() {
    if (this.notifying || !this.notify) return;
    this.notifying = true;
    try {
      await this.repository.cleanup();
      for (const row of await this.repository.notifications()) {
        try {
          await this.notify(
            row.taskId,
            `Login request ${row.id} for ${row.origin} was ${row.status}. Inspect the current page again before filling. This notification can be delivered more than once.`,
          );
          await this.repository.notified(row.id);
        } catch {
          /* Retry metadata notification, never the vault write. */
        }
      }
    } catch {
      /* Database or runtime may still be starting. */
    } finally {
      this.notifying = false;
    }
  }
  async inspect(taskId: string, workerId?: string) {
    try {
      const page = await this.browser.selectedPage(taskId, workerId);
      const result = await this.inspector.inspect(
        page,
        this.owner(taskId, workerId),
      );
      const origin = new URL(page.url()).origin;
      const accounts = new Map<
        string,
        { id: string; label: string; origin: string }
      >();
      let vaultStatus = this.vault.configured ? 'ready' : 'not_configured';
      if (this.vault.configured) {
        try {
          for (const target of result.targets)
            for (const item of await this.vault.matching(
              this.inspector.url(this.owner(taskId, workerId), target.loginRef),
            ))
              accounts.set(item.id, {
                id: item.id,
                label: item.name,
                origin: target.origin,
              });
        } catch {
          vaultStatus = 'unavailable';
        }
      }
      const inspectionId = await this.repository.inspection(
        taskId,
        origin,
        result.targets,
        result.image,
      );
      this.events.publish({ event: 'login.updated', taskId });
      return {
        origin,
        targets: result.targets,
        accounts: [...accounts.values()],
        vaultStatus,
        inspectionId,
        image: result.image.toString('base64'),
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        'unavailable',
        'Browser login inspection failed',
      );
    }
  }
  async request(taskId: string, loginRef: string, workerId?: string) {
    const target = this.inspector.target(
      this.owner(taskId, workerId),
      loginRef,
    );
    await this.inspector.assertCurrent(
      await this.browser.selectedPage(taskId, workerId),
      this.owner(taskId, workerId),
      loginRef,
    );
    const row = await this.repository.request(taskId, target.origin);
    await this.tasks.update(taskId, { status: 'needs-input' });
    this.events.publish({ event: 'login.updated', taskId });
    return { status: 'awaiting_user', requestId: row.id, origin: row.origin };
  }
  async fill(
    taskId: string,
    loginRef: string,
    accountId?: string,
    workerId?: string,
  ) {
    const target = this.inspector.target(
      this.owner(taskId, workerId),
      loginRef,
    );
    const page = await this.browser.selectedPage(taskId, workerId);
    await this.inspector.assertCurrent(
      page,
      this.owner(taskId, workerId),
      loginRef,
    );
    const matches = await this.vault.matching(
      this.inspector.url(this.owner(taskId, workerId), target.loginRef),
    );
    const account = accountId
      ? matches.find((item) => item.id === accountId)
      : matches.length === 1
        ? matches[0]
        : undefined;
    if (!account)
      throw new ApplicationError(
        'conflict',
        'Select a matching account, or request credentials',
      );
    if (target.fields.some((field) => !account.login?.[field]))
      throw new ApplicationError(
        'conflict',
        'Matching account is missing required login fields; request credentials',
      );
    try {
      return await this.inspector.fill(
        page,
        this.owner(taskId, workerId),
        loginRef,
        account.login!,
      );
    } finally {
      if (account.login) {
        account.login.password = undefined;
        account.login.username = undefined;
      }
    }
  }
  async snapshot(taskId: string) {
    const snapshot = await this.repository.snapshot(taskId);
    const requests = await Promise.all(
      snapshot.requests.map(async (row) => ({
        ...row,
        accounts:
          row.status === 'pending' && this.vault.configured
            ? await this.accounts(row.origin).catch(() => [])
            : [],
      })),
    );
    return { ...snapshot, requests, configured: this.vault.configured };
  }
  async accounts(origin: string) {
    return (await this.vault.matching(origin)).map((item) => ({
      id: item.id,
      label: item.name,
    }));
  }
  preview(id: string) {
    return this.repository.preview(id);
  }
  async finish(id: string, input?: CredentialInput) {
    const row = await this.repository.finish(id, input, (origin, input, id) =>
      this.vault.save(origin, input, id),
    );
    this.events.publish({ event: 'login.updated', taskId: row.taskId });
    void this.flushNotifications();
    return { id: row.id, status: row.status };
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
