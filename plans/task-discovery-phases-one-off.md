# Task Discovery, Message Phases, and One-Off Reminders

## Status

Done

## Goal

Retrieve existing tasks without flooding Main context, derive message visibility from phase, and handle one-off reminders using native schedules and agent guidance.

## Current Behavior

- Search matches alternative literal queries across all task statuses and archived records; Main inspects promising candidates and decides reuse/create/clarify.
- Public messages persist phase and derive Main visibility from task identity, role, and phase. Migration 0002 is deployed without historical backfill.
- Scheduling uses native cron/timezone operations. One-off prompts carry the intended date/time and instructions to delete the triggering schedule when due. Cancellation depends on agent execution.

## Target Data Shape

- Search candidates: ID, title capped at 120 characters, goal capped at 240, status, archived state, and one matching description excerpt. Full details/history come from inspection.
- Search orders by creation time and ID descending, with query-bound pagination. No relevance score.
- Schedule tools use cron/timezone/prompt. No custom timing or consumption metadata, storage writes, or serialization queue.
- Message phase and derived visibility contracts are unchanged.

## Milestones

### 1. Compact Task Retrieval

Implementation tasks:

- [x] Remove query-count scoring and score-aware cursors.
- [x] Return bounded candidates without duplicate title/goal excerpts.
- [x] Preserve iterative search, all-status discovery, pagination, and inspection.

Exit criteria:

- [x] Service coverage verifies newest-first ordering despite differing query counts, older completed-task discovery, bounded context, and unchanged full details.

### 2. Native Scheduling and Agent Guidance

Implementation tasks:

- [x] Remove the deterministic one-off adapter and its dedicated tests.
- [x] Guide agents to use date-specific cron, retain the intended date in the prompt, and delete the triggering schedule when due.
- [x] Update architecture and tool contracts.

Exit criteria:

- [x] Existing native scheduling lifecycle tests pass.

## Tests

- Reuse the task discovery service regression for ordering, pagination, context bounds, and inspection.
- Reuse native Main/task integration coverage for scheduling and routing contracts.
- Reuse the synthetic live routing probe for reuse/create/clarify.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/services.spec.ts test/main-session.spec.ts test/task-agents.spec.ts
node scripts/task-routing-smoke.mjs
```

## Overall Exit Criteria

- [x] Compact unscored retrieval and native schedule management pass relevant checks.
- [x] Documentation reflects agent-managed one-off cancellation.

## Deployment

The phase migration and previous implementation preserve record invariants with verified private backup and rollback checks. This simplification needs no application schema migration.

## Validation Record

2026-10-07: backend build and type-aware lint pass; all 8 focused service/Main/task integration tests pass. The live synthetic routing probe passes reuse/create/clarify with compact candidate responses. The deployed database contains no custom one-off records requiring conversion.

The simplification was deployed on 2026-10-07 without a schema migration. API, frontend proxy, desktop viewer, and all four supervised processes pass live checks. The prior image is retained as `pal-local:pre-simplification-20261007`.

## Parallel Tool Calls

- Main uses default parallel tool calling. Tool definitions already specify the necessary arguments.
- Mastra core 1.76.0 handles completed provider calls with no preceding argument deltas. The ChatGPT adapter uses native tool argument streaming and parallel execution.
- A focused regression covers two calls in one step, missing and present argument deltas, exactly one execution per call, and preserved streamed text. Build, lint, and seven focused model/Main/task integration tests pass.
- All three live routing cases pass with parallel calls enabled. Deployed on 2026-10-07; API, frontend proxy, desktop viewer, and supervised processes pass live checks. Rollback image: `pal-local:pre-parallel-fix-20261007`.

## Live UI Validation

2026-10-07: browser-driven checks against the deployed API and model pass for completed/archived task reuse, ambiguity clarification without duplication, unrelated task creation after two searches, and independent candidate inspections in one model response with valid IDs. The archived fixture timestamp was set to seven days earlier for older-task coverage.

Database and browser assertions confirm task commentary/final visibility, shared final IDs, and persistence after reload/reselection. The recurring reminder was created, updated, delivered once, paused, and deleted; no delivery followed pause. The one-off delivered once and its agent deleted the schedule. All four UIQA tasks are archived and no test schedules remain. Evidence is in ignored `backend/data/ui-validation/evidence.json`.

Observed UX issues: full reload opens Main; Main sometimes supplies its own answer before the task final, producing repetitive content despite distinct message identities.

## Direct Answers and Delegation

Main answers directly when context suffices to complete the request. Substantial work, task updates, and ongoing task ownership are delegated; Main then acknowledges briefly and leaves the substantive answer to the task. The routing probe covers direct fixture comparison and explicit task creation with already-known facts, alongside reuse/create/clarify. Exit criteria: direct comparison creates no task, explicit task work delegates without Main repeating the result, and existing routing cases pass.

2026-10-07: build and all five live routing cases pass. Deployed and verified through the web UI against PostgreSQL: direct fixture comparison returned the correct answer without creating a task; explicit task creation produced acknowledgments from Main and exactly one substantive task final. The test task completed and was archived. Evidence: ignored `backend/data/ui-validation/direct-answer-evidence.json`. Main still emitted both a progress acknowledgment and a completion acknowledgment, but did not repeat the task result.

Upstream investigation: [issue #26207](https://github.com/mastra-ai/mastra/issues/26207) includes a standalone reproduction and follows [#15224](https://github.com/mastra-ai/mastra/issues/15224) / [#15227](https://github.com/mastra-ai/mastra/pull/15227). [PR #26251](https://github.com/mastra-ai/mastra/pull/26251) fixes execution-time arguments and is included in core 1.76.0.
