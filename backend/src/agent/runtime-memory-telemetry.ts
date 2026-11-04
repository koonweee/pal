import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8';

export type RuntimeMemoryRole = 'task' | 'worker';

export type RuntimeMemoryContext = {
  key: string;
  role: RuntimeMemoryRole;
  runId: string;
  threadId?: string;
  taskId?: string;
  workerId?: string;
  parentRunId?: string;
  toolCallId?: string;
  executionId?: string;
};

type MemoryCounters = {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  heapLimitBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  oldSpaceUsedBytes: number;
  oldSpaceSizeBytes: number;
  largeObjectSpaceUsedBytes: number;
  largeObjectSpaceSizeBytes: number;
};

function readMemoryCounters(): MemoryCounters {
  const usage = process.memoryUsage();
  const spaces = new Map(
    getHeapSpaceStatistics().map((space) => [space.space_name, space]),
  );
  const oldSpace = spaces.get('old_space');
  const largeObjectSpaces = [
    spaces.get('large_object_space'),
    spaces.get('new_large_object_space'),
  ];
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    heapLimitBytes: getHeapStatistics().heap_size_limit,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
    oldSpaceUsedBytes: oldSpace?.space_used_size ?? 0,
    oldSpaceSizeBytes: oldSpace?.space_size ?? 0,
    largeObjectSpaceUsedBytes: largeObjectSpaces.reduce(
      (total, space) => total + (space?.space_used_size ?? 0),
      0,
    ),
    largeObjectSpaceSizeBytes: largeObjectSpaces.reduce(
      (total, space) => total + (space?.space_size ?? 0),
      0,
    ),
  };
}

export class RuntimeMemoryTelemetry {
  private readonly active = new Map<string, RuntimeMemoryContext>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly record: (data: Record<string, unknown>) => void,
    private readonly settleDelayMs = 30_000,
    private readonly read = readMemoryCounters,
  ) {}

  start(context: RuntimeMemoryContext) {
    if (this.active.has(context.key)) return;
    this.active.set(context.key, context);
    this.sample('start', context);
  }

  finish(key: string) {
    const context = this.active.get(key);
    if (!context) return;
    this.active.delete(key);
    this.sample('finish', context);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.sample('settled', context);
    }, this.settleDelayMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  close() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.active.clear();
  }

  private sample(
    phase: 'start' | 'finish' | 'settled',
    context: RuntimeMemoryContext,
  ) {
    const active = [...this.active.values()];
    const { key: _key, ...identity } = context;
    this.record({
      phase,
      ...identity,
      activeTaskRuns: active.filter((run) => run.role === 'task').length,
      activeWorkerRuns: active.filter((run) => run.role === 'worker').length,
      ...this.read(),
    });
  }
}
