import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '@mastra/core/request-context';
import {
  createMainSession,
  MAIN_RESOURCE_ID,
} from '../dist/agent/main-session.js';
import { loadAgentInstructions } from '../dist/agent/agent-instructions.js';
import { WORKER_ID } from '../dist/agent/task-workers.js';
import { CodeModeProcessor } from '../dist/agent/code-mode.processor.js';
import { TaskToolDiscoveryProcessor } from '../dist/agent/task-tool-discovery.processor.js';

it('loads authentication skills only on interaction and starts fresh after restart', async () => {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    'postgresql://pal:pal@localhost:5433/pal_test';
  if (!new URL(connectionString).pathname.endsWith('_test'))
    throw new Error('Test database must end in _test');
  const schemaName = 'pal_skills_' + randomUUID().replaceAll('-', '');
  let calls = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      const load = ++calls % 2 === 1;
      return {
        stream: simulateReadableStream({
          chunks: [
            ...(load
              ? [
                  {
                    type: 'tool-call' as const,
                    toolCallId: 'load-' + calls,
                    toolName: 'skill',
                    input: JSON.stringify({ name: 'website-authentication' }),
                  },
                ]
              : [
                  { type: 'text-start' as const, id: 'text' },
                  {
                    type: 'text-delta' as const,
                    id: 'text',
                    delta: JSON.stringify({ text: 'Ready', replyTo: null }),
                  },
                  { type: 'text-end' as const, id: 'text' },
                ]),
            {
              type: 'finish' as const,
              finishReason: {
                unified: load ? ('tool-calls' as const) : ('stop' as const),
                raw: undefined,
              },
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
  const options = {
    connectionString,
    schemaName,
    model,
    memoryOptions: {
      lastMessages: 20,
      semanticRecall: false,
      workingMemory: { enabled: false },
    },
    onEvent: () => {},
    task: {
      instructions: await loadAgentInstructions('task'),
      tools: {},
      inputProcessors: [new TaskToolDiscoveryProcessor(() => ({}))],
      publish: async () => {},
      worker: {
        model,
        instructions: await loadAgentInstructions('worker'),
        tools: {},
        inputProcessors: [new CodeModeProcessor()],
        cleanup: async () => {},
      },
    },
  };
  let session: Awaited<ReturnType<typeof createMainSession>> | undefined;
  try {
    session = await createMainSession(options);
    expect(await session.agent.listSkills()).toEqual([]);
    expect(await session.taskAgent!.listSkills()).toEqual([]);
    expect((await session.worker!.listSkills()).map((s) => s.name)).toEqual([
      'website-authentication',
    ]);
    const skill = await session.worker!.getSkill('website-authentication');
    expect(skill).toBeDefined();
    const containsBody = (value: unknown) =>
      JSON.stringify(value).includes(
        JSON.stringify(skill!.instructions).slice(1, -1),
      );
    const run = async (threadId: string) => {
      const requestContext = new RequestContext([
        [MASTRA_THREAD_ID_KEY, threadId],
        [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
        [WORKER_ID, randomUUID()],
      ]);
      const output = await session!.worker!.stream(
        'Help me log into the test store.',
        {
          memory: { thread: threadId, resource: MAIN_RESOURCE_ID },
          requestContext,
        },
      );
      await output.getFullOutput();
    };
    await run('pal-task:skill-continuation');
    expect(model.doStreamCalls).toHaveLength(2);
    const initial = model.doStreamCalls[0];
    expect(JSON.stringify(initial.prompt)).toContain('website-authentication');
    expect(containsBody(initial.prompt)).toBe(false);
    const names = initial.tools!.map((tool) =>
      tool.type === 'function' ? tool.name : undefined,
    );
    expect(names).toEqual(
      expect.arrayContaining(['skill', 'skill_read', 'skill_search']),
    );
    const system = initial.prompt.filter(
      (message) => message.role === 'system',
    );
    expect(JSON.stringify(system)).not.toContain('external_skill');
    expect(containsBody(model.doStreamCalls[1].prompt)).toBe(true);
    await session.close();
    session = undefined;
    session = await createMainSession(options);
    await run('pal-task:skill-continuation');
    expect(model.doStreamCalls).toHaveLength(4);
    expect(containsBody(model.doStreamCalls[2].prompt)).toBe(false);
    expect(containsBody(model.doStreamCalls[3].prompt)).toBe(true);
    await run('pal-task:fresh-skill-context');
    expect(model.doStreamCalls).toHaveLength(6);
    expect(containsBody(model.doStreamCalls[4].prompt)).toBe(false);
    expect(containsBody(model.doStreamCalls[5].prompt)).toBe(true);
  } finally {
    await session?.close();
    const pool = new Pool({ connectionString });
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await pool.end();
    }
  }
});
