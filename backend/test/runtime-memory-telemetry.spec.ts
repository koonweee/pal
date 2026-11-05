import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeMemoryTelemetry } from '../dist/agent/runtime-memory-telemetry.js';

const counters = {
  rssBytes: 101,
  heapUsedBytes: 102,
  heapTotalBytes: 103,
  heapLimitBytes: 104,
  externalBytes: 105,
  arrayBuffersBytes: 106,
  oldSpaceUsedBytes: 107,
  oldSpaceSizeBytes: 108,
  largeObjectSpaceUsedBytes: 109,
  largeObjectSpaceSizeBytes: 110,
};

afterEach(() => vi.useRealTimers());

it('records idempotent lifecycle and delayed samples with current active counts', () => {
  vi.useFakeTimers();
  const samples: Record<string, unknown>[] = [];
  const telemetry = new RuntimeMemoryTelemetry(
    (sample) => samples.push(sample),
    30_000,
    () => counters,
  );

  telemetry.start({
    key: 'task:task-run',
    role: 'task',
    runId: 'task-run',
    threadId: 'pal-task:task-id',
  });
  telemetry.start({
    key: 'task:task-run',
    role: 'task',
    runId: 'task-run',
  });
  telemetry.start({
    key: 'worker:task-run:tool-call',
    role: 'worker',
    runId: 'task-run',
    parentRunId: 'task-run',
    taskId: 'task-id',
    workerId: 'worker-id',
    toolCallId: 'tool-call',
  });
  telemetry.finish('worker:task-run:tool-call');
  telemetry.finish('worker:task-run:tool-call');

  expect(samples).toEqual([
    expect.objectContaining({
      phase: 'start',
      role: 'task',
      runId: 'task-run',
      activeTaskRuns: 1,
      activeWorkerRuns: 0,
      ...counters,
    }),
    expect.objectContaining({
      phase: 'start',
      role: 'worker',
      workerId: 'worker-id',
      activeTaskRuns: 1,
      activeWorkerRuns: 1,
    }),
    expect.objectContaining({
      phase: 'finish',
      role: 'worker',
      activeTaskRuns: 1,
      activeWorkerRuns: 0,
    }),
  ]);

  vi.advanceTimersByTime(30_000);
  expect(samples.at(-1)).toEqual(
    expect.objectContaining({
      phase: 'settled',
      role: 'worker',
      activeTaskRuns: 1,
      activeWorkerRuns: 0,
    }),
  );

  telemetry.finish('task:task-run');
  expect(samples.at(-1)).toEqual(
    expect.objectContaining({
      phase: 'finish',
      role: 'task',
      activeTaskRuns: 0,
      activeWorkerRuns: 0,
    }),
  );
});

it('cancels delayed samples during shutdown', () => {
  vi.useFakeTimers();
  const samples: Record<string, unknown>[] = [];
  const telemetry = new RuntimeMemoryTelemetry(
    (sample) => samples.push(sample),
    30_000,
    () => counters,
  );
  telemetry.start({ key: 'task:run', role: 'task', runId: 'run' });
  telemetry.finish('task:run');
  telemetry.close();

  vi.advanceTimersByTime(300_000);
  expect(samples.map((sample) => sample.phase)).toEqual(['start', 'finish']);
});

it('records two and five minute runtime-global idle samples', () => {
  vi.useFakeTimers();
  const samples: Record<string, unknown>[] = [];
  const telemetry = new RuntimeMemoryTelemetry(
    (sample) => samples.push(sample),
    30_000,
    () => counters,
  );
  telemetry.start({ key: 'task:run', role: 'task', runId: 'run' });
  telemetry.finish('task:run');

  vi.advanceTimersByTime(120_000);
  expect(samples.at(-1)).toEqual({
    phase: 'idle',
    idleForMs: 120_000,
    activeTaskRuns: 0,
    activeWorkerRuns: 0,
    ...counters,
  });

  vi.advanceTimersByTime(180_000);
  expect(samples.at(-1)).toEqual({
    phase: 'idle',
    idleForMs: 300_000,
    activeTaskRuns: 0,
    activeWorkerRuns: 0,
    ...counters,
  });
});

it('forces garbage collection once after a high five-minute idle sample', async () => {
  vi.useFakeTimers();
  const samples: Record<string, unknown>[] = [];
  const before = { ...counters, heapUsedBytes: 512 * 1024 * 1024 };
  const after = { ...counters, heapUsedBytes: 128 * 1024 * 1024 };
  let collected = false;
  const forceGarbageCollection = vi.fn(async () => {
    collected = true;
  });
  const telemetry = new RuntimeMemoryTelemetry(
    (sample) => samples.push(sample),
    30_000,
    () => (collected ? after : before),
    forceGarbageCollection,
  );

  telemetry.start({ key: 'task:first', role: 'task', runId: 'first' });
  telemetry.finish('task:first');
  await vi.advanceTimersByTimeAsync(300_000);

  expect(samples.slice(-2)).toEqual([
    {
      phase: 'idle',
      idleForMs: 300_000,
      activeTaskRuns: 0,
      activeWorkerRuns: 0,
      ...before,
    },
    {
      phase: 'idle_gc',
      idleForMs: 300_000,
      activeTaskRuns: 0,
      activeWorkerRuns: 0,
      ...after,
    },
  ]);

  telemetry.start({ key: 'task:second', role: 'task', runId: 'second' });
  telemetry.finish('task:second');
  await vi.advanceTimersByTimeAsync(300_000);

  expect(forceGarbageCollection).toHaveBeenCalledTimes(1);
});

it('cancels stale idle samples and restarts delays after new work finishes', () => {
  vi.useFakeTimers();
  const samples: Record<string, unknown>[] = [];
  const telemetry = new RuntimeMemoryTelemetry(
    (sample) => samples.push(sample),
    30_000,
    () => counters,
  );
  telemetry.start({ key: 'task:first', role: 'task', runId: 'first' });
  telemetry.finish('task:first');
  vi.advanceTimersByTime(60_000);

  telemetry.start({ key: 'task:second', role: 'task', runId: 'second' });
  vi.advanceTimersByTime(240_000);
  expect(samples.filter((sample) => sample.phase === 'idle')).toEqual([]);

  telemetry.finish('task:second');
  vi.advanceTimersByTime(120_000);
  expect(samples.filter((sample) => sample.phase === 'idle')).toEqual([
    expect.objectContaining({ phase: 'idle', idleForMs: 120_000 }),
  ]);
  vi.advanceTimersByTime(180_000);
  expect(samples.filter((sample) => sample.phase === 'idle')).toEqual([
    expect.objectContaining({ phase: 'idle', idleForMs: 120_000 }),
    expect.objectContaining({ phase: 'idle', idleForMs: 300_000 }),
  ]);
});
