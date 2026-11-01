import type { BrowserService } from '../browser/browser.service.js';
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
  private readonly web = new LoginBrowser();
  private readonly android: LoginAndroid;
  constructor(
    private readonly browser: BrowserService,
    android: AndroidService,
  ) {
    this.android = new LoginAndroid(android);
  }
  async inspect(
    taskId: string,
    workerId: string | undefined,
    surface: 'browser' | 'android',
    website?: string,
  ) {
    if (surface === 'android')
      return this.android.inspect(taskId, workerId, website);
    const page = await this.browser.selectedPage(taskId, workerId);
    return {
      ...(await this.web.inspect(page, loginOwner(taskId, workerId))),
      origin: new URL(page.url()).origin,
      destination: { kind: 'browser' } as SecureDestination,
    };
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
    if (this.native(fields))
      return this.android.select(taskId, workerId, fields);
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
  }
  async fill(
    taskId: string,
    workerId: string | undefined,
    fields: SecureFields,
    values: SecureValues,
  ) {
    if (this.native(fields))
      return this.android.fill(taskId, workerId, fields, values);
    return this.web.fill(
      await this.browser.selectedPage(taskId, workerId),
      loginOwner(taskId, workerId),
      fields,
      values,
    );
  }
}
