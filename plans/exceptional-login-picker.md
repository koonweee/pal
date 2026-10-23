# Exceptional Login Account Picker

## Status

Done

## Goal

Offer saved-account selection when login matches are ambiguous or the user asks to switch accounts. Routine login reuses the current flow, last successful matching account or sole match automatically.

## Current Behavior

- LoginService selects remembered accounts and publishes canonical secure-entry cards in Main and Task.
- Ambiguous matches and explicit switch requests open the account picker. Explicit credential entry opens username/password collection; its Save to control chooses a vault entry to create or update.
- SecureEntryCard owns transient drafts and uses private HTTP endpoints. Each form owns its Keep me signed in checkbox.

## Target Data Shape

- Add `login_requests.choose_account`, default false, and a `selected` completion status. Retain credential/code request kinds and the existing card identity, expiry and notification paths.
- Extend `secure_entry_request` with optional nullable `chooseAccount`. The host opens a picker only when matching saved accounts exist; code entry cannot request account selection.
- Extend the private request view with `chooseAccount`. Add `POST /login/requests/:id/select` accepting a matching account ID and optional Keep me signed in preference. Selection records caller-owned flow metadata; it neither fills nor confirms successful authentication.

## Milestones

### 1. Account selection workflow

Implementation tasks:

- [x] Add metadata migration and transactional, idempotent account selection with fresh vault matching against the request origin.
- [x] Open the picker automatically from ambiguous secure_fill calls; retain explicit account selection and automatic reuse order.
- [x] Add the request flag, private selection endpoint, generated contracts and shared Task/Worker guidance.

Exit criteria:

- Ambiguous matches and explicit switch requests publish a picker; normal remembered/sole-account fill publishes no picker.
- Account selection survives restart, preserves website matching and does not promote the last successful account.
- Tool results, canonical messages, events and database metadata contain no credentials.

### 2. Dense shared card

Implementation tasks:

- [x] Render saved accounts, Keep me signed in, Continue, Use a new account and Cancel in the existing Main/Task card.
- [x] Open the existing form locally for a new account, with Back to the picker. Preserve correction entry and its Save to control.
- [x] Keep preview disclosure on forms only, standard message width and local checkbox drafts.
- [x] Update current architecture documentation and run focused verification.

Exit criteria:

- Existing-account selection and new-account saving use their private endpoints, refresh both conversation views and leave compact completion cards.
- Main and Task share the same rendering; touch layouts fit and existing credential/code entry remains functional.

## Tests

- Extend PostgreSQL/browser integration coverage for automatic ambiguity, explicit picker, invalid account, idempotent selection, restart continuity, new-account saving from picker, cancellation and unchanged remembered defaults.
- Add one focused component test for picker navigation/private selection and local checkbox state.
- Extend the existing wide/narrow Main/Task browser test for account selection and new-account entry; reuse existing form/recovery assertions.

## Validation Commands

```bash
cd backend
npm run db:generate -- --name=exceptional_login_picker
npm run build
npm run lint
npm run test:e2e -- test/login.e2e-spec.ts test/client-contract.e2e-spec.ts
npm run openapi:check
cd ../frontend
npm run api:generate
npm run check
npm run test:unit -- test-unit/secure-entry-card.test.tsx test-unit/reload-safety.test.ts
PLAYWRIGHT_CHANNEL=chrome npm test -- test/secure-entry.spec.ts
npm run check:ui
npm run trim
```

Database tests use a disposable PostgreSQL database. Contract generation runs after backend compilation. Dev deployment follows passing checks and preserves the execution desktop.

## Overall Exit Criteria

- [x] Exceptional account selection works in the inline PWA card without interrupting ordinary automatic login reuse.
- [x] New-account and correction forms, OTP, cancellation and recovery retain their current behavior.
- [x] Selection never exposes secrets or marks authentication successful; only verified login completion updates the remembered account.
- [x] Focused checks pass, documentation matches implementation and completed changes are committed locally.

## Validation

- All 27 focused tests pass: seven browser/vault guards, thirteen login/client-contract integration tests, five card/reload-safety tests and two wide/narrow Main/Task browser workflows.
- Backend build, lint, adapter boundaries, OpenAPI consistency and migration drift checks pass. Frontend type, generated API, ownership and unused-code checks pass.
- Integration tests use a disposable PostgreSQL container and synthetic browser pages. Selection, new-account saving, notification delivery, cancellation and automatic reuse are verified without real account credentials.
- Dev backend and staged PWA updated with `./scripts/dev-local rebuild` and `./scripts/dev-local pwa-up`. Health checks pass and connected clients were notified. The execution container identity/start time and all ten login requests and thirty-seven stored previews remain unchanged. The disposable test database was removed.
