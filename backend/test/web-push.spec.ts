import { generateVAPIDKeys } from 'web-push';
import webPush from 'web-push';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { vi } from 'vitest';
import { startTestApp } from './helpers.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { NotificationRepository } from '../dist/notifications/notification.repository.js';
import { WebPushRepository } from '../dist/adapters/web-push/web-push.repository.js';
import { WebPushDispatcher } from '../dist/adapters/web-push/web-push.dispatcher.js';
import {
  WebPushProvider,
  webPushPayload,
} from '../dist/adapters/web-push/web-push.provider.js';
import { validateEnvironment } from '../dist/config/configuration.js';

const keys = generateVAPIDKeys();
const config = {
  PAL_NOTIFICATION_DESTINATIONS: ['web'],
  PAL_WEB_PUSH_PUBLIC_KEY: keys.publicKey,
  PAL_WEB_PUSH_PRIVATE_KEY: keys.privateKey,
  PAL_WEB_PUSH_SUBJECT: 'mailto:owner@example.com',
};
const subscription = (suffix: string) => ({
  endpoint: 'https://fcm.googleapis.com/fcm/send/' + suffix,
  keys: {
    p256dh: keys.publicKey,
    auth: Buffer.alloc(16, 7).toString('base64url'),
  },
});

beforeEach(() => {
  vi.spyOn(
    WebPushDispatcher.prototype,
    'onApplicationBootstrap',
  ).mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

describe('Web Push', () => {
  it('requires a complete matching VAPID configuration', () => {
    const base = {
      DATABASE_URL: 'postgresql://pal:pal@localhost/pal_test',
      PAL_UPLOAD_DIR: '/tmp/pal-test',
    };
    expect(validateEnvironment(base).PAL_NOTIFICATION_DESTINATIONS).toEqual([]);
    expect(
      validateEnvironment({ ...base, ...config }).PAL_NOTIFICATION_DESTINATIONS,
    ).toEqual(['web']);
    expect(() =>
      validateEnvironment({ ...base, PAL_WEB_PUSH_PUBLIC_KEY: keys.publicKey }),
    ).toThrow('together');
    expect(() =>
      validateEnvironment({
        ...base,
        ...config,
        PAL_WEB_PUSH_PRIVATE_KEY: generateVAPIDKeys().privateKey,
      }),
    ).toThrow('matching');
  });

  it('registers independently by endpoint, validates requests, and revokes idempotently', async () => {
    const fixture = await startTestApp({ config });
    try {
      const server = fixture.app.getHttpServer();
      const first = await request(server)
        .post('/notifications/web/installations')
        .send(subscription('one'))
        .expect(201);
      const repeated = await request(server)
        .post('/notifications/web/installations')
        .send(subscription('one'))
        .expect(201);
      const second = await request(server)
        .post('/notifications/web/installations')
        .send(subscription('two'))
        .expect(201);
      expect(repeated.body).toEqual(first.body);
      expect(Object.keys(first.body)).toEqual(['id']);
      expect(
        (
          await fixture.database.pool.query(
            'select enabled, generation from web_push_installations',
          )
        ).rows,
      ).toEqual([
        { enabled: true, generation: 1 },
        { enabled: true, generation: 1 },
      ]);
      await request(server)
        .post('/notifications/web/installations')
        .send({ ...subscription('bad'), endpoint: 'https://127.0.0.1/private' })
        .expect(400);
      await request(server)
        .post('/notifications/web/installations')
        .send({
          ...subscription('bad'),
          endpoint: 'https://fcm.googleapis.com.evil.test/send',
        })
        .expect(400);
      await request(server)
        .post('/notifications/web/installations')
        .set('origin', 'https://evil.test')
        .send(subscription('bad'))
        .expect(403);
      await request(server)
        .post('/notifications/web/installations')
        .send({ endpoint: subscription('bad').endpoint })
        .expect(400);
      await request(server)
        .delete('/notifications/web/installations/' + first.body.id)
        .expect(204);
      await request(server)
        .delete('/notifications/web/installations/' + first.body.id)
        .expect(204);
      expect(
        (
          await fixture.database.pool.query(
            'select id from web_push_installations where enabled',
          )
        ).rows,
      ).toEqual([{ id: second.body.id }]);
    } finally {
      await fixture.close();
    }
  });

  it('materializes recipients atomically and excludes late or re-enabled generations', async () => {
    const fixture = await startTestApp({ config });
    try {
      const repository = fixture.app.get(WebPushRepository);
      const intents = fixture.app.get(NotificationRepository);
      const chat = fixture.app.get(ChatService);
      const first = await repository.register(subscription('one'));
      const second = await repository.register(subscription('two'));
      const message = await chat.publish({
        role: 'assistant',
        text: 'Ready',
        notify: true,
      });
      await expect(
        intents.expand('web', async (intent, tx) => {
          await repository.materialize(intent, tx);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(
        (await fixture.database.pool.query('select * from web_push_deliveries'))
          .rows,
      ).toEqual([]);
      const [intent] = await intents.list([message.id]);
      expect(intent.state).toBe('pending');
      expect(
        intent.expiresAt.getTime() - intent.createdAt.getTime(),
      ).toBeLessThanOrEqual(300_010);
      await repository.register(subscription('late'));
      await repository.disable(second.id);
      await repository.register(subscription('two'));
      // Make activation ordering explicit even on clocks with millisecond precision.
      await fixture.database.pool.query(
        'update web_push_installations set activated_at = $1 where id <> $2',
        [new Date(intent.createdAt.getTime() + 1), first.id],
      );
      expect(
        await intents.expand('web', (value, tx) =>
          repository.materialize(value, tx),
        ),
      ).toBe(true);
      expect(
        await intents.expand('web', (value, tx) =>
          repository.materialize(value, tx),
        ),
      ).toBe(false);
      expect(
        (
          await fixture.database.pool.query(
            'select installation_id from web_push_deliveries',
          )
        ).rows,
      ).toEqual([{ installation_id: first.id }]);
      expect((await intents.list([message.id]))[0].state).toBe('expanded');
    } finally {
      await fixture.close();
    }
  });

  it('retries only the rejected recipient and cancels stale, expired, and superseded work', async () => {
    const fixture = await startTestApp({ config });
    try {
      const repository = fixture.app.get(WebPushRepository);
      const provider = fixture.app.get(WebPushProvider);
      const dispatcher = fixture.app.get(WebPushDispatcher);
      const chat = fixture.app.get(ChatService);
      const first = await repository.register(subscription('one'));
      await repository.register(subscription('two'));
      await chat.publish({
        role: 'assistant',
        text: '**Ready**',
        notify: true,
      });
      const send = vi
        .spyOn(provider, 'send')
        .mockImplementation(async (installation) =>
          installation.id === first.id
            ? { kind: 'accepted' }
            : { kind: 'retryable', code: 'http_503', retryAfterMs: 5000 },
        );
      await dispatcher.drain();
      expect(send).toHaveBeenCalledTimes(2);
      expect(
        JSON.parse(
          send.mock.calls.find(
            ([installation]) => installation.id === first.id,
          )![1],
        ),
      ).toMatchObject({
        body: 'Ready',
        badge: { installationId: first.id, generation: 1, count: 1 },
      });
      const rows = (
        await fixture.database.pool.query(
          'select * from web_push_deliveries order by installation_id',
        )
      ).rows;
      expect(rows.find((row) => row.installation_id === first.id).state).toBe(
        'accepted',
      );
      const retry = rows.find((row) => row.installation_id !== first.id);
      expect(retry.state).toBe('pending');
      expect(new Date(retry.next_attempt_at).getTime()).toBeGreaterThan(
        Date.now() + 3500,
      );
      await fixture.database.pool.query(
        "update web_push_deliveries set next_attempt_at = now() where state = 'pending'",
      );
      send.mockResolvedValue({ kind: 'uncertain', code: 'timeout' });
      await dispatcher.drain();
      await dispatcher.drain();
      expect(send).toHaveBeenCalledTimes(3);

      const target = await chat.publish({ role: 'user', text: 'Look' });
      await chat.react(
        {
          messageRef: target.sequence,
          emoji: '👀',
          destinationIds: [],
          notify: true,
        },
        'first',
      );
      await chat.react(
        {
          messageRef: target.sequence,
          emoji: '✅',
          destinationIds: [],
          notify: false,
        },
        'second',
      );
      await dispatcher.drain();
      expect(send).toHaveBeenCalledTimes(3);
      const stale = (
        await fixture.database.pool.query(
          "select error_code from web_push_deliveries where error_code = 'superseded_reaction'",
        )
      ).rows;
      expect(stale).toHaveLength(2);

      const expired = await chat.publish({
        role: 'assistant',
        text: 'Old',
        notify: true,
      });
      await fixture.database.pool.query(
        "update notification_intents set expires_at = now() - interval '1 second' where message_id = $1",
        [expired.id],
      );
      await dispatcher.drain();
      expect(send).toHaveBeenCalledTimes(3);

      const next = await chat.publish({
        role: 'assistant',
        text: 'Next',
        notify: true,
      });
      await fixture.app
        .get(NotificationRepository)
        .expand('web', (value, tx) => repository.materialize(value, tx));
      await repository.disable(first.id);
      const replacement = await repository.register(subscription('one'));
      await repository.disable(first.id, first.generation);
      expect(replacement.generation).toBe(2);
      expect(
        (
          await fixture.database.pool.query(
            'select enabled from web_push_installations where id = $1',
            [first.id],
          )
        ).rows[0].enabled,
      ).toBe(true);
      send.mockResolvedValue({ kind: 'accepted' });
      await dispatcher.drain();
      expect(send).toHaveBeenCalledTimes(4);
      expect(
        (
          await fixture.database.pool.query(
            'select d.error_code from web_push_deliveries d join notification_intents i on i.id = d.intent_id where i.message_id = $1 and d.installation_id = $2',
            [next.id, first.id],
          )
        ).rows[0].error_code,
      ).toBe('registration_changed');
      await fixture.database.pool.query(
        "update web_push_deliveries set state = 'sending' where state = 'accepted'",
      );
      await repository.recoverInterrupted();
      expect(
        (
          await fixture.database.pool.query(
            "select * from web_push_deliveries where state = 'sending'",
          )
        ).rows,
      ).toEqual([]);
      await chat.react(
        {
          messageRef: target.sequence,
          emoji: '✅',
          destinationIds: [],
          notify: true,
        },
        'preview',
      );
      await dispatcher.drain();
      expect(send).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.stringContaining('reacted ✅ to “Look”'),
      );
    } finally {
      await fixture.close();
    }
  });

  it('bounds provider retries and disables rejected subscriptions', async () => {
    const fixture = await startTestApp({ config });
    try {
      const repository = fixture.app.get(WebPushRepository);
      const intents = fixture.app.get(NotificationRepository);
      const dispatcher = fixture.app.get(WebPushDispatcher);
      const chat = fixture.app.get(ChatService);
      const installation = await repository.register(subscription('bounded'));
      const send = vi.spyOn(fixture.app.get(WebPushProvider), 'send');
      const cases = [
        {
          outcome: {
            kind: 'retryable' as const,
            code: 'http_429',
            retryAfterMs: 600_000,
          },
          attempts: 0,
          state: 'cancelled',
          error: 'expired',
        },
        {
          outcome: { kind: 'retryable' as const, code: 'http_503' },
          attempts: 3,
          state: 'failed',
          error: 'http_503',
        },
        {
          outcome: { kind: 'invalid-registration' as const, code: 'http_410' },
          attempts: 0,
          state: 'failed',
          error: 'http_410',
        },
      ];
      for (const item of cases) {
        const message = await chat.publish({
          role: 'assistant',
          text: 'Bounded alert',
          notify: true,
        });
        await intents.expand('web', (intent, tx) =>
          repository.materialize(intent, tx),
        );
        await fixture.database.pool.query(
          'update web_push_deliveries set attempts = $1 where intent_id in (select id from notification_intents where message_id = $2)',
          [item.attempts, message.id],
        );
        send.mockResolvedValue(item.outcome);
        await dispatcher.drain();
        const { rows } = await fixture.database.pool.query(
          'select d.state, d.error_code from web_push_deliveries d join notification_intents i on i.id = d.intent_id where i.message_id = $1',
          [message.id],
        );
        expect(rows).toEqual([{ state: item.state, error_code: item.error }]);
      }
      await dispatcher.drain();
      expect(send).toHaveBeenCalledTimes(3);
      expect(
        (
          await fixture.database.pool.query(
            'select enabled from web_push_installations where id = $1',
            [installation.id],
          )
        ).rows,
      ).toEqual([{ enabled: false }]);
    } finally {
      await fixture.close();
    }
  });

  it('counts unseen publications independently of transport and acknowledges only the captured installation boundary', async () => {
    const fixture = await startTestApp({ config });
    try {
      const server = fixture.app.getHttpServer();
      const repository = fixture.app.get(WebPushRepository);
      const chat = fixture.app.get(ChatService);
      await chat.publish({
        role: 'assistant',
        text: 'Before opt-in',
        notify: true,
      });
      const phone = await repository.register(subscription('phone'));
      const laptop = await repository.register(subscription('laptop'));
      const badgePath =
        '/notifications/web/installations/' + phone.id + '/badge';
      expect(
        (await request(server).get(badgePath).expect(200)).body.count,
      ).toBe(0);
      const message = await chat.publish({
        role: 'assistant',
        text: 'Ready',
        notify: true,
      });
      await chat.publish({ role: 'assistant', text: 'Quiet', notify: false });
      await chat.react(
        {
          messageRef: message.sequence,
          emoji: '✅',
          destinationIds: [],
          notify: true,
        },
        'badge-reaction',
      );
      const before = (await request(server).get(badgePath).expect(200)).body;
      expect(before.count).toBe(2);
      expect(await repository.badge(phone.id)).toEqual(before);
      // An offline/expired push remains an unseen publication.
      await fixture.database.pool.query(
        "update notification_intents set state = 'cancelled', expires_at = now() - interval '1 second' where destination_id = 'web'",
      );
      expect((await repository.badge(phone.id)).count).toBe(2);
      await chat.publish({
        role: 'assistant',
        text: 'Arrived while opening',
        notify: true,
      });
      const receipt = { generation: phone.generation, through: before.through };
      const after = (
        await request(server).put(badgePath).send(receipt).expect(200)
      ).body;
      expect(after.count).toBe(1);
      expect(after.revision).toBeGreaterThan(before.revision);
      expect(
        (await request(server).put(badgePath).send(receipt).expect(200)).body,
      ).toEqual(after);
      expect((await repository.badge(laptop.id)).count).toBe(3);
      await request(server)
        .put(badgePath)
        .send({ ...receipt, through: after.through + 1 })
        .expect(409);
      await request(server)
        .put(badgePath)
        .send({ ...receipt, through: -1 })
        .expect(400);
      await request(server)
        .put(badgePath)
        .send(receipt)
        .set('origin', 'https://evil.test')
        .expect(403);
      await repository.disable(phone.id);
      await request(server).get(badgePath).expect(404);
      const replacement = await repository.register(subscription('phone'));
      expect(replacement.generation).toBe(2);
      expect((await repository.badge(phone.id)).count).toBe(0);
      await request(server).put(badgePath).send(receipt).expect(409);
      // Concurrent publications commit in the same order as their badge positions.
      await Promise.all(
        ['One', 'Two'].map((text) =>
          chat.publish({ role: 'assistant', text, notify: true }),
        ),
      );
      const final = await repository.badge(phone.id);
      expect(final.count).toBe(2);
      const cleared = await repository.badge(phone.id, {
        generation: 2,
        through: final.through,
      });
      expect(cleared.count).toBe(0);
      expect(cleared.revision).toBeGreaterThan(final.revision);
      expect((await repository.badge(laptop.id)).count).toBe(5);
    } finally {
      await fixture.close();
    }
  });

  it('uses zero TTL, bounds payloads, and classifies provider errors without exposing them', async () => {
    const provider = new WebPushProvider(new ConfigService(config));
    const installation = {
      ...subscription('one'),
      p256dh: keys.publicKey,
      auth: subscription('one').keys.auth,
    } as Parameters<WebPushProvider['send']>[0];
    const payload = webPushPayload('Assistant', '🙂'.repeat(5000), 'intent');
    expect(Buffer.byteLength(payload)).toBeLessThanOrEqual(3000);
    const send = vi
      .spyOn(webPush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    expect(await provider.send(installation, payload)).toEqual({
      kind: 'accepted',
    });
    expect(send.mock.calls[0][2]).toMatchObject({ TTL: 0, timeout: 15000 });
    send.mockRejectedValue(
      new webPush.WebPushError(
        'secret',
        503,
        { 'retry-after': '20' },
        'secret',
        installation.endpoint,
      ),
    );
    expect(await provider.send(installation, payload)).toEqual({
      kind: 'retryable',
      code: 'http_503',
      retryAfterMs: 20000,
    });
    send.mockRejectedValue(
      new webPush.WebPushError('secret', 410, {}, '', installation.endpoint),
    );
    expect(await provider.send(installation, payload)).toEqual({
      kind: 'invalid-registration',
      code: 'http_410',
    });
    send.mockRejectedValue(new Error('endpoint secret'));
    expect(await provider.send(installation, payload)).toEqual({
      kind: 'uncertain',
      code: 'transport_outcome_unknown',
    });
  });
});
