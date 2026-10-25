import { sendToUserTool } from '../dist/agent/send-to-user.tool.js';
import { randomUUID } from 'node:crypto';
import { openStream, startTestApp, until } from './helpers.js';
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

it.each([false, true])(
  'atomically consumes suggestions once, persists events and retries in task scope %s',
  async (taskScoped) => {
    const tasks = fixture.app.get(TasksService);
    const chat = fixture.app.get(ChatService);
    const task = taskScoped
      ? await tasks.create({ title: 'Dinner', goal: 'Choose dinner' })
      : undefined;
    const source = await chat.publish({
      role: 'assistant',
      text: 'How many people?',
      taskId: task?.id,
      suggestedReplies: ['Just me', 'Two people'],
    });
    const stream = await openStream(fixture.url);
    try {
      const inputs = [0, 1].map((index) => ({
        source: 'web',
        originDestinationId: 'web',
        taskId: task?.id,
        text: '',
        attachmentIds: [],
        idempotencyKey: randomUUID(),
        suggestedReply: { messageId: source.id, index },
      }));
      if (taskScoped) {
        await expect(
          chat.accept({ ...inputs[0], taskId: undefined }),
        ).rejects.toMatchObject({ code: 'invalid_input' });
        expect((await chat.get(source.id)).suggestedReplies).toHaveLength(2);
      }
      const results = await Promise.allSettled(
        inputs.map((input) => chat.accept(input)),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const winnerIndex = results.findIndex(
        (result) => result.status === 'fulfilled',
      );
      const winner = results[winnerIndex];
      if (winner.status !== 'fulfilled') throw new Error('No winner');
      const replay = await chat.accept(inputs[winnerIndex]);
      expect(replay).toMatchObject({
        messageId: winner.value.messageId,
        created: false,
      });
      const sent = await chat.get(replay.messageId);
      expect(sent).toMatchObject({
        role: 'user',
        text: source.suggestedReplies[winnerIndex],
        taskId: task?.id ?? null,
        idempotencyKey: inputs[winnerIndex].idempotencyKey,
      });
      expect(await chat.get(source.id)).toMatchObject({
        version: 2,
        suggestedReplies: [],
      });
      const history = await chat.history({ taskId: task?.id });
      expect(
        history.messages.filter((message) => message.role === 'user'),
      ).toHaveLength(1);
      if (taskScoped) expect((await chat.history({})).messages).toEqual([]);
      await until(() =>
        stream.events.some(
          (event) =>
            event.event === 'message.added' && event.message.id === sent.id,
        ),
      );
      expect(stream.events).toContainEqual(
        expect.objectContaining({
          event: 'message.updated',
          message: expect.objectContaining({
            id: source.id,
            version: 2,
            suggestedReplies: [],
          }),
        }),
      );
    } finally {
      await stream.close();
    }
  },
);

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
