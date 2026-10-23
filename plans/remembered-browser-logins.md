# Remembered browser logins

## Status

In Progress

## Goal

Reuse the last successful account by default, honor explicit different/new-account requests, and remember a per-origin Keep me signed in preference from private entry or user text.

## Current Behavior

Secure entry collects credentials privately. Caller-owned flow metadata retains staged selections, site metadata retains successful accounts and session intent, and the agent verifies website responses.

## Target Data Shape

- `login_sites`: credential origin, last successful vault item ID and Keep me signed in preference (initially false).
- `login_flows`: caller-owned account selection and preference, retained for 24 hours across login stages/restarts; confirmation is idempotent.
- `login_requests.keep_me_signed_in`: checkbox state bound to the request. The save API accepts an optional boolean for existing-client compatibility.
- No credentials or codes enter these records or model context. Existing accounts are not backfilled as successful from fill/save history.

## Milestones

### 1. Remember successful accounts and session intent — validated

Implementation tasks:

- Replace transient selections with persisted flow metadata and per-origin defaults.
- Select explicit account, current flow, last successful matching account, then sole matching account; require a choice if still ambiguous.
- Add `login_session` with separate complete/preference actions for agent-verified success and session intent. Save/fill alone never promote an account. Duplicate completion cannot overwrite a more recent successful choice.
- Add the same optional Keep me signed in argument to secure fill/request and session updates for text instructions.

Exit criteria:

- Confirmed choices survive restarts and flow changes; rejected or unconfirmed choices do not replace successful defaults.
- Existing matching, field validation and new-account entry behavior remain intact.

### 2. Private checkbox and guidance — validated

Implementation tasks:

- Add the remembered checkbox to credential forms, preserving drafts across reconnects/resizes.
- Return session intent to the agent through fill results and completion notifications.
- Guide Task/Worker to reuse current sessions, honor overrides, inspect website persistence controls and verify success before confirmation. No site-specific selectors or session guarantee.
- Generate first-party API artifacts and update architecture documentation.

Exit criteria:

- Form and text preferences converge on the same stored intent; codes remain transient and do not show the checkbox.

### 3. Verify and deploy to development

Implementation tasks:

- Extend existing login integration and responsive UI regressions.
- Run relevant build, lint, API, frontend and architectural checks.
- Deploy backend/migration and PWA, preserving the execution browser and private data.

Exit criteria:

- Focused checks pass and deployed services are healthy.

## Tests

- Synthetic browser/API flow: automatic reuse across callers/restart, explicit switching, confirmation-only promotion, idempotence, deleted/nonmatching default fallback and private checkbox/text persistence.
- Existing code/recovery and secret-free output coverage.
- Card unit and responsive browser checks: remembered checkbox, private submission, draft preservation and absence on OTP forms.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/login.spec.ts
npm run test:e2e -- test/login.e2e-spec.ts test/client-contract.e2e-spec.ts
npm run openapi:check
cd ../frontend
npm run check
npm run check:ui
npm run test:unit -- test-unit/secure-entry-card.test.tsx
PLAYWRIGHT_CHANNEL=chrome npm test -- test/secure-entry.spec.ts
npm run api:check
npm run trim
```

## Overall Exit Criteria

Login choice defaults require no configuration. Explicit overrides work. The agent receives remembered session intent and records verified success without receiving secrets. Existing sessions and the execution desktop persist through development deployment.

## Validation Progress

- Passed backend build, lint and adapter boundaries; seven secure-field regressions and 13 login/client-contract integration cases on a fresh migration database.
- Passed frontend type, ownership, generated API and unused-code checks; four card/reload unit cases and two responsive browser flows.
- Schema generation reports no drift. First-party API changes are additive: the save boolean is optional for existing clients.
- Fixed a test-fixture race found during validation: detached fake replies now settle before database truncation/shutdown.
- Per user direction, an open form owns its checkbox draft; text intent does not synchronize into an already-open form.
- All 26 focused tests and relevant build, lint, type, ownership, generated API and unused-code checks pass.
- Remaining: local commit, development migration/backend/PWA deployment and preservation/health checks.
