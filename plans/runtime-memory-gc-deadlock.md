# Runtime Memory GC Deadlock

## Status

In Progress

## Goal

Restore production Pal by fixing inspector cleanup after the idle forced-GC diagnostic and deploying only agent-service.

## Current Behavior

- Disconnecting the inspector synchronously inside its collection callback deadlocks Node 24.15.0.
- Pal recovered from the 03:45 backup, completed scheduled work at 06:34 Pacific, and froze at the following five-minute idle diagnostic.
- The production backend is unhealthy; dependency containers and persisted state remain available.

## Milestones

### 1. Fix and validate inspector cleanup

Implementation tasks:

- [x] Defer inspector disconnect until the collection callback has returned.
- [x] Add a bounded real-process regression that exercises the actual inspector collector and confirms event-loop progress.
- [x] Validate build, focused telemetry tests, formatting, and lint; commit and publish reviewed source.

Exit criteria:

- The regression fails against synchronous cleanup and passes with deferred cleanup.
- Relevant backend checks pass.

### 2. Deploy and accept production recovery

Implementation tasks:

- [ ] Build and verify one immutable Linux AMD64 agent-service image from the reviewed commit.
- [ ] Validate and publish only the changed Build and agent-service deployment pin through Stack v2.
- [ ] Pull and deploy only agent-service through Komodo with temporary --no-deps; restore normal Stack arguments.
- [ ] Verify API/SSE, real inspector collection in the deployed image, retained dependencies, and cleanup.

Exit criteria:

- Production API is healthy on the verified image, real collection returns, and dependency identities remain unchanged.
- Temporary configuration and task artifacts are removed.

## Tests

- Real child-process inspector regression with an external kill timeout.
- Existing runtime-memory and telemetry persistence tests.
- Backend build, lint, and focused formatting checks.

## Validation Commands

```bash
cd backend
npm run build
npx vitest run test/runtime-memory-telemetry.spec.ts test/run-telemetry.spec.ts
npm run lint
npx prettier --check src/agent/runtime-memory-telemetry.ts test/runtime-memory-telemetry.spec.ts
```

## Overall Exit Criteria

- The collector finishes without blocking the backend event loop.
- Production recovers through a backend-only release with unchanged schema, API/PWA identity, and persistent state.
- Release evidence and cleanup are recorded.

## Rollback

Use the compatible pre-diagnostic e0c1a83 backend image documented in Stack v2 if the corrected image fails acceptance. Retain release identity 4037c65 and all application state. The current 627b712 image contains the reproduced deadlock and is unsuitable for recovery.

## Validation Evidence

- The real-process regression times out and kills its child against synchronous cleanup; deferred cleanup completes collection and a subsequent event-loop callback.
- Backend build, lint, boundary checks, and focused formatting pass. All eight runtime-memory and database-backed telemetry tests pass against an isolated disposable database.
