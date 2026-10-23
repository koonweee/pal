# Secure entry in Main

## Status

Done

## Goal

Let users complete secure entry from Main or the owning Task, and have Task agents request corrected credentials after an explicit website rejection. Deploy the verified update to the development PWA.

## Current Behavior

- Canonical secure-entry messages belong to Tasks and are absent from Main history.
- The login API already supports replacement after a credential fill attempt.
- The current Apple attempt reported rejected credentials without immediately opening a replacement form.

## Target Data Shape

Secure-entry Task messages use the existing `mainVisible` flag. The same message and request appear in both conversations; Task ownership and completion notifications stay unchanged. A data migration promotes existing cards.

## Milestones

### 1. Shared cards — validated

Implementation tasks:

- Derive Main visibility from trusted secure-entry metadata and promote existing cards.
- Render the same card in Main and Task using the standard message maximum width.
- Keep cached Main history display-only until authoritative reconciliation.

Exit criteria:

- Main and Task show the same request and completion state.
- Cached cards do not fetch private request state or mount forms.

### 2. Rejected credentials — validated

Implementation tasks:

- Update shared Task/Worker guidance to request corrected credentials after explicit rejection, using fresh inspection.
- Preserve reuse across username/password stages and distinguish other sign-in obstacles.
- Inspect live login timing and prioritize the post-submission fill sequence in shared guidance.
- Verify existing replacement behavior and focused frontend/backend regressions.

Exit criteria:

- Replacement remains available after attempted credentials; unused saved credentials still suppress redundant prompts.
- Guidance makes rejection handling proactive without adding tools or parameters.

## Tests

- Extend login integration coverage for shared message identity, Task-only ordinary messages and existing-card migration.
- Extend responsive browser coverage for Main entry, Task navigation, shared completion, live updates and cached-form gating.
- Run focused login unit/integration tests, frontend checks and ownership checks.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm run test:e2e -- test/login.e2e-spec.ts test/client-contract.e2e-spec.ts
cd ../frontend
npm run check
npm run check:ui
PLAYWRIGHT_CHANNEL=chrome npm test -- test/secure-entry.spec.ts
```

## Overall Exit Criteria

- Users can act on secure-entry cards in either conversation without duplicating requests or changing Task ownership.
- Credential values stay in private submission paths and component memory.
- Relevant checks pass and changes are committed locally. The development PWA is updated after validation.

## Current Attempt Findings

- Apple rejected the first submitted login; private credential filling succeeded. The model reported rejection and waited until the next turn to open a replacement form.
- Corrected credentials and the verification code completed sign-in.
- The first credential notification was accepted at 06:44:35 UTC; inspection completed at 06:44:48 and the first fill at 06:45:29. Two extra browser reads occurred between inspection and fill. The corrected attempt was notified at 06:48:56 and filled at 06:49:15.
- Notification delivery is immediate after save; the ten-second sweep is a retry path. Stored tool completion times show agent/browser round trips, but do not separate model processing from each tool's runtime. No fixed sleep was identified. No model/provider change or automatic credential submission was added.

## Validation

- Passed: 7 backend login regressions, 12 login/API client integration cases, 7 frontend unit/policy cases and 2 responsive browser flows (900px and 390px).
- Passed: backend build/lint/boundaries; frontend type checks, ownership, unused-code and generated API checks.
- Deployed implementation `7ff2d2b` with `./scripts/dev-local rebuild` and `./scripts/dev-local pwa-up`. The first PWA command encountered a transient proxy startup race; the retry succeeded after health checks passed.
- Verified the staged PWA at mobile width: three existing Main cards, navigation to the owning Task and back, and no horizontal overflow. Tailnet and local health checks pass.
- Preserved seven requests, 24 inspections and 1,196,508 preview bytes. The execution desktop container ID and start time are unchanged. All three canonical cards are now Main-visible.
- No remaining implementation or deployment work.

## Card Presentation

Main and Task use identical secure-entry cards without Task navigation inside the card. Cards retain their compact preferred width and inherit the standard message maximum width. Removed the unused attribution props and styles. Responsive coverage compares rendered card bounds with ordinary messages in both conversations, including a narrow desktop pane. The card unit test waits for asynchronous reload-safety cleanup before asserting the released state.

Validated with frontend type/ownership/unused-code checks, three card unit tests and two responsive browser flows. Deployed `8ac1e1d` with `./scripts/dev-local pwa-up`; a mobile smoke check confirms identical markup for three cards in Main and Task, no Task links and no horizontal overflow.
