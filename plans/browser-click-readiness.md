# Browser Click Readiness

## Status

Done. Integrated into main after isolated-worktree validation; not deployed.

## Goal

Deliver trusted clicks to newly navigated background tabs without changing models, guidance or global concurrency.

## Current Behavior

- BrowserService routes agent-browser commands to owned worker tabs.
- Hidden documents can accept text before rendering; clicks may be acknowledged without delivery.
- The focused Cua diagnosis validates temporary target-specific focus emulation.

## Milestones

### 1. Guard trusted clicks

- Wrap click and double-click execution with target-specific focus emulation, a 25 ms rendering allowance, and unconditional cleanup.
- Keep existing ownership checks and cancellation.

Exit criteria met: build, six browser tests, full lint/boundary checks and 22 benchmark tests pass. Cleanup errors after a delivered click preserve its result.

### 2. Benchmark the implementation

- Run the existing concurrency benchmark three times with unchanged models and guidance in the isolated stack.
- Record success, latency and tokens; preserve evidence and clean disposable resources.

Exit criteria met: both lanes saved exactly once with distinct owners and overlapping workers in all three runs.

## Tests

- Focus cleanup on successful, failed and cancelled clicks; ownership rejection prevents execution.
- Existing benchmark tests and full-harness concurrency regression.

## Validation Commands

```bash
cd backend
npm run build
npx vitest run test/browser.spec.ts
```

## Overall Exit Criteria

- Regression tests and three full-harness samples pass using production code, with no experimental click override.
- Evidence and results documented; no deployment or Android changes.

## Results

The `bench/cua-focused` worktree retains evidence at `.local/cua-click-fix-rerun/{report.html,summary.json,results.jsonl,trace.jsonl,environment.json}`. Task remains Sol medium and workers Terra medium. Harness and guidance are unchanged; click execution uses BrowserService without a benchmark override.

| Measurement | Earlier diagnostic baseline | Implemented guard |
| --- | --- | --- |
| Full-harness success | 0/2 | 3/3 |
| Click duration | 0.16–0.20 s visible; 5.16 s failed background | 0.54–0.88 s, all six delivered |
| Median task duration | 37.0 s | 38.4 s (range 26.7–38.7 s) |
| Median input / output tokens | 96,326 / 832.5 | 83,206 / 780 |

All token usage is complete. These small diagnostic samples validate reliability, not a general speed or token improvement. The guard adds ownership resolution and CDP overhead to already-working clicks; it removes the background-input stall. Prior baseline includes a protocol recorder. No new model-facing controls or guidance are introduced. Other pointer commands and the separate private-fill failure are outside this regression.

The first startup attempt had no samples because the fresh test database needed migrations; its setup metadata remains in `.local/cua-click-fix`. Disposable stack resources and copied model authentication are removed after export; shared development resources remain untouched.
