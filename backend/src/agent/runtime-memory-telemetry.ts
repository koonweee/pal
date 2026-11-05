import { Session } from 'node:inspector';
import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8';

const FIVE_MINUTES_MS = 300_000;
const FORCED_GC_HEAP_THRESHOLD_BYTES = 512 * 1024 * 1024;

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

function collectGarbage(): Promise<void> {
  return new Promise((resolve, reject) => {
    const session = new Session();
    let connected = false;
    const finish = (error?: Error | null) => {
      // Disconnect after inspector dispatch unwinds to avoid blocking Node.
      setImmediate(() => {
        if (connected) session.disconnect();
        if (error) reject(error);
        else resolve();
      });
    };

    try {
      session.connect();
      connected = true;
      session.post('HeapProfiler.enable', (enableError) => {
        if (enableError) {
          finish(enableError);
          return;
        }
        session.post('HeapProfiler.collectGarbage', finish);
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export class RuntimeMemoryTelemetry {
  private readonly active = new Map<string, RuntimeMemoryContext>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly idleTimers = new Map<
    number,
    ReturnType<typeof setTimeout>
  >();
  private readonly idleSampleDelaysMs = [120_000, 300_000] as const;
  private forcedGcAttempted = false;
  private closed = false;

  constructor(
    private readonly record: (data: Record<string, unknown>) => void,
    private readonly settleDelayMs = 30_000,
    private readonly read = readMemoryCounters,
    private readonly forceGarbageCollection = collectGarbage,
  ) {}

  start(context: RuntimeMemoryContext) {
    if (this.active.has(context.key)) return;
    this.cancelIdleSamples();
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
    if (this.active.size === 0) this.scheduleIdleSamples();
  }

  close() {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.cancelIdleSamples();
    this.active.clear();
  }

  private scheduleIdleSamples() {
    this.cancelIdleSamples();
    for (const delayMs of this.idleSampleDelaysMs) {
      const timer = setTimeout(() => {
        this.idleTimers.delete(delayMs);
        const counters = this.read();
        this.record({
          phase: 'idle',
          idleForMs: delayMs,
          activeTaskRuns: 0,
          activeWorkerRuns: 0,
          ...counters,
        });
        if (
          delayMs === FIVE_MINUTES_MS &&
          !this.forcedGcAttempted &&
          counters.heapUsedBytes >= FORCED_GC_HEAP_THRESHOLD_BYTES
        ) {
          this.forcedGcAttempted = true;
          void this.forceGarbageCollection().then(
            () => this.recordForcedGcSample('idle_gc'),
            () => this.recordForcedGcSample('idle_gc_failed'),
          );
        }
      }, delayMs);
      timer.unref?.();
      this.idleTimers.set(delayMs, timer);
    }
  }

  private cancelIdleSamples() {
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
  }

  private recordForcedGcSample(phase: 'idle_gc' | 'idle_gc_failed') {
    if (this.closed) return;
    const active = [...this.active.values()];
    this.record({
      phase,
      idleForMs: FIVE_MINUTES_MS,
      activeTaskRuns: active.filter((run) => run.role === 'task').length,
      activeWorkerRuns: active.filter((run) => run.role === 'worker').length,
      ...this.read(),
    });
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
