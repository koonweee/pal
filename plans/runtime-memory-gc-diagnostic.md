# Runtime Memory GC Diagnostic

## Status

Done

## Goal

Distinguish collectible idle heap from live retained references in production by taking one thresholded post-GC memory sample. Deploy only the production agent service.

## Current Behavior

- `RuntimeMemoryTelemetry` records process memory after two and five uninterrupted idle minutes.
- Production browser-worker runs can leave an elevated idle heap floor, but natural collection makes ordinary idle samples inconclusive.

## Target Data Shape

- Keep the ordinary five-minute `idle` sample as the pre-GC measurement.
- Emit one `idle_gc` sample immediately after successful forced collection, or `idle_gc_failed` if collection fails.
- Retain the existing process-global counters and omit run identities and content.

## Milestones

### 1. Thresholded Diagnostic

Implementation tasks:

- At the five-minute idle sample, trigger inspector garbage collection when heap used is at least 512 MiB.
- Arm the diagnostic once per process and disconnect the inspector session after the attempt.
- Record the post-attempt process memory without retaining run data.

Exit criteria:

- Focused tests cover the threshold, before/after ordering, and once-per-process behavior.
- Build and lint pass.

### 2. Production Deployment

Implementation tasks:

- Build and publish one immutable Linux AMD64 agent-service image.
- Update and apply only the Pal build and Stack image definitions.
- Pull and deploy only `agent-service` with dependencies disabled, then restore normal Stack arguments.

Exit criteria:

- Production remains healthy with unchanged dependency-container identities.
- The deployed source includes the armed diagnostic and ordinary memory telemetry continues to persist.

## Tests

- Extend the focused runtime-memory telemetry unit suite.
- Reuse the existing telemetry persistence coverage because the new phases use the existing sanitized `phase` field.

## Validation Commands

```bash
cd backend
npm run build
npx vitest run test/runtime-memory-telemetry.spec.ts test/run-telemetry.spec.ts
npm run lint
```

## Overall Exit Criteria

- One five-minute idle period at or above 512 MiB produces an ordinary sample followed by one post-GC diagnostic sample.
- Lower heaps and later idle periods do not force collection.
- Only `agent-service` is replaced in production.

## Outcome

Production runs Pal `627b712` at `ghcr.io/koonweee/pal:627b712@sha256:17e8ae295bf1a684624a2abf704a076f2a20be0dd8bfcc3a5c6b1bfc979a47cf`. The running image contains the inspector collection path, five-minute gate, 512 MiB threshold, and success/failure phases. Only `agent-service` changed container identity; it is healthy with zero restarts and no OOM, normal Stack arguments are restored, and dependency identities are unchanged. The one-shot sample remains armed until production reaches its first qualifying idle period.
