# Execution Audience Routing

## Status

Done

## Goal

Route Main publications to secondary channels that originated the current execution by default, while preserving a narrowly explicit agent override for current user instructions.

## Current Behavior

- Pal destinations are always included by host policy.
- Main must select every secondary destination on each `sendToUser` call.
- Main inputs and Task result signals already carry origin attributes, and native idle wakes can mark execution boundaries.

## Target Data Shape

- `sendToUser.explicitDestinationIds` optionally adds enabled secondary destinations to the execution-derived audience.
- Main and Task idle-wake signals carry `executionStart`.
- Task schedules retain the execution-derived destination IDs in native schedule attributes and return them with scheduled outcomes.

## Milestones

### 1. Deterministic execution audience

Implementation tasks:

- Derive destination IDs from current native signals through the latest execution boundary.
- Stamp Main idle wakes and forward Task/schedule audiences through existing result signals.
- Union enabled secondary origins with explicit tool overrides before publication or reaction.

Exit criteria:

- A PWA-only execution does not include Telegram.
- A Telegram-originated or mixed active execution includes Telegram.
- A later execution does not inherit an earlier execution's audience.
- A scheduled outcome retains the audience captured when its schedule was created.

### 2. Tool contract and validation

Implementation tasks:

- Make the explicit destination override optional and describe its exceptional use in the tool contract and Main guidance.
- Add focused regressions for execution boundaries, Task/schedule propagation, and explicit additive overrides.
- Rebuild and exercise the integrated development stack.

Exit criteria:

- Relevant tests, build, and lint pass.
- Development behavior confirms automatic routing and an explicit override.

## Tests

- Unit coverage for current-execution audience extraction and boundary reset.
- Tool coverage for automatic routing plus explicit additive destinations.
- Runtime coverage for active-input accumulation, fresh idle wakes, Task outcomes, and schedule snapshots.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
TEST_DATABASE_URL=postgresql://pal:pal@localhost:15433/pal_test npm test
cd ..
./scripts/dev-local rebuild
```

## Overall Exit Criteria

- Host code owns normal destination routing from factual current-execution attributes.
- Main can explicitly add an enabled secondary channel for a current user instruction.
- Historical channel choices cannot become automatic routing inputs.
- The development stack runs the validated implementation.

## Validation Results

- Backend build, type-aware lint, and architecture boundary checks pass. Lint also reports one unrelated unused import in the in-progress run-telemetry test.
- Full backend suite: 26 files and 87 tests pass. Focused routing suite: 2 files and 7 tests pass after the final enabled-destination assertion.
- The rebuilt development stack is healthy. A PWA-origin smoke test produced canonical `ios`/`web` delivery with no Telegram or notifications.
- In development, Main selected `explicitDestinationIds: ["telegram"]` for an explicit Telegram request. The host rejected it because Telegram is disabled in that environment, and Main corrected to canonical delivery. The focused integration test enables Telegram temporarily and verifies canonical plus Telegram delivery.
