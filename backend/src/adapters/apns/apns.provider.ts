import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { connect, type ClientHttp2Session } from 'node:http2';
import type { UserVisibleMessage } from '../../chat/chat.types.js';
import { notificationPreview } from '../../notifications/notification-preview.js';
import type { NotificationIntent } from '../../notifications/notification.repository.js';
import type { NativeInstallation } from '../notifications/native-installation.repository.js';

export type NativeNotificationOutcome =
  | { kind: 'accepted' }
  | { kind: 'retryable'; code: string }
  | { kind: 'invalid-registration'; code: string }
  | { kind: 'permanent'; code: string }
  | { kind: 'uncertain'; code: string };

export function apnsPayload(
  title: string,
  installationId: string,
  message: Pick<UserVisibleMessage, 'taskId' | 'text'>,
  reaction?: string,
) {
  const content = {
    aps: {
      alert: {
        title,
        body: notificationPreview(message.text, reaction) || 'New message',
      },
      sound: 'default',
      'thread-id': 'main',
      'content-available': 1,
    },
    installationId,
  };
  let payload = JSON.stringify(content);
  const characters = Array.from(content.aps.alert.body);
  while (Buffer.byteLength(payload, 'utf8') > 4_096 && characters.length) {
    characters.pop();
    content.aps.alert.body = characters.length ? `${characters.join('')}…` : '';
    payload = JSON.stringify(content);
  }
  return payload;
}

@Injectable()
export class ApnsProvider {
  readonly enabled: boolean;
  private readonly teamId?: string;
  private readonly keyId?: string;
  private readonly topic?: string;
  private readonly environment?: 'development' | 'production';
  private readonly key?: KeyObject;
  private session?: ClientHttp2Session;
  private jwt?: { value: string; at: number };
  private closed = false;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.teamId = config.get<string>('PAL_APNS_TEAM_ID');
    this.keyId = config.get<string>('PAL_APNS_KEY_ID');
    this.topic = config.get<string>('PAL_APNS_TOPIC');
    this.environment = config.get<'development' | 'production'>(
      'PAL_APNS_ENVIRONMENT',
    );
    const privateKey = config.get<string>('PAL_APNS_PRIVATE_KEY');
    this.enabled = !!(
      this.teamId &&
      this.keyId &&
      this.topic &&
      this.environment &&
      privateKey
    );
    if (privateKey) this.key = createPrivateKey(privateKey);
  }

  private token() {
    const now = Math.floor(Date.now() / 1000);
    if (this.jwt && now - this.jwt.at < 3_000) return this.jwt.value;
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = `${encode({ alg: 'ES256', kid: this.keyId })}.${encode({ iss: this.teamId, iat: now })}`;
    const signature = sign('sha256', Buffer.from(body), {
      key: this.key!,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    this.jwt = { value: `${body}.${signature}`, at: now };
    return this.jwt.value;
  }

  async send(
    installation: NativeInstallation,
    intent: NotificationIntent,
    message: UserVisibleMessage,
    title: string,
  ): Promise<NativeNotificationOutcome> {
    if (
      !this.enabled ||
      this.closed ||
      installation.environment !== this.environment
    )
      return { kind: 'permanent', code: 'provider_unavailable' };
    if (!this.session || this.session.closed || this.session.destroyed) {
      this.session = connect(
        this.environment === 'production'
          ? 'https://api.push.apple.com'
          : 'https://api.sandbox.push.apple.com',
      );
      const session = this.session;
      session.on('error', () => session.destroy());
      session.on('goaway', () => session.close());
    }
    const session = this.session;
    try {
      const response = await new Promise<{ status: number; reason?: string }>(
        (resolve, reject) => {
          const request = session.request({
            ':method': 'POST',
            ':path': `/3/device/${installation.token}`,
            authorization: `bearer ${this.token()}`,
            'apns-topic': this.topic!,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'apns-id': intent.id,
            'apns-expiration': String(
              Math.floor(intent.expiresAt.getTime() / 1000),
            ),
            'apns-collapse-id': intent.id,
          });
          let status = 0;
          let body = '';
          let settled = false;
          const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) return reject(error);
            try {
              resolve({
                status,
                reason: body
                  ? (JSON.parse(body) as { reason?: string }).reason
                  : undefined,
              });
            } catch {
              reject(new Error('Invalid APNs response'));
            }
          };
          const timer = setTimeout(() => {
            finish(new Error('timeout'));
            request.close();
          }, 15_000);
          request.setEncoding('utf8');
          request.on('response', (headers) => {
            status = Number(headers[':status']);
          });
          request.on('data', (chunk: string) => {
            body += chunk;
            if (body.length > 8_192) {
              finish(new Error('response too large'));
              request.close();
            }
          });
          request.on('end', () =>
            status ? finish() : finish(new Error('missing response status')),
          );
          request.on('error', () => finish(new Error('transport')));
          request.on('close', () => finish(new Error('closed')));
          request.end(
            apnsPayload(
              title,
              installation.id,
              message,
              intent.reaction ?? undefined,
            ),
          );
        },
      );
      if (response.status === 200) return { kind: 'accepted' };
      const code = /^[A-Za-z]{1,64}$/.test(response.reason ?? '')
        ? response.reason!
        : `http_${response.status}`;
      if (
        ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(
          response.reason ?? '',
        )
      )
        return { kind: 'invalid-registration', code };
      if (response.status === 429 || response.status >= 500)
        return { kind: 'retryable', code };
      return { kind: 'permanent', code };
    } catch {
      return { kind: 'uncertain', code: 'transport_outcome_unknown' };
    }
  }

  close() {
    this.closed = true;
    this.session?.destroy();
  }
}
