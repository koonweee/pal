import { randomBytes, randomUUID } from 'node:crypto';
import { getHeapSpaceStatistics } from 'node:v8';
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

const value = (name, fallback) => {
  const argument = process.argv.find((item) => item.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : fallback;
};
const scenario = value('scenario', 'combined');
const cycles = Number(value('cycles', '12'));
const gcMode = value('gc', 'end');
const settleMs = Number(value('settle-ms', '0'));
if (!['sequential', 'overlap', 'combined'].includes(scenario))
  throw new Error('scenario must be sequential, overlap, or combined');
if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 50)
  throw new Error('cycles must be an integer from 1 to 50');
if (!['end', 'each'].includes(gcMode))
  throw new Error('gc must be end or each');
if (!Number.isSafeInteger(settleMs) || settleMs < 0 || settleMs > 60_000)
  throw new Error('settle-ms must be an integer from 0 to 60000');
if (!global.gc) throw new Error('Run this harness with --expose-gc');

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pal:pal@127.0.0.1:15433/pal_test';
if (!new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('Test database must end in _test');

const workerActions = 30;
const screenshotBytes = 320 * 1024;
const monitoringCalls = 27;
const monitoringResultBytes = 32 * 1024;
const idleMs = 250;
const schema = 'pal_memory_soak_' + randomUUID().replaceAll('-', '');

const finish = (toolCalls = false) => ({
  type: 'finish',
  finishReason: {
    unified: toolCalls ? 'tool-calls' : 'stop',
    raw: undefined,
  },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
});
const text = (contents) => [
  { type: 'text-start', id: 'text' },
  { type: 'text-delta', id: 'text', delta: contents },
  { type: 'text-end', id: 'text' },
];
const publicText = (contents) =>
  JSON.stringify({
    text: contents,
    replyTo: null,
    attachmentIds: [],
    files: [],
  });
const tag = (prompt) =>
  (() => {
    const match = [...prompt.matchAll(/(deal|monitor)-cycle-(\d+)/g)].at(-1);
    if (!match) return 'unknown';
    const prefix = match[1] === 'deal' ? 'deal' : 'monitor';
    return `${prefix}-cycle-${Number(match[2])}`;
  })();

const taskCalls = new Map();
const workerCalls = new Map();
const taskModel = new MockLanguageModelV3({
  doStream: async (input) => {
    const prompt = JSON.stringify(input.prompt);
    const runTag = tag(prompt);
    const call = (taskCalls.get(runTag) ?? 0) + 1;
    taskCalls.set(runTag, call);
    const chunks = runTag.startsWith('deal-')
      ? call === 1
        ? [
            {
              type: 'tool-call',
              toolCallId: `delegate-${runTag}`,
              toolName: 'agent-worker',
              input: JSON.stringify({ prompt: `${runTag} inspect deals` }),
            },
            finish(true),
          ]
        : [...text(publicText(`completed ${runTag}`)), finish()]
      : call === 1
        ? [
            ...Array.from({ length: monitoringCalls }, (_, index) => ({
              type: 'tool-call',
              toolCallId: `${runTag}-monitor-${index}`,
              toolName: 'monitor_source',
              input: JSON.stringify({ runTag, index }),
            })),
            finish(true),
          ]
        : [...text(publicText(`completed ${runTag}`)), finish()];
    return { stream: simulateReadableStream({ chunks }) };
  },
});
const workerModel = new MockLanguageModelV3({
  modelId: 'memory-soak-worker',
  doStream: async (input) => {
    const prompt = JSON.stringify(input.prompt);
    const runTag = tag(prompt);
    const call = (workerCalls.get(runTag) ?? 0) + 1;
    workerCalls.set(runTag, call);
    return {
      stream: simulateReadableStream({
        chunks:
          call <= workerActions
            ? [
                {
                  type: 'tool-call',
                  toolCallId: `${runTag}-action-${call}`,
                  toolName: 'screenshot_action',
                  input: JSON.stringify({ runTag, index: call }),
                },
                finish(true),
              ]
            : [...text(`verified findings for ${runTag}`), finish()],
      }),
    };
  },
});

const memory = () => {
  const usage = process.memoryUsage();
  const spaces = new Map(
    getHeapSpaceStatistics().map((space) => [space.space_name, space]),
  );
  const old = spaces.get('old_space');
  const large = ['large_object_space', 'new_large_object_space'].reduce(
    (total, name) => total + (spaces.get(name)?.space_used_size ?? 0),
    0,
  );
  const mib = (bytes) => Number((bytes / 1024 / 1024).toFixed(2));
  return {
    rssMiB: mib(usage.rss),
    heapUsedMiB: mib(usage.heapUsed),
    heapTotalMiB: mib(usage.heapTotal),
    externalMiB: mib(usage.external),
    arrayBuffersMiB: mib(usage.arrayBuffers),
    oldSpaceUsedMiB: mib(old?.space_used_size ?? 0),
    largeObjectSpaceUsedMiB: mib(large),
  };
};
const forceGc = async () => {
  for (let index = 0; index < 3; index += 1) {
    global.gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
};
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

let main;
const outputs = new Set();
const samples = [];
try {
  main = await createMainSession({
    connectionString: databaseUrl,
    schemaName: schema,
    model: taskModel,
    memoryOptions: {
      lastMessages: 20,
      semanticRecall: false,
      workingMemory: { enabled: false },
    },
    publish: async () => {},
    onEvent: () => {},
    task: {
      instructions: 'Run the requested fixture work and return its result.',
      tools: {
        monitor_source: createTool({
          id: 'monitor_source',
          description: 'Return one monitoring source result',
          execute: async ({ runTag, index }) => ({
            runTag,
            index,
            result:
              `${runTag}:${index}:` +
              randomBytes(monitoringResultBytes).toString('base64'),
          }),
        }),
      },
      publish: async () => {},
      worker: {
        coordinator: new InteractionCoordinator(),
        model: workerModel,
        instructions: 'Use one visual action at a time and return findings.',
        tools: {
          screenshot_action: createTool({
            id: 'screenshot_action',
            description: 'Perform an action and return its screenshot',
            execute: async ({ runTag, index }) => ({
              runTag,
              index,
              image:
                `${runTag}:${index}:` +
                randomBytes(screenshotBytes).toString('base64'),
            }),
          }),
        },
        cleanup: async () => {},
      },
    },
  });

  const run = async (threadId, contents) => {
    const requestContext = new RequestContext([
      [MASTRA_THREAD_ID_KEY, threadId],
      [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
    ]);
    const accepted = await main.taskAgent.sendMessage(contents, {
      resourceId: MAIN_RESOURCE_ID,
      threadId,
      ifIdle: { streamOptions: { requestContext } },
    }).accepted;
    if (accepted.action !== 'wake')
      throw new Error(`Expected wake, received ${accepted.action}`);
    outputs.add(accepted.output);
    try {
      await accepted.output.getFullOutput();
    } finally {
      outputs.delete(accepted.output);
    }
  };

  await forceGc();
  const initial = memory();
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    let peak = memory();
    const sampler = setInterval(() => {
      const current = memory();
      if (current.heapUsedMiB > peak.heapUsedMiB) peak = current;
    }, 5);
    const work = [];
    if (scenario !== 'overlap')
      work.push(run('pal-task:memory-soak-deal', `deal-cycle-${cycle}`));
    if (scenario !== 'sequential')
      work.push(run('pal-task:memory-soak-monitor', `monitor-cycle-${cycle}`));
    await Promise.all(work);
    taskModel.doStreamCalls.length = 0;
    workerModel.doStreamCalls.length = 0;
    clearInterval(sampler);
    const completed = memory();
    await wait(idleMs);
    const idle = memory();
    let postGc;
    if (gcMode === 'each') {
      await forceGc();
      postGc = memory();
    }
    samples.push({
      cycle,
      peak,
      completed,
      idle,
      ...(postGc ? { postGc } : {}),
    });
  }
  if (settleMs > 0) await wait(settleMs);
  await forceGc();
  const finalGc = memory();
  const inspection = new Pool({ connectionString: databaseUrl });
  let storage;
  try {
    const { rows } = await inspection.query(
      `SELECT
         CASE WHEN thread_id IN ('pal-task:memory-soak-deal', 'pal-task:memory-soak-monitor')
           THEN 'parent' ELSE 'worker' END AS kind,
         count(*)::int AS messages,
         coalesce(sum(pg_column_size(content)), 0)::bigint AS bytes
       FROM "${schema}".mastra_messages
       GROUP BY 1
       ORDER BY 1`,
    );
    storage = rows.map((row) => ({
      kind: row.kind,
      messages: row.messages,
      mebibytes: Number((Number(row.bytes) / 1024 / 1024).toFixed(2)),
    }));
  } finally {
    await inspection.end();
  }
  console.log(
    JSON.stringify(
      {
        scenario,
        cycles,
        gcMode,
        conditions: {
          workerActions,
          screenshotKiB: screenshotBytes / 1024,
          monitoringCalls,
          monitoringResultKiB: monitoringResultBytes / 1024,
          idleMs,
          settleMs,
        },
        initial,
        samples,
        finalGc,
        storage,
      },
      null,
      2,
    ),
  );
} finally {
  for (const output of outputs) main?.taskAgent?.abortRunStream(output.runId);
  await Promise.allSettled(
    [...outputs].map((output) => output.getFullOutput()),
  );
  await main?.close();
  const cleanup = new Pool({ connectionString: databaseUrl });
  try {
    await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await cleanup.end();
  }
}
