# Web Conversation Pacing

## Status

Done

## Goal

Coordinate optimistic user messages, delayed Read receipts, the typing indicator, and assistant arrival as one natural conversation timeline in the web app.

## Current Behavior

- User messages render optimistically and reconcile by idempotency key.
- Read appears as soon as the latest user message is persisted.
- Typing independently starts after send acceptance and uses a randomized lifetime.
- Conversation layout animation already handles added and removed rows.

## Milestones

### 1. Central conversation pacing

Implementation tasks:

- Add one hook that owns the active outgoing burst, Read and typing deadlines, and timer cleanup.
- Keep burst deadlines when another user message is sent before an assistant response, moving receipt ownership to the newest message.
- Reveal Read no later than typing or the next assistant message, while preserving persistence as the receipt boundary.

Exit criteria:

- Read normally appears 1–5 seconds after submit.
- Persisted user messages show Delivered while awaiting the Read deadline.
- Typing can appear after a 2–8 second delay and never precedes Read.
- Rapid sends share one pacing timeline and the newest persisted message owns the only receipt.

### 2. Organic layout and validation

Implementation tasks:

- Treat receipt visibility as a conversation geometry change and reuse the existing layout reconciliation.
- Exercise normal, early-typing, early-assistant, timeout, and rapid-send combinations in the development app.

Exit criteria:

- The optimistic latest-user row reserves the receipt footprint, so persistence and the Delivered-to-Read crossfade cause no additional geometry change.
- Automated regressions and visual development trials show no duplicate receipts, stale timers, or abrupt motion.

## Tests

- Unit coverage for randomized pacing bounds and omitted typing.
- Focused browser coverage for delayed Read, typing ordering, assistant forcing, rapid-send ownership, cleanup, and layout motion.
- Visual inspection of representative timing combinations in the development app.

## Validation Commands

```bash
cd frontend
npm run check
npm run test:unit
npm test -- --grep 'read|typing|rapid'
npm run check:ui
npm run trim
```

## Overall Exit Criteria

- One frontend pacing owner deterministically orders Read, typing, and assistant presentation without backend changes.
- The development conversation feels organic across ordinary and rapid-send scenarios.

## Validation

- Frontend type, UI ownership, unused-code, and all six unit-test files pass.
- All pacing scenarios pass, including delayed Read, rapid sends, early typing, early assistant arrival, persistence recovery, failed sends, and stable optimistic-to-Delivered row height. The full chat run passed 12 scenarios; the concurrently changed reaction-geometry scenario failed its separate emoji-offset assertion.
- Deterministic development-app trials and real local-stack rapid-send and Delivered-to-Read trials show one receipt beneath the newest user message, stable typing placement, a reserved status footprint, and no persistence-time layout shift on desktop or mobile.
