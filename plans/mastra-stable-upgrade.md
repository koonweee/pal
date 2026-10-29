# Mastra stable upgrade and primitive audit

## Status

Done. Implemented in `8d9e08e`, accepted in development and deployed to production from `a841fc0` on October 29, 2026. Baseline: `2931465`, after the monitoring recovery rollout.

## Goal

Upgrade the supported Mastra stack together, preserve Pal's conversations and monitoring behavior, and remove Pal code and instructions whose responsibilities are covered by supported Mastra primitives. Every retained adapter must have a concrete remaining requirement; every deletion must have behavioral evidence.

## Current Behavior

- [Main session](../backend/src/agent/main-session.ts) owns one native controller session, shared thread-scoped memory, native Task/interaction agents, and workspace configuration. Pal wraps run options and scheduler startup.
- [Runtime](../backend/src/agent/mastra-agent-runtime.ts) connects native signals and streams to canonical chat, task metadata, provenance, activity, and delivery. [Task schedules](../backend/src/tasks/task-schedules.service.ts) use `mastra.schedules` with application ownership checks.
- [MCP discovery](../backend/src/agent/task-tool-discovery.processor.ts) composes `ToolSearchProcessor` and `createCodeMode`. Local adapters coordinate OAuth refresh and suppress unsupported MCP Apps advertisement.
- [ExecutionFilesystem](../backend/src/execution/execution-filesystem.ts) invokes a contained `LocalFilesystem` in the execution container. [ComposeSandbox](../backend/src/execution/compose-sandbox.ts) attaches Mastra command execution to the persistent Compose desktop.
- [Monitoring recovery](monitoring-memory-reliability.md) is accepted in production at `2ba506c`: all three watches finished fresh checks, schedules and delivered-notification history were preserved, and duplicate alerts were absent. Mobile required an additional source-reference correction. These outcomes are regression requirements.

### Version baseline

npm stable metadata verified October 29, 2026; all listed Mastra targets were published October 28. Rechecked during implementation; targets are unchanged and pinned exactly.

| Package | Previous | Pinned |
| --- | --- | --- |
| `@mastra/core` | 1.76.0 | 1.80.0 |
| `@mastra/memory` | 1.37.0 | 1.39.1 |
| `@mastra/pg` | 1.29.0 | 1.33.0 |
| `@mastra/mcp` | 2.1.2 | 2.6.0 |
| `@mastra/code-sdk` | 1.10.1 | 1.16.0 |
| `@mastra/docker` | 0.10.0 | 0.12.1 |
| `@modelcontextprotocol/client` | 2.0.0 | 2.4.0, matching Mastra MCP |

Memory, PostgreSQL and Code SDK targets require core >=1.80. MCP requires core >=1.79 and Zod >=4.2. Verify the resolved dependency tree, including the existing nested core/memory copies under Code SDK. Declare directly imported test dependencies explicitly if the new tree stops exposing them; the compaction fixture currently imports `@mastra/libsql` transitively. Preserve the existing AI SDK model contract unless compatibility requires a change.

The primary benefits are [preserved unread input during compaction](https://github.com/mastra-ai/mastra/pull/27502), [empty-observer recovery](https://github.com/mastra-ai/mastra/pull/27294), [refusal recovery](https://github.com/mastra-ai/mastra/pull/28456), and [PostgreSQL observation/reflection concurrency fixes](https://github.com/mastra-ai/mastra/pull/25906). MCP fixes preserve [embedded resource content](https://github.com/mastra-ai/mastra/pull/27131) and normalize [malformed input schemas](https://github.com/mastra-ai/mastra/pull/25995). Native [signal text](https://github.com/mastra-ai/mastra/pull/27150) also preserves commands containing XML-sensitive characters.

## Primitive and guidance audit

Final dispositions use stable source at `6a191d4`, installed packages and the probes recorded below.

| Pal surface | Native primitive / evidence | Implemented disposition and evidence |
| --- | --- | --- |
| `main-session.ts`: session lifecycle | [Controller session identity](https://github.com/mastra-ai/mastra/pull/27336) | Migrated to `deleteSession({ sessionId: 'pal-main-session' })`; resource/thread identities unchanged. Integration shutdown/restart retains history. |
| `main-session.ts`: machinery wrapper | [Controller source](https://github.com/mastra-ai/mastra/blob/6a191d4/packages/core/src/agent-controller/agent-controller.ts) still sets `CONTROLLER_MAX_STEPS = 1000` | Retained unlimited-step/header override: no public maximum-step configuration replaces the constant. Forwarded optional request context. Main, steering, error and restart integration checks pass. |
| `task-scheduler.worker.ts` | Native `SchedulerWorker` and [worker startup](https://github.com/mastra-ai/mastra/blob/6a191d4/packages/core/src/mastra/index.ts) | Retained. Removing the adapter made the overdue restart regression time out; restoring it passes. Native startup still polls before the agent consumer subscribes. |
| `TaskSchedulesService.bind()` legacy normalization | Native schedule updates already persist normalized wake attributes | Removed the repeated conversion and obsolete legacy-row fixture. Read-only checks found 8 production schedules, zero obsolete delivery attributes and zero missing executionStart flags; development had zero schedules. Native create/update owns persistence; ownership and wake initialization remain. |
| `single-flight-oauth-provider.ts` | MCP client 2.4.0; [upstream refresh PR](https://github.com/modelcontextprotocol/typescript-sdk/pull/2757) is still open | Retained: installed client does not supply provider-wide refresh coordination and PR remains open. Rotating-token integration passes; stale configuration writes remain guarded. |
| `tools-only-fetch.ts` | [MCP client](https://github.com/mastra-ai/mastra/blob/6a191d4/packages/mcp/src/client/client.ts) still unconditionally inserts the UI extension | Retained: installed MCP source adds Apps advertisement unconditionally. Capabilities configuration is insufficient. Apps-suppression integration passes. |
| `ExecutionFilesystem` and `backend/execution/filesystem.mjs` | Published `@mastra/code-sdk/agents/sandbox-filesystem` exposes [SandboxFilesystem](https://github.com/mastra-ai/mastra/blob/6a191d4/mastracode/sdk/src/agents/sandbox-filesystem.ts) | Retained after parity probe: native SandboxFilesystem ignores expectedMtime, overwrites stale files, fails a 2 MB write with E2BIG, and remaps absolute paths outside its root. Current contained LocalFilesystem bridge preserves checks and stdin transport. Replacement would require more custom code. |
| `ComposeSandbox` | Native Docker process manager and optional sandbox filesystem | Retained Compose ownership, replacement discovery and detach-only shutdown. Installed spawn uses only options.cwd; the default-cwd adapter remains. Native writeFiles reads its current container without ensureRunning, so lazy/replacement attachment remains. Packaged smoke verifies transport, cancellation and reconnection. |
| `CodeModeProcessor`, `TaskToolDiscoveryProcessor` | Native `createCodeMode` and `ToolSearchProcessor` already own execution/discovery | Removed duplicate discovery instruction and batching/data-shaping prose supplied by native tools. Retained the small per-step composition adapter: it refreshes MCP tools and creates the code allowlist after discovery, excluding media/worker/skill tools. Reused/scheduled discovery and allowlist integration passes. |
| `chatgpt-model.ts`, `citations.ts` | Native OAuth fetch is already used; [Codex middleware](https://github.com/mastra-ai/mastra/blob/6a191d4/mastracode/sdk/src/providers/openai-codex.ts) sets generic coding instructions | Retained: native Codex middleware still replaces caller instructions with generic coding guidance. Pal must preserve observer/reflector policy and citation output. Native OAuth fetch remains the transport owner. |
| `mastra-agent-runtime.ts`, activity callbacks | Native signals, accepted delivery, run-status subscriptions and provider-error classification | Retained application projection and lifecycle callbacks. Main controller events and direct/scheduled Task hooks cover distinct routes; native run status does not own canonical chat, delivery, origin or public failures. Failure/cancellation and steering integration passes. No queueSignal semantic change. |
| `task-workers.ts`, browser/secure-entry integration | Native subagent execution, hooks and cancellation | Retained trusted identities, three-worker cap, continuation and browser cleanup around native execution. Worker integration passes private results, failure/abort cleanup and reused worker identity. Fixed fixture ordering assumptions; the cap makes no admission-order promise. |
| `memory-options.ts`, `context-authority.md`, `memory.md` | Native observation/reflection fixes now protect message retention | Retained thresholds, raw retention, isolation, suggested-response disablement and settled shutdown. Shared authority policy loads once for Main/Task and once for each observer/reflector. Native retention fixes do not supply attribution, uncertainty or closed-work policy. |
| `task.md`, `execution.md`, role prompts and processor instructions | Native tool schemas, generated code-mode instructions and skills | Trimmed only duplicated native discovery/code-mode mechanics. Reviewed composed Main, Task, worker and memory guidance; retained product communication, source failures, monitoring checkpoints and private secure-entry rules. Role-specific ownership remains separate; context-authority remains shared. |
| `task.md`: one-off scheduling instructions | [Stable schedules API](https://github.com/mastra-ai/mastra/blob/6a191d4/packages/core/src/schedules/schedules.ts) remains cron-based | Retained year guards and deletion after firing. Installed supported API remains cron-based; it has no absolute one-shot equivalent. |

New MCP Events, Connect, Factory, durable-engine migrations and observability dashboards are deferred. They introduce new workflows beyond this upgrade. Record any useful follow-up separately.

## Target Data Shape

Keep Pal public API, public tables, task IDs, message references, delivery records, schedule IDs/cron/timezones and workspace paths unchanged. Main's runtime session key is explicitly `pal-main-session`; its persisted resource/thread identity stays unchanged.

`PostgresStore.init()` owns Mastra schema upgrades. The 1.29-to-1.33 rehearsal and exact schema changes are recorded below. Existing messages, observations, schedules and pending notifications survive initialization twice. Rollback requires a pre-upgrade database backup; conversations and schedules are never reset or regenerated.

## Milestones

### 1. Establish compatibility and native replacement evidence

Implementation tasks:

- [x] Pin the verified stable package set in an isolated checkout; inspect peer resolution and published exports.
- [x] Rehearse Mastra storage initialization and record rollback requirements.
- [x] Run narrow probes for filesystem parity, scheduler boot ordering, controller lifecycle and OAuth refresh coordination. Finish the audit with a remove/simplify/retain decision for each row.
- [x] Capture composed Main, Task, worker, observer and reflector guidance; mark duplicated mechanics and required application policy.

Exit criteria:

- Exact dependency graph and schema changes are known; each proposed deletion has a supported replacement and observable acceptance check. Unsupported candidates have a specific retained-gap explanation.

### 2. Upgrade and remove verified duplication

Implementation tasks:

- [x] Upgrade dependencies together and migrate session deletion/context forwarding.
- [x] Implement proven native substitutions, removing superseded modules, packaging, dependencies and tests in the same change.
- [x] Remove completed schedule normalization after its migration/data gate passes.
- [x] Trim overlapping guidance while maintaining one shared owner per policy and role-specific tool boundaries. Keep the recent recovery policies until equivalence is demonstrated.
- [x] Update current architecture/contracts and workaround comments; leave deferred work in this plan.

Exit criteria:

- Build/lint and focused integration checks pass; native primitives own the replaced behavior; remaining custom code is limited to demonstrated gaps or Pal product requirements. No increase in model-facing tools or choices without a current requirement.

### 3. Validate development behavior and prepare release

Implementation tasks:

- [x] Rebuild the existing development backend; rebuild execution only if its packaged dependencies/scripts changed. Preserve shared volumes and desktop ownership.
- [x] Run the essential checks below and the real-model monitoring/compaction fixtures. Record deterministic guarantees separately from observed model behavior.
- [x] Verify existing-thread continuation, unchanged schedule definitions, files, MCP discovery, interaction-worker continuation and shutdown/restart.
- [x] Prepare a concrete rollout/rollback procedure from schema evidence. Production deployment requires a subsequent user request.
- [x] Clean task-created fixtures and disposable resources. After builds inspect Docker usage; keep protected stack images/volumes and report any retained rollback artifact.

Exit criteria:

- Development acceptance passes with no lost context, duplicate alerts or stale catalog behavior. Release steps specify draining active work, backing up affected state, deploying compatible backend/execution artifacts, checking health and removing temporary backups after acceptance.

## Tests

Reuse the smallest existing coverage set; extend assertions only for an actual changed boundary.

1. `task-agents.spec.ts` and `agent-activity-runtime.spec.ts`: Main/Task acceptance, active steering, scheduled wake, private/public output, provenance, failure/cancellation and restart history. Add session-ID shutdown and literal `<`, `>` / `&` signal coverage where needed.
2. `mcp.spec.ts`: rotating refresh, Apps suppression, fresh discovery on reused/scheduled runs and code-mode allowlist. Add malformed schema/embedded resource fixtures only to verify Pal's end-to-end adapter behavior.
3. `task-workers.spec.ts` and `runtime:smoke`: worker cap, private results, error/abort cleanup, code-mode transport, persistent desktop and replacement-container attachment. Include filesystem parity only if that bridge changes.
4. PostgreSQL memory/storage rehearsal: preserve overlapping buffered observation/reflection state and existing schedule ownership across migration/restart. Keep one targeted regression for any uncovered failure; avoid copying upstream's whole memory test suite.
5. `monitoring-memory-smoke.mjs` and `task-schedule-smoke.mjs`: fresh checks after observation/reflection, attributed findings, rejected unsupported claims, quiet unchanged checks, stop behavior and no historical-count/source-ID repair loops. Extend the existing fixture with empty/refusal observer and unread-result cases only where native behavior can be asserted deterministically.

Existing real-model smoke uses temporary SQLite; it does not replace the PostgreSQL migration/concurrency check. Use isolated synthetic task data and valid local authentication, never live monitoring mutations for routine tests. Model outcomes are observed acceptance evidence, not universal guarantees.

## Validation Commands

Run from the repository root unless shown otherwise. Commands are for implementation; planning validation only checks this document, links and diff.

```bash
cd backend
npm run build
npm run lint
npm ls @mastra/core @mastra/memory @mastra/mcp @mastra/pg @mastra/code-sdk @mastra/docker @modelcontextprotocol/client zod
npm test -- test/task-agents.spec.ts test/agent-activity-runtime.spec.ts test/mcp.spec.ts test/task-workers.spec.ts
node scripts/monitoring-memory-smoke.mjs
node scripts/task-schedule-smoke.mjs
npm run runtime:smoke
```

Use the existing configured PostgreSQL test environment. Add a narrowly scoped migration rehearsal command only if existing integration setup cannot cover the previous-schema fixture. Run relevant file/browser smoke or public API checks when those boundaries change. Do not run unrelated frontend/iOS suites for a backend-only dependency update.

## Overall Exit Criteria

- Compatible stable packages are pinned; storage initialization and rollback requirements are verified.
- Every audit row has a supported disposition and required parity evidence; obsolete implementations and duplicate instructions are removed together.
- Existing conversations, task identity, schedules, notification history, secure entry and persistent desktop behavior remain intact.
- Compaction preserves usable context and monitoring progresses without duplicate notifications in the focused fixtures.
- Documentation describes the resulting system, checks pass, and completed work is committed locally. Include the required tool/guidance change table when reporting implementation completion.
- Production deployment is outside this implementation; any later rollout follows the separately authorized release and cleanup procedure.

## Implementation evidence — October 29, 2026

- Exact dependency pins resolve one deduplicated core/memory/MCP/PG stack; no new model-facing tools or parameters. Build, type-aware lint/boundary checks and four focused suites (8 tests) pass.
- Integration retains existing-thread history, scheduled overdue delivery, ownership/provenance, MCP refresh/discovery, worker identity/continuation and cancellation. The Task-result assertion now waits for Main's asynchronously delivered message. Worker assertions accept any three concurrent admissions while preserving failure and continuation coverage.
- Packaged runtime smoke passes Docker execution, stdin/streaming, isolation, cancellation, native code mode, cleanup and cross-process reconnection with the execution user process surviving.
- PostgreSQL 1.29 → 1.33 rehearsal initialized twice over an old-schema synthetic thread, message, active/buffered observations, paused schedule and pending notification. All survived. Concurrent reflection and append from independent pools retained both buffered chunks and advanced the generation once. New decoding preserves buffered timestamp timezone and milliseconds that the old reader misread.
- Schema changes: `mastra_observational_memory.supersededBy`; new `mastra_memory_run_fences` and `mastra_workflow_run_owners` tables keyed by runId; notification primary key becomes `(threadId, id)`. AI spans gain input/output/error previews, model/provider/outcome/stop-reason metadata, external parent/resumed span IDs, first-chunk/first-token timings and error count. Pal public tables are unchanged.
- Old-store reopen/read succeeded for the thread and schedule only. This does not prove old writer compatibility with generation fencing or the composite notification key; rollback requires the pre-upgrade database snapshot.

## Release and rollback procedure

Production rollout is deferred until requested. Before rollout, confirm no active Main/Task/interaction runs and pause ingress/dispatch so no writer overlaps the backup. Record current image IDs, schedule definitions/status/next-fire times, thread/message/notification counts, and home-volume identity. Take a restricted database backup containing both public and Mastra schemas; retain the current compatible backend/execution image pair until acceptance.

Build the pinned backend and execution artifacts. Replace execution because its packaged Mastra dependencies change; preserve agent home/profile and service-data/PostgreSQL volumes. Start the backend, let native PostgresStore initialization migrate storage, then verify health, existing-thread continuation, schedule definitions, pending notifications, delivery idempotency, file access and worker continuation before reopening normal admission. Observe the next normal monitoring check without manually duplicating it; require fresh source progress and no repeated notification for unchanged results.

If acceptance fails, stop new writes and restore the database snapshot together with the prior backend/execution pair; assess any post-cutover messages before restoration to avoid silently discarding them. Do not rely on image-only rollback. After accepted rollout, remove the migration backup and unneeded rollback images under the repository cleanup rules. No production mutation is included in this implementation.

## Development acceptance and cleanup

The existing `pal-dev-split` backend and execution images both contain the pinned package set. Backend restart, health and chat-history HTTP checks passed; execution retains `pal-dev-split_agent_home` and all protected volumes. Development had zero schedules before and after migration; schedule/history preservation and overdue wake were exercised in the isolated PostgreSQL integration fixtures rather than by creating user-facing development work.

Both real-model fixtures passed inside the upgraded development backend using its existing login. The separate host login was expired and was not used. Observation and reflection retained the attributed $659 finding and unsupported coupon, then called only the fresh storefront check and checkpoint save for $649. No historical repair ran. The scheduling fixture stayed silent for unchanged prices, published a changed price, and paused before completing on stop. These are observed model outcomes, not deterministic guarantees for every future run.

On the upgraded development pair, a temporary 2 MB binary roundtrip passed; a stale expected-mtime write was rejected without changing content; outside-root access failed; shell cwd was correct. A dedicated browser worker opened a public fixture, captured a screenshot and continued in the same session. Its group, screenshot and temporary file were removed. Native worker integration separately verifies parent ownership, concurrency, private output and failure/abort cleanup.

Removed the disposable PostgreSQL database (~10.8 MB), temporary schema/probes, copied container fixtures, development migration snapshot (~16 MB), runtime-smoke image (2.66 GB logical size), smoke containers/volume and isolated worktree (including ~1.4 GB dependencies). Docker image usage fell from 9.62 GB to 7.30 GB after removing the smoke image. Protected stack volumes and current service image tags remain; backend/execution images are approximately 2.17/4.33 GB logical size. Shared build cache (~14.3 GB) and unrelated images/volumes were preserved. No task rollback backup or one-off image remains. No production service, task or data was changed.

## Production acceptance

Production runs source `a841fc0` through Stack v2 `52e575f`. Backend and execution use verified immutable Linux AMD64 images; web release identity/contract remain unchanged. Explicit application migrations and native Mastra initialization passed, including the expected observation, notification-key and fencing changes. A backend restart preserved execution, and the normal Stack configuration is restored.

Cutover waited for active monitoring to finish. All pre-cutover identities survived: 2,026 public messages, 39 tasks, 44 attachments, 152 notification intents, 209 delivery jobs, 28,100 native messages, 789 threads and 980 observation records. All eight schedules retain their definitions; native next-fire advancement continues. Both MCP connections are healthy with 85 tools. Home/profile, web, egress, PostgreSQL and Google MCP are retained.

Production file/browser/network checks and both real-model fixtures passed. The first normal scheduled connected-source check fired at 23:40 UTC, used fresh tool discovery/code mode and completed silently; public messages remained 2,026. No duplicate check was injected. Other watches retain their original schedules. Runtime error-level logs were absent during acceptance.

Temporary rollback material was removed after acceptance: the exact rollout-created encrypted snapshot, ~4.1 GiB local database/home/private-state snapshot, fixtures, staging files and superseded backend/execution/migration images. Other backup snapshots, active state, current images and shared caches remain. Snapshot integrity was checked; no production restore rehearsal is claimed. Full image digests and operator update IDs are recorded in Stack v2's `plans/pal-mastra-upgrade-rollout.md`.
