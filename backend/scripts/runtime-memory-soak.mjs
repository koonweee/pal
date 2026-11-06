import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { getHeapSpaceStatistics } from 'node:v8';
import { deflateSync } from 'node:zlib';
import { Pool } from 'pg';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { createOpenAI } from '@ai-sdk/openai';
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
import {
  createMemoryOptions,
  createWorkerMemoryOptions,
} from '../dist/agent/memory-options.js';
import { interactionHistoryProcessor } from '../dist/agent/interaction-history.processor.js';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import { InteractionCoordinator } from '../dist/interaction/interaction-coordinator.js';

const value = (name, fallback) => {
  const argument = process.argv.find((item) => item.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : fallback;
};
const scenario = value('scenario', 'combined');
const cycles = Number(value('cycles', '12'));
const gcMode = value('gc', 'end');
const consumption = value('consumption', 'full-output');
const memoryMode = value('memory', 'simple');
const workerModelMode = value('worker-model', 'mock');
const settleMs = Number(value('settle-ms', '0'));
const workerActions = Number(value('worker-actions', '30'));
const screenshotKib = Number(value('screenshot-kib', '320'));
const screenshotFile = value('screenshot-file', '');
const runTimeoutMs = Number(
  value('run-timeout-ms', workerModelMode === 'real' ? '600000' : '30000'),
);
if (!['sequential', 'overlap', 'combined'].includes(scenario))
  throw new Error('scenario must be sequential, overlap, or combined');
if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 50)
  throw new Error('cycles must be an integer from 1 to 50');
if (!['end', 'each'].includes(gcMode))
  throw new Error('gc must be end or each');
if (!['full-output', 'full-stream', 'accepted-only'].includes(consumption))
  throw new Error(
    'consumption must be full-output, full-stream, or accepted-only',
  );
if (!['simple', 'observational'].includes(memoryMode))
  throw new Error('memory must be simple or observational');
if (
  !['mock', 'provider-fixture', 'provider-http', 'real'].includes(
    workerModelMode,
  )
)
  throw new Error(
    'worker-model must be mock, provider-fixture, provider-http, or real',
  );
if (!Number.isSafeInteger(settleMs) || settleMs < 0 || settleMs > 60_000)
  throw new Error('settle-ms must be an integer from 0 to 60000');
if (
  !Number.isSafeInteger(workerActions) ||
  workerActions < 1 ||
  workerActions > 100
)
  throw new Error('worker-actions must be an integer from 1 to 100');
if (
  !Number.isSafeInteger(screenshotKib) ||
  screenshotKib < 1 ||
  screenshotKib > 10_240
)
  throw new Error('screenshot-kib must be an integer from 1 to 10240');
if (
  !Number.isSafeInteger(runTimeoutMs) ||
  runTimeoutMs < 1_000 ||
  runTimeoutMs > 900_000
)
  throw new Error('run-timeout-ms must be an integer from 1000 to 900000');
if (!global.gc) throw new Error('Run this harness with --expose-gc');

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pal:pal@127.0.0.1:15433/pal_test';
if (!new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('Test database must end in _test');

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.byteLength);
  return chunk;
};
const syntheticPng = () => {
  const width = 640;
  const height = 512;
  const pixels = Buffer.alloc((width + 1) * height);
  for (let row = 0; row < height; row += 1)
    randomBytes(width).copy(pixels, row * (width + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels, { level: 0 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
const screenshotFixture = screenshotFile
  ? await readFile(screenshotFile)
  : workerModelMode === 'real'
    ? syntheticPng()
    : null;
if (
  screenshotFixture &&
  (screenshotFixture.byteLength < 24 ||
    !screenshotFixture
      .subarray(0, 8)
      .equals(Buffer.from('89504e470d0a1a0a', 'hex')))
)
  throw new Error('screenshot-file must be a PNG image');
const screenshotBytes = screenshotFixture?.byteLength ?? screenshotKib * 1024;
const screenshotDimensions = screenshotFixture
  ? {
      width: screenshotFixture.readUInt32BE(16),
      height: screenshotFixture.readUInt32BE(20),
    }
  : null;
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
let providerFixtureCalls = 0;
const providerRunCalls = new Map();
const providerFixtureStream = (body) => {
  providerFixtureCalls += 1;
  const serialized = JSON.stringify(body.input ?? []);
  const runTag = tag(serialized);
  const call = (providerRunCalls.get(runTag) ?? 0) + 1;
  providerRunCalls.set(runTag, call);
  const responseId = `response-${runTag}-${call}`;
  const events = [
    {
      type: 'response.created',
      response: {
        id: responseId,
        created_at: Math.floor(Date.now() / 1000),
        model: 'gpt-6.1-terra',
      },
    },
  ];
  if (call <= workerActions) {
    const action = call;
    const callId = `${runTag}-action-${action}`;
    const item = {
      type: 'function_call',
      id: `item-${callId}`,
      call_id: callId,
      name: 'screenshot_action',
      arguments: JSON.stringify({ runTag, index: action }),
    };
    events.push(
      { type: 'response.output_item.added', output_index: 0, item },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { ...item, status: 'completed' },
      },
    );
  } else {
    const itemId = `message-${runTag}`;
    events.push(
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: itemId, phase: 'final_answer' },
      },
      {
        type: 'response.output_text.delta',
        item_id: itemId,
        delta: `verified findings for ${runTag}`,
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'message', id: itemId, phase: 'final_answer' },
      },
    );
  }
  events.push({
    type: 'response.completed',
    response: {
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
    },
  });
  const stream = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('');
  return stream;
};
let providerHttpServer;
let providerHttpBaseUrl;
if (workerModelMode === 'provider-http') {
  providerHttpServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(providerFixtureStream(body));
  });
  await new Promise((resolve, reject) => {
    providerHttpServer.once('error', reject);
    providerHttpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = providerHttpServer.address();
  if (!address || typeof address === 'string')
    throw new Error('Provider fixture server did not bind a TCP port');
  providerHttpBaseUrl = `http://127.0.0.1:${address.port}/v1`;
}
const providerFixture = createOpenAI({
  apiKey: 'fixture',
  ...(providerHttpBaseUrl ? { baseURL: providerHttpBaseUrl } : {}),
  ...(workerModelMode === 'provider-fixture'
    ? {
        fetch: async (url, init) => {
          const request = new Request(url, init);
          const forwarded = new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal: request.signal,
            ...(request.body ? { duplex: 'half' } : {}),
          });
          const body = JSON.parse(await forwarded.text());
          const stream = providerFixtureStream(body);
          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        },
      }
    : {}),
});
const selectedWorkerModel =
  workerModelMode === 'real'
    ? chatgptModel(
        'gpt-6.1-terra',
        process.env.PAL_AGENT_AUTH_PATH ?? '',
        'medium',
      )
    : workerModelMode === 'provider-fixture' ||
        workerModelMode === 'provider-http'
      ? providerFixture.responses('gpt-6.1-terra')
      : workerModel;
let memoryCalls = 0;
const memoryModel = new MockLanguageModelV3({
  modelId: 'memory-soak-observer',
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        ...text(
          `<observations>Completed recurring fixture cycle ${++memoryCalls}.</observations><current-task>Continue recurring fixture checks.</current-task>`,
        ),
        finish(),
      ],
    }),
  }),
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
    memoryOptions:
      memoryMode === 'observational'
        ? await createMemoryOptions(memoryModel)
        : {
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
        model: selectedWorkerModel,
        memoryOptions: await createWorkerMemoryOptions(memoryModel),
        inputProcessors: [interactionHistoryProcessor(['screenshot_action'])],
        instructions:
          workerModelMode === 'real'
            ? `Call screenshot_action exactly ${workerActions} times sequentially, then return a short completion. Do not stop early.`
            : 'Use one visual action at a time and return findings.',
        tools: {
          screenshot_action: createTool({
            id: 'screenshot_action',
            description: 'Perform an action and return its screenshot',
            execute: async ({ runTag, index }) => ({
              __workspaceMedia: true,
              text: `Completed ${runTag} action ${index}`,
              mediaType: 'image/png',
              data: Buffer.from(
                screenshotFixture ?? randomBytes(screenshotBytes),
              ).toString('base64'),
            }),
            toModelOutput: (output) => ({
              type: 'content',
              value: [
                { type: 'text', text: output.text },
                {
                  type: 'media',
                  data: output.data,
                  mediaType: output.mediaType,
                },
              ],
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
    if (consumption === 'accepted-only') {
      const deadline = Date.now() + runTimeoutMs;
      while (
        main.taskAgent
          .listActiveThreadRuns()
          .some((run) => run.runId === accepted.runId)
      ) {
        if (Date.now() >= deadline)
          throw new Error(`Timed out waiting for ${accepted.runId}`);
        await wait(10);
      }
      return;
    }
    outputs.add(accepted.output);
    try {
      if (consumption === 'full-stream') {
        for await (const _part of accepted.output.fullStream) {
          // Production consumes the stream to completion without retaining parts.
        }
      } else {
        await accepted.output.getFullOutput();
      }
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
    memoryModel.doStreamCalls.length = 0;
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
        consumption,
        memoryMode,
        memoryCalls,
        workerModelMode,
        providerFixtureCalls,
        conditions: {
          workerActions,
          screenshotKiB: Number((screenshotBytes / 1024).toFixed(2)),
          screenshotDimensions,
          screenshotSource: screenshotFile
            ? 'png-fixture'
            : workerModelMode === 'real'
              ? 'synthetic-png'
              : 'synthetic-bytes',
          monitoringCalls,
          monitoringResultKiB: monitoringResultBytes / 1024,
          idleMs,
          settleMs,
          runTimeoutMs,
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
  for (const run of main?.taskAgent?.listActiveThreadRuns() ?? [])
    main.taskAgent.abortRunStream(run.runId);
  for (const output of outputs) main?.taskAgent?.abortRunStream(output.runId);
  await Promise.allSettled(
    [...outputs].map((output) => output.getFullOutput()),
  );
  await main?.close();
  if (providerHttpServer) {
    providerHttpServer.closeIdleConnections();
    await new Promise((resolve, reject) => {
      providerHttpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
  const cleanup = new Pool({ connectionString: databaseUrl });
  try {
    await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await cleanup.end();
  }
}
