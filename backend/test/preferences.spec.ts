import { startTestApp } from './helpers.js';
import { ChatService } from '../dist/chat/chat.service.js';
import {
  PreferenceConflictException,
  PreferencesService,
} from '../dist/preferences/preferences.service.js';
import {
  mainPreferenceActor,
  preferenceReadTool,
  preferenceWriteTool,
  taskPreferenceActor,
} from '../dist/preferences/preference-tools.js';
import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { TasksService } from '../dist/tasks/tasks.service.js';

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

it('keeps source-backed revisions atomic and rejects competing versions', async () => {
  const chat = fixture.app.get(ChatService);
  const preferences = fixture.app.get(PreferencesService);
  const source = await chat.publish({
    role: 'user',
    text: 'I always prefer an aisle seat for personal flights.',
  });
  const created = await preferences.create(
    {
      topic: 'travel.flights',
      statement: 'Prefers aisle seats.',
      appliesWhen: 'Personal flights',
      basis: 'user-stated',
      sourceMessageIds: [source.id],
      reason: 'The user stated a lasting flight preference.',
    },
    { actor: 'main' },
  );
  expect(created).toMatchObject({
    version: 1,
    basis: 'user-stated',
    status: 'active',
    sources: [{ id: source.id, sequence: source.sequence }],
  });

  const writes = await Promise.allSettled([
    preferences.update(
      created.id,
      {
        expectedVersion: 1,
        statement: 'Prefers window seats.',
        sourceMessageIds: [source.id],
        reason: 'First correction.',
      },
      { actor: 'main' },
    ),
    preferences.update(
      created.id,
      {
        expectedVersion: 1,
        statement: 'Prefers middle seats.',
        sourceMessageIds: [source.id],
        reason: 'Competing correction.',
      },
      { actor: 'main' },
    ),
  ]);
  expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(
    1,
  );
  const conflict = writes.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  expect(conflict?.reason).toBeInstanceOf(PreferenceConflictException);
  expect(conflict?.reason.current.version).toBe(2);
  const history = await preferences.history(created.id, {});
  expect(history.revisions.map((revision) => revision.version)).toEqual([2, 1]);
  expect(history.revisions.map((revision) => revision.actor)).toEqual([
    'main',
    'main',
  ]);
});

it('searches selectively, retires records, and exposes role-scoped tools', async () => {
  const chat = fixture.app.get(ChatService);
  const tasks = fixture.app.get(TasksService);
  const preferences = fixture.app.get(PreferencesService);
  const flightSource = await chat.publish({
    role: 'user',
    text: 'For flights I prefer the aisle.',
  });
  const foodSource = await chat.publish({
    role: 'user',
    text: 'I like spicy noodles.',
  });
  const flight = await preferences.create(
    {
      topic: 'travel.flights',
      statement: 'Prefers aisle seating',
      basis: 'user-stated',
      sourceMessageIds: [flightSource.id],
      reason: 'Explicit statement',
    },
    { actor: 'main' },
  );
  await preferences.create(
    {
      topic: 'food',
      statement: 'Likes spicy noodles',
      basis: 'user-stated',
      sourceMessageIds: [foodSource.id],
      reason: 'Explicit statement',
    },
    { actor: 'main' },
  );
  expect(
    (await preferences.search({ queries: ['flight aisle'] })).preferences.map(
      (preference) => preference.id,
    ),
  ).toEqual([flight.id]);

  const task = await tasks.create({ title: 'Trip', goal: 'Plan a trip' });
  const taskWrite = preferenceWriteTool(preferences, taskPreferenceActor);
  const updated = await taskWrite.execute!(
    {
      operation: 'update',
      id: flight.id,
      expectedVersion: 1,
      status: 'retired',
      reason: 'The preference no longer applies.',
    },
    {
      requestContext: {
        get: (key: string) =>
          key === MASTRA_THREAD_ID_KEY ? `pal-task:${task.id}` : undefined,
      },
    },
  );
  expect(updated).toMatchObject({
    preference: { status: 'retired', version: 2 },
  });
  expect(
    (await preferences.search({ queries: ['flight'] })).preferences,
  ).toEqual([]);
  expect(
    (await preferences.search({ queries: ['flight'], status: 'retired' }))
      .preferences,
  ).toHaveLength(1);
  expect((await preferences.history(flight.id, {})).revisions[0]).toMatchObject(
    {
      actor: 'task',
      taskId: task.id,
    },
  );

  const read = preferenceReadTool(preferences);
  expect(
    read.inputSchema['~standard'].jsonSchema.input({ target: 'draft-07' }),
  ).toMatchObject({ type: 'object', oneOf: expect.any(Array) });
  await expect(
    read.execute!({ operation: 'get', id: flight.id }, {}),
  ).resolves.toMatchObject({ preference: { id: flight.id } });
  const mainWrite = preferenceWriteTool(preferences, mainPreferenceActor);
  expect(
    mainWrite.inputSchema['~standard'].jsonSchema.input({ target: 'draft-07' }),
  ).toMatchObject({ type: 'object', oneOf: expect.any(Array) });
  await expect(
    mainWrite.execute!(
      {
        operation: 'create',
        topic: 'invalid',
        statement: 'No evidence',
        basis: 'model-inferred',
        sourceMessageRefs: [],
        reason: 'Unsupported inference',
      },
      {},
    ),
  ).rejects.toThrow('require a user message source');
});
