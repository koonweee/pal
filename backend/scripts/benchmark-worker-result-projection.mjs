import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { projectWorkerResults } from '../dist/agent/worker-result-projection.js';

const scenario = process.argv[2];
if (!['baseline', 'projected'].includes(scenario))
  throw new Error(
    'Usage: node --expose-gc scripts/benchmark-worker-result-projection.mjs <baseline|projected>',
  );
if (!global.gc) throw new Error('Run this benchmark with --expose-gc');

const concurrentWorkers = 3;
const completedCycles = 5;
const resultsPerWorker = 30;
const rawImageBytes = 320 * 1024;

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

const text = (value) => [
  { type: 'text-start', id: 'text' },
  { type: 'text-delta', id: 'text', delta: value },
  { type: 'text-end', id: 'text' },
];

const modelCalls = new Map();
const model = new MockLanguageModelV3({
  doStream: async (input) => {
    const prompt = JSON.stringify(input.prompt);
    const runTag = prompt.match(/cycle-\d+-worker-\d+/)?.[0] ?? 'unknown';
    const call = (modelCalls.get(runTag) ?? 0) + 1;
    modelCalls.set(runTag, call);
    return {
      stream: simulateReadableStream({
        chunks:
          call === 1
            ? [
                ...Array.from({ length: resultsPerWorker }, (_, index) => ({
                  type: 'tool-call',
                  toolCallId: `${runTag}-${index}`,
                  toolName: 'screenshot',
                  input: JSON.stringify({ index, runTag }),
                })),
                finish(true),
              ]
            : [...text(`Completed ${runTag}`), finish()],
      }),
    };
  },
});

const worker = new Agent({
  id: 'memory-benchmark-worker',
  name: 'Memory benchmark worker',
  instructions: 'Capture the requested screenshots.',
  model,
  tools: {
    screenshot: createTool({
      id: 'screenshot',
      description: 'Return screenshot-sized evidence',
      execute: async ({ index, runTag }) => ({
        index,
        runTag,
        image:
          `${runTag}:${index}:` +
          Buffer.alloc(rawImageBytes, 65 + (index % 26)).toString('base64'),
      }),
    }),
  },
});
const delegatedWorker =
  scenario === 'projected' ? projectWorkerResults(worker) : worker;

const memory = () => {
  const usage = process.memoryUsage();
  return {
    heapUsedMiB: usage.heapUsed / 1024 / 1024,
    externalMiB: usage.external / 1024 / 1024,
    rssMiB: usage.rss / 1024 / 1024,
  };
};

const collectParentResult = async (cycle, workerIndex) => {
  const runTag = `cycle-${cycle}-worker-${workerIndex}`;
  const output = await delegatedWorker.stream(runTag, {
    maxSteps: 0,
    stopWhen: () => false,
  });
  const forwardedChunks = [];
  for await (const chunk of output.fullStream) forwardedChunks.push(chunk);
  const toolResults = (await output.toolResults) ?? [];
  const parentResult = {
    text: await output.text,
    subAgentToolResults: toolResults.map(({ payload }) => ({
      toolName: payload.toolName,
      toolCallId: payload.toolCallId,
      result: payload.result,
      args: payload.args,
      isError: payload.isError,
    })),
  };
  const persistedParentRecord = JSON.stringify({
    forwardedChunks,
    parentResult,
  });
  return Buffer.byteLength(persistedParentRecord);
};

const forceGc = async () => {
  for (let index = 0; index < 3; index += 1) {
    global.gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
};

await forceGc();
const initial = memory();
const cycles = [];
for (let cycle = 1; cycle <= completedCycles; cycle += 1) {
  let sampledPeak = memory();
  const sampler = setInterval(() => {
    const current = memory();
    if (current.heapUsedMiB > sampledPeak.heapUsedMiB) sampledPeak = current;
  }, 2);
  const parentBytes = await Promise.all(
    Array.from({ length: concurrentWorkers }, (_, workerIndex) =>
      collectParentResult(cycle, workerIndex + 1),
    ),
  );
  clearInterval(sampler);
  const completed = memory();
  if (completed.heapUsedMiB > sampledPeak.heapUsedMiB) sampledPeak = completed;
  model.doStreamCalls.length = 0;
  await forceGc();
  cycles.push({
    cycle,
    parentRecordMiB:
      parentBytes.reduce((sum, value) => sum + value, 0) / 1024 / 1024,
    peakHeapMiB: sampledPeak.heapUsedMiB,
    completedHeapMiB: completed.heapUsedMiB,
    postGcHeapMiB: memory().heapUsedMiB,
  });
}

const stableCycles = cycles.slice(-3).map(({ postGcHeapMiB }) => postGcHeapMiB);
console.log(
  JSON.stringify(
    {
      scenario,
      conditions: {
        concurrentWorkers,
        completedCycles,
        resultsPerWorker,
        rawImageKiB: rawImageBytes / 1024,
        rawEvidenceMiBPerWorker:
          (resultsPerWorker * rawImageBytes * 4) / 3 / 1024 / 1024,
        workerStepLimit: 'none',
      },
      initial,
      cycles,
      final: memory(),
      lastThreePostGcRangeMiB:
        Math.max(...stableCycles) - Math.min(...stableCycles),
    },
    null,
    2,
  ),
);
