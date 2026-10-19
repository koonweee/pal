# Messaging Routing and Task Execution Provenance

## Status

Done

## Goal

Always include first-party publication and alert targets, let Main select additional channels, and limit Task outcome provenance to inputs from the current execution.

## Current Behavior

- Main owns `sendToUser`; Task output stays local and finals signal Main.
- Host resolution includes first-party audiences; Main selects additional secondary channels and one notification boolean.
- Outcome provenance uses the live native message list and a stored idle-wake boundary for recovery.

## Target Data Shape

- Tool `destinationIds` accepts an empty list and selects enabled secondary channels.
- Persisted delivery lists include enabled canonical destinations plus selected secondary destinations. `notify` applies to the full included list.
- Native idle-wake signals carry an execution-start attribute. Result signals carry current-execution origins and schedule IDs, when present.

## Milestones

### 1. Routing contract

- [x] Include canonical destinations in host resolution; validate additional IDs as secondary.
- [x] Update the tool, destination directory, minimal Main guidance, and affected checks.

Exit criteria: empty additional destinations publish in Pal; requested alerts include native destinations; secondary channels share the same notify boolean for messages and reactions.

### 2. Execution provenance

- [x] Stamp native idle wakes for direct input, delegation, and existing/new schedules.
- [x] Read live native messages through that boundary; use newest stored messages when compressed context needs recovery, with no total-count query.
- [x] Preserve selected older references, current steering, schedule-trigger facts, and conversation continuity across restart.

Exit criteria: results exclude previous executions' origins while retaining current inputs and explicitly selected older references.

### 3. Validation and complexity review

- [x] Update architecture and run focused backend integration/end-to-end checks, build, and lint.
- [x] Rebuild the integrated local stack.
- [x] Review complexity, state ownership, guidance duplication, and remaining limitations; commit the completed change.

Exit criteria: relevant checks pass; obsolete logic is removed; review findings and scenario behavior are reported.

## Tests

- Extend existing native notification and secondary-adapter coverage for automatic first-party inclusion and silent/alerting publication and reactions.
- Extend the real Mastra runtime fixture for steering, successive idle wakes, explicitly selected older references, schedules, and restart.
- Verify bounded pagination against a long native history.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
TEST_DATABASE_URL=postgresql://pal:pal@localhost:15433/pal_test npm test
TEST_DATABASE_URL=postgresql://pal:pal@localhost:15433/pal_test npm run test:e2e -- test/chat.e2e-spec.ts test/secondary-adapter.e2e-spec.ts
```

## Overall Exit Criteria

- First-party inclusion is deterministic; model controls only additional channels and alert intent.
- Provenance follows the latest idle wake and active steering without lifetime-history scans.
- Scheduled runs require no historical destination reconstruction or special routing guidance.
- Existing Main/Task communication ownership and adapter behavior remain intact.

## Complexity Review

- DestinationService owns audience expansion for messages and reactions. Existing notification intents and delivery jobs own alert/provider behavior; no new delivery state or migration is needed.
- The native winning idle-delivery branch stamps the boundary, avoiding a separate active/idle check and its race. Existing schedule binding normalizes saved wake attributes through supported APIs.
- One scanner reads live context and, when needed, native storage. Live context is necessary because first-step finals can precede input persistence; stored signals recover inputs removed by context compression. No Memory subclass, provenance table, or custom lifecycle manager is added.
- Lookup cost follows one execution. An uninterrupted long execution can still require multiple pages; earlier executions are excluded.
- Scheduled dispatch failures supply their known schedule ID with empty origins because no execution was started. Normal scheduled outcomes use the same scanner as interactive work.
- Tool descriptions own automatic first-party inclusion. Main's existing role guidance only describes additional-channel judgment; Task/worker guidance needs no duplicated policy or scheduling-specific routing rule.
- Existing result-commit/native-signal crash recovery and provider acceptance limitations are unchanged; no replay subsystem is introduced.

## Validation Results

- Backend build and type-aware lint/boundary checks pass.
- Backend suite: 15 files, 43 tests pass.
- Affected HTTP/SSE and secondary-adapter end-to-end suites: 2 files, 12 tests pass.
- The native runtime fixture covers immediate finals, active steering, multiple finals, multi-page stored recovery with truncated live context, a 150-message older history, fresh continuation after restart, explicit older references, and existing-schedule normalization.
- Integrated local stack rebuilt; backend health returns `{"status":"ok"}`.
