# Texting Guidance

## Status

Done

## Goal

Keep Pal's guidance brief while supporting intentional message grouping, inline verified links, proportional follow-ups, and complete task-result delivery.

## Current Behavior

- `voice.md` combines personality and public-message rules and is shared with private workers.
- Main and Task publish completed structured text blocks. Task finals appear in Main; workers return private findings.

## Milestones

### 1. Lightweight Instructions

- [x] Keep voice guidance separate from a short `texting.md`, retaining existing structured-output, acknowledgment, and reply rules.
- [x] Add grouping and inline-link guidance; load texting for Main and Task while workers receive voice and private-work instructions.
- [x] Keep task final-result visibility explicit and document instruction loading.

Exit criteria:

- [x] Guidance adds only the portable behaviors and preserves existing delivery contracts.

### 2. Validation

- [x] Build, lint, and run existing Main, Task, and worker integration checks.
- [x] Use disposable native real-model sessions to check a linked recommendation, short follow-up, and Task final result.
- [x] Rebuild the local runtime and verify it is healthy.

Exit criteria:

- [x] Existing delivery checks pass, model samples are inspected, and the local runtime loads the new instructions.

## Tests

Reuse existing native integration tests. Review bounded synthetic model examples for meaning, links, proportionality, and final phase; no fixed wording or bubble-count target.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/main-session.spec.ts test/task-agents.spec.ts test/task-workers.spec.ts
docker compose build pal
docker compose up -d --no-deps pal
```

## Overall Exit Criteria

- [x] Main and Task receive lightweight texting guidance; workers remain private.
- [x] No database, API, renderer, tool, or dependency changes.
- [x] Relevant checks and model samples pass; local runtime and documentation are current.

## Validation Notes

Build, lint, and the three existing native integration files pass (nine tests). The worker smoke script loads the same separated instruction files; its syntax check passes.

Disposable real-model sessions using the configured model and synthetic sources produced a short contextual follow-up and a complete Task `final_answer` with accurate totals and source links. The first recommendation linked Cedar but omitted the mentioned Birch URL; clarifying the same short first-mention rule yielded a recommendation linking both in one declared follow-up check. This is bounded model evidence, not a wording or grouping guarantee. Recording-only publication and a disposable test schema kept the examples out of user chats.

The local image is rebuilt and running with matching instruction assets; API, desktop, and viewer health checks pass. Voice stays shared; public texting rules load only for Main and Task. Added behavior is two short rules; existing structured output, acknowledgments, replies, and Task visibility remain in place.
