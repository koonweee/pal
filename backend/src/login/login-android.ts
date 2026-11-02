import { randomUUID } from 'node:crypto';
import type { AndroidService } from '../android/android.service.js';
import type {
  NativeInput,
  NativeSnapshot,
  NativeStatus,
} from '../android/android-native.js';
import { ApplicationError } from '../application/contracts/errors.js';
import {
  selectedFields,
  fieldKind,
  StaleSecureFieldsError,
  type LoginInput,
  type SecureFields,
  type SecureValues,
  type SecureDestination,
} from './login-fields.js';

interface Binding {
  owner: string;
  session: string;
  generation: number;
  at: number;
  inspectionId: string;
  origin: string;
  destination: Extract<SecureDestination, { kind: 'android' }>;
  native: NativeInput;
}
export class LoginAndroid {
  private readonly inputs = new Map<string, Binding>();
  constructor(private readonly android: AndroidService) {}

  private identity(taskId: string, workerId?: string) {
    if (!workerId)
      throw new ApplicationError(
        'invalid_input',
        'Android private entry requires an interaction worker',
      );
    return { taskId, workerId };
  }
  has(ref: string) {
    return this.inputs.has(ref);
  }
  live(
    taskId: string,
    workerId: string | undefined,
    fields: SecureFields | null,
  ) {
    if (!fields || !workerId)
      return false;
    return selectedFields(fields).every(([, ref]) => {
      const input = this.inputs.get(ref);
      return (
        !!input &&
        input.owner === taskId + ':' + workerId &&
        input.generation === this.android.generation &&
        Date.now() - input.at < 10 * 60_000
      );
    });
  }
  async inspect(taskId: string, workerId?: string, website?: string) {
    let origin: string;
    try {
      const url = new URL(website ?? '');
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error();
      origin = url.origin;
    } catch {
      throw new ApplicationError(
        'invalid_input',
        'Supply the HTTPS account website for Android private entry',
      );
    }
    const identity = this.identity(taskId, workerId);
    const snapshot = await this.android.secure<NativeSnapshot | NativeStatus>(
      identity,
      { action: 'inspect' },
    );
    if (snapshot.status !== 'ready')
      throw new ApplicationError(
        'unavailable',
        'Android private inspection unavailable; wait for the screen to settle',
      );
    const owner = taskId + ':' + workerId;
    for (const [ref, input] of this.inputs)
      if (input.owner === owner || Date.now() - input.at >= 10 * 60_000)
        this.inputs.delete(ref);
    const inspectionId = randomUUID();
    const destination: Extract<SecureDestination, { kind: 'android' }> = {
      kind: 'android',
      packageName: snapshot.identity.packageName,
    };
    const inputs: LoginInput[] = snapshot.inputs.map((native) => {
      this.inputs.set(native.ref, {
        owner,
        session: snapshot.session,
        generation: this.android.generation,
        at: Date.now(),
        inspectionId,
        origin,
        destination,
        native,
      });
      const variation = native.inputType & 0xfff;
      const type = native.password
        ? 'password'
        : (native.inputType & 15) === 3
          ? 'tel'
          : (native.inputType & 15) === 2
            ? 'number'
            : variation === 0x21 || variation === 0xd1
              ? 'email'
              : 'text';
      return {
        ref: native.ref,
        origin,
        type,
        autocomplete: '',
        label: native.label || native.identifier,
        group: destination.packageName,
        inputType: native.inputType,
        ...(native.maxLength > 0 ? { maxLength: native.maxLength } : {}),
      };
    });
    return {
      origin,
      destination,
      inputs,
      image: Buffer.from(snapshot.image, 'base64'),
      inspectionId,
      screen: {
        width: snapshot.width,
        height: snapshot.height,
        imageWidth: snapshot.imageWidth,
        imageHeight: snapshot.imageHeight,
      },
    };
  }
  url(taskId: string, workerId: string | undefined, ref: string) {
    if (!this.live(taskId, workerId, { username: ref }))
      throw new StaleSecureFieldsError();
    return this.inputs.get(ref)!.origin;
  }
  async select(
    taskId: string,
    workerId: string | undefined,
    fields: SecureFields,
  ) {
    const identity = this.identity(taskId, workerId);
    if (fieldKind(fields) === 'card')
      throw new ApplicationError(
        'invalid_input',
        'Android payment entry is unavailable',
      );
    const selected = selectedFields(fields);
    if (!this.live(taskId, workerId, fields))
      throw new StaleSecureFieldsError();
    const first = this.inputs.get(selected[0][1])!;
    for (const [, ref] of selected) {
      const input = this.inputs.get(ref)!;
      if (input.inspectionId !== first.inspectionId)
        throw new StaleSecureFieldsError();
    }
    const result = await this.android.secure<NativeStatus>(identity, {
      action: 'validate',
      session: first.session,
      packageName: first.destination.packageName,
      fields: selected.map(([role, ref]) => ({ role, ref })),
    });
    if (result.status !== 'valid') throw new StaleSecureFieldsError();
    return {
      origin: first.origin,
      url: first.origin,
      roles: [...new Set(selected.map(([role]) => role))],
      inspectionId: first.inspectionId,
      destination: first.destination,
    };
  }
  async fill(
    taskId: string,
    workerId: string | undefined,
    fields: SecureFields,
    values: SecureValues,
  ) {
    const target = await this.select(taskId, workerId, fields);
    const selected = selectedFields(fields);
    const first = this.inputs.get(selected[0][1])!;
    const code = values.code?.trim();
    if (
      target.roles.includes('code') &&
      (!code ||
        code.length > 64 ||
        /\s/.test(code) ||
        (selected.length > 1 && code.length !== selected.length))
    )
      throw new ApplicationError(
        'invalid_input',
        'Enter a complete verification code',
      );
    const prepared = selected.map(([role, ref], index) => {
      const value =
        role === 'code'
          ? selected.length > 1
            ? code![index]
            : code!
          : values[role];
      const max = this.inputs.get(ref)!.native.maxLength;
      if (!value || value.length > 4096 || (max > 0 && value.length > max))
        throw new ApplicationError(
          'invalid_input',
          'Secure entry is missing or exceeds the selected input length',
        );
      return { role, ref, value };
    });
    try {
      const result = await this.android.secure<NativeStatus>(
        this.identity(taskId, workerId),
        {
          action: 'fill',
          session: first.session,
          packageName: target.destination.packageName,
          fields: prepared,
        },
      );
      if (result.status !== 'filled')
        throw new ApplicationError(
          'conflict',
          result.code === 'partial_fill'
            ? 'Android filling may be partial. Inspect current state before deciding the next step; do not replay this fill.'
            : 'Android field selection changed. Inspect again before filling.',
        );
      return { status: 'filled' as const, fields: target.roles };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        'unavailable',
        'Android filling could not be confirmed. Inspect current state and do not replay the previous fill.',
      );
    } finally {
      for (const field of prepared) field.value = '';
    }
  }
}
