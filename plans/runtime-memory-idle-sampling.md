# Runtime Memory Idle Sampling

## Status

In Progress

## Goal

Record process memory after two and five uninterrupted idle minutes so production telemetry distinguishes delayed garbage collection from memory retained across completed runs. Deploy only the production agent service.

## Current Behavior

- `RuntimeMemoryTelemetry` records Task and worker `start`, `finish`, and 30-second `settled` samples.
- Production evidence shows 30 seconds is often too early for major garbage collection; idle heap can rise across runs and later collapse without a process restart.

## Milestones

### 1. Idle Memory Samples

Implementation tasks:

- Schedule runtime-global samples after two and five uninterrupted idle minutes.
- Cancel pending idle samples when a new unique Task or worker run starts.
- Keep existing per-run lifecycle samples and shutdown cleanup unchanged.
- Record the idle duration without assigning a misleading run identity.

Exit criteria:

- Focused tests cover both idle delays, cancellation on resumed work, timer reset after returning idle, and shutdown cleanup.
- Build and lint pass.

### 2. Production Deployment

Implementation tasks:

- Build and publish one immutable Linux AMD64 agent-service image.
- Update and apply only the Pal build and Stack image definitions.
- Pull and deploy only `agent-service` with dependencies disabled, then restore normal Stack arguments.

Exit criteria:

- Production remains healthy with unchanged dependency-container identities.
- A live run records `idle` samples at the configured durations, or deployment wiring and the first available idle sample are verified within the rollout window.

## Tests

- Extend the focused runtime-memory telemetry unit suite.
- Reuse existing worker lifecycle coverage for persisted sample wiring.

## Validation Commands

```bash
cd backend
npm run build
npx vitest run test/runtime-memory-telemetry.spec.ts test/task-workers.spec.ts
npm run lint
```

## Overall Exit Criteria

- Production telemetry records delayed idle memory without retaining run content or identities.
- New work cancels stale idle timers and a later idle period starts fresh timers.
- Only `agent-service` is replaced in production.
