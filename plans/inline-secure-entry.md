# Inline Secure Entry and Recovery

## Status

Done

## Goal

Render dense credential/code forms in canonical Task messages and recover stale browser selections automatically. Fix null optional tool arguments while keeping all secret submissions outside model context.

## Current Behavior

- Login tools accept null/omitted optional roles and privately fill explicit model selections.
- Canonical Task messages reference stable cards; the login service owns bound previews, fresh submission IDs and bounded recovery.
- The PWA renders dense inline forms and keeps secret drafts outside messages and persistent browser storage.

## Target Data Shape

- Canonical message metadata carries only secureEntryRequestId. Login requests own status, inspection/card references and bounded recovery attempts.
- Pending requests expose their own preview ID; saved/filled/cancelled/updating/failed states contain no form or preview.
- Private API submission remains the only credential/code transport. Recovery notifications contain metadata only.

## Milestones

### 1. Tool Arguments and Error Classification

Status: validated.

- Accept omitted/null optional roles and account IDs; reject malformed/mixed/duplicate selections.
- Distinguish invalid arguments from stale references; verify the fresh-vault staged flow.

Exit criteria: targeted parser/browser regressions pass.

### 2. Canonical Cards and Recovery

Status: validated.

- Bind requests to inspections and canonical messages. Publish/replace cards idempotently.
- Recover stale codes, reference expiry and restart through Task notifications; cap automatic recovery at two attempts and expose retry after failure.
- Reuse saved credentials and discard submitted OTPs; never retarget an existing draft to new inputs.

Exit criteria: direct API, recovery, retry, cancellation and metadata-only event tests pass.

### 3. Dense PWA Forms

Status: validated and deployed to development.

- Replace the Logins modal with inline cards using existing Pal components.
- Show preview disclosure below the header only on active forms; clear drafts on completion, replacement or unmount and block reload while forms are active.
- Refresh authoritative request state on SSE/reconnect and preserve layout/responsive accessibility.

Exit criteria: focused frontend checks and desktop/mobile browser flows pass.

## Tests

- Null argument regression and invalid-versus-stale errors.
- Fresh vault, staged reuse, OTP private fill, idempotency, bound previews, automatic recovery/restart/timeout/cap/retry/cancellation and secret-free persistence/events.
- Inline credentials/code submission, form replacement, lifecycle states, reconnect and reload safety with multiple cards; desktop/mobile overflow and preview disclosure.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- test/login.spec.ts
npm run test:e2e -- test/login.e2e-spec.ts test/client-contract.e2e-spec.ts
npm run openapi:check
cd ../frontend
npm run api:generate
npm run check
npm run test:unit -- test-unit/secure-entry-card.test.tsx test-unit/reload-safety.test.ts
npm run check:ui
npm run trim
```

## Overall Exit Criteria

- Complete inline flow and bounded recovery work without secrets in messages, notifications or model outputs.
- Superseded modal code is removed; architecture, shared Task/Worker guidance and generated contracts reflect the implementation.
- Relevant checks pass; changes are committed and dev/PWA updated while preserving the execution desktop.

## Validation Results

- Seven browser/parser/provider tests pass, including null optional roles, malformed arguments, stale references and private destination checks.
- Twelve login/API/client-contract integration cases pass, covering fresh-vault staged reuse, direct OTP fill, canonical card reconciliation, bound previews, restart recovery, two-attempt cap, timeout, explicit retry, cancellation and Task completion.
- Five focused frontend unit/policy tests and two desktop/mobile browser flows pass. Drafts survive reconnect/resize, replacement clears old input, previews are request-bound and active-form-only, multiple forms keep reload blocked, and private submissions never enter chat or browser storage.
- Backend build/lint/boundaries/OpenAPI and frontend strict types/generated API/ownership/unused-code checks pass. Drizzle reports no schema drift. First-party contract version 5 is aligned across PWA and iOS headers; native iOS UI is outside this PWA scope.
- Implementation is committed as `39da12e`. Development backend migration and staged PWA update are complete and healthy. All four existing login requests, 15 previews and 727,028 image bytes are preserved; execution-container identity and start time are unchanged. The deployed parser accepts the reproduced null-role input, existing request views remain secret-free, and the staged bundle includes inline cards and recovery. The disposable test database container is removed.
