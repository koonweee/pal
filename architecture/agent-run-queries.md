# Querying Agent Runs

Auditing agents write temporary scripts against the installed Mastra storage APIs. Run them from an authorized operations environment or the agent-service working directory, using read-only database access. The execution desktop has no database credentials or route. No audit CLI is provided.

## Evidence

All records live in Pal's existing PostgreSQL database:

| Records | Access |
| --- | --- |
| Runs, model usage, tools | `observability.listTraces`, `getTrace`; filter root runs by time, `runId`, `threadId`, or `entityId`; nested workers are in the parent trace |
| Code-mode calls and Pal events | `observability.listLogs`; filter by time, run/thread/trace, or severity |
| Private conversations and worker evidence | `memory.listMessages` with the exact thread ID |
| Current observations and reflection generations | `memory.getObservationalMemory(threadId, resourceId)`, `getObservationalMemoryHistory(threadId, resourceId, limit)` |
| Public messages and current tasks | Parameterized SELECTs against `public.messages` / `public.tasks` through `storage.readDb` |

Mastra owns records in the `mastra` schema: `mastra_messages`, `mastra_observational_memory`, and the partitioned `mastra_span_events` / `mastra_log_events`. Use the APIs for Mastra records rather than interpreting event-table rows as completed spans.

Main uses thread `pal-main`, resource `pal-owner`, and agent `pal-main-agent`. Tasks use `pal-task:<task-id>` and agent `pal-task-agent`. Interaction uses `pal-task-worker`; its actual private thread/resource IDs remain in the parent's `agent-worker` result. Worker trace metadata includes `palParentTaskId`, `palParentRunId`, and `palWorkerId`. Tool spans identify the tool through `entityId`; span names are normalized.

`pal.input.accepted` logs associate public message references or schedule/trigger IDs with a native run. Several inputs can join one run. `pal.publication` links Task output to a public message reference. Main's `sendToUser` tool spans retain numeric `attributes.messageRefs` and flag partial publication failure. Native parent spans and input-event `parentRunId` connect handoffs. `releaseId` metadata identifies the deployment when configured.

## Minimal Script

Create a temporary `.mjs` file where the backend dependencies resolve. This example reads one bounded page; follow `pagination.hasMore` with increasing pages for a complete window. Run with `node <script.mjs>` or feed it to `node --input-type=module` inside agent-service. Supply the connection through the environment; never print credentials.

```js
import { Pool } from 'pg';
import { PostgresStoreVNext } from '@mastra/pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c default_transaction_read_only=on -c statement_timeout=15000',
});
const storage = new PostgresStoreVNext({
  id: 'temporary-run-review', schemaName: 'mastra', pool,
  observability: { schemaName: 'mastra', pool },
  disableInit: true,
});
try {
  const observability = await storage.getStore('observability');
  const memory = await storage.getStore('memory');
  const since = new Date(Date.now() - 86_400_000);
  const runs = await observability.listTraces({
    filters: { spanType: 'agent_run', startedAt: { start: since } },
    pagination: { page: 0, perPage: 50 },
    orderBy: { field: 'startedAt', direction: 'DESC' },
  });
  console.log(runs.spans.map(({ traceId, runId, threadId, entityId, outcome }) =>
    ({ traceId, runId, threadId, entityId, outcome })));
  const run = runs.spans[0];
  if (run) {
    const trace = await observability.getTrace({ traceId: run.traceId });
    const logs = await observability.listLogs({
      filters: { runId: run.runId, timestamp: { start: since } },
      pagination: { page: 0, perPage: 100 },
    });
    console.log({ spanCount: trace.spans.length, logCount: logs.logs.length });
    // Fetch protected content only when it is relevant to the finding.
    if (run.threadId) {
      const history = await memory.listMessages({
        threadId: run.threadId, page: 0, perPage: 50,
      });
      console.log({ messageCount: history.messages.length });
    }
  }
} finally {
  await storage.close();
  await pool.end(); // Caller-provided pools are owned by this script.
}
```

Keep `disableInit: true`; inspection scripts call no initialization, pruning, or write APIs. Use installed `.d.ts` definitions for additional filters and pagination. Close connections and delete scripts and scratch exports after review. Production access must be configured before unattended use.

## Interpretation

- `pal.interaction.queued`, `acquired` and `released` record device admission. Acquired duration is queue wait; released duration is turn ownership time. Dispatched operations may finish after release. Task/worker/execution and parent-run IDs correlate turns; a reused private-entry worker identity can have multiple execution IDs. Missing transitions are unknown, not proof of ownership or cleanup.

- Telemetry retains approximately 30–31 days because PostgreSQL expiry drops whole UTC day partitions. Pruning runs hourly with at most two partitions per signal table per tick; backlogs can take additional ticks. Existing conversations and memory follow their own retention. Collection starts with this release; missing historical telemetry is expected.
- Native run outcomes describe execution, not fulfillment of the user's request. Missing terminal evidence is unknown. Confirm claims and instruction following against user messages, delegation assignments, tool evidence, and delivered responses; cite exact run/message references.
- Use model-generation `attributes.usage` for usage accounting. Do not add agent totals and model totals, or count child runs twice. `internalUsage` represents hidden internal model work on its exported ancestor; keep it separate. Missing usage is unknown; no authoritative monetary cost is computed.
- Code-mode logs retain tool names, durations, and severity. Concurrent calls of the same tool lack individual native subcall IDs. Error severity records execution failure; a returned business failure still needs result/transcript review. `execute_typescript` spans retain an explicit `resultSuccess` when available.
- Memory lifecycle logs retain counts, cycle/record identity, timings, and failure status where emitted through the live stream. Native persisted markers and reflection history provide additional evidence. Current observations change within a generation; historical context cannot be reconstructed exactly for every model step. RAM/container history is outside this instrumentation.
- Runtime memory `idle_gc` is the one-shot post-collection sample paired with the preceding five-minute `idle` sample when heap used reached 512 MiB. `idle_gc_failed` means the collection attempt failed; both remain process-global and carry no run identity.
- `pal.output.fallback` and `pal.publication.failed` identify Task output handling problems; `pal.schedule.failed` records schedule dispatch failures. Telemetry excludes message bodies, arbitrary arguments/results, screenshots, and raw errors. Details remain in protected native conversations. Logs may lag by a second; collection failures emit a sanitized `RunTelemetry` warning and can leave gaps.
