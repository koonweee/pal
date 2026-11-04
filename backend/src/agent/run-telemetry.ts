import { Logger } from '@nestjs/common';
import {
  SpanType,
  type AnyExportedSpan,
  type CorrelationContext,
  type LogEvent,
  type MetricEvent,
  type ScoreEvent,
  type FeedbackEvent,
  type TracingEvent,
  type ObservabilityDropEvent,
} from '@mastra/core/observability';
import type { Processor } from '@mastra/core/processors';
import type { RetentionConfig } from '@mastra/core/storage';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import type { PostgresStoreVNext } from '@mastra/pg';

export const telemetryRetention: RetentionConfig = {
  observability: {
    spans: { maxAge: '30d' },
    logs: { maxAge: '30d' },
    metrics: { maxAge: '30d' },
  },
};

const keptSpans = new Set([
  SpanType.AGENT_RUN,
  SpanType.MODEL_GENERATION,
  SpanType.TOOL_CALL,
  SpanType.MCP_TOOL_CALL,
  SpanType.PROVIDER_TOOL_CALL,
  SpanType.MEMORY_OPERATION,
  SpanType.GENERIC,
]);
const identityKeys = [
  'entityType',
  'entityId',
  'parentEntityType',
  'parentEntityId',
  'rootEntityType',
  'rootEntityId',
  'resourceId',
  'runId',
  'sessionId',
  'threadId',
  'serviceName',
];
const metadataKeys = [
  'runId',
  'threadId',
  'resourceId',
  'messageRef',
  'messageId',
  'scheduleId',
  'triggerId',
  'taskId',
  'workerId',
  'parentRunId',
  'toolCallId',
  'palParentTaskId',
  'palWorkerId',
  'palParentRunId',
  'executionId',
  'resource',
];
const countKeys = [
  'durationMs',
  'tokensObserved',
  'tokensToObserve',
  'tokensToReflect',
  'observationTokens',
  'tokensAttempted',
  'tokensBuffered',
  'bufferedTokens',
  'tokensToBuffer',
  'chunksActivated',
  'tokensActivated',
  'messagesActivated',
  'generationCount',
  'compressedTokens',
  'activeTaskRuns',
  'activeWorkerRuns',
  'idleForMs',
  'rssBytes',
  'heapUsedBytes',
  'heapTotalBytes',
  'heapLimitBytes',
  'externalBytes',
  'arrayBuffersBytes',
  'oldSpaceUsedBytes',
  'oldSpaceSizeBytes',
  'largeObjectSpaceUsedBytes',
  'largeObjectSpaceSizeBytes',
];
const memoryEvents = new Set([
  'data-om-observation-start',
  'data-om-observation-end',
  'data-om-observation-failed',
  'data-om-buffering-start',
  'data-om-buffering-end',
  'data-om-buffering-failed',
  'data-om-activation',
]);
const palEvents = new Set([
  'pal.input.accepted',
  'pal.publication',
  'pal.publication.failed',
  'pal.output.fallback',
  'pal.schedule.failed',
  'pal.interaction.queued',
  'pal.interaction.acquired',
  'pal.interaction.released',
  'pal.memory.sample',
]);

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function scalars(value: unknown, keys: readonly string[]) {
  const source = object(value);
  return Object.fromEntries(
    keys.flatMap((key) => {
      const item = source[key];
      return typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item))
        ? [[key, item]]
        : [];
    }),
  );
}

// Mastra UsageStats has a fixed numeric shape.
function usage(value: unknown): Record<string, unknown> {
  const source = object(value);
  const counts = (item: unknown, keys: string[]) =>
    Object.fromEntries(
      Object.entries(scalars(item, keys)).filter(
        ([, count]) => typeof count === 'number',
      ),
    );
  return {
    ...counts(source, ['inputTokens', 'outputTokens']),
    inputDetails: counts(source.inputDetails, [
      'text',
      'cacheRead',
      'cacheWrite',
      'cacheWrite5m',
      'cacheWrite1h',
      'audio',
      'image',
    ]),
    outputDetails: counts(source.outputDetails, [
      'text',
      'reasoning',
      'audio',
      'image',
    ]),
  };
}

function sanitizeSpan(span: AnyExportedSpan): AnyExportedSpan {
  const attributes = object(span.attributes);
  const output = object(span.output);
  const publicationRefs =
    span.entityId === 'sendToUser'
      ? (Array.isArray(output.messageRefs)
          ? output.messageRefs
          : [output.messageRef]
        )
          .filter(
            (value): value is number =>
              typeof value === 'number' && Number.isSafeInteger(value),
          )
          .slice(0, 100)
      : [];
  const publicationFailed =
    span.entityId === 'sendToUser' && typeof output.error === 'string';
  const status =
    typeof output.status === 'string' &&
    ['aborted', 'suspended', 'interrupted'].includes(output.status)
      ? output.status
      : undefined;
  const outcome =
    span.outcome ??
    status ??
    (span.errorInfo
      ? 'error'
      : span.endTime && span.output !== undefined
        ? 'complete'
        : undefined);
  return {
    id: span.id,
    traceId: span.traceId,
    type: span.type,
    // Native span names can include commands, paths, and other user content.
    name: span.type,
    startTime: span.startTime,
    endTime: span.endTime,
    isEvent: span.isEvent,
    isRootSpan: span.isRootSpan,
    parentSpanId: span.parentSpanId,
    ...scalars(span, [
      ...identityKeys,
      'model',
      'provider',
      'stopReason',
      'resumedFromSpanId',
    ]),
    ...(outcome ? { outcome } : {}),
    attributes: {
      ...scalars(attributes, [
        'model',
        'provider',
        'toolId',
        'toolName',
        'toolCallId',
        'finishReason',
        'success',
      ]),
      ...(publicationRefs.length ? { messageRefs: publicationRefs } : {}),
      ...(publicationFailed ? { publicationFailed: true } : {}),
      ...(span.entityId === 'execute_typescript' &&
      typeof output.success === 'boolean'
        ? { resultSuccess: output.success }
        : {}),
      ...(attributes.signal
        ? {
            signal: {
              ...scalars(attributes.signal, ['id', 'type', 'tagName']),
              attributes: scalars(object(attributes.signal).attributes, [
                ...metadataKeys,
                'executionStart',
                'source',
              ]),
            },
          }
        : {}),
      ...(attributes.usage ? { usage: usage(attributes.usage) } : {}),
      ...(attributes.internalUsage
        ? { internalUsage: usage(attributes.internalUsage) }
        : {}),
    },
    metadata: scalars(span.metadata, metadataKeys),
    // Explicit empty previews prevent storage from regenerating content previews.
    inputPreview: '',
    outputPreview: '',
    errorPreview: '',
    ...(span.errorInfo ? { errorInfo: { message: 'Execution failed' } } : {}),
  } as AnyExportedSpan;
}

/** One boundary for all persisted signals, including code-mode logs. */
class RunStorageExporter extends MastraStorageExporter {
  private readonly diagnostics = new Logger('RunTelemetry');
  private warned = false;
  private closed = false;

  constructor(private readonly releaseId?: string) {
    super({
      maxBatchSize: 100,
      maxBufferSize: 2_000,
      maxBatchWaitMs: 1_000,
      maxRetries: 1,
    });
  }

  private async safely(work: () => Promise<void>) {
    try {
      await work();
    } catch {
      this.unavailable();
    }
  }

  unavailable(reason?: string) {
    if (this.warned) return;
    this.warned = true;
    this.diagnostics.warn(
      'Run telemetry collection failed; evidence may be incomplete' +
        (reason ? ` (${reason})` : ''),
    );
  }

  override async _exportTracingEvent(event: TracingEvent) {
    if (this.closed) return;
    if (!keptSpans.has(event.exportedSpan.type)) return;
    const span = sanitizeSpan(event.exportedSpan);
    span.metadata = {
      ...span.metadata,
      ...(this.releaseId ? { releaseId: this.releaseId } : {}),
    };
    await this.safely(() =>
      super._exportTracingEvent({ ...event, exportedSpan: span }),
    );
  }

  override async onLogEvent(event: LogEvent) {
    if (this.closed) return;
    const { log } = event;
    if (
      !palEvents.has(log.message) &&
      !memoryEvents.has(log.message) &&
      log.message !== 'code-mode external call' &&
      log.message !== 'code-mode external result'
    )
      return;
    const data = scalars(log.data, [
      ...metadataKeys,
      ...countKeys,
      'tool',
      'action',
      'phase',
      'category',
      'operationType',
      'cycleId',
      'recordId',
      'retrying',
      'failurePolicy',
      'role',
    ]);
    await this.safely(() =>
      super.onLogEvent({
        type: 'log',
        log: {
          logId: log.logId,
          timestamp: log.timestamp,
          traceId: log.traceId,
          spanId: log.spanId,
          level: log.level,
          message: log.message,
          data,
          correlationContext: {
            ...scalars(log.correlationContext, identityKeys),
            ...scalars(data, ['runId', 'threadId', 'resourceId']),
          } as CorrelationContext,
          metadata: this.releaseId ? { releaseId: this.releaseId } : {},
        },
      }),
    );
  }

  // Native metrics duplicate span usage; no scores/feedback are collected.
  onDroppedEvent(event: ObservabilityDropEvent) {
    this.unavailable(
      event.reason + ':' + event.signal + ':' + (event.error?.id ?? 'no-error'),
    );
  }

  override async onMetricEvent(_event: MetricEvent) {}
  override async onScoreEvent(_event: ScoreEvent) {}
  override async onFeedbackEvent(_event: FeedbackEvent) {}
  override async flush() {
    await this.safely(() => super.flush());
  }
  override async shutdown() {
    if (this.closed) return;
    // Native spans may emit after bus teardown; the sink owns its closed state.
    this.closed = true;
    await this.safely(() => super.shutdown());
  }
}

export class RunTelemetry {
  private readonly exporter: RunStorageExporter;
  readonly observability: Observability;
  private timer?: ReturnType<typeof setInterval>;
  private pruning?: Promise<unknown>;
  private readonly abortPrune = new AbortController();

  constructor(releaseId?: string) {
    this.exporter = new RunStorageExporter(releaseId);
    this.observability = new Observability({
      configs: {
        pal: {
          serviceName: 'pal',
          exporters: [this.exporter],
          logging: { enabled: true, level: 'info' },
          requestContextKeys: [
            'palParentTaskId',
            'palWorkerId',
            'palParentRunId',
          ],
        },
      },
    });
  }

  record(message: string, data: Record<string, unknown>, failed = false) {
    // The native bus owns pending writes, buffering, and shutdown draining.
    const logger = this.observability
      .getDefaultInstance()
      ?.getLoggerContext?.();
    if (failed) logger?.warn(message, data);
    else logger?.info(message, data);
  }

  readonly memoryProcessor: Processor &
    Required<Pick<Processor, 'processOutputStream'>> = {
    id: 'pal-memory-telemetry',
    processDataParts: true,
    processOutputStream: async ({ part }) => {
      if (memoryEvents.has(part.type)) {
        const marker = object(part);
        this.record(
          part.type,
          {
            ...object(marker.data ?? object(marker.payload).data),
            runId: part.runId,
          },
          part.type.endsWith('failed'),
        );
      }
      return part;
    },
  };

  startRetention(storage: PostgresStoreVNext) {
    let partitionDay = new Date().toISOString().slice(0, 10);
    const prune = () => {
      if (this.pruning) return;
      this.pruning = (async () => {
        const today = new Date().toISOString().slice(0, 10);
        if (today !== partitionDay) {
          // Native PostgreSQL partitions are provisioned by init, not by writes.
          await (await storage.getStore('observability'))!.init();
          partitionDay = today;
        }
        return storage.prune({ maxBatches: 2, signal: this.abortPrune.signal });
      })()
        .catch(() => this.exporter.unavailable())
        .finally(() => {
          this.pruning = undefined;
        });
    };
    prune();
    this.timer = setInterval(prune, 60 * 60 * 1_000);
    this.timer.unref();
  }

  async stopRetention() {
    clearInterval(this.timer);
    this.abortPrune.abort();
    await this.pruning;
  }
}
