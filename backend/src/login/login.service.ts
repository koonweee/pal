import { ChatService } from '../chat/chat.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { BrowserService } from '../browser/browser.service.js';
import { EventsService } from '../events/events.service.js';
import { ApplicationError } from '../application/contracts/errors.js';
import { BitwardenService, type CredentialInput } from './bitwarden.service.js';
import {
  LoginRepository,
  loginOwner,
  type LoginRequest,
} from './login.repository.js';
import { LoginBrowser } from './login-browser.js';
import { StaleSecureFieldsError, type SecureFields } from './login-fields.js';

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
    @Inject(ChatService) private readonly chat: ChatService,
  ) {}
  bindNotifier(notify: (taskId: string, text: string) => Promise<void>) {
    this.notify = notify;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.flushNotifications();
    }, 10_000);
    this.timer.unref();
    void this.flushNotifications();
  }
  async flushNotifications() {
    if (this.notifying || !this.notify) return;
    this.notifying = true;
    try {
      for (const row of await this.repository.cleanup()) {
        if (row.status === 'failed')
          await this.tasks.update(row.taskId, { status: 'needs-input' });
        this.events.publish({ event: 'login.updated', taskId: row.taskId });
      }
      for (const row of await this.repository.active()) {
        await this.publishCard(row);
        if ((await this.tasks.details(row.taskId)).status === 'completed') {
          await this.repository.finish(row.id);
          await this.repository.notified(row.id, 'cancelled');
          this.events.publish({ event: 'login.updated', taskId: row.taskId });
          continue;
        }
        if (
          row.status === 'pending' &&
          row.kind === 'code' &&
          !this.inspector.live(
            loginOwner(row.taskId, row.workerId ?? undefined),
            row.fields,
          )
        ) {
          await this.recover(row.id);
        }
      }
      for (const row of await this.repository.notifications()) {
        try {
          if ((await this.tasks.details(row.taskId)).status === 'completed') {
            await this.repository.notified(row.id, row.status);
            continue;
          }
          const next =
            row.status === 'updating'
              ? `Automatic recovery ${row.recoveryAttempts}/2: browser input references are stale. Inspect the browser again, choose fresh fields and call secure_entry_request to replace the inline form. Never ask the user to refresh. If login already completed, verify it and complete the task.`
              : row.status === 'failed'
                ? 'Automatic recovery stopped. Yield; the inline card lets the user retry. Do not create more requests until the user retries.'
                : row.status === 'saved'
                  ? 'The complete username and password are stored. Inspect again and use secure_fill with the saved account for subsequent login stages.'
                  : row.status === 'filled'
                    ? 'The verification code was filled directly in the browser. Check the page before continuing.'
                    : 'The request was cancelled.';
          await this.notify(
            row.taskId,
            `Secure entry request ${row.id} for ${row.origin} is ${row.status}. ${next}${row.status === 'saved' ? ` Keep me signed in preference: ${row.keepMeSignedIn ? 'on' : 'off'}. Inspect website persistence options and honor this preference; do not claim it was applied unless you selected an applicable option.` : ''} This notification can be delivered more than once.`,
          );
          await this.repository.notified(row.id, row.status);
        } catch {
          /* Retry metadata notification, never the secret submission. */
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
        loginOwner(taskId, workerId),
      );
      const origin = new URL(page.url()).origin;
      const accounts = new Map<
        string,
        { id: string; label: string; origin: string }
      >();
      let vaultStatus = this.vault.configured ? 'ready' : 'not_configured';
      if (this.vault.configured) {
        try {
          const urls = new Map(
            result.inputs.map((input) => [
              this.inspector.url(loginOwner(taskId, workerId), input.ref),
              input.origin,
            ]),
          );
          for (const [url, origin] of urls)
            for (const item of await this.vault.matching(url))
              accounts.set(origin + ':' + item.id, {
                id: item.id,
                label: item.name,
                origin,
              });
        } catch {
          vaultStatus = 'unavailable';
        }
      }
      const inspectionId = await this.repository.inspection(
        taskId,
        origin,
        result.inputs,
        result.image,
        result.inspectionId,
      );
      this.events.publish({ event: 'login.updated', taskId });
      return {
        origin,
        inputs: result.inputs,
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
  async request(
    taskId: string,
    fields: SecureFields,
    workerId?: string,
    keepMeSignedIn?: boolean,
  ) {
    const target = await this.inspector.select(
      await this.browser.selectedPage(taskId, workerId),
      loginOwner(taskId, workerId),
      fields,
    );
    const kind = target.roles.includes('code') ? 'code' : 'credentials';
    const row = await this.repository.request(
      taskId,
      target.origin,
      kind,
      fields,
      workerId,
      target.inspectionId,
      keepMeSignedIn,
    );
    await this.publishCard(row);
    await this.tasks.update(taskId, { status: 'needs-input' });
    this.events.publish({ event: 'login.updated', taskId });
    return {
      status: 'awaiting_user' as const,
      requestId: row.id,
      origin: row.origin,
      kind,
      keepMeSignedIn: row.keepMeSignedIn,
    };
  }

  async fill(
    taskId: string,
    fields: SecureFields,
    accountId?: string,
    workerId?: string,
    keepMeSignedIn?: boolean,
  ) {
    const page = await this.browser.selectedPage(taskId, workerId);
    const target = await this.inspector.select(
      page,
      loginOwner(taskId, workerId),
      fields,
    );
    if (target.roles.includes('code'))
      return {
        status: 'input_required' as const,
        message:
          'Request secure PWA verification-code entry with secure_entry_request.',
      };
    const matches = await this.vault.matching(target.url);
    const flow = await this.repository.selection(taskId, workerId);
    const site = await this.repository.site(target.origin);
    const activeFlow =
      flow?.origin === target.origin && !flow.confirmedAt ? flow : undefined;
    const preferredId =
      accountId ?? activeFlow?.accountId ?? site?.lastAccountId;
    const account = accountId
      ? matches.find((item) => item.id === accountId)
      : preferredId && matches.some((item) => item.id === preferredId)
        ? matches.find((item) => item.id === preferredId)
        : site?.lastAccountId &&
            matches.some((item) => item.id === site.lastAccountId)
          ? matches.find((item) => item.id === site.lastAccountId)
          : matches.length === 1
            ? matches[0]
            : undefined;
    if (!account)
      throw new ApplicationError(
        'conflict',
        'Select a matching account, or request credentials',
      );
    if (
      target.roles.some(
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
        loginOwner(taskId, workerId),
        fields,
        account.login!,
      );
      const keep =
        keepMeSignedIn ??
        activeFlow?.keepMeSignedIn ??
        site?.keepMeSignedIn ??
        false;
      if (keepMeSignedIn !== undefined)
        await this.repository.keep(target.origin, keepMeSignedIn);
      await this.repository.select(
        taskId,
        workerId,
        target.origin,
        account.id,
        keep,
      );
      return { ...result, accountId: account.id, keepMeSignedIn: keep };
    } finally {
      if (account.login) {
        account.login.password = undefined;
        account.login.username = undefined;
      }
    }
  }
  private async publishCard(row: LoginRequest) {
    const text =
      row.kind === 'code'
        ? 'Enter the verification code securely.'
        : 'Enter your sign-in details securely.';
    const metadata = { secureEntryRequestId: row.cardId };
    await this.chat.publish(
      {
        role: 'assistant',
        taskId: row.taskId,
        phase: 'commentary',
        text,
        metadata,
      },
      'secure-entry:' + row.cardId,
    );
  }
  async get(id: string) {
    const row = await this.repository.current(id);
    return {
      id: row.id,
      origin: row.origin,
      kind: row.kind,
      status: row.status,
      inspectionId: row.status === 'pending' ? row.inspectionId : null,
      configured: this.vault.configured,
      keepMeSignedIn: row.keepMeSignedIn,
      accounts:
        row.status === 'pending' &&
        row.kind === 'credentials' &&
        this.vault.configured
          ? await this.accounts(row.origin).catch(() => [])
          : [],
    };
  }
  private async recover(id: string, retry = false) {
    const row = await this.repository.recover(id, retry);
    if (row.status === 'updating')
      await this.tasks.update(row.taskId, { status: 'in-progress' });
    else if (row.status === 'failed')
      await this.tasks.update(row.taskId, { status: 'needs-input' });
    this.events.publish({ event: 'login.updated', taskId: row.taskId });
    return { id: row.id, status: row.status };
  }
  async retry(id: string) {
    const result = await this.recover(id, true);
    void this.flushNotifications();
    return result;
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
  async finish(
    id: string,
    input?: CredentialInput & { keepMeSignedIn?: boolean },
  ) {
    const row = await this.repository.finish(
      id,
      input ? 'credentials' : undefined,
      input ? (row) => this.vault.save(row.origin, input, row.id) : undefined,
      input?.keepMeSignedIn,
    );
    this.events.publish({ event: 'login.updated', taskId: row.taskId });
    void this.flushNotifications();
    return { id: row.id, status: row.status };
  }
  async submitCode(id: string, code: string) {
    try {
      const row = await this.repository.finish(id, 'code', async (row) => {
        if (!row.fields || !('code' in row.fields))
          throw new StaleSecureFieldsError();
        const owner = loginOwner(row.taskId, row.workerId ?? undefined);
        const page = await this.browser
          .selectedPage(row.taskId, row.workerId ?? undefined)
          .catch(() => {
            throw new StaleSecureFieldsError();
          });
        const target = await this.inspector.select(page, owner, row.fields);
        if (target.origin !== row.origin) throw new StaleSecureFieldsError();
        await this.inspector.fill(page, owner, row.fields, { code });
      });
      this.events.publish({ event: 'login.updated', taskId: row.taskId });
      void this.flushNotifications();
      return { id: row.id, status: row.status };
    } catch (error) {
      if (!(error instanceof StaleSecureFieldsError)) throw error;
      const result = await this.recover(id);
      void this.flushNotifications();
      return result;
    } finally {
      code = '';
    }
  }
  async session(
    taskId: string,
    action: 'complete' | 'preference',
    workerId?: string,
    keepMeSignedIn?: boolean,
  ) {
    if (action !== 'complete' && action !== 'preference')
      throw new ApplicationError(
        'invalid_input',
        'Unknown login session action',
      );
    if (action === 'preference' && keepMeSignedIn === undefined)
      throw new ApplicationError(
        'invalid_input',
        'Supply keepMeSignedIn to update the login preference',
      );
    if (keepMeSignedIn !== undefined) {
      const flow = await this.repository.selection(taskId, workerId);
      const origin =
        flow?.origin ??
        new URL((await this.browser.selectedPage(taskId, workerId)).url())
          .origin;
      if (new URL(origin).protocol !== 'https:')
        throw new ApplicationError(
          'invalid_input',
          'Login preferences require HTTPS',
        );
      await this.repository.preference(
        taskId,
        workerId,
        origin,
        keepMeSignedIn,
      );
      if (action === 'preference')
        return { status: 'recorded' as const, origin, keepMeSignedIn };
    }
    const flow = await this.repository.complete(taskId, workerId);
    if (!flow)
      throw new ApplicationError(
        'conflict',
        'No selected login is available to confirm',
      );
    return { status: 'recorded' as const, ...flow };
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
