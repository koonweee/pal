import type { SharedBrowserService } from '../browser/shared-browser.service.js';
import type { InteractionCoordinator } from '../interaction/interaction-coordinator.js';
import type { AndroidService } from '../android/android.service.js';
import { ApplicationError } from '../application/contracts/errors.js';
import { LoginBrowser } from './login-browser.js';
import { LoginAndroid } from './login-android.js';
import { loginOwner } from './login.repository.js';
import {
  selectedFields,
  type SecureFields,
  type SecureValues,
  type SecureDestination,
} from './login-fields.js';

/** The shared workflow owns policy; these adapters own destination mechanics. */
export class LoginDestinations {
  private readonly web: LoginBrowser;
  private readonly android: LoginAndroid;
  constructor(
    private readonly browser: SharedBrowserService,
    android: AndroidService,
    private readonly coordinator: InteractionCoordinator,
  ) {
    this.web = new LoginBrowser(() => this.coordinator.unavailable('desktop'));
    this.android = new LoginAndroid(android);
  }
  private async withBrowser<T>(
    operation: () => Promise<T>,
    interacts: boolean,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            // Renderer/CDP timeout is not proof that dispatched work stopped.
            if (interacts) this.coordinator.unavailable('desktop');
            reject(
              new ApplicationError(
                'unavailable',
                interacts
                  ? 'Private browser interaction timed out. Recover the desktop before continuing; do not replay a fill.'
                  : 'Private browser observation timed out. Inspect again before continuing.',
              ),
            );
          }, 30_000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
  async inspect(
    taskId: string,
    workerId: string | undefined,
    surface: 'browser' | 'android',
    website?: string,
  ) {
    return this.coordinator.forSession(
      surface === 'android' ? 'android' : 'desktop',
      { taskId, workerId: workerId ?? 'task' },
      async () => {
        if (surface === 'android')
          return this.android.inspect(taskId, workerId, website);
        return this.withBrowser(async () => {
          const page = await this.browser.selectedPage(taskId, workerId, true);
          return {
            ...(await this.web.inspect(page, loginOwner(taskId, workerId))),
            origin: new URL(page.url()).origin,
            destination: { kind: 'browser' } as SecureDestination,
          };
        }, true);
      },
    );
  }
  withFields<T>(
    taskId: string,
    workerId: string | undefined,
    fields: SecureFields,
    operation: () => Promise<T>,
  ) {
    return this.coordinator.forSession(
      this.native(fields) ? 'android' : 'desktop',
      { taskId, workerId: workerId ?? 'task' },
      operation,
    );
  }
  native(fields: SecureFields) {
    const refs = selectedFields(fields).map(([, ref]) => this.android.has(ref));
    if (refs.some(Boolean) && !refs.every(Boolean))
      throw new ApplicationError(
        'invalid_input',
        'Secure fields must belong to one destination',
      );
    return refs.every(Boolean);
  }
  url(taskId: string, workerId: string | undefined, ref: string) {
    return this.android.has(ref)
      ? this.android.url(taskId, workerId, ref)
      : this.web.url(loginOwner(taskId, workerId), ref);
  }
  live(
    taskId: string,
    workerId: string | undefined,
    fields: SecureFields | null,
  ) {
    if (!fields) return false;
    return this.native(fields)
      ? this.android.live(taskId, workerId, fields)
      : this.web.live(loginOwner(taskId, workerId), fields);
  }
  async select(
    taskId: string,
    workerId: string | undefined,
    fields: SecureFields,
  ) {
    return this.withFields(taskId, workerId, fields, async () => {
      if (this.native(fields))
        return this.android.select(taskId, workerId, fields);
      return this.withBrowser(async () => {
        const page = await this.browser.selectedPage(taskId, workerId);
        const { origin, url, roles, inspectionId } = await this.web.select(
          page,
          loginOwner(taskId, workerId),
          fields,
        );
        return {
          origin,
          url,
          roles,
          inspectionId,
          destination: { kind: 'browser' } as SecureDestination,
        };
      }, false);
    });
  }
  async fill(
    taskId: string,
    workerId: string | undefined,
    fields: SecureFields,
    values: SecureValues,
  ) {
    return this.withFields(taskId, workerId, fields, async () => {
      if (this.native(fields))
        return this.android.fill(taskId, workerId, fields, values);
      return this.withBrowser(
        async () =>
          this.web.fill(
            await this.browser.selectedPage(taskId, workerId),
            loginOwner(taskId, workerId),
            fields,
            values,
          ),
        true,
      );
    });
  }
}
