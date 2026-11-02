# Worker result projection

## Status

Done

## Goal

Prevent screenshot-heavy interaction worker evidence from being duplicated into Task streams and results while preserving native Mastra delegation, worker evidence, approval/resume behavior, and unlimited active-run length. Validate the change under repeated and overlapping production-shaped runs.

## Current Behavior

- Task delegates interaction work through Mastra's native agent-as-tool support in `backend/src/agent/main-session.ts`.
- A public `SubAgent` adapter projects worker stream chunks and completed tool results before Mastra constructs the parent delegation result. Task receives final text, continuation metadata and compact tool-call identity.
- Interaction workers run without a step limit. Full worker evidence remains in the worker thread and trace.

## Milestones

### 1. Project worker results at the native subagent boundary

Implementation tasks:

- [x] Add a public `SubAgent` adapter around the interaction worker.
- [x] Preserve worker execution, memory, final text, tool-call identity, approvals, suspensions, aborts, errors, and lifecycle hooks.
- [x] Remove nested tool arguments/results and data-heavy presentation chunks before they enter the parent delegation result or stream.
- [x] Keep the implementation independent of Mastra internals and remove superseded parent-result compaction.

Exit criteria:

- A large synthetic worker tool result remains available in worker history and is absent from the parent result, stream, and persisted history.
- Approval, suspension/resume, failure, abort, and cleanup coverage passes.

### 2. Benchmark production-shaped memory behavior

Implementation tasks:

- [x] Add a bounded benchmark harness that produces screenshot-sized worker results with run shape and overlap comparable to the production failure.
- [x] Measure peak and post-completion heap for an unprojected baseline and projected runs without introducing a worker step or concurrency limit.
- [x] Repeat completed runs to distinguish active-run growth from retained post-run growth.

Exit criteria:

- Projected overlap has a materially lower peak than the baseline.
- Post-completion heap returns to a stable band rather than rising with each completed run.
- Results and benchmark conditions are recorded in this plan.

## Tests

- Extend the smallest native delegation integration suite with a large synthetic image result and parent/worker persistence assertions.
- Add focused projection tests for ordinary completion, suspension/resume, failure/abort, and compact tool-call identity.
- Reuse existing interaction coordinator and worker tests for lifecycle cleanup.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
TEST_DATABASE_URL=postgresql://pal:pal@127.0.0.1:15433/pal_test npx vitest run test/task-workers.spec.ts test/worker-result-projection.spec.ts
node --expose-gc scripts/benchmark-worker-result-projection.mjs baseline
node --expose-gc scripts/benchmark-worker-result-projection.mjs projected
```

## Validation Results

The benchmark ran five completed cycles in separate baseline and projected processes. Each cycle overlapped three workers with 30 320 KiB screenshot payloads per worker, or 12.5 MiB of encoded evidence per worker. This matches the low end of the 13–31 MiB worker results observed around the production failure. Workers had no step limit and ended naturally after their final response. The fixed evidence batch makes the two variants comparable; production concurrency policy was not changed.

| Metric | Unprojected | Projected |
| --- | ---: | ---: |
| Serialized parent record per cycle | 525.517 MiB | 0.042 MiB |
| Peak heap across five cycles | 281.57–294.71 MiB | 126.27–139.19 MiB |
| Post-GC heap, last three cycles | 54.163–54.358 MiB | 55.663–55.888 MiB |
| Last-three post-GC range | 0.194 MiB | 0.225 MiB |
| Final RSS | 632.15 MiB | 230.24 MiB |

Projection removed more than 99.99% of the parent record and reduced overlapping peak heap by about 51%. Projected post-completion heap remained stable. The remaining peak is active worker evidence and is released after completion.

Build, lint and boundary checks pass. The focused projection and PostgreSQL-backed native delegation tests pass, including private worker persistence, compact parent identity, concurrent execution, failure/abort cleanup and resume behavior.

## Overall Exit Criteria

- Native delegation behavior and full worker evidence are preserved.
- Task never receives nested worker tool payloads or screenshot-heavy worker chunks.
- No worker step or concurrency limit is added.
- Repeated and overlapping benchmark runs show bounded post-completion heap.
- Checks pass, documentation reflects the current boundary, and the work is committed locally.
