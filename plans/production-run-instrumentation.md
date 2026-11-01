# Production Run Instrumentation

## Status

Done

## Goal

Make production agent behavior queryable for evidence-based reviews of task friction, instruction following, run outcomes, and agent memory. Store selective telemetry in the existing PostgreSQL database and document how an auditing agent writes its own temporary scripts against Mastra storage APIs.

Scope: native telemetry, minimal application correlation, bounded retention, and a short query guide. Implementation and development acceptance precede separately requested production deployment and daily automation setup.

## Current Behavior

- `backend/src/agent/main-session.ts` uses `PostgresStoreVNext` in the `mastra` schema with selective native observability. Main uses Controller events; Task and Interaction use native Agent callbacks.
- `backend/src/agent/mastra-agent-runtime.ts` carries user message references into inputs, consumes direct Task streams, handles scheduled execution, and publishes responses. Input acceptance, publication, and scheduler failures have structured telemetry. Inputs can join an active run.
- `backend/src/agent/agent-activity.service.ts` owns an in-memory activity projection; it is not durable run history.
- Private Main, Task, and Interaction transcripts are stored by Mastra. Compact delegation results preserve worker thread/resource references. Public messages and current tasks are stored in Pal tables.
- `backend/src/agent/code-mode.processor.ts` uses native code mode. The installed implementation emits internal-call names, durations, and error-level logs through observability; upstream call logs contain arguments that Pal removes before persistence.
- Observational memory stores current observations and prior reflection generations. Native observation/buffering markers expose counts and lifecycle information. Active observations can change within one generation, so generation history does not reproduce every earlier model context.
- Production database access belongs to the service/operations environment. The execution container has neither backend credentials nor database network access; see `architecture/deployment.md`.

## Target Data Shape

Use Mastra's storage-backed observability in the existing `mastra` schema. Reuse existing transcript and memory records. Prefer supported native metadata and structured log events for Pal correlation; add an application table only if a demonstrated query requirement cannot be represented there.

Persist the smallest supported set:

| Evidence | Fields |
| --- | --- |
| Run | Native run/trace identity, role, task/thread/resource identity, parent linkage, start/end, finish reason, model, available usage, release ID |
| Input association | Run identity, public message reference or schedule trigger identity, accepted time; multiple associations per run |
| Tool or delegation | Native call/parent identity where available, tool name, start/duration, execution outcome, sanitized failure indicator, worker thread/resource linkage |
| Publication | Run/call identity, persisted public message reference, publication or structured-output failure category |
| Memory | Thread/resource, record/generation/cycle identity where available, operation, counts, timing, and failure status from native evidence |

- Reuse `PAL_RELEASE_ID` and native request context for trusted attribution. State which fields each role/path actually supports.
- Preserve cancellations, suspensions, failures, and runs without terminal evidence distinctly. A finished model run does not prove task success. A process stop without a terminal event remains incomplete evidence.
- Prefer native usage totals; avoid summing cumulative Main updates or double-counting child runs. Missing usage is unknown.
- Separate tool execution errors from application-level unsuccessful results. Recognize only existing explicit result contracts; semantic failure remains a review judgment.
- Keep arbitrary arguments, tool results, prompts, message text, credentials, screenshots, and raw exception payloads out of new telemetry. Read detailed evidence from existing protected histories when needed.
- Retain new telemetry for 30 days. Existing public/private conversation and memory retention remain unchanged. No historical backfill.

## Milestones

### 1. Validate native collection and query coverage

Implementation tasks:

- [x] Exercise the installed Mastra observability exporter and PostgreSQL adapter against isolated development data. Declare a direct pinned observability dependency if the application imports it.
- [x] Verify coverage for Main, direct/scheduled Task runs, Interaction delegation, code-mode internal calls, and memory events. Check whether agent registration/context propagation needs adjustment.
- [x] Identify the supported metadata, filtering, query, and retention APIs. Verify how payload filtering applies to logs as well as spans.
- [x] Establish a read-only query connection with `PostgresStore({ disableInit: true, ... })`; prove reads work without initialization or schema writes. Use restricted database permissions in validation.
- [x] Record concrete coverage gaps and the minimal host hooks required in this plan. Keep unsupported fields explicit rather than inventing precise attribution.

Exit criteria:

- Persisted synthetic evidence can be read through Mastra storage APIs after reopening the connection.
- The collection path for every required evidence category is known, including code-mode calls and Task memory events.
- Secret-bearing sentinel payloads can be excluded before telemetry persistence. No dependency patches or alternate execution engine are required.

### 2. Instrument production code paths

Implementation tasks:

- [x] Configure a selective storage-backed exporter with bounded buffering and explicit shutdown flushing. Telemetry failure must not fail agent work; expose collection failures through sanitized operational diagnostics.
- [x] Apply a metadata allowlist to every exported signal type, including nested fields, errors, and native code-mode logs. Exclude verbose token/chunk events and duplicated content.
- [x] Add minimal host correlation at input acceptance, run lifecycle, delegation, and publication boundaries. Cover messages delivered into active runs and scheduled wakeups. Keep run accounting owned in one place; avoid duplicate terminal records from callbacks and stream consumers.
- [x] Persist explicit structured-output fallback and publication-failure signals from existing handling. Preserve current user-visible behavior and tool contracts.
- [x] Reuse native memory evidence/history; add metadata-only lifecycle hooks only for verified gaps. Do not snapshot full prompts or memory on every model step.
- [x] Configure a fixed 30-day telemetry retention policy with bounded periodic pruning and shutdown cleanup using supported storage primitives. Confirm pruning covers stored logs/metrics as applicable and never targets conversations, memories, tasks, or preferences.
- [x] Document any introduced environment configuration in `.env.example`. Keep deterministic defaults in host code.

Exit criteria:

- All required execution paths produce queryable evidence with input/output and worker linkage where supported.
- Direct and code-mode tool friction is inspectable, and gaps in timing or correlation are disclosed.
- Export failure, cancellation, and shutdown preserve application behavior. Retention is operational and scoped to telemetry.
- No new model-facing tools, parameters, prompts, audit CLI, or inspection endpoint are introduced.

### 3. Publish agent query guidance and validate an audit

Implementation tasks:

- [x] After instrumentation works, write `architecture/agent-run-queries.md`, targeting one short page plus a minimal executable connection/query example.
- [x] Explain data locations, role/thread/run relationships, available filters, pagination/time bounds, token usage semantics, memory-generation limitations, retention, and collection gaps.
- [x] List verified APIs for trace/log queries and transcript/memory reads, including `listTraces`, `getTrace`, `listLogs`, `listMessages`, `getObservationalMemory`, and `getObservationalMemoryHistory` where supported by the installed adapter. Give exact tested argument shapes for the small example; refer to installed types for further queries.
- [x] Direct auditing agents to write their own temporary scripts using these APIs, run bounded read-only queries, close connections, and remove scratch artifacts. Use existing read access for Pal-owned messages/tasks when native references need resolution; Mastra APIs do not own these tables.
- [x] Document execution from an authorized operations/service environment with read-only credentials, `disableInit: true`, no calls to `init()`/prune/write methods, and no credential values in examples or command output. Describe production access prerequisites without widening execution-container access.
- [x] Link the guide from `architecture/backend.md` and the repository's agent-facing documentation entry point. It is on-demand guidance for repository/operations agents; do not load it into Pal Main/Task runtime prompts.
- [x] Use a disposable agent-authored script to review a bounded synthetic run set: compare user constraints, delegation, actual evidence, public outcome, and memory. Cite run/message references, distinguish observed facts from judgment, and disclose missing evidence.
- [x] Update architecture documentation, milestone status, and the plan index after acceptance. Remove temporary scripts and isolated validation data.

Exit criteria:

- An agent following only the query guide can locate a run, follow its worker evidence and public outcome, and inspect relevant memory through its own script.
- The example succeeds with read-only access, and unsupported or expired evidence is reported accurately.
- No reusable audit program, report generator, dashboard, or scheduled automation is shipped.

## Tests

Extend existing PostgreSQL-backed agent integration fixtures rather than building a separate evaluation harness:

- One focused lifecycle/correlation fixture covering Main, direct and scheduled Task, concurrent worker linkage, active-run input, public publication, and an abort/failure. Assert durable evidence after reconnect and no duplicate usage/outcome accounting.
- One focused telemetry boundary fixture covering direct and code-mode calls, a structured-output/publication failure, secret sentinels in span/log/error payloads, and exporter failure isolation.
- One storage fixture covering read-only API queries and 30-day pruning with old/new telemetry plus protected conversation/memory rows.
- Reuse memory fixtures to verify available lifecycle counts and reflection history; no new real-model benchmark is required.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/run-telemetry.spec.ts test/main-session.spec.ts test/task-agents.spec.ts test/task-workers.spec.ts
```

Run against the existing development test database with isolated schemas. The telemetry fixture executes the guide's example and removes its temporary SELECT-only role and schema. Use `./scripts/dev-local rebuild` for integrated development acceptance when needed. Production deployment and access verification require a separately requested rollout.

## Overall Exit Criteria

- Selective telemetry is durable in the existing PostgreSQL store and queryable through verified Mastra APIs.
- Agent-written scripts can review run outcomes, tool friction, instruction-following evidence, and agent memory with explicit correlation/coverage limits.
- New telemetry excludes sensitive payloads, expires after 30 days, and cannot break user work when collection fails.
- The short query guide reflects implemented behavior and is discoverable without adding runtime agent instructions.
- Relevant checks pass; changes are reviewed and committed locally with unrelated work preserved.

## Deferred Work

- Daily automation setup, production deployment, and live production audit acceptance.
- Reusable audit tooling, report storage, dashboards, automated semantic scoring, and automatic repairs.
- Full task-state revision history, exact per-step context snapshots, and historical telemetry reconstruction.
- System RAM/container monitoring. This slice covers agent context and observational memory; backend RSS/heap and whole-stack resource history can be added if operational evidence warrants them.

## Implementation and Validation

- Native event-sourced PostgreSQL storage provides trace/log reads. Pal's exporter allowlists metadata, numeric usage, publication references, and lifecycle facts; private content remains in existing histories. No application table or audit tooling is needed.
- Code-mode internal calls have names, durations, and severity but no unique subcall IDs. Memory events expose cycle/record counts; exact historical model contexts remain unavailable.
- UTC day partitions are refreshed daily and pruned hourly, at two expired partitions per signal table per tick. Effective retention is 30–31 days plus any pruning backlog.
- Mastra closes storage before exporter shutdown. Pal drains telemetry first and ignores late emissions after exporter closure; native Main restart/cancellation coverage asserts there are no storage-write failures.
- Build, type-aware lint/boundaries, and the four focused suites pass (10 tests). Acceptance covers native Main/Task/scheduled/Interaction execution, active-run input, publication references, memory history/events, private payload filtering, export failure recovery, SELECT-only access, and scoped retention. The documented standalone query example executes successfully.
- The rebuilt development service is healthy. An isolated synthetic Main run in the running image retains its completed trace and 10 input / 5 output tokens after shutdown, readable with initialization disabled and read-only transactions. The fixture schema is removed. Production deployment and unattended production access are deferred.
- Routing ownership was coordinated with thread `01a19591-9eb1-73b0-ae03-f5861da725dd`; additive hooks preserve commit `bc2a0f6` and its `explicitDestinationIds` contract.
- Temporary fixture schemas and query roles are removed. No task containers or superseded images remain; the current development service image is approximately 2.17 GB and existing shared build cache is retained.
