# Task Workers

## Status

Done

## Goal

Let each task agent run up to three focused workers concurrently, one level deep, and combine their findings within the existing public task. Browser workers share Chromium logins while controlling independent pinned sessions in the parent task group.

## Current Behavior

- Main delegates to persistent native Task Agent threads through `delegate_task`.
- Task exposes native `agent-worker` alongside MCP/code mode, local execution, metadata and schedules. The interaction worker uses Luna high for browser/computer/login and code mode, returning private findings from explicit assignments without inherited history. See [current runtime deployment](interaction-worker-runtime.md).
- BrowserService pins independent task/worker CLI sessions; the extension maintains parent task groups, per-session/tab ownership, and cleanup membership.

## Milestones

### 1. Native Workers

Implementation tasks:

- [x] Register one reusable native worker through Task Agent's `agents` configuration.
- [x] Enforce three active workers per task with native delegation hooks and trusted parent/worker identities.
- [x] Give interaction workers UI/login tools and code mode, with private results, no task management tools or child agents; Task owns MCP/local execution.
- [x] Propagate cancellation and release worker slots after success, failure, or abort.
- [x] Add concise guidance for independent substantial branches and parent synthesis.

Exit criteria:

- [x] A native integration test proves overlapping workers, the fourth-worker limit, independent task limits, private output, no recursion, and cancellation/failure recovery.

### 2. Browser Sessions and Cleanup

Implementation tasks:

- [x] Route each worker to its own pinned session under the parent's group.
- [x] Record session/tab ownership in browser session storage, including attributable popups.
- [x] Close worker member tabs and its daemon at completion; group cleanup closes all remaining task sessions.
- [x] Preserve ungrouped tabs and tabs moved out, including after extension/API reconnect.

Exit criteria:

- [x] Deployed browser checks prove independent worker targets, one group per task, shared authentication, popup cleanup, and preserved human tabs.

### 3. Prompt Validation and Review

Implementation tasks:

- [x] Test real-model prompts similar to Carousell Saturday tickets for three plus F1 events today, including a three-branch request.
- [x] Verify actual overlap, parent synthesis, resource cleanup, and Main responsiveness using bounded disposable fixtures.
- [x] Build, lint, run focused regression checks, rebuild the running image, and update architecture documentation.
- [x] Review added logic for unnecessary abstractions and workarounds.

Exit criteria:

- [x] Similar prompts complete through real native workers with observed concurrency and correct combined results.
- [x] Checks pass; docs and plan status reflect validated behavior.

## Tests

- One native worker integration test covers concurrency/limit, separate parent tasks, private output, zero inherited context, failure, cancellation, and slot reuse.
- Extend the existing browser fixture for worker sessions/group cleanup and moved-tab preservation.
- A bounded real-model smoke uses local ticket/event fixtures and similar user prompts; external read-only research checks may be used to validate live behavior.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/task-workers.spec.ts test/task-agents.spec.ts test/main-session.spec.ts test/browser.spec.ts test/task-tool-discovery.spec.ts test/mcp.spec.ts
npm run browser:smoke
npm run workers:smoke
```

## Overall Exit Criteria

- [x] One extra worker level with at most three active workers per task; no new public task records or API contracts.
- [x] Workers run independently, return private findings, receive explicit assignments and interaction guidance, and clean up browser resources on exit.
- [x] Independent browser sessions share the parent group and profile without action locks.
- [x] Similar real-model prompts, focused checks, deployment, and simplicity review are complete.

## Deferred Work

Background worker jobs, persistent worker management UI, recursive delegation, global concurrency budgets, and automatic retry/queue infrastructure.

## Validation Notes

Native worker integration passes with three overlapping workers, fourth-worker rejection, a separate task allowance, slot reuse after a failed delegation, cancellation cleanup, role-scoped code mode, and private worker text. Six focused files pass 15 tests; build and lint pass.

The VM browser fixture verifies three distinct pinned targets starting in one parent group, shared profile state, session recovery, worker popup/member cleanup, moved-tab preservation, and all worker daemons exiting. Worker session names use only worker UUIDs to fit native Unix socket limits. Chromium blocks popup links from inactive tabs; the popup fixture foregrounds its opener, while agents can use explicit `tab new` for background work. Native close replies can precede process exit, so fixture checks wait for teardown to settle.

Real-model prompt checks pass against disposable local ticket/event/dinner fixtures, with explicit requests for parallel workers inside one public task. Observed native/browser concurrency peaks are two and three, combined findings match the sources, Main answers during active work, the follow-up reuses the public task, and all worker tabs/daemons are cleaned up. The full smoke also passes browser restart/login recovery and extension suspension. Native task streams are drained immediately, matching application consumption.

Worker selection remains model-driven: the original unqualified prompt used one worker plus parent research, and the explicit two-branch check initially ran sequentially before overlapping its verification workers. The three-branch follow-up started all three together. Main guidance keeps related checks with a combined answer in one task.

Simplicity review keeps Mastra native agents, delegation hooks, private memory, and cancellation. Custom additions are the per-task cap/trusted identities and browser session ownership/cleanup. Worker delegation stays outside code mode because native hooks require each invocation's unique tool-call ID. There are no new dependencies, queues, database tables, API endpoints, or worker-management UI.
