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
  // Remembers which fields the selected account has actually been tried on.
  // This also retains the account choice across staged forms, without secrets.
  private readonly attempts = new Map<
    string,
    { accountId: string; fields: Set<string>; at: number }
  >();
  private attempt(owner: string, origin: string) {
    const key = owner + ':' + origin;
    const attempt = this.attempts.get(key);
    if (attempt && Date.now() - attempt.at < 10 * 60_000) return attempt;
    this.attempts.delete(key);
    return undefined;
  }
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
      for (const [key, value] of this.attempts)
        if (Date.now() - value.at >= 10 * 60_000) this.attempts.delete(key);
      for (const row of await this.repository.notifications()) {
        try {
          await this.notify(
            row.taskId,
            `Secure entry request ${row.id} for ${row.origin} was ${row.status}. ${row.status === 'saved' ? 'The complete username and password are stored. Inspect again and use secure_fill with the saved account for subsequent login stages.' : row.status === 'filled' ? 'The verification code was filled directly in the browser. Check the page before continuing.' : 'No input was submitted.'} This notification can be delivered more than once.`,
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
          for (const target of result.targets.filter(
            (t) => !t.fields.includes('code'),
          ))
            for (const item of await this.vault.matching(
              this.inspector.url(
                this.owner(taskId, workerId),
                target.targetRef,
              ),
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
  async request(taskId: string, targetRef: string, workerId?: string) {
    const target = this.inspector.target(
      this.owner(taskId, workerId),
      targetRef,
    );
    await this.inspector.assertCurrent(
      await this.browser.selectedPage(taskId, workerId),
      this.owner(taskId, workerId),
      targetRef,
    );
    const kind = target.fields.includes('code') ? 'code' : 'credentials';
    if (kind === 'credentials' && this.vault.configured) {
      const accounts = await this.vault.matching(
        this.inspector.url(this.owner(taskId, workerId), targetRef),
      );
      const complete = accounts.filter((account) =>
        target.fields.every(
          (field) => !!account.login?.[field as 'username' | 'password'],
        ),
      );
      const tried = this.attempt(this.owner(taskId, workerId), target.origin);
      if (
        complete.length &&
        !(
          tried &&
          complete.some((account) => account.id === tried.accountId) &&
          target.fields.every((field) => tried.fields.has(field))
        )
      ) {
        return {
          status: 'credentials_available' as const,
          accounts: complete.map((account) => ({
            id: account.id,
            label: account.name,
          })),
          message:
            'The complete login is already stored. Use secure_fill for this stage; no new entry is needed.',
        };
      }
    }
    const row = await this.repository.request(
      taskId,
      target.origin,
      kind,
      kind === 'code' ? targetRef : undefined,
      workerId,
    );
    await this.tasks.update(taskId, { status: 'needs-input' });
    this.events.publish({ event: 'login.updated', taskId });
    return {
      status: 'awaiting_user' as const,
      requestId: row.id,
      origin: row.origin,
      kind,
    };
  }

  async fill(
    taskId: string,
    targetRef: string,
    accountId?: string,
    workerId?: string,
  ) {
    const target = this.inspector.target(
      this.owner(taskId, workerId),
      targetRef,
    );
    const page = await this.browser.selectedPage(taskId, workerId);
    await this.inspector.assertCurrent(
      page,
      this.owner(taskId, workerId),
      targetRef,
    );
    if (target.fields.includes('code'))
      return {
        status: 'input_required' as const,
        message:
          'Request secure PWA verification-code entry with secure_entry_request.',
      };
    const matches = await this.vault.matching(
      this.inspector.url(this.owner(taskId, workerId), target.targetRef),
    );
    const preferredId =
      accountId ??
      this.attempt(this.owner(taskId, workerId), target.origin)?.accountId;
    const account = accountId
      ? matches.find((item) => item.id === accountId)
      : preferredId && matches.some((item) => item.id === preferredId)
        ? matches.find((item) => item.id === preferredId)
        : matches.length === 1
          ? matches[0]
          : undefined;
    if (!account)
      throw new ApplicationError(
        'conflict',
        'Select a matching account, or request credentials',
      );
    if (
      target.fields.some(
        (field) => !account.login?.[field as 'username' | 'password'],
      )
    )
      throw new ApplicationError(
        'conflict',
        'Matching account is missing required login fields; request credentials',
      );
    try {
      const result = await this.inspector.fill(
        page,
        this.owner(taskId, workerId),
        targetRef,
        account.login!,
      );
      const previous = this.attempt(
        this.owner(taskId, workerId),
        target.origin,
      );
      this.attempts.set(this.owner(taskId, workerId) + ':' + target.origin, {
        accountId: account.id,
        fields: new Set([
          ...(previous?.accountId === account.id ? previous.fields : []),
          ...target.fields,
        ]),
        at: Date.now(),
      });
      return result;
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
          row.status === 'pending' &&
          row.kind === 'credentials' &&
          this.vault.configured
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
    const row = await this.repository.finish(
      id,
      input ? 'credentials' : undefined,
      input ? (row) => this.vault.save(row.origin, input, row.id) : undefined,
    );
    if (input && row.status === 'saved' && row.accountId) {
      this.attempts.set(
        this.owner(row.taskId, row.workerId ?? undefined) + ':' + row.origin,
        {
          accountId: row.accountId,
          fields: new Set(),
          at: Date.now(),
        },
      );
    }
    this.events.publish({ event: 'login.updated', taskId: row.taskId });
    void this.flushNotifications();
    return { id: row.id, status: row.status };
  }
  async submitCode(id: string, code: string) {
    try {
      const row = await this.repository.finish(id, 'code', async (row) => {
        if (!row.targetRef)
          throw new ApplicationError(
            'conflict',
            'Verification target expired; inspect again',
          );
        const owner = this.owner(row.taskId, row.workerId ?? undefined);
        const target = this.inspector.target(owner, row.targetRef);
        if (!target.fields.includes('code') || target.origin !== row.origin)
          throw new ApplicationError(
            'conflict',
            'Verification target changed; inspect again',
          );
        await this.inspector.fill(
          await this.browser.selectedPage(
            row.taskId,
            row.workerId ?? undefined,
          ),
          owner,
          row.targetRef,
          { code },
        );
      });
      this.events.publish({ event: 'login.updated', taskId: row.taskId });
      void this.flushNotifications();
      return { id: row.id, status: row.status };
    } finally {
      code = '';
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
