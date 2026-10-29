# Mastra stable upgrade and primitive audit

## Status

Planned. Planning baseline: `2931465`, after the October 29 monitoring recovery rollout completed. No dependency or runtime changes are included in this planning task.

## Goal

Upgrade the supported Mastra stack together, preserve Pal's conversations and monitoring behavior, and remove Pal code and instructions whose responsibilities are covered by supported Mastra primitives. Every retained adapter must have a concrete remaining requirement; every deletion must have behavioral evidence.

## Current Behavior

- [Main session](../backend/src/agent/main-session.ts) owns one native controller session, shared thread-scoped memory, native Task/interaction agents, and workspace configuration. Pal wraps run options and scheduler startup.
- [Runtime](../backend/src/agent/mastra-agent-runtime.ts) connects native signals and streams to canonical chat, task metadata, provenance, activity, and delivery. [Task schedules](../backend/src/tasks/task-schedules.service.ts) use `mastra.schedules` with application ownership checks.
- [MCP discovery](../backend/src/agent/task-tool-discovery.processor.ts) composes `ToolSearchProcessor` and `createCodeMode`. Local adapters coordinate OAuth refresh and suppress unsupported MCP Apps advertisement.
- [ExecutionFilesystem](../backend/src/execution/execution-filesystem.ts) invokes a contained `LocalFilesystem` in the execution container. [ComposeSandbox](../backend/src/execution/compose-sandbox.ts) attaches Mastra command execution to the persistent Compose desktop.
- [Monitoring recovery](monitoring-memory-reliability.md) is accepted in production at `2ba506c`: all three watches finished fresh checks, schedules and delivered-notification history were preserved, and duplicate alerts were absent. Mobile required an additional source-reference correction. These outcomes are regression requirements.

### Version baseline

npm stable metadata verified October 29, 2026; all listed Mastra targets were published October 28. Recheck before implementation and record any target change.

| Package | Current | Target |
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

Findings below come from the stable release source at `6a191d4` and published package metadata. Conditional removals need the focused checks below; an upstream feature name alone is insufficient.

| Pal surface | Native primitive / evidence | Planned disposition and proof required |
| --- | --- | --- |
| `main-session.ts`: session lifecycle | [Controller session identity](https://github.com/mastra-ai/mastra/pull/27336) | Migrate shutdown from `deleteSession({ resourceId })` to `deleteSession({ sessionId: 'pal-main-session' })`. Keep resource `pal-owner` and thread `pal-main`. Verify shutdown and restart retain history and terminate listeners. |
| `main-session.ts`: machinery wrapper | [Controller source](https://github.com/mastra-ai/mastra/blob/6a191d4/packages/core/src/agent-controller/agent-controller.ts) still sets `CONTROLLER_MAX_STEPS = 1000` | Retain the unlimited-run override unless a supported configuration passes initial/resumed-run parity. Forward the new optional request context into `buildSharedRunOptions`; the existing zero-argument wrapper drops it. Preserve provider headers and native approval/usage settings. |
| `task-scheduler.worker.ts` | Native `SchedulerWorker` and [worker startup](https://github.com/mastra-ai/mastra/blob/6a191d4/packages/core/src/mastra/index.ts) | Seek supported consumer-first startup and delete the subclass if it preserves overdue boot delivery. Stable source still starts workers in array order, so retain the small shim if the native startup probe fails. Do not infer the race is fixed from scheduler retry improvements. |
| `TaskSchedulesService.bind()` legacy normalization | Native schedule updates already persist normalized wake attributes | After verifying existing deployed rows and backup compatibility, remove the repeated legacy `participantDestinationIds` / `deliveryChannels` cleanup. Put any remaining conversion in an explicit one-time migration. Retain task ownership and provenance initialization. |
| `single-flight-oauth-provider.ts` | MCP client 2.4.0; [upstream refresh PR](https://github.com/modelcontextprotocol/typescript-sdk/pull/2757) is still open | Retain provisionally. Remove only when the exact installed client shares refresh across concurrent 401s for the same provider and the rotating-token regression passes. Keep rejection of writes from replaced configurations. |
| `tools-only-fetch.ts` | [MCP client](https://github.com/mastra-ai/mastra/blob/6a191d4/packages/mcp/src/client/client.ts) still unconditionally inserts the UI extension | Retain. The new capabilities option does not disable that insertion. Delete only with a supported opt-out and ordinary text-response parity; Pal has no MCP Apps renderer. |
| `ExecutionFilesystem` and `backend/execution/filesystem.mjs` | Published `@mastra/code-sdk/agents/sandbox-filesystem` exposes [SandboxFilesystem](https://github.com/mastra-ai/mastra/blob/6a191d4/mastracode/sdk/src/agents/sandbox-filesystem.ts) | Main replacement candidate. Prove home-rooted absolute/relative paths, binary/media reads, writes, symlink containment, error mapping and large outputs. If equivalent, replace the bridge and remove its script, packaging and obsolete tests. Preserve generated-file validation and bounded, race-checked delivery reads in `ExecutionService`. Keep the bridge if parity needs a larger custom adapter. |
| `ComposeSandbox` | Native Docker process manager and optional sandbox filesystem | Keep Compose ownership, replacement-container discovery and detach-only shutdown. Native Factory provisions per-session containers, which does not fit the shared desktop. Audit spawn-cwd and `writeFiles` overrides separately; remove only if the installed provider preserves their behavior. |
| `CodeModeProcessor`, `TaskToolDiscoveryProcessor` | Native `createCodeMode` and `ToolSearchProcessor` already own execution/discovery | Check whether direct composition can replace the wrapper and redundant injected instruction. Retain one owner for the step-local tool allowlist and media exclusions. Prove reused/scheduled threads get refreshed MCP tools, Main stays catalog-free, and code cannot invoke unexposed tools. No custom executor or second discovery cache. |
| `chatgpt-model.ts`, `citations.ts` | Native OAuth fetch is already used; [Codex middleware](https://github.com/mastra-ai/mastra/blob/6a191d4/mastracode/sdk/src/providers/openai-codex.ts) sets generic coding instructions | Retain caller-instruction preservation and citation conversion until native output is equivalent. Native middleware must preserve observer/reflector instructions, streaming, `store:false`, effort, links and tool phases before substitution. |
| `mastra-agent-runtime.ts`, activity callbacks | Native signals, accepted delivery, run-status subscriptions and provider-error classification | Audit duplicate lifecycle observation against native run status; consolidate only if Main, direct Task and scheduled Task failures/cancellation remain observable. Keep canonical messages, application idempotency, provenance and delivery policies. `queueSignal` changes active delivery timing; retain current steering semantics. |
| `task-workers.ts`, browser/secure-entry integration | Native subagent execution, hooks and cancellation | Keep trusted task/worker identities, three-worker cap, browser-session continuation and cleanup. Remove duplicated execution bookkeeping only when native hooks cover abort/error paths. Do not replace private secure entry with generic tool approval. |
| `memory-options.ts`, `context-authority.md`, `memory.md` | Native observation/reflection fixes now protect message retention | Keep 12k thresholds, 3k raw retention, thread isolation, suggested responses disabled and `settled()` at shutdown initially. Keep attribution, uncertainty and completed-work policy; the fixes do not guarantee those model judgments. Remove only duplicate wording demonstrated by the composed prompts and compaction fixture. |
| `task.md`, `execution.md`, role prompts and processor instructions | Native tool schemas, generated code-mode instructions and skills | Delete repeated API mechanics already supplied at runtime; consolidate equivalent shared rules through `agent-instructions.ts`. Preserve capability-based discovery, Main's prompt acknowledgment, Task/worker ownership, secure entry, source failure handling and notification criteria. Review monitoring checkpoint rules against the mobile source-ID regression. |
| `task.md`: one-off scheduling instructions | [Stable schedules API](https://github.com/mastra-ai/mastra/blob/6a191d4/packages/core/src/schedules/schedules.ts) remains cron-based | Keep year guards and deletion after firing while date-specific cron can recur annually. Terminal cron handling does not by itself provide an absolute one-shot API. Reduce guidance only after an equivalent native primitive is verified. |

New MCP Events, Connect, Factory, durable-engine migrations and observability dashboards are deferred. They introduce new workflows beyond this upgrade. Record any useful follow-up separately.

## Target Data Shape

Keep Pal public API, public tables, task IDs, message references, delivery records, schedule IDs/cron/timezones and workspace paths unchanged. Main's runtime session key is explicitly `pal-main-session`; its persisted resource/thread identity stays unchanged.

Let `PostgresStore.init()` own Mastra schema upgrades. Inspect the exact 1.29-to-1.33 storage changes and rehearse initialization twice against an isolated database containing representative existing messages, observations, schedules and pending signals. Record table/column/index changes and old-binary compatibility. Do not promise image-only rollback before proving database compatibility. Never reset conversations or regenerate schedules to resolve an upgrade issue.

## Milestones

### 1. Establish compatibility and native replacement evidence

Implementation tasks:

- [ ] Pin the verified stable package set in an isolated checkout; inspect peer resolution and published exports.
- [ ] Rehearse Mastra storage initialization and record rollback requirements.
- [ ] Run narrow probes for filesystem parity, scheduler boot ordering, controller lifecycle and OAuth refresh coordination. Finish the audit with a remove/simplify/retain decision for each row.
- [ ] Capture composed Main, Task, worker, observer and reflector guidance; mark duplicated mechanics and required application policy.

Exit criteria:

- Exact dependency graph and schema changes are known; each proposed deletion has a supported replacement and observable acceptance check. Unsupported candidates have a specific retained-gap explanation.

### 2. Upgrade and remove verified duplication

Implementation tasks:

- [ ] Upgrade dependencies together and migrate session deletion/context forwarding.
- [ ] Implement proven native substitutions, removing superseded modules, packaging, dependencies and tests in the same change.
- [ ] Remove completed schedule normalization after its migration/data gate passes.
- [ ] Trim overlapping guidance while maintaining one shared owner per policy and role-specific tool boundaries. Keep the recent recovery policies until equivalence is demonstrated.
- [ ] Update current architecture/contracts and workaround comments; leave deferred work in this plan.

Exit criteria:

- Build/lint and focused integration checks pass; native primitives own the replaced behavior; remaining custom code is limited to demonstrated gaps or Pal product requirements. No increase in model-facing tools or choices without a current requirement.

### 3. Validate development behavior and prepare release

Implementation tasks:

- [ ] Rebuild the existing development backend; rebuild execution only if its packaged dependencies/scripts changed. Preserve shared volumes and desktop ownership.
- [ ] Run the essential checks below and the real-model monitoring/compaction fixtures. Record deterministic guarantees separately from observed model behavior.
- [ ] Verify existing-thread continuation, unchanged schedule definitions, files, MCP discovery, interaction-worker continuation and shutdown/restart.
- [ ] Prepare a concrete rollout/rollback procedure from schema evidence. Production deployment requires a subsequent user request.
- [ ] Clean task-created fixtures and disposable resources. After builds inspect Docker usage; keep protected stack images/volumes and report any retained rollback artifact.

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
- No production deployment occurs as part of planning; any later rollout follows the separately authorized release and cleanup procedure.
