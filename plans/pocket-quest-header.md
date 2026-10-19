# Pocket quest header

## Status

Done

## Goal

Animate the chosen pocket quest speech bubble and show task completion when completed work settles, including while Main or other tasks continue.

## Current Behavior

- AgentActivityService owns live runs and an ephemeral latest completion cue; the frontend activity feature owns selection and rendering.
- Completed status arms a cue; its task's last successful active run ending starts the five-second display, including alongside other activity.
- The header uses a soft speech shape with pocket quest motion, title/commentary fallbacks, multi-task navigation, and an idle name without a status dot.

## Target Data Shape

Keep the existing activity contract. A completed-status transition arms a process-local cue. The task's last successful active run ending publishes latestCompletion with a fresh occurredAt. Idle status changes can publish immediately. Interrupted runs, reopening, archival, and reset discard armed completion. Startup does not replay historic completions.

## Milestones

### 1. Completion lifecycle

Implementation tasks:

- [x] Arm completion while a task is running; publish when its final active run ends successfully.
- [x] Carry native abort/error outcome through the existing activity lifecycle callback and direct stream cleanup.
- [x] Preserve distinct task counts, stale-event checks, and startup/reset behavior.

Exit criteria:

- A status change 45 seconds before run end still creates a fresh cue at idle, with Main/other work unaffected.
- Idle alone and interrupted or superseded completion do not produce celebrations.

### 2. Pocket quest rendering

Implementation tasks:

- [x] Add the small turning charm, stacked speech cards for multiple tasks, and input/completion motifs using theme tokens.
- [x] Render a five-second completion check and brief sparkle independently of the primary activity text; keep idle task completion readable and navigable.
- [x] Preserve 44px controls, truncation, name fallback, task/list navigation, and reduced motion.

Exit criteria:

- Ongoing task text, Main activity, and input cues retain their priority while a completion celebration is visible.
- Header fit and accessibility hold at 320px in both themes, with motion disabled under reduced motion.

### 3. Validation and development

Implementation tasks:

- [x] Run focused backend lifecycle and frontend policy/browser checks, plus build/lint/type/ownership checks.
- [x] Rebuild idle development, refresh its configured staged PWA after backend readiness, and inspect the rendered header.
- [x] Update current architecture/plan records, remove temporary test resources, and commit the scoped change.

Exit criteria:

- Targeted regression and UI acceptance pass; development runs the reviewed code and temporary resources are removed.

### 4. Production deployment

Implementation tasks:

- [x] Publish matching runtime/web images from tested source `a40a28f` and verify Linux amd64 manifests.
- [x] Validate immutable image pins and deploy through the private release workflow while preserving application state.
- [x] Verify deployed images, health, release metadata, complete activity SSE, quest assets, and the actual narrow touch header; remove exact temporary rollout files.

Exit criteria:

- Production serves the reviewed release and passes live API, asset, stream, and browser acceptance.

## Tests

- Backend regression for delayed status completion, multiple runs, Main/other task overlap, interruption, reopening, and archival.
- Selector regression for concurrent completion decoration, expiry/reconnect, and existing activity priority.
- Extend the narrow touch-browser activity workflow for visible completion during Main/other work, expiry, navigation, and reduced motion.
- Reuse native runtime tests for lifecycle callback wiring; use an isolated PostgreSQL test database when required.

## Validation Commands

```bash
npm run build --prefix backend
npm run lint --prefix backend
npm test --prefix backend -- test/agent-activity.spec.ts test/agent-activity-runtime.spec.ts test/task-agents.spec.ts
npm run check --prefix frontend
npm run check:ui --prefix frontend
npm run test:unit --prefix frontend -- test-unit/activity.test.ts
cd frontend && npx playwright test test/activity.spec.ts
./scripts/dev-local rebuild
./scripts/dev-local pwa-up
```

## Overall Exit Criteria

- Pocket quest is the header treatment and completion appears after completed task work becomes idle.
- Completion can celebrate alongside ongoing work without changing objective status or primary activity text.
- Relevant checks pass; documentation, local commit, development runtime, and staged PWA are current.

## Out of Scope

Agent guidance changes, invented progress, additional design variants, and persistent completion queues.

## Validation findings

The delayed-completion regression fails against the former timing policy and passes with arming plus run-end publication. Four projection tests, one native failure-after-completion regression, and the existing Task native integration pass. One run of the existing Task integration timed out waiting for a mocked forwarded result; isolated and combined reruns pass without test timeout or behavior changes. Backend build/lint, five activity policy tests, strict frontend checks, ownership/unused-code/generated-contract checks, and the narrow touch-browser activity workflow pass. The browser workflow verifies completion alongside another task and Main, expiry, completion navigation, both themes, 320px fit, and actual reduced-motion behavior.

Development and its staged PWA are rebuilt and healthy. A browser-only activity fixture using configured appearance settings fits working, multiple-task, input, and completion states at 320px in both themes without page errors. The packaged dev backend also passes an isolated completion lifecycle check. Private deployment health, immutable image identity, release metadata, full activity SSE, quest assets, desktop viewer, and a real narrow touch browser in both themes pass. Temporary browser artifacts, databases, and rollout probes are removed.
