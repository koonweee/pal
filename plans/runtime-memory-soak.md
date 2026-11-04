# Runtime memory telemetry and soak validation

## Status

Done

## Goal

Measure process and V8 heap state at Task and interaction-worker lifecycle boundaries, then run repeated production-shaped development scenarios to determine whether completed runs retain live objects or leave reusable V8/RSS high-water memory.

## Current Behavior

- Production monitoring records container RSS but does not record JavaScript heap, external buffer, or V8 heap-space usage at agent-run boundaries.
- Worker-result projection removes screenshot payloads from parent delegation results while retaining the complete private worker transcript.
- The existing projection benchmark validates completed synthetic worker calls with forced garbage collection. It does not exercise native Task wake-up, PostgreSQL memory, overlapping scheduled-shaped work, or natural idle collection in one long-lived process.

## Target Data Shape

`pal.memory.sample` observability logs contain a lifecycle phase, role, run/thread/task identity when available, active Task/worker counts, process memory counters, and V8 old/large-object-space counters. Samples contain no prompts, tool arguments, results, screenshots, or credentials.

## Milestones

### 1. Record bounded runtime memory samples

Implementation tasks:

- Add one process-level sampler with Task and worker start/finish ownership and a delayed post-finish sample.
- Persist only numeric memory counters and existing run identity metadata through `RunTelemetry`.
- Clear delayed sampling timers during shutdown.

Exit criteria:

- Focused tests cover start, finish, delayed samples, active-run counts, duplicate lifecycle calls, and shutdown cleanup.
- Existing agent telemetry remains sanitized and build/lint pass.

### 2. Exercise repeated production-shaped development runs

Implementation tasks:

- Add a bounded soak harness using native Task wake-up, native worker delegation, PostgreSQL memory, projected worker results, sequential screenshot-producing worker steps, and overlapping monitoring-shaped tool batches.
- Record natural-idle and forced-GC memory after repeated cycles without retaining generated results in the harness.
- Run several scenario shapes and record the observed curves and retained-object conclusion.

Exit criteria:

- Sequential, overlapping, and combined repeated-run scenarios complete and clean their temporary schemas.
- Results distinguish live heap after forced GC from RSS/heap reservation and identify any scenario with cycle-over-cycle live growth.

## Tests

- Focused unit coverage for the runtime memory sampler.
- Existing Task worker integration coverage for lifecycle wiring and sanitized persisted telemetry.
- The soak harness is diagnostic validation, not part of the ordinary test suite.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/runtime-memory-telemetry.spec.ts test/task-workers.spec.ts
node --expose-gc scripts/runtime-memory-soak.mjs --scenario=sequential --cycles=12 --gc=end
node --expose-gc scripts/runtime-memory-soak.mjs --scenario=overlap --cycles=12 --gc=each
node --expose-gc scripts/runtime-memory-soak.mjs --scenario=combined --cycles=24 --gc=end
```

## Results

- Twelve sequential screenshot-heavy worker runs persisted 300.21 MiB of private worker messages. Forced-GC heap ended at 76.13 MiB from a 61.34 MiB baseline; large-object space ended at 14.14 MiB from 13.20 MiB. RSS ended at 330.21 MiB from 213.83 MiB.
- Twelve combined runs with per-cycle forced GC returned to 74–76 MiB heap after every cycle while peak heap reached 447 MiB. RSS rose from 213 MiB to 432 MiB despite stable live heap.
- Twenty-four combined runs without per-cycle forced GC persisted 600.42 MiB of worker messages and 27.22 MiB of parent messages. Natural collection reclaimed heap in waves; completed-run heap ranged from 137 MiB to 296 MiB, peak heap reached 473 MiB, and final forced-GC heap was 78.46 MiB. RSS remained at 474.53 MiB from a 214.90 MiB baseline.
- The corrected harness did not reproduce cycle-over-cycle live-object retention. It did reproduce elevated post-run RSS and temporarily elevated large-object space between natural collections.

## Overall Exit Criteria

- Production-compatible telemetry can correlate completed agent work with live heap and RSS without retaining model content.
- Repeated development runs exercise the production lifecycle and produce reproducible memory evidence.
- Findings state whether the tested accumulation is live-object retention, recyclable heap/RSS high-water behavior, or an unresolved production-only path.
