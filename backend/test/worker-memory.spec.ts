import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { createTool } from '@mastra/core/tools';
import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';
import {
  createMainSession,
  MAIN_RESOURCE_ID,
} from '../dist/agent/main-session.js';
import { InteractionCoordinator } from '../dist/interaction/interaction-coordinator.js';
import { WORKER_ID } from '../dist/agent/task-workers.js';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pal:pal@localhost:5433/pal_test';
if (!new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('Test database must end in _test');

const finish = (tool = false) => ({
  type: 'finish' as const,
  finishReason: {
    unified: tool ? ('tool-calls' as const) : ('stop' as const),
    raw: undefined,
  },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
});

const text = (value: string) => [
  { type: 'text-start' as const, id: 'text' },
  { type: 'text-delta' as const, id: 'text', delta: value },
  { type: 'text-end' as const, id: 'text' },
];

it('evicts observed worker evidence from the active prompt while retaining storage', async () => {
  const schema = 'pal_worker_memory_' + randomUUID().replaceAll('-', '');
  const sentinel = 'raw-worker-image-'.repeat(2_000);
  const actorPrompts: string[] = [];
  const actor = new MockLanguageModelV3({
    doStream: async (input) => {
      const prompt = JSON.stringify(input.prompt);
      actorPrompts.push(prompt);
      return {
        stream: simulateReadableStream({
          chunks:
            actorPrompts.length === 1
              ? [
                  {
                    type: 'tool-call' as const,
                    toolCallId: 'capture-1',
                    toolName: 'capture',
                    input: '{}',
                  },
                  finish(true),
                ]
              : actorPrompts.length === 2
                ? [
                    {
                      type: 'tool-call' as const,
                      toolCallId: 'confirm-1',
                      toolName: 'confirm',
                      input: '{}',
                    },
                    finish(true),
                  ]
                : [...text('Worker complete'), finish()],
        }),
      };
    },
  });
  const observer = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          ...text(
            '<observations>\nDate: Nov 5, 2026\n* Captured screen evidence for the active flow.\n</observations>\n<current-task>Finish the worker flow.</current-task>',
          ),
          finish(),
        ],
      }),
    }),
  });
  let session: Awaited<ReturnType<typeof createMainSession>> | undefined;
  try {
    session = await createMainSession({
      connectionString: databaseUrl,
      schemaName: schema,
      model: actor,
      memoryOptions: {
        lastMessages: false,
        semanticRecall: false,
        workingMemory: { enabled: false },
      },
      onEvent: () => {},
      task: {
        instructions: 'Task fixture',
        tools: {},
        publish: async () => {},
        worker: {
          coordinator: new InteractionCoordinator(),
          model: actor,
          memoryOptions: {
            lastMessages: false,
            semanticRecall: false,
            workingMemory: { enabled: false },
            observationalMemory: {
              model: observer,
              scope: 'thread',
              observation: {
                messageTokens: 100,
                bufferTokens: false,
                bufferActivation: 25,
                observeAttachments: false,
                continuationHints: { suggestedResponse: false },
              },
              reflection: { observationTokens: 10_000 },
            },
          },
          instructions: 'Use capture and finish the flow.',
          tools: {
            capture: createTool({
              id: 'capture',
              description: 'Capture fixture evidence',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => ({ screenshot: sentinel }),
            }),
            confirm: createTool({
              id: 'confirm',
              description: 'Confirm fixture progress',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => ({ confirmed: true }),
            }),
          },
          cleanup: async () => {},
        },
      },
    });
    const threadId = 'pal-worker-memory-fixture';
    const output = await session.worker!.stream('Capture the screen.', {
      memory: { thread: threadId, resource: MAIN_RESOURCE_ID },
      requestContext: new RequestContext([
        [MASTRA_THREAD_ID_KEY, threadId],
        [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
        [WORKER_ID, 'fixture-worker'],
      ]),
    });
    await output.getFullOutput();

    expect(actorPrompts).toHaveLength(3);
    expect(actorPrompts[1]).toContain('Captured screen evidence');
    expect(actorPrompts[1]).toContain('raw-worker-image-');
    expect(actorPrompts[2]).toContain('Captured screen evidence');
    expect(actorPrompts[2]).not.toContain('raw-worker-image-');
    expect(observer.doStreamCalls).toHaveLength(1);

    const inspection = new Pool({ connectionString: databaseUrl });
    try {
      const { rows } = await inspection.query(
        `SELECT content FROM "${schema}".mastra_messages WHERE thread_id = $1`,
        [threadId],
      );
      expect(JSON.stringify(rows)).toContain('raw-worker-image-');
    } finally {
      await inspection.end();
    }
  } finally {
    await session?.close();
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    } finally {
      await pool.end();
    }
  }
}, 30_000);
