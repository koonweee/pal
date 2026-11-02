# Exclusive interaction resources

## Status

In Progress. Shared coordination and execution lifecycle are being implemented.

## Goal

Replace separate desktop and Android ownership mechanisms with one small host-owned coordinator. Workers take FIFO turns on a device through their existing tools. Preserve browser/app state between turns and make cleanup part of the worker's assignment.

Implementation and acceptance are authorized in development. Production deployment is separate.

## Current Behavior

- [ComputerSessionProcessor](../backend/src/agent/computer-session.processor.ts) wraps computer tools with BrowserService ownership checks. Competing workers receive a busy error; calls do not wait.
- [BrowserService](../backend/src/browser/browser.service.ts) combines desktop ownership, browser setup, task groups, pinned CLI sessions, private-entry page resolution, and tab cleanup. It closes tabs on worker completion, task completion/archive, 15-minute inactivity, and service shutdown.
- [Worker lifecycle wiring](../backend/src/agent/mastra-agent-runtime.ts) releases desktop ownership before closing worker tabs, allowing cleanup to overlap a later owner.
- [AndroidService](../backend/src/android/android.service.ts) independently owns reservation, serialization, and helper handoffs. It rejects other workers and can retain ownership for ten minutes while private entry awaits the user.
- [Delegation hooks](../backend/src/agent/task-workers.ts) track worker assignments and support resuming a private-entry session with the same worker identity. That session identity must not also identify a new execution's resource grant.
- [Private entry](../backend/src/login/login-destinations.ts) resolves browser pages through group/session ownership. Browser inspection brings pages to the foreground outside the computer guard. Android private refs depend on helper generation and live screen state.
- Task model requests have explicit timeout settings; interaction workers do not configure equivalent bounds. The X11 adapter does not currently forward per-call cancellation to its subprocess calls.
- General browser automation remains in production source and dependencies for internal fallback, smoke scripts, and historical benchmarks despite its removal from the worker tool inventory.

## Agreed Behavior

- Two independent exclusive resources: desktop and Android. Different workers can use the two devices concurrently.
- Strict FIFO for all requests, including user work, monitoring, and host private-entry operations. A user request may wait behind scheduled work; no priority or preemption in this version.
- The first ordinary device call binds a worker execution to that device and automatically queues it. No model-facing acquire, release, status, or polling tools.
- Ownership lasts across observations, model thinking, actions, and cleanup until execution completion, failure, or cancellation. Calls from the same execution are serialized. Concurrent first calls cannot create duplicate queue entries or bind two devices.
- A worker cannot switch devices. A cross-device call returns an actionable error without acquiring the second device. The worker returns findings to Task, which delegates a fresh worker for fallback after the first finishes.
- Credential waits release the device when the worker yields its result. The pending request survives; later submission and continuation reacquire access and recover stale state as needed.
- Workers share the existing browser and manage tabs visually. Remove automatic task windows, tab groups, and worker tab adoption. Preserve the persistent browser profile and logins.
- Workers clean temporary UI before returning, preserve unfinished work and private-entry targets, and report deferred cleanup to Task. Deferred cleanup is another ordinary queued assignment. No background cleanup agent or automatic tab sweeper.
- Use lifecycle cleanup and bounded operations. No periodic liveness watchdog, idle-turn timeout, or heartbeat. A healthy quiet worker keeps its turn.
- Coordination applies within one backend. Assume manual viewers send no input and development/production never control the physical phone simultaneously.

## Target Data Shape

- One in-memory coordinator owns per-resource FIFO entries, the current grant, and outstanding operations. Execution records carry trusted task identity, a unique execution identity, bound resource, and cancellation/lifecycle state.
- Browser private-entry targets retain explicit page/target identity plus the existing origin, document, frame, field, and expiry validation. Retained target identity is independent of resource ownership and Chrome group membership.
- Extend the existing activity snapshot with the minimal typed resource owner/waiter information needed to display waiting tasks. Derive it from coordinator state; do not maintain a second queue or persist queue positions. Update API/event types and generated client contracts together where applicable.
- Retain current private-entry records and notifications where possible. No durable job queue or automatic restart replay. If target persistence requires a schema change, document the exact requirement and migration before implementing it.

## Milestones

Implementation progress:

- Shared coordinator foundation and native delegation lifecycle integration implemented. Three focused coordinator tests and the PostgreSQL-backed native worker lifecycle journey pass (four tests total); backend build and type-aware lint/boundary checks pass.
- Native worker validation covers concurrent delegation, queued calls, failure, parent cancellation, and a resumed session receiving a fresh execution identity. Model response deadlines use Mastra's existing model-stream timeout boundary.
- Device adapters, transport settlement, private entry, activity, cleanup removal, and development evaluation remain outstanding. Production runtime has not been switched to the new coordinator yet.

### 1. Shared queue and execution lifecycle

Implementation tasks:

- Inspect the pinned Mastra delegation, cancellation, and tool-execution primitives. Use supported hooks; document any gap that needs a small adapter.
- Introduce one coordinator with automatic FIFO acquisition, one-device binding, per-owner serialization, and idempotent execution finalization. Separate fresh execution identity from resumable private-entry session identity.
- Wire worker completion/error/abort and parent termination to finalization. Reject new calls from ended executions, remove cancelled waiters, and drain dispatched operations before handing ownership onward.
- Bound worker model requests and dispatched device operations using existing timeout conventions. Queue waiting must not consume model-generation or device-operation deadlines; verify inherited delegation/tool deadlines do not terminate legitimate queue waits.
- Define transport settlement explicitly: a rejected promise or client timeout alone does not prove a remote mutation stopped. Where termination cannot be confirmed, make that resource unavailable until its device adapter can establish a safe state. Do not replay uncertain actions.
- On shutdown stop admission, cancel waiters, and settle active operations. On restart initialize empty queues and verify device readiness before dispatch; retain UI state and do not replay interrupted work.

Exit criteria:

- Essential coordinator tests prove FIFO, independent devices, single-device binding, cancellation, idempotent release, and rejection of late calls.
- A cancelled or timed-out operation cannot overlap a new owner. A healthy quiet execution is not evicted, and a long queue wait remains valid.

### 2. Device adapters and shared browser

Implementation tasks:

- Route computer and Android operations through the coordinator, replacing both existing ownership implementations. Keep device connection and helper mechanics in their adapters.
- Prepare/connect Chromium only when browser work needs it; acquiring desktop access must not create a task window or rearrange tabs. Keep native computer interaction usable for non-browser applications.
- Replace group-owned page selection with minimal active-browser-target resolution for fresh private inspection and explicit bound-target resolution for later operations.
- Remove automatic group creation, popup adoption/movement, session/group closing, task activity touching, idle sweeps, and shutdown tab deletion. Remove the extension if no remaining production requirement needs it; otherwise reduce it to the minimal target-resolution bridge.
- Remove obsolete agent-browser command paths, pinned-session daemons, production dependencies, and packaging. Update current smoke checks to exercise supported computer/private-entry behavior. Retire obsolete executable benchmarks rather than preserving a second production control system; retain historical results as reference.
- Preserve Android's native-ref invalidation and automation-helper handoff rules while removing its independent owner, pending-call queue, and retained-reservation timer.

Exit criteria:

- Two workers on each device take turns automatically; desktop and Android can progress independently.
- Completion, cancellation, archive, idle time, and backend restart do not automatically close retained browser tabs. Agent cleanup happens before its turn ends.
- There is one owner for queueing and serialization, with no legacy browser automation dependency retained solely for historical tools.

### 3. Private entry and continuation

Implementation tasks:

- Coordinate every private operation that can focus, inspect, or mutate a device, including operations initiated by HTTP submissions. Calls inside an owning worker reuse its grant without nested queue deadlocks.
- Preserve pending login/payment requests when the worker returns, while releasing device access. Separate request/session retention from reservation retention.
- Queue late user submissions as bounded host operations with the same FIFO policy. Revalidate the bound target after acquisition and before filling. Handle submissions racing the original worker's completion without deadlock or overlapping access.
- Keep saved/selected credentials within the existing private path. If fields or the screen changed, use the existing bounded recovery/Task continuation flow to navigate and inspect afresh. Never fill the currently visible screen merely because it is active, and never automatically replay an uncertain fill or purchase action.
- Resume with a new execution identity, fresh queue acquisition, and retained request context. Android generation changes require fresh native refs; browser targeting must survive unrelated active-tab changes without relying on removed task groups.

Exit criteria:

- A worker awaiting credentials releases its device; another task can use it; submission/continuation either fills the validated original target or recovers safely.
- Account selection, credentials, codes, and payment entry retain existing validation and notification behavior, including request cancellation and bounded recovery.

### 4. Agent guidance, activity, and documentation

Implementation tasks:

- Preserve existing computer/Android tool sets and the current private-authentication tools. Update descriptions only where waiting and one-device binding affect usage; add no queue-management tools or parameters.
- Put shared turn-taking and cleanup policy in one applicable instruction source. Task guidance owns fresh-worker fallback and deferred-cleanup assignments; Worker guidance owns focused interaction, preserving continuation state, and cleanup before return.
- Remove guidance to negotiate locks through parents, manually sequence independent device branches, treat ordinary contention as Android fallback, or ask the user to free a Pal-owned resource.
- Show waiting state through the existing activity UI, without model polling, chat notifications for each queue transition, or new queue settings. Keep running/waiting distinct from business-level needs-input/completed status.
- Record bounded queue/acquisition/release/failure telemetry using existing instrumentation, excluding credentials and arbitrary page content.
- Update architecture, deployment/packaging references, affected plans, and smoke instructions to describe the resulting system. Keep implementation progress in this plan.

Exit criteria:

- Native agent scenarios wait without busy-error loops, report real blockers, and perform or explicitly hand off cleanup. Guidance remains a model responsibility, not a guarantee of actual cleanup.
- Activity snapshots/reconnect show correct ownership and waiting state; Main remains responsive while workers wait.

### 5. Development acceptance and removal audit

Implementation tasks:

- Run the minimal automated tests below, then rebuild the existing development stack and exercise both resource adapters through native workers.
- Evaluate realistic dev workloads to find defects and opportunities for simplification: a burst of ten scheduled-style interactions followed by a direct request, concurrent desktop/Android work, a blocked login with delayed user submission, device fallback, and a cancelled turn with queued followers. Use synthetic tasks and existing fixtures; do not reproduce real purchases or external messages.
- Inspect native worker transcripts, queue events, public responses, and resulting UI state. Record queue wait/ownership durations, completion outcomes, unnecessary delegations, private-entry recovery attempts, cleanup omissions, leftover tabs, and whether waiting is understandable. Compare with the observed busy-error failure and a single-worker baseline; distinguish measurements from impressions.
- Fix implementation defects within the agreed design and rerun only the affected cases. For policy or scope changes, record the observed problem, evidence/run references, smallest proposed change, tradeoffs, and recommendation. Priority scheduling, preemption, explicit release tools, watchdogs, and automatic cleanup require evidence and a separate decision; do not add them silently during acceptance.
- Produce a short dev evaluation report alongside validation evidence: scenarios attempted, pass/fail and usability findings, fixes made and retested, remaining limitations, and improvements proposed (or an explicit finding that none are warranted). Keep status In Progress while required fixes or acceptance checks remain.
- Use local synthetic pages and non-destructive Android fixtures for contention/private-entry cases. Serialize physical-phone acceptance operationally with production; no production task changes or deployment are part of this plan.
- Rebuild execution only if dependency/extension/image changes require it. Preserve browser profile, agent home, databases, and shared stack volumes.
- Audit remaining references to busy rejection, retained Android reservations, browser-group cleanup, and legacy browser automation. Remove superseded tests and scripts together with their production paths.
- Commit coherent implementation boundaries after relevant checks. Remove task-created fixtures, containers, temporary data and unneeded images; inspect Docker disk usage after build-heavy work and report retained resources.

Exit criteria:

- Development demonstrates automatic handoff, safe failure recovery, retained browser state, private-entry continuation, and cleanup during an owning turn.
- Overall exit criteria below pass with validation evidence recorded here. Production rollout remains separate.
- The dev evaluation report identifies any improvements or fixes that should be proposed, supported by concrete observed behavior. Known accepted limitations such as FIFO latency are distinguished from defects.

## Tests

Use one parameterized coordinator suite and focused adapter/private-entry regressions. Avoid repeating every ordering case through every layer.

- **FIFO and ownership:** queue ten executions, verify admission order and one waiter per execution; serialize concurrent calls by an owner. Verify desktop and Android independence, same-task workers competing normally, and competing first calls binding only one device.
- **Lifecycle:** cancel a waiter; complete/fail/cancel an owner with an outstanding action; repeat finalization; end the parent before the worker completion hook. Assert the next owner cannot dispatch early and the old execution cannot issue late calls.
- **Timeout boundaries:** legitimate queue waiting and quiet model work survive; bounded model/device failures release only after settlement. An uncertain remote mutation makes its resource unavailable until recovery, without blocking the other device.
- **Shared browser:** fresh inspection targets the active browser page; retained private targets survive unrelated tab changes; explicit agent tab closure is respected. Worker completion, archive, idle time, and backend shutdown do not close tabs.
- **Private-entry journey, both adapters:** inspect/request, finish/release, intervening worker, user submission, and continuation. Cover valid target, stale target/helper generation, submission racing finish, cancellation while queued, and no replay after an uncertain fill. Reuse existing credential/code/payment tests for unchanged validation.
- **Activity:** queued/running/ended transitions and reconnect snapshots remain correct for multiple workers on one task. Waiting does not mark a task needs-input or completed.
- **Native dev acceptance:** two workers contend on each resource, separate devices progress concurrently, a worker cleans temporary UI before handing over, and fallback returns to Task for a fresh worker on the other device. Record tool evidence separately from model claims; do not use a broad real-model benchmark as a correctness gate.

## Validation Commands

Run focused suites during milestones, then the affected full backend suites for development acceptance. Add a bounded `interaction-resources:smoke` command for native queue/device acceptance; it does not exist yet.

```bash
cd backend
npm run build
npm run lint
npm test
npm run test:e2e
npm run openapi:check
```

For activity/client contract changes:

```bash
cd frontend
npm run check
npm run api:check
npm run check:ui
npm run test:unit
npx playwright test test/activity.spec.ts
```

From the repository root, use `./scripts/dev-local rebuild` and `status`; use `execution-rebuild` when execution dependencies change. Run relevant PWA checks if staging the activity UI. Exact fixture commands and results belong in validation evidence when implemented.

## Overall Exit Criteria

- Desktop and Android share one FIFO coordinator; each worker execution binds to one device through existing tools.
- Ordinary contention waits automatically without busy errors, polling, user intervention, or priority/preemption policy.
- Lifecycle cleanup and operation deadlines prevent unsafe handoff; no periodic watchdog is introduced.
- Private-entry waits release access and later reacquire/recover without wrong-target filling or repeated uncertain mutations.
- Shared browser/app state persists across turns. Workers own normal cleanup; deferred cleanup takes a queued turn.
- Automatic tab management and superseded ownership/automation paths, dependencies, tests, and guidance are removed.
- Targeted automated and native development acceptance pass, documentation matches behavior, and task artifacts are cleaned up.
- Realistic dev contention evaluation is complete; required fixes are retested and evidence-backed improvement proposals are reported for review.
- Completion report includes the repository-required tool/guidance table with change, affected agent, and availability. No production deployment is implied.
