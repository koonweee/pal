import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { createTool } from '@mastra/core/tools';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '@mastra/core/request-context';
import {
  createMainSession,
  MAIN_RESOURCE_ID,
} from '../dist/agent/main-session.js';
import { AgentActivityService } from '../dist/agent/agent-activity.service.js';
import { EventsService } from '../dist/events/events.service.js';
import type { TasksService } from '../dist/tasks/tasks.service.js';
import type { Task } from '../dist/tasks/tasks.types.js';

it('disarms completion when native generation fails after marking the task completed', async () => {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    'postgresql://pal:pal@localhost:5433/pal_test';
  if (!new URL(connectionString).pathname.endsWith('_test'))
    throw new Error('Test database must end in _test');
  const schemaName = 'pal_activity_' + randomUUID().replaceAll('-', '');
  const events = new EventsService();
  const now = new Date().toISOString();
  const task: Task = {
    id: 'task',
    title: 'Fixture',
    goal: 'Fixture',
    description: '',
    status: 'in-progress',
    archived: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  };
  const activity = new AgentActivityService(events, {
    activityTasks: async () => [task],
  } as unknown as TasksService);
  await activity.onModuleInit();
  let calls = 0;
  let interrupted = false;
  let markedCompleted = false;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      if (calls++) throw new Error('Fixture generation failure');
      return {
        stream: simulateReadableStream({
          chunks: [
            {
              type: 'tool-call',
              toolCallId: 'complete',
              toolName: 'mark_completed',
              input: '{}',
            },
            {
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: undefined },
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            },
          ],
        }),
      };
    },
  });
  let session: Awaited<ReturnType<typeof createMainSession>> | undefined;
  try {
    session = await createMainSession({
      connectionString,
      schemaName,
      model,
      memoryOptions: {
        lastMessages: 10,
        semanticRecall: false,
        workingMemory: { enabled: false },
      },
      onEvent: () => {},
      onTaskActivity: (runId, working, _thread, stopped) => {
        if (stopped) interrupted = true;
        activity.setRunWorking(runId, working, task.id, stopped);
      },
      task: {
        instructions: 'Use mark_completed to finish this fixture.',
        publish: async () => {},
        tools: {
          mark_completed: createTool({
            id: 'mark_completed',
            description: 'Complete the fixture task.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => {
              markedCompleted = true;
              events.publish({
                event: 'task.updated',
                task: { ...task, status: 'completed', version: 2 },
              });
              expect(activity.current().latestCompletion).toBeNull();
              return { done: true };
            },
          }),
        },
      },
    });
    const threadId = 'pal-task:' + task.id;
    const requestContext = new RequestContext([
      [MASTRA_THREAD_ID_KEY, threadId],
      [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
    ]);
    const accepted = await session.taskAgent!.sendMessage(
      'Complete the fixture.',
      {
        resourceId: MAIN_RESOURCE_ID,
        threadId,
        ifIdle: { streamOptions: { requestContext } },
      },
    ).accepted;
    expect(accepted.action).toBe('wake');
    if (accepted.action !== 'wake') throw new Error('Task did not start');
    await accepted.output.getFullOutput().catch(() => {});
    expect(markedCompleted).toBe(true);
    expect(interrupted).toBe(true);
    expect(activity.current()).toMatchObject({
      status: 'idle',
      runningTasks: [],
      latestCompletion: null,
    });
  } finally {
    await session?.close();
    activity.onModuleDestroy();
    const pool = new Pool({ connectionString });
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await pool.end();
    }
  }
});
