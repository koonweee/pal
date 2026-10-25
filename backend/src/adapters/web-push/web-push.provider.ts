import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webPush from 'web-push';
import { notificationPreview } from '../../notifications/notification-preview.js';
import type {
  WebPushBadge,
  WebPushInstallation,
} from './web-push.repository.js';
import { validateSubscription } from './web-push.policy.js';

export type WebPushOutcome =
  | { kind: 'accepted' }
  | { kind: 'retryable'; code: string; retryAfterMs?: number }
  | { kind: 'invalid-registration' | 'permanent' | 'uncertain'; code: string };

export function webPushPayload(
  title: string,
  text: string,
  intentId: string,
  reaction?: string,
  badge?: WebPushBadge,
) {
  const plain = notificationPreview(text, reaction);
  const full = Array.from(plain || 'New message');
  const chars = full.slice(0, 1000);
  const content = {
    title,
    body: chars.join('') + (full.length > chars.length ? '…' : ''),
    tag: intentId,
    badge,
  };
  // Leaves room in a 4096-byte push for aes128gcm framing.
  while (
    Buffer.byteLength(JSON.stringify(content), 'utf8') > 3000 &&
    chars.length
  ) {
    chars.pop();
    content.body = chars.join('') + '…';
  }
  return JSON.stringify(content);
}

@Injectable()
export class WebPushProvider {
  readonly enabled: boolean;
  private readonly vapid?: {
    subject: string;
    publicKey: string;
    privateKey: string;
  };
  constructor(@Inject(ConfigService) config: ConfigService) {
    this.enabled = (
      config.get<string[]>('PAL_NOTIFICATION_DESTINATIONS') ?? []
    ).includes('web');
    if (this.enabled)
      this.vapid = {
        subject: config.getOrThrow<string>('PAL_WEB_PUSH_SUBJECT'),
        publicKey: config.getOrThrow<string>('PAL_WEB_PUSH_PUBLIC_KEY'),
        privateKey: config.getOrThrow<string>('PAL_WEB_PUSH_PRIVATE_KEY'),
      };
  }

  async send(
    installation: WebPushInstallation,
    payload: string,
  ): Promise<WebPushOutcome> {
    if (!this.enabled)
      return { kind: 'permanent', code: 'provider_unavailable' };
    try {
      validateSubscription({
        endpoint: installation.endpoint,
        keys: { p256dh: installation.p256dh, auth: installation.auth },
      });
    } catch {
      return { kind: 'permanent', code: 'invalid_subscription' };
    }
    try {
      await webPush.sendNotification(
        {
          endpoint: installation.endpoint,
          keys: { p256dh: installation.p256dh, auth: installation.auth },
        },
        payload,
        { TTL: 0, timeout: 15_000, vapidDetails: this.vapid },
      );
      return { kind: 'accepted' };
    } catch (error) {
      if (!(error instanceof webPush.WebPushError))
        return { kind: 'uncertain', code: 'transport_outcome_unknown' };
      const status = error.statusCode;
      const code = `http_${status}`;
      if (status === 404 || status === 410)
        return { kind: 'invalid-registration', code };
      if (status === 429 || status >= 500) {
        const value = error.headers['retry-after'];
        const raw = Array.isArray(value) ? value[0] : value;
        const delay =
          raw === undefined
            ? NaN
            : /^\d+$/.test(raw)
              ? Number(raw) * 1000
              : Date.parse(raw) - Date.now();
        return {
          kind: 'retryable',
          code,
          ...(Number.isFinite(delay)
            ? { retryAfterMs: Math.max(0, delay) }
            : {}),
        };
      }
      return { kind: 'permanent', code };
    }
  }
}
