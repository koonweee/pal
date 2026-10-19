# Web Typing Indicator

## Status

Done

## Goal

Show a brief, natural-looking Pal typing bubble after an accepted web message without implying that global agent activity belongs to the visible conversation.

## Current Behavior

- The backend publishes aggregate `working` activity across Main and task runs.
- The web client renders that activity on the header avatar and publishes assistant messages only when complete.
- The client already knows when its submission is accepted and when a same-conversation assistant message arrives.

## Milestones

### 1. Ephemeral conversation indicator

Implementation tasks:

- Randomly decide whether an accepted send shows the indicator and choose a bounded display duration.
- Dismiss it on timeout, same-conversation assistant publication, send replacement, conversation change, or unmount.
- Render a reduced-motion-safe typing bubble and preserve pinned and unpinned scroll behavior.

Exit criteria:

- The indicator never appears before API acceptance or after failed sends.
- It is never persisted as a message and does not use aggregate activity as conversation state.
- Focused policy and browser regressions pass.

## Tests

- Unit coverage for appearance probability and duration bounds.
- One browser regression for accepted-send appearance, assistant dismissal, timeout, failed-send absence, and bottom pinning.

## Validation Commands

```bash
cd frontend
npm run check
npm run test:unit
npm test -- test/chat.spec.ts
npm run check:ui
npm run trim
```

## Overall Exit Criteria

- Accepted web sends can show a subtle randomized typing bubble that disappears naturally without changing backend contracts or durable message state.

## Validation

- Strict application and test TypeScript checks pass.
- All frontend unit tests and all nine chat Playwright scenarios pass.
- UI ownership and unused-code checks pass.
- The browser regression covers animation, bottom pinning, timeout, new-assistant dismissal, old-message updates, and failed-send absence.
