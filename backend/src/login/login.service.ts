import { ChatService } from '../chat/chat.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { BrowserService } from '../browser/browser.service.js';
import { EventsService } from '../events/events.service.js';
import { ApplicationError } from '../application/contracts/errors.js';
import { BitwardenService, type CredentialInput } from './bitwarden.service.js';
import { LoginRepository, type LoginRequest } from './login.repository.js';
import type { LoginBrowser } from './login-browser.js';
import { LoginDestinations } from './login-destinations.js';
import { AndroidService } from '../android/android.service.js';
import { cardValues, type CardSubmission } from './payment-card.js';
import {
  sameDestination,
  credentialFieldLabels,
  credentialRoles,
  fieldKind,
  StaleSecureFieldsError,
  type SecureFields,
} from './login-fields.js';

@Injectable()
export class LoginService implements OnModuleDestroy {
  private readonly inspector: LoginDestinations;
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
    @Inject(AndroidService) private readonly android: AndroidService,
  ) {
    this.inspector = new LoginDestinations(browser, android);
  }
  get androidEnabled() {
    return this.android.enabled;
  }
  bindNotifier(notify: (taskId: string, text: string) => Promise<void>) {
    this.notify = notify;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.flushNotifications();
    }, 10_000);
    this.timer.unref();
    void this.flushNotifications();
  }
  async resumeWorker(taskId: string, assignment: string) {
    const id =
      /secure entry request\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
        assignment,
      )?.[1];
    if (!id) return;
    let row;
    try {
      row = await this.repository.current(id);
    } catch (error) {
      if (error instanceof ApplicationError && error.code === 'not_found')
        return;
      throw error;
    }
    if (
      row.taskId !== taskId ||
      !row.workerId ||
      row.status === 'cancelled' ||
      Date.now() - row.createdAt.getTime() >= 24 * 3600_000
    )
      return;
    if (row.destination.kind === 'android')
      return this.android.owns(taskId, row.workerId) ? row.workerId : undefined;
    const group = (await this.browser.groups()).find(
      (group) => group.taskId === taskId,
    );
    return group?.sessions?.includes('worker-' + row.workerId)
      ? row.workerId
      : undefined;
  }

  async retainWorkerSession(
    taskId: string,
    workerId: string,
    completed: boolean,
    startedAt: number,
  ) {
    const requests = await this.repository.workerRequests(taskId, workerId);
    const pending = requests.filter((row) =>
      ['pending', 'updating', 'failed'].includes(row.status),
    );
    // A user can submit before delegation cleanup runs. Retain that new request
    // too; a resumed assignment will have a later start time and can close it.
    if (completed)
      return (
        pending.length > 0 ||
        requests.some(
          (row) =>
            row.status !== 'cancelled' && row.createdAt.getTime() >= startedAt,
        )
      );
    for (const row of pending) await this.repository.finish(row.id);
    if (pending.length) {
      this.events.publish({ event: 'login.updated', taskId });
      void this.flushNotifications();
    }
    return false;
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
          row.kind !== 'credentials' &&
          !this.inspector.live(
            row.taskId,
            row.workerId ?? undefined,
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
          const surface =
            row.destination.kind === 'android' ? 'Android app' : 'browser';
          const next =
            row.status === 'updating'
              ? `Automatic recovery ${row.recoveryAttempts}/2: secure input references are stale. Inspect the destination again, choose fresh fields and call secure_entry_request to replace the inline form. Never ask the user to refresh. If login already completed, verify it and complete the task.`
              : row.status === 'failed'
                ? 'Automatic recovery stopped. Yield; the inline card lets the user retry. Do not create more requests until the user retries.'
                : row.status === 'saved'
                  ? 'The requested credential fields are stored. Filling could not be confirmed. Inspect current state and verify any advancement; fill fresh fields only when still needed.'
                  : row.status === 'selected'
                    ? 'The user selected a saved account. Inspect again and use secure_fill without accountId to continue this selected flow.'
                    : row.status === 'filled'
                      ? row.kind === 'card'
                        ? 'The payment fields were filled directly in the browser. Filling does not submit a purchase.'
                        : row.kind === 'code'
                          ? `The verification code was filled directly in the ${surface}.`
                          : `The requested credential fields are stored. The selected ${Object.keys(row.fields ?? {}).join('/')} fields were filled directly in the ${surface}.`
                      : 'The request was cancelled.';
          await this.notify(
            row.taskId,
            `Secure entry request ${row.id} for ${row.origin} is ${row.status}. ${next}${row.destination.kind === 'browser' && row.kind === 'credentials' && ['saved', 'selected', 'filled'].includes(row.status) ? ` Keep me signed in preference: ${row.keepMeSignedIn ? 'on' : 'off'}.` : ''} This notification can be delivered more than once.`,
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
  async inspect(
    taskId: string,
    workerId?: string,
    action?: string[],
    signal?: AbortSignal,
    surface: 'browser' | 'android' = 'browser',
    website?: string,
  ) {
    try {
      signal?.throwIfAborted();
      if (surface === 'android' && action)
        throw new ApplicationError(
          'invalid_input',
          'Browser actions are unavailable for Android private inspection',
        );
      if (action) {
        if (!action.length)
          throw new ApplicationError(
            'invalid_input',
            'Supply a browser action',
          );
        // New tabs may be the caller's first owned page. For existing pages,
        // arm the frame listener before dispatching asynchronous navigation.
        const before =
          action[0] === 'tab' && action[1] === 'new'
            ? undefined
            : await this.browser.selectedPage(taskId, workerId);
        const navigation = before
          ?.waitForEvent('framenavigated', { timeout: 1500 })
          .catch(() => undefined);
        const result = await this.browser.command(
          taskId,
          action,
          signal,
          workerId,
        );
        if (!result.success)
          throw new ApplicationError(
            'unavailable',
            'Browser action failed. Inspect again without action before retrying.',
          );
        const frame = await navigation;
        if (frame)
          await frame.waitForLoadState('domcontentloaded', { timeout: 5000 });
      }
      if (action)
        await (
          await this.browser.selectedPage(taskId, workerId)
        ).waitForLoadState('domcontentloaded', { timeout: 5000 });
      signal?.throwIfAborted();
      const result = await this.inspector.inspect(
        taskId,
        workerId,
        surface,
        website,
      );
      const origin = result.origin;
      const accounts = new Map<
        string,
        { id: string; label: string; origin: string }
      >();
      let vaultStatus = this.vault.configured ? 'ready' : 'not_configured';
      if (this.vault.configured) {
        try {
          const urls = new Map(
            result.inputs.map((input) => [
              this.inspector.url(taskId, workerId, input.ref),
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
        result.destination,
      );
      this.events.publish({ event: 'login.updated', taskId });
      return {
        origin,
        ...(result.destination.kind === 'android'
          ? { app: result.destination.packageName }
          : {}),
        inputs: result.inputs,
        ...('screen' in result ? { screen: result.screen } : {}),
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
    chooseAccount = false,
  ) {
    const target = await this.inspector.select(taskId, workerId, fields);
    if (target.destination.kind === 'android' && keepMeSignedIn !== undefined)
      throw new ApplicationError(
        'invalid_input',
        'Session preferences apply to browser logins',
      );
    const kind = fieldKind(fields);
    if (kind === 'card' && keepMeSignedIn !== undefined)
      throw new ApplicationError(
        'invalid_input',
        'Session preferences apply only to logins',
      );
    if (chooseAccount && kind === 'code')
      throw new ApplicationError(
        'invalid_input',
        'Account selection requires credential fields',
      );
    const picker =
      chooseAccount &&
      this.vault.configured &&
      (kind === 'card'
        ? await this.vault.cards()
        : await this.vault.matching(target.origin)
      ).length > 0;
    const row = await this.repository.request(
      taskId,
      target.origin,
      kind,
      fields,
      workerId,
      target.inspectionId,
      keepMeSignedIn,
      picker,
      target.destination,
    );
    await this.publishCard(row);
    await this.tasks.update(taskId, { status: 'needs-input' });
    this.events.publish({ event: 'login.updated', taskId });
    return {
      status: 'awaiting_user' as const,
      requestId: row.id,
      origin: row.origin,
      kind,
      chooseAccount: row.chooseAccount,
      ...(row.destination.kind === 'browser'
        ? { keepMeSignedIn: row.keepMeSignedIn }
        : {}),
    };
  }

  async fill(
    taskId: string,
    fields: SecureFields,
    accountId?: string,
    workerId?: string,
    keepMeSignedIn?: boolean,
    action?: string[],
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (action && !action.length)
      throw new ApplicationError('invalid_input', 'Supply a browser action');
    const target = await this.inspector.select(taskId, workerId, fields);
    if (
      target.destination.kind === 'android' &&
      (action || keepMeSignedIn !== undefined)
    )
      throw new ApplicationError(
        'invalid_input',
        'Android filling accepts no browser action or session preference',
      );
    if (fieldKind(fields) === 'card') {
      if (action || accountId || keepMeSignedIn !== undefined)
        throw new ApplicationError(
          'invalid_input',
          'Payment filling uses the private card picker; omit action, accountId and login preferences',
        );
      return this.request(taskId, fields, workerId, undefined, true);
    }
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
      flow?.origin === target.origin &&
      sameDestination(flow.destination, target.destination) &&
      !flow.confirmedAt
        ? flow
        : undefined;
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
    if (!account && !accountId && matches.length > 1)
      return this.request(taskId, fields, workerId, keepMeSignedIn, true);
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
    let filled: Awaited<ReturnType<LoginBrowser['fill']>> & {
      accountId: string;
      keepMeSignedIn?: boolean;
    };
    try {
      signal?.throwIfAborted();
      const result = await this.inspector.fill(
        taskId,
        workerId,
        fields,
        account.login!,
      );
      const keep =
        target.destination.kind === 'android'
          ? false
          : (keepMeSignedIn ??
            activeFlow?.keepMeSignedIn ??
            site?.keepMeSignedIn ??
            false);
      if (keepMeSignedIn !== undefined)
        await this.repository.keep(target.origin, keepMeSignedIn);
      await this.repository.select(
        taskId,
        workerId,
        target.origin,
        account.id,
        keep,
        target.destination,
      );
      filled = {
        ...result,
        accountId: account.id,
        ...(target.destination.kind === 'browser'
          ? { keepMeSignedIn: keep }
          : {}),
      };
    } finally {
      if (account.login) {
        account.login.password = undefined;
        account.login.username = undefined;
      }
    }
    if (!action) return filled;
    try {
      return {
        ...filled,
        actionStatus: 'completed' as const,
        ...(await this.inspect(taskId, workerId, action, signal)),
      };
    } catch {
      return {
        ...filled,
        actionStatus: 'failed' as const,
        message:
          'Fields were filled, but the browser action or resulting inspection failed. Inspect without action and do not refill.',
      };
    }
  }
  private async credentialDetails(row: LoginRequest) {
    const fields = credentialRoles(row.fields);
    return {
      fields,
      fieldLabels: credentialFieldLabels(
        row.fields,
        await this.repository.inspectionInputs(row.inspectionId),
      ),
    };
  }
  private async publishCard(row: LoginRequest) {
    const credential =
      row.kind === 'credentials'
        ? await this.credentialDetails(row)
        : undefined;
    const singleCredential =
      credential?.fields.length === 1
        ? credential.fieldLabels[credential.fields[0]]
        : undefined;
    const credentialName =
      singleCredential && singleCredential === singleCredential.toUpperCase()
        ? singleCredential
        : singleCredential
          ? singleCredential[0].toLowerCase() + singleCredential.slice(1)
          : undefined;
    const text =
      row.kind === 'card'
        ? 'Enter or select payment details securely.'
        : row.kind === 'code'
          ? 'Enter the verification code securely.'
          : row.chooseAccount
            ? 'Choose an account to sign in.'
            : credentialName
              ? `Enter your ${credentialName} securely.`
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
    const credential =
      row.kind === 'credentials'
        ? await this.credentialDetails(row)
        : undefined;
    const flow = credential
      ? await this.repository.selection(row.taskId, row.workerId ?? undefined)
      : undefined;
    const accountId =
      flow?.origin === row.origin &&
      sameDestination(flow.destination, row.destination) &&
      !flow.confirmedAt
        ? flow.accountId
        : undefined;
    return {
      id: row.id,
      origin: row.origin,
      ...(row.destination.kind === 'android'
        ? { app: row.destination.packageName }
        : {}),
      kind: row.kind,
      chooseAccount: row.chooseAccount,
      status: row.status,
      inspectionId: row.status === 'pending' ? row.inspectionId : null,
      configured: this.vault.configured,
      ...(row.kind === 'card'
        ? {
            fields: Object.keys(row.fields ?? {}),
            cards:
              row.status === 'pending' &&
              row.chooseAccount &&
              this.vault.configured
                ? await this.cards().catch(() => [])
                : [],
          }
        : credential
          ? { ...credential, ...(accountId ? { accountId } : {}) }
          : {}),
      keepMeSignedIn: row.keepMeSignedIn,
      accounts:
        row.status === 'pending' &&
        row.kind === 'credentials' &&
        this.vault.configured
          ? await this.accounts(row.origin).catch(() => [])
          : [],
    };
  }
  private async cards() {
    return (await this.vault.cards()).map((item) => ({
      id: item.id,
      label: item.name,
      brand: item.card?.brand ?? '',
      lastFour: (item.card?.number ?? '').replace(/\D/g, '').slice(-4),
    }));
  }
  async submitCard(id: string, input: CardSubmission) {
    try {
      const row = await this.repository.finish(id, {
        kind: 'card',
        status: 'filled',
        submit: async (row) => {
          if (!row.fields || fieldKind(row.fields) !== 'card')
            throw new StaleSecureFieldsError();
          if (
            input.accountId &&
            (!row.chooseAccount ||
              input.save ||
              Object.entries(input).some(
                ([key, value]) => key !== 'accountId' && value != null,
              ))
          ) {
            throw new ApplicationError(
              'invalid_input',
              'Select a saved card or enter new details',
            );
          }
          const saved = input.accountId
            ? (await this.vault.cards()).find(
                (item) => item.id === input.accountId,
              )
            : undefined;
          if (input.accountId && !saved)
            throw new ApplicationError(
              'invalid_input',
              'Saved card is unavailable',
            );
          const values = cardValues(saved?.card ?? input);
          try {
            if (
              input.save &&
              (!values.number ||
                !values.cardholderName ||
                !values.expMonth ||
                !values.expYear ||
                !input.label?.trim())
            ) {
              throw new ApplicationError(
                'invalid_input',
                'A complete card and label are required to save',
              );
            }
            // Validate the live destination before persisting or filling anything.
            const target = await this.inspector.select(
              row.taskId,
              row.workerId ?? undefined,
              row.fields,
            );
            if (target.origin !== row.origin)
              throw new StaleSecureFieldsError();
            if (target.roles.some((role) => !values[role]))
              throw new ApplicationError(
                'invalid_input',
                'The card is missing required fields. Enter the details privately.',
              );
            const accountId = input.save
              ? await this.vault.saveCard(values, input.label!.trim(), row.id)
              : saved?.id;
            await this.fillRequest(row, values);
            return { accountId, filled: true };
          } finally {
            for (const key of Object.keys(values) as (keyof typeof values)[])
              values[key] = undefined;
            if (saved) saved.card = undefined;
          }
        },
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
      input.number =
        input.securityCode =
        input.cardholderName =
        input.expMonth =
        input.expYear =
          undefined;
    }
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
    try {
      const current = input ? await this.repository.current(id) : undefined;
      if (
        current?.destination.kind === 'android' &&
        input?.keepMeSignedIn !== undefined
      )
        throw new ApplicationError(
          'invalid_input',
          'Session preferences apply to browser logins',
        );
      const flow = current
        ? await this.repository.selection(
            current.taskId,
            current.workerId ?? undefined,
          )
        : undefined;
      const activeAccountId =
        current &&
        flow?.origin === current.origin &&
        sameDestination(flow.destination, current.destination) &&
        !flow.confirmedAt
          ? flow.accountId
          : undefined;
      const row = await this.repository.finish(
        id,
        input
          ? {
              kind: 'credentials',
              status: 'saved',
              submit: async (row) => {
                const roles = credentialRoles(row.fields);
                const supplied = (['username', 'password'] as const).filter(
                  (role) => input[role] !== undefined,
                );
                if (
                  supplied.some((role) => !roles.includes(role)) ||
                  roles.some((role) => !input[role])
                )
                  throw new ApplicationError(
                    'invalid_input',
                    'Enter only the requested login fields',
                  );
                const credentials: CredentialInput = {
                  ...Object.fromEntries(
                    roles.map((role) => [role, input[role]]),
                  ),
                  label: input.label,
                  accountId: input.accountId ?? activeAccountId,
                };
                const accountId = await this.vault.save(
                  row.origin,
                  credentials,
                  row.id,
                );
                const filled = await this.fillRequest(row, credentials).then(
                  () => true,
                  () => false,
                );
                return { accountId, filled };
              },
              keepMeSignedIn: input.keepMeSignedIn,
            }
          : undefined,
      );
      this.events.publish({ event: 'login.updated', taskId: row.taskId });
      void this.flushNotifications();
      return { id: row.id, status: row.status };
    } finally {
      if (input) {
        input.username = undefined;
        input.password = undefined;
      }
    }
  }
  async selectAccount(id: string, accountId: string, keepMeSignedIn?: boolean) {
    const row = await this.repository.finish(id, {
      kind: 'credentials',
      status: 'selected',
      keepMeSignedIn,
      submit: async (row) => {
        if (row.destination.kind === 'android' && keepMeSignedIn !== undefined)
          throw new ApplicationError(
            'invalid_input',
            'Session preferences apply to browser logins',
          );
        const account = (await this.vault.matching(row.origin)).find(
          (item) => item.id === accountId,
        );
        if (!account)
          throw new ApplicationError(
            'invalid_input',
            'Account does not match this website',
          );
        try {
          const filled = await this.fillRequest(
            row,
            account.login ?? {},
            accountId,
          ).then(
            () => true,
            () => false,
          );
          return { accountId, filled };
        } finally {
          if (account.login) {
            account.login.username = undefined;
            account.login.password = undefined;
          }
        }
      },
    });
    this.events.publish({ event: 'login.updated', taskId: row.taskId });
    void this.flushNotifications();
    return { id: row.id, status: row.status };
  }
  private async fillRequest(
    row: LoginRequest,
    values: Parameters<LoginBrowser['fill']>[3],
    accountId?: string,
  ) {
    if (!row.fields) throw new StaleSecureFieldsError();
    const target = await this.inspector.select(
      row.taskId,
      row.workerId ?? undefined,
      row.fields,
    );
    if (
      target.origin !== row.origin ||
      !sameDestination(target.destination, row.destination)
    )
      throw new StaleSecureFieldsError();
    if (
      accountId &&
      !(await this.vault.matching(target.url)).some(
        (item) => item.id === accountId,
      )
    )
      throw new StaleSecureFieldsError();
    await this.inspector.fill(
      row.taskId,
      row.workerId ?? undefined,
      row.fields,
      values,
    );
  }
  async submitCode(id: string, code: string) {
    try {
      const row = await this.repository.finish(id, {
        kind: 'code',
        status: 'filled',
        submit: async (row) => {
          if (!row.fields || !('code' in row.fields))
            throw new StaleSecureFieldsError();
          await this.fillRequest(row, { code });
        },
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
      if (flow?.destination.kind === 'android')
        throw new ApplicationError(
          'invalid_input',
          'Session preferences apply to browser logins',
        );
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
    return {
      status: 'recorded' as const,
      origin: flow.origin,
      ...(flow.destination.kind === 'browser'
        ? { keepMeSignedIn: flow.keepMeSignedIn }
        : {}),
    };
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
