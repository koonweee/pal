# Execution Browser Pressure

## Status

Done

## Goal

Keep the persistent execution desktop healthy across repeated interaction work by reclaiming worker-created browser pages, recording bounded execution resource telemetry, and restoring production from the current Chromium OOM state.

## Current Behavior

- Chromium and the desktop persist across agent-service runs and deployments.
- Worker guidance asks the model to close temporary tabs, but host code does not own or reclaim pages created during a worker turn.
- Production execution telemetry is limited to container health; browser targets, processes, cgroup memory, swap, and OOM counters are not retained with agent telemetry.

## Milestones

### 1. Deterministic Worker Page Cleanup

Implementation tasks:

- Snapshot page target IDs before the worker's first desktop action.
- Close only pages created during that worker after completion or failure.
- Retain the snapshot and selected page while secure-entry continuation is pending.
- Complete cleanup before FIFO admission releases the desktop to the next worker.

Exit criteria:

- Focused tests prove pre-existing pages remain open, worker-created pages close, continuations remain available, and cleanup does not alter device tool media results.

### 2. Execution Resource Telemetry

Implementation tasks:

- Sample execution cgroup memory, swap, OOM counters, process/thread counts, Chromium renderer counts, and browser target counts every two minutes.
- Persist only bounded numeric/boolean measurements through existing Mastra observability.
- Record browser cleanup counts and sanitized collection failures.

Exit criteria:

- Focused tests cover successful and failed sampling, and a live development sample contains no process arguments, URLs, titles, or page content.

### 3. Production Rollout

Implementation tasks:

- Build and pin reviewed agent-service and execution images from one Pal revision.
- Replace the production execution desktop to clear the existing unowned browser backlog while preserving its home/profile volume.
- Deploy agent-service, verify cleanup/resource telemetry, and confirm execution memory and target counts remain bounded.

Exit criteria:

- Production services are healthy, the execution container has a fresh desktop session, and the first telemetry sample reports expected bounded counters.

## Tests

- Focused browser ownership and execution telemetry unit tests.
- Backend build and lint.
- Development stack smoke covering a worker-created tab and its post-run cleanup.
- Production health, telemetry, browser-target, and cgroup verification after rollout.

## Validation Commands

```bash
cd backend
npm run build
npx vitest run test/shared-browser.spec.ts test/interaction-tools.spec.ts test/execution-resource-telemetry.spec.ts test/task-workers.spec.ts
npm run lint
```

## Validation Results

- Backend build, lint, boundary checks, three focused suites with eight tests, and the database-backed task-worker integration pass.
- The protected development stack rebuilt cleanly. A live browser check started with one page, created one worker-owned page, closed that page, and returned to the original single page. Execution telemetry reported bounded cgroup, process, renderer, and target counters with no private browser or process content.
- Production runs Pal revision `4f29924b9350cc8209fcbb91fd78d09909795abf` through Stack v2 revision `2a4c87c`. Agent-service and execution were the only Pal containers replaced; all persistent volumes and the other eleven container identities were preserved.
- The first production execution samples reported 368–400 MiB memory, zero swap use, zero OOM/OOM-kill events, 20–21 processes, and no browser targets before the desktop browser was started. Agent-service and execution are healthy with zero restarts and no OOM kill.
- Two scheduled monitor runs were active at rollout and lost their terminal spans. No direct user task run was interrupted. The next scheduled wake completed while two Task runs overlapped; agent RSS remained below 464 MiB and execution remained below 400 MiB. At two and five minutes idle, agent RSS was 323 and 326 MiB, heap used was 171 and 177 MiB, and large-object space remained 38 MiB.
- The crash watcher now reports child-process OOM events as memory pressure without treating them as container exits. Its watcher and socket proxy remained healthy after deployment.

## Overall Exit Criteria

- Completed interaction workers do not leave newly created pages behind.
- Secure-entry continuations retain their bound page until completion.
- Execution pressure is queryable without retaining private browser or process content.
- Production starts from a reclaimed Chromium session and remains healthy after representative work.
