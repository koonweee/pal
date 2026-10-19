import { sendToUserTool } from '../dist/agent/send-to-user.tool.js';
import { randomUUID } from 'node:crypto';
import { startTestApp } from './helpers.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { mainTaskTools } from '../dist/agent/task-tools.js';
import { FilesService } from '../dist/files/files.service.js';
import { ChatService } from '../dist/chat/chat.service.js';
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

it('keeps Task actions local and allows only one concurrent selection', async () => {
  const tasks = fixture.app.get(TasksService);
  const chat = fixture.app.get(ChatService);
  const task = await tasks.create({ title: 'Choose', goal: 'Choose' });
  const message = await chat.publish({
    role: 'assistant',
    text: 'Choose one',
    taskId: task.id,
    phase: 'final_answer',
    actions: {
      actions: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      state: 'available',
      selectedActionId: null,
    },
  });
  const requests = ['a', 'b'].map((actionId) => ({
    actionId,
    messageId: message.id,
    idempotencyKey: randomUUID(),
  }));
  const results = await Promise.allSettled(
    requests.map((input) => chat.selectAction(input)),
  );
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const winner =
    requests[results.findIndex((result) => result.status === 'fulfilled')];
  await expect(chat.selectAction(winner)).resolves.toEqual({
    messageId: message.id,
  });
  const main = (await chat.history({})).messages[0];
  const scoped = (await chat.history({ taskId: task.id })).messages[0];
  expect(main).toBeUndefined();
  expect(scoped.version).toBe(2);
  expect(scoped.actions?.selectedActionId).toBe(winner.actionId);
});

it('retrieves older completed tasks with alternatives and inspects bounded public history', async () => {
  const tasks = fixture.app.get(TasksService);
  const chat = fixture.app.get(ChatService);
  const older = await tasks.create({
    title: 'F1 race tickets',
    goal: 'Find affordable admission ' + 'x'.repeat(300),
    description: 'Singapore Grand Prix qualifying on Saturday',
  });
  await tasks.update(older.id, { status: 'completed', archived: true });
  await fixture.database.pool.query(
    `update tasks set created_at = now() - interval '7 days' where id = $1`,
    [older.id],
  );
  const recent = await tasks.create({ title: 'F1 news', goal: 'Read results' });
  await tasks.create({ title: 'Concert tickets', goal: 'Book a concert' });
  expect(
    (await tasks.search({ queries: ['qualifying lowest price'] })).tasks,
  ).toEqual([]);
  const result = await tasks.search({
    queries: ['qualifying', 'F1'],
    limit: 1,
  });
  expect(result.tasks.map((task) => task.id)).toEqual([recent.id]);
  expect(result.after).not.toBeNull();
  const next = await tasks.search({
    queries: ['F1', 'qualifying'],
    limit: 1,
    after: result.after!,
  });
  expect(next.tasks[0]).toEqual({
    id: older.id,
    title: 'F1 race tickets',
    goal: expect.stringContaining('Find affordable admission'),
    archived: true,
    status: 'completed',
    descriptionExcerpt: expect.stringContaining('qualifying'),
  });
  expect(next.tasks[0].goal).toHaveLength(240);
  expect((await tasks.details(older.id)).goal.length).toBeGreaterThan(240);
  expect(next.after).toBeNull();
  await expect(
    tasks.search({ queries: ['concert'], after: result.after! }),
  ).rejects.toThrow('Invalid search cursor');
  expect((await tasks.search({ queries: ['%', '_'] })).tasks).toEqual([]);
  await chat.publish({
    role: 'user',
    taskId: older.id,
    text: 'Prefer Saturday',
  });
  const final = await chat.publish({
    role: 'assistant',
    taskId: older.id,
    text: 'Saturday details',
    phase: 'final_answer',
  });
  const tools = mainTaskTools(
    tasks,
    chat,
    async () => ({ taskId: older.id }),
    fixture.app.get(FilesService),
  );
  const inspected = await tools.inspect_task.execute!(
    { taskId: older.id, includeHistory: true, before: null, limit: 1 },
    {},
  );
  expect(inspected).toMatchObject({
    task: { id: older.id },
    history: { messages: [{ id: final.id }], before: final.sequence },
  });
});

it('persists one reaction slot and queues explicit delivery once per accepted operation', async () => {
  const chat = fixture.app.get(ChatService);
  const target = await chat.publish({ role: 'user', text: 'Please check' });
  const input = {
    messageRef: target.sequence,
    emoji: '👀',
    destinationIds: [],
    notify: false,
  };
  const key = randomUUID();
  await chat.react(input, key);
  const repeated = await chat.react(input, key);
  expect(repeated).toMatchObject({ reaction: '👀', version: 2 });
  const final = await chat.react({ ...input, emoji: '✅' }, randomUUID());
  expect(final).toMatchObject({ reaction: '✅', version: 3 });
  expect((await chat.history({})).messages).toHaveLength(1);
  await expect(
    chat.react({ ...input, emoji: 'ok' }, randomUUID()),
  ).rejects.toThrow('one emoji');
  await expect(
    chat.react({ ...input, destinationIds: ['unknown'] }, randomUUID()),
  ).rejects.toThrow('Unknown or disabled');
  await expect(
    chat.react({ ...input, destinationIds: ['web'] }, randomUUID()),
  ).rejects.toThrow('additional destination');
});

it('reports accepted message parts when a later part needs correction', async () => {
  const chat = fixture.app.get(ChatService);
  let calls = 0;
  const tool = sendToUserTool(
    async (output) => {
      if (++calls === 2) throw new Error('Attachment unavailable');
      return chat.publish({
        role: 'assistant',
        text: output.text,
        destinationIds: [],
        notify: false,
      });
    },
    async () => {
      throw new Error('Unexpected reaction');
    },
  );
  const result = await tool.execute!(
    {
      destinationIds: [],
      notify: false,
      content: {
        kind: 'message',
        message: {
          text: ['Accepted', 'Needs correction'],
          replyTo: null,
          attachmentIds: [],
          files: [],
        },
      },
    },
    {
      agent: {
        agentId: 'pal-main-agent',
        toolCallId: randomUUID(),
        messages: [],
      },
    },
  );
  expect(result).toMatchObject({
    messageRefs: [expect.any(Number)],
    error: 'Attachment unavailable',
    correction: expect.stringContaining('only the failed part'),
  });
  expect((await chat.history({})).messages.map((m) => m.text)).toEqual([
    'Accepted',
  ]);
});
