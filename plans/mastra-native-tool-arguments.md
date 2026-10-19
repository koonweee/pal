# Native Mastra Tool Arguments

## Status

Done

## Goal

Use the released Mastra fix for completed tool calls without argument deltas and remove Pal's compatibility middleware.

## Current Behavior

- Core 1.76.0 includes [PR #26251](https://github.com/mastra-ai/mastra/pull/26251).
- The regression in `backend/test/chatgpt-model.spec.ts` exercises native streaming directly.

## Milestones

### 1. Native Tool Streaming

Implementation tasks:

- [x] Identify the first published stable release containing the fix.
- [x] Confirm the native regression fails on core 1.74.0.
- [x] Pin core 1.76.0 and compatible memory 1.37.0; remove completed-call middleware.
- [x] Update current dependency and streaming documentation.

Exit criteria:

- Native streaming executes each tool exactly once with complete arguments, with and without argument deltas, and preserves text.

### 2. Runtime Validation

Implementation tasks:

- [x] Run focused model, Main, Task, worker, and delivery coverage, plus build and lint.
- [x] Review and commit the scoped change.

Exit criteria:

- Relevant checks pass and Main, Task, Memory, and PostgreSQL use core 1.76.0.

## Tests

- Existing tool-argument regression validates actual execution inputs, call count, and text.
- Existing runtime coverage validates Main/Task acceptance, publication, schedules, workers, and participant routing.

## Validation Commands

```bash
cd backend
npm test -- test/chatgpt-model.spec.ts test/main-session.spec.ts test/task-agents.spec.ts test/task-workers.spec.ts test/participant-delivery.spec.ts
npm run lint
npm ls @mastra/core
```

## Overall Exit Criteria

- Core 1.76.0 handles tool arguments without compatibility middleware.
- Focused runtime checks, build, and lint pass; documentation reflects native streaming.

## Validation Record

- Core 1.74.0 fails the direct regression: the first tool receives an undefined ID instead of `first`.
- Core 1.76.0 passes the direct regression and all 13 focused tests across five files against disposable PostgreSQL. Build, type-aware lint, and adapter boundary checks pass.
- Memory 1.37.0 is needed for core 1.76.0 observational-memory types. Code SDK remains pinned for OAuth helpers and retains its private core 1.74.0 and memory 1.35.0 dependencies; Pal agent execution uses root core 1.76.0.
