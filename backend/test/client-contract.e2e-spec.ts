import { TasksService } from '../dist/tasks/tasks.service.js';
import { AgentActivityService } from '../dist/agent/agent-activity.service.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { openStream, startTestApp, until } from './helpers.js';
import {
  firstPartyClients,
  reconcileMessages,
} from './fixtures/first-party-clients.js';
import { FIRST_PARTY_CONTRACT_VERSION } from '../dist/adapters/first-party/first-party-adapter.module.js';
import {
  FIRST_PARTY_CONTRACT_HEADER,
  FIRST_PARTY_RELEASE_HEADER,
} from '../dist/adapters/first-party/first-party-contract.js';

let fixture: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  fixture = await startTestApp();
});
afterAll(async () => fixture.close());
beforeEach(async () => fixture.reset());

it.each(firstPartyClients)(
  '$name uses the shared canonical contract',
  async ({ destinationId, contractVersion }) => {
    expect(contractVersion).toBe(FIRST_PARTY_CONTRACT_VERSION);
    const input = {
      destinationId,
      idempotencyKey: randomUUID(),
      text: `from ${destinationId}`,
      attachmentIds: [],
    };
    const accepted = await request(fixture.url)
      .post('/chat/messages')
      .send(input)
      .expect(201);
    const replay = await request(fixture.url)
      .post('/chat/messages')
      .send(input)
      .expect(201);
    expect(replay.body).toEqual(accepted.body);
    const history = await request(fixture.url).get('/chat/history').expect(200);
    expect(history.body.messages).toContainEqual(
      expect.objectContaining({
        id: accepted.body.messageId,
        source: destinationId,
        originDestinationId: destinationId,
      }),
    );
  },
);

it('rejects secondary and unknown destinations at first-party ingress', async () => {
  for (const destinationId of ['telegram', 'unknown'])
    await request(fixture.url)
      .post('/chat/messages')
      .send({
        destinationId,
        idempotencyKey: randomUUID(),
        text: 'invalid route',
        attachmentIds: [],
      })
      .expect(400);
});

it('rejects cross-site browser mutations without requiring native credentials', async () => {
  await request(fixture.url)
    .post('/chat/messages')
    .set('Origin', 'https://untrusted.example')
    .set('Sec-Fetch-Site', 'cross-site')
    .send({
      destinationId: 'web',
      idempotencyKey: randomUUID(),
      text: 'cross-site',
      attachmentIds: [],
    })
    .expect(403);
});

it('identifies the running contract and rejects stale browser mutations', async () => {
  const read = await request(fixture.url).get('/health').expect(200);
  expect(read.headers[FIRST_PARTY_CONTRACT_HEADER]).toBe(
    String(FIRST_PARTY_CONTRACT_VERSION),
  );
  expect(read.headers[FIRST_PARTY_RELEASE_HEADER]).toBe('development');

  const mutation = {
    destinationId: 'web',
    idempotencyKey: randomUUID(),
    text: 'versioned browser request',
    attachmentIds: [],
  };
  await request(fixture.url)
    .post('/chat/messages')
    .set('Origin', fixture.url)
    .set('Sec-Fetch-Site', 'same-origin')
    .send(mutation)
    .expect(409);
  await request(fixture.url)
    .post('/chat/messages')
    .set('Origin', fixture.url)
    .set('Sec-Fetch-Site', 'same-origin')
    .set(FIRST_PARTY_CONTRACT_HEADER, '1')
    .send(mutation)
    .expect(409);
  await request(fixture.url)
    .post('/chat/messages')
    .set('Origin', fixture.url)
    .set('Sec-Fetch-Site', 'same-origin')
    .set(FIRST_PARTY_CONTRACT_HEADER, String(FIRST_PARTY_CONTRACT_VERSION))
    .send(mutation)
    .expect(201);
});

it('announces the current frontend release when an SSE stream opens', async () => {
  const stream = await openStream(fixture.url);
  try {
    await until(() =>
      stream.events.some((event) => event.event === 'frontend.updated'),
    );
    expect(stream.events).toContainEqual({
      event: 'frontend.updated',
      releaseId: 'development',
      contractVersion: FIRST_PARTY_CONTRACT_VERSION,
    });
  } finally {
    await stream.close();
  }
});

it('publishes frontend-only deployment markers to open SSE streams', async () => {
  const stream = await openStream(fixture.url);
  try {
    await until(() =>
      stream.events.some((event) => event.event === 'frontend.updated'),
    );
    await request(fixture.url)
      .post('/frontend-updates')
      .send({ revision: 'frontend-build-123' })
      .expect(204);
    await until(() =>
      stream.events.some(
        (event) =>
          event.event === 'frontend.updated' &&
          event.releaseId === 'frontend-build-123',
      ),
    );
    expect(stream.events).toContainEqual({
      event: 'frontend.updated',
      releaseId: 'frontend-build-123',
      contractVersion: FIRST_PARTY_CONTRACT_VERSION,
    });
  } finally {
    await stream.close();
  }
});

it('reconciles retained pages with snapshots and buffered live changes', () => {
  const retained = [{ id: 'old', version: 1, sequence: 1, text: 'old' }];
  const snapshot = [{ id: 'new', version: 1, sequence: 2, text: 'snapshot' }];
  const buffered = [
    { id: 'old', version: 2, sequence: 1, text: 'updated' },
    { id: 'live', version: 1, sequence: 3, text: 'live' },
  ];
  expect(reconcileMessages(snapshot, buffered, retained)).toEqual([
    buffered[0],
    snapshot[0],
    buffered[1],
  ]);
});

it('reconnects with complete task activity and emits membership changes while already working', async () => {
  const tasks = fixture.app.get(TasksService);
  const activity = fixture.app.get(AgentActivityService);
  const pending = await tasks.create({
    title: 'Needs input',
    goal: 'Wait for input',
  });
  await tasks.update(pending.id, { status: 'needs-input' });
  const a = await tasks.create({ title: 'First running task', goal: 'Run' });
  const b = await tasks.create({ title: 'Second running task', goal: 'Run' });
  activity.setRunWorking('a', true, a.id);
  const stream = await openStream(fixture.url);
  try {
    await until(() =>
      stream.events.some((event) => event.event === 'agent.activity'),
    );
    expect(stream.events[0]).toMatchObject({
      event: 'agent.activity',
      state: {
        runningTasks: [{ id: a.id }],
        needsInputTasks: [{ id: pending.id }],
      },
    });
    activity.setRunWorking('b', true, b.id);
    await until(() =>
      stream.events.some(
        (event) =>
          event.event === 'agent.activity' &&
          event.state.runningTasks.length === 2,
      ),
    );
    activity.commentary('a', a.id, {
      messageId: 'commentary',
      sequence: 1,
      text: 'checking…',
    });
    const reconnect = await openStream(fixture.url);
    try {
      await until(() => reconnect.events.length > 0);
      expect(reconnect.events[0]).toMatchObject({
        state: {
          runningTasks: [
            { id: a.id, commentary: { text: 'checking…' } },
            { id: b.id },
          ],
        },
      });
    } finally {
      await reconnect.close();
    }
  } finally {
    await stream.close();
    activity.setRunWorking('a', false);
    activity.setRunWorking('b', false);
  }
});
