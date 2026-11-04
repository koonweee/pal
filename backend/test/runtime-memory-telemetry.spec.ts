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

  vi.advanceTimersByTime(30_000);
  expect(samples.map((sample) => sample.phase)).toEqual(['start', 'finish']);
});
