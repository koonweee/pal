import type { ExecutionService } from './execution.service.js';

const TWO_MINUTES_MS = 120_000;

const sampleScript = String.raw`
import { readFileSync, readdirSync } from 'node:fs';

const read = (name) => readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim();
const count = (value) => value === 'max' ? undefined : Number(value);
const events = Object.fromEntries(
  read('memory.events').split('\n').map((line) => {
    const [name, value] = line.split(' ');
    return [name, Number(value)];
  }),
);
let processCount = 0;
let threadCount = 0;
let chromiumProcessCount = 0;
let chromiumRendererCount = 0;
for (const entry of readdirSync('/proc')) {
  if (!/^\d+$/.test(entry)) continue;
  try {
    const comm = readFileSync('/proc/' + entry + '/comm', 'utf8').trim();
    const status = readFileSync('/proc/' + entry + '/status', 'utf8');
    processCount++;
    threadCount += Number(/^Threads:\s+(\d+)/m.exec(status)?.[1] ?? 0);
    if (comm === 'chromium') {
      chromiumProcessCount++;
      const command = readFileSync('/proc/' + entry + '/cmdline', 'utf8');
      // Chromium rewrites its argv block, so arguments may be space-separated
      // inside /proc/<pid>/cmdline instead of retaining their NUL boundaries.
      if (command.includes('--type=renderer')) {
        chromiumRendererCount++;
      }
    }
  } catch {}
}
let browserAvailable = false;
let targets = [];
try {
  const response = await fetch('http://127.0.0.1:9222/json/list', {
    signal: AbortSignal.timeout(2000),
  });
  if (response.ok) {
    targets = await response.json();
    browserAvailable = Array.isArray(targets);
  }
} catch {}
const targetCount = (type) => targets.filter((target) => target?.type === type).length;
console.log(JSON.stringify({
  available: true,
  browserAvailable,
  memoryCurrentBytes: count(read('memory.current')),
  memorySwapBytes: count(read('memory.swap.current')),
  memoryMaxBytes: count(read('memory.max')),
  memorySwapMaxBytes: count(read('memory.swap.max')),
  memoryEventsMax: events.max ?? 0,
  memoryEventsOom: events.oom ?? 0,
  memoryEventsOomKill: events.oom_kill ?? 0,
  processCount,
  threadCount,
  chromiumProcessCount,
  chromiumRendererCount,
  browserTargetCount: targets.length,
  pageTargetCount: targetCount('page'),
  iframeTargetCount: targetCount('iframe'),
  workerTargetCount: targetCount('worker'),
}));
`;

export class ExecutionResourceTelemetry {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private closed = false;

  constructor(
    private readonly execution: ExecutionService,
    private readonly record: (
      data: Record<string, unknown>,
      failed?: boolean,
    ) => void,
    private readonly intervalMs = TWO_MINUTES_MS,
  ) {}

  start() {
    if (this.timer || this.closed) return;
    void this.sample();
    this.timer = setInterval(() => void this.sample(), this.intervalMs);
    this.timer.unref?.();
  }

  async sample() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      const output = await this.execution.output(
        'node',
        ['--input-type=module', '-e', sampleScript],
        { timeout: 5_000, maxBytes: 8_192 },
      );
      const data = JSON.parse(output.toString()) as Record<string, unknown>;
      if (!this.closed) this.record(data);
    } catch {
      if (!this.closed) this.record({ available: false }, true);
    } finally {
      this.running = false;
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
