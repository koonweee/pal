# Memory Compaction Budgets

## Status

Done

## Goal

Reduce Main and Task context growth using native Mastra compaction thresholds and deploy to dev while preserving conversation state and the execution desktop.

## Current Behavior

- Main and Task share thread-scoped observational memory in `backend/src/agent/main-session.ts`.
- Production metadata shows Main holding about 67k memory tokens and five Tasks updated on October 23 holding a median 34.5k. These estimates exclude instructions and tool schemas.
- Native observation and reflection handle context compression; visible conversation history remains in application storage.

## Milestones

### 1. Set native budgets

Implementation tasks:

- [x] Set observation to 12,000 tokens with 3,000 raw tokens retained after activation.
- [x] Set reflection to 12,000 observation tokens.
- [x] Preserve existing asynchronous buffering defaults and disabled idle buffering.
- [x] Document the effective policy without adding configuration or model-facing controls.

Exit criteria:

- Backend build/lint and focused Main/Task memory tests pass.

### 2. Deploy and verify dev

Implementation tasks:

- [x] Rebuild dev through the supported script.
- [x] Verify effective native configuration and existing-record threshold resolution without executing model actions.
- [x] Verify healthy services, retained application state, and unchanged execution-container identity.

Exit criteria:

- Dev runs the new budgets, persisted state remains available, and the execution desktop is preserved.

## Tests

- Reuse Main-session compression/continuation and Task-agent integration tests.
- Inspect effective native options and existing-record resolution using an isolated temporary schema.
- Check dev health and metadata-only state counts across deployment.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- test/main-session.spec.ts test/task-agents.spec.ts
cd ..
./scripts/dev-local rebuild
./scripts/dev-local status
```

## Overall Exit Criteria

- Main and Task use 12k recent-history and observation thresholds, retaining a target 3k raw tokens after observation activation.
- Idle buffering, tools, guidance, model settings, and production deployment are unchanged.
- Relevant checks and dev runtime verification pass with the execution desktop and persisted state preserved.

## Deferred Work

Measure latency and continuity on long threads after compaction settles. Smaller thresholds are a latency experiment; this deployment does not establish a measured speedup.

## Validation Results

- Backend build and lint pass; six focused Main-session/Task-agent integration tests pass against disposable PostgreSQL.
- The deployed image resolves 12k observation/reflection thresholds, 3k raw retention, 2.4k background observation intervals, and disabled idle buffering. Native threshold resolution ignores legacy initial snapshots in favor of current instance settings. Verification used a temporary schema, removed afterward, with no model calls.
- Dev services and Tailnet API health pass. The supported rebuild completed after retrying a missing-container error during web recreation.
- Application counts remain 11 Tasks, 510 public messages, 786 private messages, 39 login sites and 12 native threads. Execution container ID and start time are unchanged.
