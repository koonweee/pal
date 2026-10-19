import { randomUUID } from 'node:crypto';
import { parsePublicResponse } from '../dist/agent/public-output.js';
import { Readable } from 'node:stream';
import { startTestApp, until } from './helpers.js';
import { SecondaryIngressService } from '../dist/adapters/secondary/secondary-ingress.service.js';
import { SecondaryDriverHostService } from '../dist/adapters/secondary/secondary-driver-host.service.js';
import type {
  SecondaryDriver,
  SecondaryOutput,
} from '../dist/adapters/secondary/secondary-driver.js';
import { DestinationRepository } from '../dist/delivery/destination.repository.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { deliveryJobs } from '../dist/database/schema.js';
import { externalMessageReferences } from '../dist/database/secondary.schema.js';
import { eq } from 'drizzle-orm';
import { setTimeout } from 'node:timers/promises';
import { DeliveryJobRepository } from '../dist/delivery/delivery-job.repository.js';

let fixture: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  fixture = await startTestApp();
});

afterAll(async () => fixture.close());
beforeEach(async () => {
  await fixture.reset();
  await fixture.app.get(DestinationRepository).setEnabled('telegram', true);
});

it('cancels disabled pending work and marks interrupted sends uncertain', async () => {
  const chat = fixture.app.get(ChatService);
  const repository = fixture.app.get(DeliveryJobRepository);
  const destinations = fixture.app.get(DestinationRepository);
  const pendingMessage = await chat.publish({
    role: 'assistant',
    phase: 'final_answer',
    text: 'pending',
  });
  await fixture.database.db.insert(deliveryJobs).values({
    messageId: pendingMessage.id,
    destinationId: 'telegram',
    adapterId: 'telegram',
    notify: false,
    nextAttemptAt: new Date(Date.now() + 60_000),
  });
  await destinations.setEnabled('telegram', false);
  await repository.cancelDisabled();
  const [cancelled] = await fixture.database.db
    .select({ state: deliveryJobs.state })
    .from(deliveryJobs)
    .where(eq(deliveryJobs.messageId, pendingMessage.id));
  expect(cancelled?.state).toBe('cancelled');

  await destinations.setEnabled('telegram', true);
  const sendingMessage = await chat.publish({
    role: 'assistant',
    phase: 'final_answer',
    text: 'sending',
  });
  await fixture.database.db.insert(deliveryJobs).values({
    messageId: sendingMessage.id,
    destinationId: 'telegram',
    adapterId: 'telegram',
    notify: false,
    state: 'sending',
  });
  await repository.recoverInterrupted();
  const [uncertain] = await fixture.database.db
    .select({ state: deliveryJobs.state })
    .from(deliveryJobs)
    .where(eq(deliveryJobs.messageId, sendingMessage.id));
  expect(uncertain?.state).toBe('uncertain');
});

it('deduplicates scoped owner input, imports files, and resolves known quotes', async () => {
  const ingress = fixture.app.get(SecondaryIngressService);
  const driver = {
    adapterId: 'telegram',
    destinationId: 'telegram',
  } as SecondaryDriver;
  const first = await ingress.accept(driver, {
    externalEventId: 'update-1',
    externalMessageId: 'message-1',
    text: 'with file',
    attachments: [
      {
        stream: Readable.from('hello'),
        filename: 'hello.txt',
        contentType: 'text/plain',
      },
    ],
  });
  expect(
    await ingress.accept(driver, {
      externalEventId: 'update-1',
      externalMessageId: 'message-1',
      text: 'with file',
      attachments: [],
    }),
  ).toEqual(first);
  const quoted = await ingress.accept(driver, {
    externalEventId: 'update-2',
    externalMessageId: 'message-2',
    replyToExternalMessageId: 'message-1',
    text: 'follow-up',
    attachments: [],
  });
  const chat = fixture.app.get(ChatService);
  expect(await chat.get(first.messageId)).toMatchObject({
    originDestinationId: 'telegram',
    attachments: [expect.objectContaining({ filename: 'hello.txt' })],
  });
  expect(await chat.get(quoted.messageId)).toMatchObject({
    replyToMessageId: first.messageId,
  });
});

it('delivers explicit Main sends and incoming-message quotes, keeps Task logs local, and records references', async () => {
  const sent: SecondaryOutput[] = [];
  const attempts = new Map<string, number>();
  const driver: SecondaryDriver = {
    adapterId: 'telegram',
    destinationId: 'telegram',
    async start() {},
    async stop() {},
    async send(output) {
      sent.push(output);
      const count = (attempts.get(output.message.id) ?? 0) + 1;
      attempts.set(output.message.id, count);
      if (output.message.text === 'public result' && count === 1)
        return { kind: 'retryable', code: 'provider_busy' };
      if (output.message.text === 'uncertain result')
        return { kind: 'uncertain', code: 'provider_timeout' };
      return {
        kind: 'accepted',
        references: [{ externalMessageId: `sent-${sent.length}`, position: 0 }],
      };
    },
  };
  fixture.app.get(SecondaryDriverHostService).register(driver);
  const task = await fixture.app.get(TasksService).create({
    title: 'Secondary delivery',
    goal: 'Verify visibility',
  });
  const chat = fixture.app.get(ChatService);
  await chat.publish({
    role: 'assistant',
    taskId: task.id,
    phase: 'commentary',
    text: 'private progress',
    destinationIds: ['telegram'],
  });
  const final = await chat.publish({
    role: 'assistant',
    notify: true,
    phase: 'final_answer',
    text: 'public result',
    destinationIds: ['telegram'],
  });
  expect(final.deliveryDestinationIds).toEqual(['ios', 'telegram', 'web']);
  expect(final.notificationDestinationIds).toEqual(['ios', 'telegram', 'web']);
  await until(() => sent.length === 2, 5_000);
  expect(sent[1]).toMatchObject({
    deliveryId: expect.any(String),
    notify: true,
    message: { id: final.id, text: 'public result' },
  });
  await until(async () => {
    const [job] = await fixture.database.db
      .select({ state: deliveryJobs.state })
      .from(deliveryJobs)
      .where(eq(deliveryJobs.messageId, final.id));
    return job?.state === 'accepted';
  });
  expect(
    await fixture.database.db
      .select()
      .from(externalMessageReferences)
      .where(eq(externalMessageReferences.canonicalMessageId, final.id)),
  ).toHaveLength(1);

  const uncertain = await chat.publish({
    role: 'assistant',
    phase: 'final_answer',
    text: 'uncertain result',
    destinationIds: ['telegram'],
  });
  await until(async () => {
    const [job] = await fixture.database.db
      .select({ state: deliveryJobs.state })
      .from(deliveryJobs)
      .where(eq(deliveryJobs.messageId, uncertain.id));
    return job?.state === 'uncertain';
  });
  await setTimeout(1_200);
  expect(sent.filter((item) => item.message.id === uncertain.id)).toHaveLength(
    1,
  );

  const original = await fixture.app
    .get(SecondaryIngressService)
    .accept(driver, {
      externalEventId: 'owner-update',
      externalMessageId: '11',
      externalThreadId: 'owner-dm',
      text: 'find me more astronomy pics',
      attachments: [],
    });
  const reply = await fixture.app.get(ChatService).publish({
    role: 'assistant',
    phase: 'final_answer',
    text: 'acked!',
    replyToMessageId: original.messageId,
    destinationIds: ['telegram'],
  });
  await until(() => sent.some((output) => output.message.id === reply.id));
  expect(sent.find((output) => output.message.id === reply.id)?.notify).toBe(
    false,
  );
  expect(
    sent.find((output) => output.message.id === reply.id)?.replyTo,
  ).toEqual({
    externalMessageId: '11',
    externalThreadId: 'owner-dm',
    position: 0,
  });
  const target = await chat.get(original.messageId);
  const reaction = {
    messageRef: target.sequence,
    emoji: '👀',
    destinationIds: ['telegram'],
    notify: false,
  };
  const reactionKey = randomUUID();
  await chat.react(reaction, reactionKey);
  await chat.react(reaction, reactionKey);
  await chat.react({ ...reaction, emoji: '👍' }, randomUUID());
  await until(() => sent.some((output) => output.reaction === '👍'));
  expect(sent.filter((output) => output.reaction === '👍')).toHaveLength(1);
  expect(
    sent.find((output) => output.reaction === '👍')?.replyTo?.externalMessageId,
  ).toBe('11');
  expect((await chat.get(original.messageId)).reaction).toBe('👍');
  const targetReferences = await fixture.database.db
    .select()
    .from(externalMessageReferences)
    .where(
      eq(externalMessageReferences.canonicalMessageId, original.messageId),
    );
  expect(targetReferences).toHaveLength(1);
  expect(targetReferences[0].externalMessageId).toBe('11');

  const parts = parsePublicResponse(
    JSON.stringify({
      text: ['coupon answer', 'coupon workaround', 'coupon alternative'],
      replyTo: null,
    }),
  );
  const grouped = [];
  for (const part of parts)
    grouped.push(
      await chat.publish({
        role: 'assistant',
        phase: null,
        text: part.text,
        destinationIds: ['telegram'],
      }),
    );
  await until(() =>
    grouped.every((message) =>
      sent.some((output) => output.message.id === message.id),
    ),
  );
  expect(
    sent
      .filter((output) =>
        grouped.some((message) => message.id === output.message.id),
      )
      .map((output) => output.message.text),
  ).toEqual(parts.map((part) => part.text));
  const main = await chat.history({});
  expect(
    grouped.every((message) =>
      main.messages.some((visible) => visible.id === message.id),
    ),
  ).toBe(true);
});
