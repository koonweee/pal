# Suggested Replies

## Status

Done

## Goal

Main and Task can offer up to three 44px reply pills beneath a message in the PWA. Selecting a pill immediately sends its exact text as a normal user message and removes the options across clients.

## Current Behavior

- Main publishes through `sendToUser`; Task uses structured public output.
- Chat submission owns optimistic sends, receipts, retries, persistence, and agent handoff.
- Public messages carry agent-selected suggestions; selecting one atomically creates a user message and clears the source options.

## Target Data Shape

- Assistant messages expose `suggestedReplies: string[]`, empty after selection.
- Message submissions optionally identify a source message and suggestion index; the server resolves the text.
- Selection clears suggestions and creates the user message atomically, with existing idempotency and versioned SSE updates.

## Milestones

### 1. Agent output and canonical selection

Done.

Implementation tasks:

- Replace legacy actions with validated suggested replies in persistence and first-party contract v6. Remove unused native action stubs and align its request version.
- Add one shared Main/Task instruction and preserve suggestions on the final bubble of grouped output.
- Atomically consume a suggestion and submit through the normal agent handoff.

Exit criteria:

- Output validation, concurrent selection, idempotent retry, chat scope, and SSE persistence tests pass.

### 2. Chat UI and development acceptance

Done.

Implementation tasks:

- Render 44px pills beneath the latest assistant message.
- Reuse optimistic submission and animation while preserving composer state.
- Reconcile selection across clients and retain failed-send retry behavior.
- Fade and collapse consumed options using shared motion timings; disable interaction immediately and respect Reduce Motion.
- Rebuild dev and validate actual agent suggestions and selection across browser clients.

Exit criteria:

- Frontend checks and focused browser tests pass; live dev selection removes pills from both clients and produces one user message.

## Tests

- Extend public-output coverage for limits and final-bubble placement.
- One service/API integration flow for concurrent selection, retry, scope validation, events, and continuation.
- Focused browser scenarios for optimistic send/animation, preserved composer state, retry, and remote/reloaded consumption.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- test/public-output.spec.ts test/services.spec.ts test/task-agents.spec.ts
npm run test:e2e -- test/suggested-replies.e2e-spec.ts test/chat.e2e-spec.ts test/openapi-contract.e2e-spec.ts test/client-contract.e2e-spec.ts
cd ../frontend
npm run check
npm run check:ui
npm run trim
npm test -- test/suggested-replies.spec.ts test/chat.spec.ts
cd ..
./scripts/dev-local rebuild
./scripts/dev-local pwa-up
```

## Validation Results

- Backend build, type-aware lint, adapter boundaries, and OpenAPI synchronization pass.
- Nine focused service/output/runtime tests and 21 API/end-to-end tests pass, including Main/Task publication, concurrent selection, separate SSE clients, and handoff retry after consumption.
- Frontend strict type checks, ownership checks, unused-code checks, three cache tests, and all three suggested-reply browser tests pass, including exit collapse and Reduce Motion. Production PWA builds successfully.
- Live dev acceptance passed between the Vite UI and staged PWA in separate Chrome contexts: actual agent-generated suggestions, 44px pills, optimistic bubble, preserved draft, synchronized removal with exit transitions on both clients, reload, and an idempotent replay returning the same message. Evidence: `.local/suggested-replies/dev-acceptance.json` and screenshots beside it.
- Broader chat tests expose intermittent keyboard-resize and pagination anchor failures. Both reproduce on an untouched HEAD snapshot; feature-specific tests pass.
- Native client compatibility cleanup passes the simulator-target build; native suggestion controls are outside this PWA feature.

## Overall Exit Criteria

- Main and Task decide when to include suggestions with one shared policy.
- One selection creates one normal user message and durably clears the source options.
- All connected clients reconcile through SSE; snapshots retain consumption after reload.
- Optimistic sending, composer preservation, and targeted checks pass in dev.
