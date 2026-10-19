import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { startTestApp, openStream, until } from './helpers.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { ChatCoordinatorService } from '../dist/application/chat-coordinator.service.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { tasks } from '../dist/database/schema.js';
import {
  AgentHandoffError,
  AGENT_RUNTIME,
  type AgentRuntime,
} from '../dist/agent/agent-runtime.js';
import { AgentActivityService } from '../dist/agent/agent-activity.service.js';
let fixture: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  fixture = await startTestApp();
});
afterAll(async () => {
  await fixture?.close();
});
beforeEach(async () => {
  await fixture.reset();
});

it('paginates tied task timestamps, filters archives, and keeps main/task history consistent', async () => {
  const service = fixture.app.get(TasksService);
  const first = await service.create({ title: 'First', goal: 'First' });
  const second = await service.create({ title: 'Second', goal: 'Second' });
  await fixture.database.db
    .update(tasks)
    .set({ lastActivityAt: new Date('2026-01-01T00:00:00.000Z') });
  const page = await request(fixture.url).get('/tasks?limit=1').expect(200);
  const next = await request(fixture.url)
    .get('/tasks')
    .query({ limit: 1, after: page.body.after })
    .expect(200);
  expect(new Set([page.body.tasks[0].id, next.body.tasks[0].id])).toEqual(
    new Set([first.id, second.id]),
  );
  expect(next.body.after).toBeNull();
  await request(fixture.url).get('/tasks?after=bad').expect(400);
  await request(fixture.url).get('/tasks?archived=invalid').expect(400);
  await request(fixture.url)
    .post(`/tasks/${first.id}/archive`)
    .send({ archived: true })
    .expect(201);
  const listed = await request(fixture.url).get('/tasks').expect(200);
  expect(listed.body.tasks.map((t: { id: string }) => t.id)).toEqual([
    second.id,
  ]);
  const archived = await request(fixture.url)
    .get('/tasks?archived=true')
    .expect(200);
  expect(archived.body.tasks[0]).toMatchObject({
    id: first.id,
    status: 'in-progress',
    archived: true,
    version: 2,
  });
  const chat = fixture.app.get(ChatService);
  const hidden = await chat.publish({
    role: 'assistant',
    text: 'Task only',
    taskId: second.id,
  });
  const shared = await chat.publish({
    role: 'assistant',
    text: 'Shared',
    taskId: second.id,
    phase: 'final_answer',
  });
  const main = await request(fixture.url).get('/chat/history').expect(200);
  const scoped = await request(fixture.url)
    .get('/chat/history')
    .query({ taskId: second.id, limit: 1 })
    .expect(200);
  expect(main.body.messages).toEqual([]);
  expect(scoped.body.messages[0].id).toBe(shared.id);
  const older = await request(fixture.url)
    .get('/chat/history')
    .query({ taskId: second.id, before: scoped.body.before })
    .expect(200);
  expect(older.body.messages[0].id).toBe(hidden.id);
  expect(older.body.messages[0].phase).toBeNull();
  expect(scoped.body.messages[0].phase).toBe('final_answer');
  expect(scoped.body.messages[0]).not.toHaveProperty('showInMainChat');
  const beforeShared = await request(fixture.url)
    .get('/chat/history')
    .query({ before: shared.sequence })
    .expect(200);
  expect(beforeShared.body.messages).toEqual([]);
  await request(fixture.url)
    .post('/chat/messages')
    .send({
      idempotencyKey: randomUUID(),
      text: 'spoof',
      phase: 'final_answer',
      attachmentIds: [],
    })
    .expect(400);
  const details = await request(fixture.url)
    .get(`/tasks/details/${second.id}`)
    .expect(200);
  expect(details.body.task).toMatchObject({
    id: second.id,
    description: '',
  });
  expect(details.body.task).not.toHaveProperty('attachments');
  await fixture.database.db
    .update(tasks)
    .set({ description: 'Persisted' })
    .where(eq(tasks.id, second.id));
});

it('orders task lists by message activity without changing metadata time', async () => {
  const tasksService = fixture.app.get(TasksService);
  const chat = fixture.app.get(ChatService);
  const older = await tasksService.create({ title: 'Older', goal: 'Wait' });
  const newer = await tasksService.create({ title: 'Newer', goal: 'Wait' });
  await fixture.database.db
    .update(tasks)
    .set({ lastActivityAt: new Date('2026-01-01T00:00:00.000Z') })
    .where(eq(tasks.id, older.id));
  await fixture.database.db
    .update(tasks)
    .set({ lastActivityAt: new Date('2026-01-02T00:00:00.000Z') })
    .where(eq(tasks.id, newer.id));

  const message = await chat.publish({
    role: 'assistant',
    text: 'New activity',
    taskId: older.id,
  });
  const detail = await tasksService.details(older.id);
  expect(detail).toMatchObject({
    version: 2,
    updatedAt: older.updatedAt,
    lastActivityAt: message.createdAt,
  });
  expect((await tasksService.list({})).tasks.map((task) => task.id)).toEqual([
    older.id,
    newer.id,
  ]);
});

it('persists visible user and assistant replies and rejects invalid explicit targets', async () => {
  const chat = fixture.app.get(ChatService);
  const submit = vi
    .spyOn(fixture.app.get<AgentRuntime>(AGENT_RUNTIME), 'submit')
    .mockResolvedValue(undefined);
  const tasksService = fixture.app.get(TasksService);
  const task = await tasksService.create({
    title: 'Quotes',
    goal: 'Check quotes',
  });
  const other = await tasksService.create({ title: 'Other', goal: 'Other' });
  const mainUser = await chat.publish({ role: 'user', text: 'Main question' });
  const mainAssistant = await chat.publish({
    role: 'assistant',
    text: 'Main answer',
    replyToSequence: mainUser.sequence,
  });
  expect(mainAssistant.replyTo).toMatchObject({
    id: mainUser.id,
    sequence: mainUser.sequence,
    role: 'user',
    textPreview: 'Main question',
  });
  const taskOnly = await chat.publish({
    role: 'assistant',
    text: 'Task detail',
    taskId: task.id,
    phase: 'commentary',
  });
  const shared = await chat.publish({
    role: 'assistant',
    text: 'Task result',
    taskId: task.id,
    phase: 'final_answer',
    replyToSequence: taskOnly.sequence,
  });
  expect(shared.replyToMessageId).toBe(taskOnly.id);
  const inMain = (await chat.history({})).messages.find(
    (m) => m.id === shared.id,
  );
  const inTask = (await chat.history({ taskId: task.id })).messages.find(
    (m) => m.id === shared.id,
  );
  expect(inMain).toBeUndefined();
  expect(inTask?.replyTo?.taskId).toBe(task.id);
  const input = {
    idempotencyKey: randomUUID(),
    text: 'About that answer',
    replyToMessageId: mainAssistant.id,
    attachmentIds: [],
  };
  const stream = await openStream(fixture.url);
  try {
    const sent = await request(fixture.url)
      .post('/chat/messages')
      .send(input)
      .expect(201);
    const saved = await chat.get(sent.body.messageId);
    expect(saved.replyToMessageId).toBe(mainAssistant.id);
    expect(saved.replyTo?.textPreview).toBe('Main answer');
    await until(() =>
      stream.events.some(
        (event) =>
          event.event === 'message.added' &&
          event.message.id === saved.id &&
          event.message.replyTo?.id === mainAssistant.id,
      ),
    );
    const replay = await request(fixture.url)
      .post('/chat/messages')
      .send({ ...input, replyToMessageId: mainAssistant.id })
      .expect(201);
    expect(replay.body.messageId).toBe(saved.id);
    const ordinary = {
      idempotencyKey: randomUUID(),
      text: 'No quote',
      attachmentIds: [],
    };
    const ordinarySent = await request(fixture.url)
      .post('/chat/messages')
      .send(ordinary)
      .expect(201);
    const ordinaryReplay = await request(fixture.url)
      .post('/chat/messages')
      .send({ ...ordinary, replyToMessageId: null })
      .expect(201);
    expect(ordinaryReplay.body).toEqual(ordinarySent.body);
    await request(fixture.url)
      .post('/chat/messages')
      .send({ ...input, replyToMessageId: mainUser.id })
      .expect(409);
    const taskInput = {
      ...input,
      idempotencyKey: randomUUID(),
      taskId: task.id,
      replyToMessageId: taskOnly.id,
    };
    const taskSent = await request(fixture.url)
      .post('/chat/messages')
      .send(taskInput)
      .expect(201);
    expect((await chat.get(taskSent.body.messageId)).replyTo?.id).toBe(
      taskOnly.id,
    );
    for (const invalid of [
      {
        ...input,
        idempotencyKey: randomUUID(),
        replyToMessageId: randomUUID(),
      },
      { ...input, idempotencyKey: randomUUID(), replyToMessageId: taskOnly.id },
      { ...taskInput, idempotencyKey: randomUUID(), taskId: other.id },
    ])
      await request(fixture.url)
        .post('/chat/messages')
        .send(invalid)
        .expect(400);
    const fallback = await chat.publish({
      role: 'assistant',
      text: 'Still useful',
      replyToSequence: 999999999,
    });
    expect(fallback.replyToMessageId).toBeNull();
    expect(fallback.text).toBe('Still useful');
  } finally {
    await stream.close();
    submit.mockRestore();
  }
});

it('delivers initial activity, committed events, heartbeat, and one asynchronous reply for idempotent retries', async () => {
  const stream = await openStream(fixture.url);
  try {
    await until(() => stream.events.length > 0);
    expect(stream.events[0]).toMatchObject({
      event: 'agent.activity',
      state: {
        status: 'idle',
        mainWorking: false,
        runningTasks: [],
        needsInputTasks: [],
        latestCompletion: null,
      },
    });
    const runtime = fixture.app.get<AgentRuntime>(AGENT_RUNTIME);
    const spy = vi.spyOn(runtime, 'submit');
    const input = {
      idempotencyKey: randomUUID(),
      text: 'Hello',
      attachmentIds: [],
      metadata: { timezone: 'Asia/Singapore' },
    };
    const responses = await Promise.all([
      request(fixture.url).post('/chat/messages').send(input),
      request(fixture.url).post('/chat/messages').send(input),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0].body).toEqual(responses[1].body);
    await until(
      () =>
        stream.events.filter((e) => e.event === 'message.added').length === 2,
    );
    await until(
      () => fixture.app.get(AgentActivityService).current().status === 'idle',
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].metadata).toEqual(input.metadata);
    expect(
      stream.events
        .filter((e) => e.event === 'message.added')
        .some(
          (e) =>
            e.event === 'message.added' &&
            e.message.metadata.timezone === 'Asia/Singapore',
        ),
    ).toBe(true);
    expect(stream.events).toContainEqual(
      expect.objectContaining({
        event: 'agent.activity',
        state: expect.objectContaining({
          status: 'working',
          mainWorking: true,
        }),
      }),
    );
    const history = await request(fixture.url).get('/chat/history').expect(200);
    expect(history.body.messages).toHaveLength(2);
    expect(history.body.messages[0].text).toBe('Test reply: Hello');
    expect(history.body.messages[1].metadata).toEqual(input.metadata);
    await request(fixture.url)
      .post('/chat/messages')
      .send({ ...input, metadata: { timezone: 'Europe/London' } })
      .expect(409);
    for (const metadata of [
      { timezone: 'invalid' },
      { timezone: 42 },
      { source: 'automation' },
    ])
      await request(fixture.url)
        .post('/chat/messages')
        .send({ ...input, idempotencyKey: randomUUID(), metadata })
        .expect(400);
    await request(fixture.url)
      .post('/chat/messages')
      .send({ ...input, text: 'Changed' })
      .expect(409);
    await request(fixture.url)
      .post('/chat/messages')
      .send({ ...input, idempotencyKey: randomUUID(), text: '' })
      .expect(400);
    spy.mockRejectedValueOnce(
      new Error('Private credentials and provider details'),
    );
    const failedInput = {
      ...input,
      idempotencyKey: randomUUID(),
      text: 'Fail',
    };
    const failed = await request(fixture.url)
      .post('/chat/messages')
      .send(failedInput)
      .expect(503);
    expect(JSON.stringify(failed.body)).not.toContain('Private credentials');
    const failedHistory = await request(fixture.url)
      .get('/chat/history')
      .expect(200);
    expect(
      failedHistory.body.messages.filter(
        (m: { text: string }) => m.text === 'Fail',
      ),
    ).toHaveLength(1);
    await request(fixture.url)
      .post('/chat/messages')
      .send(failedInput)
      .expect(201);
    expect(spy).toHaveBeenCalledTimes(2);
    for (const unsupported of [
      { ...input, idempotencyKey: randomUUID(), attachmentIds: [randomUUID()] },
    ])
      await request(fixture.url)
        .post('/chat/messages')
        .send(unsupported)
        .expect(400);
    expect(
      (await request(fixture.url).get('/chat/history')).body.messages,
    ).toHaveLength(3);
    const legacy = {
      idempotencyKey: randomUUID(),
      text: 'Legacy',
      attachmentIds: [],
    };
    const saved = await request(fixture.url)
      .post('/chat/messages')
      .send(legacy)
      .expect(201);
    const retried = await request(fixture.url)
      .post('/chat/messages')
      .send({ ...legacy, metadata: {} })
      .expect(201);
    expect(retried.body).toEqual(saved.body);
    expect(
      (await fixture.app.get(ChatService).get(saved.body.messageId)).metadata,
    ).toEqual({});
    spy.mockRestore();
    const task = await fixture.app
      .get(TasksService)
      .create({ title: 'Live task', goal: 'Updates' });
    await fixture.app
      .get(TasksService)
      .update(task.id, { description: 'New detail' });
    await until(() =>
      stream.events.some(
        (e) =>
          e.event === 'task.updated' &&
          e.task.id === task.id &&
          e.task.version === 2,
      ),
    );
    const activity = await fixture.app.get(ChatService).publish({
      role: 'assistant',
      text: 'Task activity',
      taskId: task.id,
    });
    await until(() =>
      stream.events.some(
        (e) =>
          e.event === 'task.updated' &&
          e.task.id === task.id &&
          e.task.version === 3 &&
          e.task.lastActivityAt === activity.createdAt,
      ),
    );
    await until(
      () => stream.events.some((e) => e.event === 'heartbeat'),
      17000,
    );
  } finally {
    await stream.close();
  }
});

it('retries a handoff in-process only after a definite pre-acceptance failure', async () => {
  const runtime = fixture.app.get<AgentRuntime>(AGENT_RUNTIME);
  const spy = vi
    .spyOn(runtime, 'submit')
    .mockRejectedValueOnce(
      new AgentHandoffError(false, 'definite pre-acceptance failure'),
    )
    .mockResolvedValueOnce(undefined);
  const input = {
    idempotencyKey: randomUUID(),
    text: 'Retry same input',
    attachmentIds: [],
  };
  await request(fixture.url).post('/chat/messages').send(input).expect(503);
  await request(fixture.url).post('/chat/messages').send(input).expect(201);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(
    (await request(fixture.url).get('/chat/history')).body.messages.filter(
      (message: { text: string }) => message.text === input.text,
    ),
  ).toHaveLength(1);
  spy.mockRestore();
});

it('does not rerun an uncertain handoff when its canonical input is retried', async () => {
  const runtime = fixture.app.get<AgentRuntime>(AGENT_RUNTIME);
  const spy = vi
    .spyOn(runtime, 'submit')
    .mockRejectedValueOnce(new AgentHandoffError(true, 'acceptance uncertain'));
  const input = {
    idempotencyKey: randomUUID(),
    text: 'Uncertain same input',
    attachmentIds: [],
  };
  await request(fixture.url).post('/chat/messages').send(input).expect(503);
  await request(fixture.url).post('/chat/messages').send(input).expect(201);
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});

it('preserves submission order through acceptance and publishes independent updates over SSE', async () => {
  const runtime = fixture.app.get<AgentRuntime>(AGENT_RUNTIME);
  const coordinator = fixture.app.get(ChatCoordinatorService);
  const accepted = Promise.withResolvers<void>();
  const called = Promise.withResolvers<void>();
  const calls: string[] = [];
  const spy = vi
    .spyOn(runtime, 'submit')
    .mockImplementation(async (message) => {
      calls.push(message.text);
      if (calls.length === 1) {
        called.resolve();
        await accepted.promise;
      }
    });
  const receipts = await openStream(fixture.url);
  const firstKey = randomUUID();
  let returned = false;
  const first = coordinator
    .send({ idempotencyKey: firstKey, text: 'A', attachmentIds: [] })
    .then((response) => {
      returned = true;
      return response;
    });
  const second = coordinator.send({
    idempotencyKey: randomUUID(),
    text: 'B',
    attachmentIds: [],
  });
  try {
    await called.promise;
    expect(returned).toBe(false);
    expect(calls).toEqual(['A']);
    await until(() =>
      receipts.events.some((event) => event.event === 'message.added'),
    );
    const receipt = receipts.events.find(
      (event) => event.event === 'message.added',
    );
    expect(receipt).toMatchObject({
      message: { role: 'user', text: 'A', idempotencyKey: firstKey },
    });
    expect(
      (await request(fixture.url).get('/chat/history')).body.messages[0],
    ).toMatchObject({
      role: 'user',
      text: 'A',
      idempotencyKey: firstKey,
    });
    expect(returned).toBe(false);
    expect(
      (await request(fixture.url).get('/chat/history')).body.messages,
    ).toHaveLength(1);
    accepted.resolve();
    await Promise.all([first, second]);
    expect(calls).toEqual(['A', 'B']);
    // B's acceptance does not depend on any assistant response.
    expect(
      (await request(fixture.url).get('/chat/history')).body.messages.map(
        (message: { text: string }) => message.text,
      ),
    ).toEqual(['B', 'A']);
    const stream = await openStream(fixture.url);
    try {
      await fixture.app
        .get(ChatService)
        .publish({ role: 'assistant', text: 'First update for A and B' });
      await fixture.app
        .get(ChatService)
        .publish({ role: 'assistant', text: 'Second update for A and B' });
      await until(
        () =>
          stream.events.filter((event) => event.event === 'message.added')
            .length === 2,
      );
    } finally {
      await stream.close();
    }
  } finally {
    accepted.resolve();
    const legacy = {
      idempotencyKey: randomUUID(),
      text: 'Legacy',
      attachmentIds: [],
    };
    const saved = await request(fixture.url)
      .post('/chat/messages')
      .send(legacy)
      .expect(201);
    const retried = await request(fixture.url)
      .post('/chat/messages')
      .send({ ...legacy, metadata: {} })
      .expect(201);
    expect(retried.body).toEqual(saved.body);
    expect(
      (await fixture.app.get(ChatService).get(saved.body.messageId)).metadata,
    ).toEqual({});
    await receipts.close();
    spy.mockRestore();
  }
});

it('closes the application with an SSE response still open', async () => {
  const instance = await startTestApp();
  const response = await fetch(instance.url + '/stream');
  const reader = response.body!.getReader();
  await reader.read();
  let closed = false;
  const closing = instance.close().then(() => {
    closed = true;
  });
  try {
    await until(() => closed);
    const disconnected = await reader.read().then(
      ({ done }) => done,
      () => true,
    );
    expect(disconnected).toBe(true);
  } finally {
    await reader.cancel().catch(() => {});
    await closing;
  }
});

it('persists source and delivery intent, checks idempotency, and keeps commentary quiet', async () => {
  const runtime = fixture.app.get<AgentRuntime>(AGENT_RUNTIME);
  const submit = vi.spyOn(runtime, 'submit').mockResolvedValue(undefined);
  const chat = fixture.app.get(ChatService);
  const stream = await openStream(fixture.url);
  try {
    const input = {
      idempotencyKey: randomUUID(),
      text: 'hello',
      destinationId: 'web',
      attachmentIds: [],
    };
    const accepted = await request(fixture.url)
      .post('/chat/messages')
      .send(input)
      .expect(201);
    expect(await chat.get(accepted.body.messageId)).toMatchObject({
      source: 'web',
      originDestinationId: 'web',
      deliveryDestinationIds: [],
      notify: false,
    });
    expect(submit.mock.calls[0][0].originDestinationId).toBe('web');
    const replay = await request(fixture.url)
      .post('/chat/messages')
      .send(input)
      .expect(201);
    expect(replay.body).toEqual(accepted.body);
    await request(fixture.url)
      .post('/chat/messages')
      .send({ ...input, destinationId: 'ios' })
      .expect(409);
    for (const change of [
      { source: 'email' },
      { destinationIds: ['telegram'] },
      { deliveryDestinationIds: ['telegram'] },
      { notify: true },
      { notificationDestinationIds: ['telegram'] },
    ])
      await request(fixture.url)
        .post('/chat/messages')
        .send({ ...input, idempotencyKey: randomUUID(), ...change })
        .expect(400);
    const legacy = {
      idempotencyKey: randomUUID(),
      text: 'legacy',
      attachmentIds: [],
    };
    const saved = await request(fixture.url)
      .post('/chat/messages')
      .send(legacy)
      .expect(201);
    const explicit = await request(fixture.url)
      .post('/chat/messages')
      .send({ ...legacy, destinationId: 'web' })
      .expect(201);
    expect(explicit.body).toEqual(saved.body);
    expect((await chat.get(saved.body.messageId)).source).toBe('web');
    const commentary = await chat.publish({
      role: 'assistant',
      text: 'working',
      notify: false,
      phase: 'commentary',
      destinationIds: [],
    });
    const final = await chat.publish({
      role: 'assistant',
      text: 'done',
      notify: true,
      phase: 'final_answer',
      destinationIds: [],
    });
    const unknown = await chat.publish({
      role: 'assistant',
      text: 'unknown phase',
      destinationIds: [],
    });
    expect(commentary).toMatchObject({
      source: null,
      deliveryDestinationIds: ['ios', 'web'],
      notificationDestinationIds: [],
      notify: false,
    });
    expect(final).toMatchObject({
      deliveryDestinationIds: ['ios', 'web'],
      notificationDestinationIds: ['ios', 'web'],
      notify: true,
    });
    expect(unknown).toMatchObject({
      deliveryDestinationIds: ['ios', 'web'],
      notificationDestinationIds: [],
      notify: false,
    });
    await until(() =>
      stream.events.some(
        (e) => e.event === 'message.added' && e.message.id === final.id,
      ),
    );
    expect(
      stream.events.find(
        (e) => e.event === 'message.added' && e.message.id === commentary.id,
      ),
    ).toMatchObject({ message: commentary });
    const history = await request(fixture.url).get('/chat/history').expect(200);
    expect(
      history.body.messages.find((m: { id: string }) => m.id === final.id),
    ).toEqual(final);
  } finally {
    submit.mockRestore();
    await stream.close();
  }
});
