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
import { PARENT_TASK_ID, WORKER_ID } from '../dist/agent/task-workers.js';
import { TaskToolDiscoveryProcessor } from '../dist/agent/task-tool-discovery.processor.js';
import { until } from './helpers.js';

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

it('runs native workers concurrently with per-task limits, private output, and failure/abort cleanup', async () => {
  const schema = 'pal_workers_' + randomUUID().replaceAll('-', '');
  const parents = ['alpha', 'beta', 'cancel'];
  const gates = Object.fromEntries(
    parents.map((id) => [id, Promise.withResolvers<void>()]),
  );
  const started: { taskId: string; workerId: string; branch: string }[] = [];
  const cleaned: string[] = [];
  const publications: string[] = [];
  const calls = new Map<string, number>();
  const toolSets: string[][] = [];
  const parentResults: string[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (input) => {
      const header = input.headers?.['session-id'];
      if (!header) throw new Error('Missing session header');
      const count = (calls.get(header) ?? 0) + 1;
      calls.set(header, count);
      const worker = header.startsWith('pal-worker:');
      const prompt = JSON.stringify(input.prompt);
      const branch = [...prompt.matchAll(/branch:([a-z]+-\d)/g)].at(-1)?.[1];
      if (worker && branch === 'alpha-2' && count > 1)
        throw new Error('Fixture worker failed');
      if (worker) toolSets.push((input.tools ?? []).map((tool) => tool.name));
      const parent = header.slice('pal-task:'.length);
      if (!worker && count > 1) parentResults.push(prompt);
      return {
        stream: simulateReadableStream({
          chunks: worker
            ? count === 1
              ? [
                  {
                    type: 'tool-call',
                    toolCallId: 'hold-' + branch,
                    toolName: 'hold',
                    input: JSON.stringify({ branch }),
                  },
                  finish(true),
                ]
              : [...text('private finding ' + branch), finish()]
            : count === 1 || (parent === 'alpha' && count === 3)
              ? [
                  ...Array.from(
                    {
                      length:
                        parent === 'alpha'
                          ? count === 1
                            ? 4
                            : 3
                          : parent === 'cancel'
                            ? 3
                            : 1,
                    },
                    (_, index) => ({
                      type: 'tool-call' as const,
                      toolCallId: 'delegate-' + index,
                      toolName: 'agent-worker',
                      input: JSON.stringify({
                        prompt:
                          'branch:' +
                          parent +
                          '-' +
                          (index + (count === 3 ? 5 : 1)),
                      }),
                    }),
                  ),
                  finish(true),
                ]
              : [
                  ...text(
                    JSON.stringify({
                      text: 'Combined ' + parent,
                      replyTo: null,
                    }),
                  ),
                  finish(),
                ],
        }),
      };
    },
  });
  let main: Awaited<ReturnType<typeof createMainSession>> | undefined;
  const runs: import('@mastra/core/stream').MastraModelOutput<unknown>[] = [];
  try {
    main = await createMainSession({
      connectionString: databaseUrl,
      schemaName: schema,
      model,
      memoryOptions: {
        lastMessages: 20,
        semanticRecall: false,
        workingMemory: { enabled: false },
      },
      publish: async () => {},
      onEvent: () => {},
      task: {
        instructions: 'Coordinate workers and combine findings.',
        tools: {},
        inputProcessors: [new TaskToolDiscoveryProcessor(() => ({}))],
        publish: async (output) => {
          publications.push(output.text);
        },
        worker: {
          instructions: 'Return private findings.',
          tools: {
            hold: createTool({
              id: 'hold',
              description: 'Wait for fixture release',
              inputSchema: {
                type: 'object',
                properties: { branch: { type: 'string' } },
                required: ['branch'],
                additionalProperties: false,
              },
              execute: async ({ branch }: { branch: string }, context) => {
                const taskId = context!.requestContext!.get(
                  PARENT_TASK_ID,
                ) as string;
                const workerId = context!.requestContext!.get(
                  WORKER_ID,
                ) as string;
                expect(
                  context!.requestContext!.get(MASTRA_THREAD_ID_KEY),
                ).not.toBe('pal-task:' + taskId);
                started.push({ taskId, workerId, branch });
                const aborted = Promise.withResolvers<void>();
                const abort = () =>
                  aborted.reject(new Error('Fixture aborted'));
                context?.abortSignal?.addEventListener('abort', abort, {
                  once: true,
                });
                try {
                  await Promise.race([gates[taskId].promise, aborted.promise]);
                  return { branch };
                } finally {
                  context?.abortSignal?.removeEventListener('abort', abort);
                }
              },
            }),
          },
          inputProcessors: [new TaskToolDiscoveryProcessor(() => ({}))],
          cleanup: async (_, id) => {
            cleaned.push(id);
          },
        },
      },
    });
    const run = async (taskId: string) => {
      const threadId = 'pal-task:' + taskId;
      const requestContext = new RequestContext([
        [MASTRA_THREAD_ID_KEY, threadId],
        [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
      ]);
      const delivery = await main!.taskAgent!.sendMessage(
        'Run independent branches',
        {
          resourceId: MAIN_RESOURCE_ID,
          threadId,
          ifIdle: { streamOptions: { requestContext } },
        },
      ).accepted;
      if (delivery.action !== 'wake')
        throw new Error('Fixture task did not wake');
      runs.push(delivery.output);
      return delivery.output;
    };
    const alpha = await run('alpha');
    await until(() => started.length === 3, 10000);
    const beta = await run('beta');
    await until(() => started.length === 4, 10000);
    expect(started.filter((worker) => worker.taskId === 'alpha')).toHaveLength(
      3,
    );
    expect(started.some((worker) => worker.branch === 'alpha-4')).toBe(false);
    expect(new Set(started.map((worker) => worker.workerId)).size).toBe(4);
    expect(publications).toEqual([]);
    gates.alpha.resolve();
    gates.beta.resolve();
    await Promise.all([alpha.getFullOutput(), beta.getFullOutput()]);
    expect(cleaned).toHaveLength(4);
    expect(
      parentResults.some((result) => result.includes('three active workers')),
    ).toBe(true);
    expect(publications.sort()).toEqual(['Combined alpha', 'Combined beta']);
    expect(
      toolSets.every(
        (tools) =>
          tools.includes('hold') &&
          tools.includes('search_tools') &&
          !tools.includes('agent-worker') &&
          !tools.includes('set_task_status'),
      ),
    ).toBe(true);
    expect(
      parentResults.some((result) =>
        result.includes('Failed agent tool execution'),
      ),
    ).toBe(true);
    await (await run('alpha')).getFullOutput();
    expect(started).toHaveLength(7);
    expect(cleaned).toHaveLength(7);
    const cancelled = await run('cancel');
    await until(() => started.length === 10, 10000);
    main.taskAgent!.abortRunStream(cancelled.runId);
    await cancelled.getFullOutput().catch(() => {});
    await until(() => cleaned.length === 10, 10000);
    expect(
      publications.some((value) => value.includes('private finding')),
    ).toBe(false);
  } finally {
    for (const gate of Object.values(gates)) gate.resolve();
    for (const run of main?.taskAgent?.listActiveThreadRuns() ?? [])
      main!.taskAgent!.abortRunStream(run.runId);
    await Promise.allSettled(runs.map((run) => run.getFullOutput()));
    await main?.close();
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    } finally {
      await pool.end();
    }
  }
}, 30000);
