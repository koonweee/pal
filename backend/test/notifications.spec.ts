import request from 'supertest';
import { NotificationRepository } from '../dist/notifications/notification.repository.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { apnsPayload } from '../dist/adapters/apns/apns.provider.js';
import { webPushPayload } from '../dist/adapters/web-push/web-push.provider.js';
import { nextNotificationState } from '../dist/adapters/notifications/native-notification.dispatcher.js';
import { startTestApp } from './helpers.js';

describe('native notifications', () => {
  it('creates provider-neutral intent only for explicitly requested alerts', async () => {
    const fixture = await startTestApp({
      config: { PAL_NOTIFICATION_DESTINATIONS: ['ios'] },
    });
    try {
      const chat = fixture.app.get(ChatService);
      const notifications = fixture.app.get(NotificationRepository);
      const final = await chat.publish({
        role: 'assistant',
        text: 'Ready',
        notify: true,
        phase: 'final_answer',
        destinationIds: [],
      });
      const commentary = await chat.publish({
        role: 'assistant',
        text: 'Working',
        phase: 'commentary',
        destinationIds: [],
      });
      expect(final.deliveryDestinationIds).toEqual(['ios', 'web']);
      expect(final.notificationDestinationIds).toEqual(['ios', 'web']);
      expect(commentary.notificationDestinationIds).toEqual([]);
      expect(await notifications.list([final.id, commentary.id])).toMatchObject(
        [{ messageId: final.id, destinationId: 'ios', state: 'pending' }],
      );
      const target = await chat.publish({ role: 'user', text: 'Check this' });
      await chat.react(
        {
          messageRef: target.sequence,
          emoji: '👀',
          destinationIds: [],
          notify: false,
        },
        'quiet-reaction',
      );
      expect(await notifications.list([target.id])).toEqual([]);
      await chat.react(
        {
          messageRef: target.sequence,
          emoji: '✅',
          destinationIds: [],
          notify: true,
        },
        'alert-reaction',
      );
      expect(await notifications.list([target.id])).toMatchObject([
        {
          messageId: target.id,
          destinationId: 'ios',
          reaction: '✅',
          state: 'pending',
        },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it('registers one active iOS installation and revokes idempotently', async () => {
    const fixture = await startTestApp({
      config: { PAL_APNS_ENVIRONMENT: 'production' },
    });
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    try {
      await request(fixture.app.getHttpServer())
        .put(`/notifications/ios/installations/${first}`)
        .send({ token: 'ab'.repeat(32), environment: 'production' })
        .expect(200);
      await request(fixture.app.getHttpServer())
        .put(`/notifications/ios/installations/${second}`)
        .send({ token: 'cd'.repeat(32), environment: 'production' })
        .expect(200);
      const { rows } = await fixture.database.pool.query<{
        id: string;
        enabled: boolean;
      }>('select id, enabled from native_installations order by id');
      expect(rows).toEqual([
        { id: first, enabled: false },
        { id: second, enabled: true },
      ]);
      await request(fixture.app.getHttpServer())
        .delete(`/notifications/ios/installations/${second}`)
        .expect(204);
      await request(fixture.app.getHttpServer())
        .delete(`/notifications/ios/installations/${second}`)
        .expect(204);
    } finally {
      await fixture.close();
    }
  });

  it('quotes a bounded plain-text target in reaction alerts for both providers', () => {
    for (const [text, emoji, expected] of [
      [
        '**Thanks**\n[Pal](https://example.com)',
        '✅',
        'reacted ✅ to “Thanks Pal”',
      ],
      ['Take a look', '*️⃣', 'reacted *️⃣ to “Take a look”'],
      ['😀'.repeat(200), '👀', `reacted 👀 to “${'😀'.repeat(200)}”`],
      ['😀'.repeat(201), '👀', `reacted 👀 to “${'😀'.repeat(200)}…”`],
      ['', '✅', 'reacted ✅'],
    ]) {
      const message = { taskId: null, text };
      const native = JSON.parse(
        apnsPayload('Riley', 'installation-1', message, emoji),
      );
      const web = JSON.parse(webPushPayload('Pal', text, 'intent-1', emoji));
      expect(native.aps.alert.title).toBe('Riley');
      expect(native.aps.alert.body).toBe(expected);
      expect(web.body).toBe(expected);
    }
  });

  it('bounds APNs previews and classifies retries', () => {
    const payload = JSON.parse(
      apnsPayload('Riley', 'installation-1', {
        taskId: '11111111-1111-4111-8111-111111111111',
        text: `**${'hello '.repeat(1_000)}**`,
      }),
    ) as {
      aps: { alert: { body: string }; 'thread-id': string };
      installationId: string;
      taskId?: string;
    };
    expect(
      Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    ).toBeLessThanOrEqual(4_096);
    expect(payload.aps.alert.body).not.toContain('**');
    expect(payload.aps['thread-id']).toBe('main');
    expect(payload.taskId).toBeUndefined();
    expect(payload.installationId).toBe('installation-1');
    expect(nextNotificationState({ kind: 'accepted' }, 1)).toEqual({
      state: 'accepted',
    });
    expect(
      nextNotificationState({ kind: 'retryable', code: 'http_503' }, 4),
    ).toEqual({ state: 'failed', errorCode: 'http_503' });
  });
});
