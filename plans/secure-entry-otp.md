# Secure Entry and Verification Codes

## Status

Done — implementation, automated checks and development update validated. Real-account OTP completion remains an operator acceptance check.

## Goal

Collect verification codes through the PWA and fill them without model exposure. Generalize fill/request tools, reuse saved credentials across login stages, and show one current masked preview.

## Current Behavior

- LoginService provides deterministic browser inspection and Bitwarden filling, durable request metadata and private previews.
- The PWA displays one current masked preview and requests complete credentials once. Shared execution guidance and the request service direct later stages to the saved account.
- Verification controls support code-only PWA collection and immediate direct filling; generated vault TOTP remains deferred.

## Target Data Shape

The current input-selection contract is specified in [Model-Selected Secure Fields](model-selected-secure-fields.md).

- Requests have a backend-selected kind: credentials or code. Code requests retain only target/worker references and expire after ten minutes; codes are never persisted.
- Inspections expose opaque input refs and HTML metadata. The model assigns username/password/code roles through the shared fields contract; selected refs bind actual DOM handles.
- Tools: login_inspect(), secure_fill({fields, accountId?}), secure_entry_request({fields}). Vault TOTP generation is deferred; code filling reports input_required.
- The PWA submits codes directly to a dedicated no-store endpoint; the backend fills immediately and emits metadata-only completion.

## Milestones

### 1. Browser and Request Workflow

Status: validated.

- Detect and mask semantic verification fields and split digit groups, revalidate bindings before filling, and sanitize failures.
- Generalize request/fill contracts. Prefer the selected matching account and redirect unnecessary requests to saved credentials before those fields have been tried.
- Add expiring code-request metadata and direct fill on submission. Preserve credential save/cancel behavior and notification retries.

Exit criteria: synthetic single/split code fill works, wrong/stale/ambiguous targets fail, repeated stages reuse the stored login and codes never enter results or persistent data.

### 2. PWA and Agent Guidance

Status: validated.

- Render a code-only form with transient protected drafts, submit/cancel, and one current preview.
- Explain complete-login collection, reuse, PWA location, verification entry and completion behavior in shared guidance/tool descriptions.
- Update API contracts and architecture.

Exit criteria: focused component/API checks validate the forms and single preview; obsolete model tool names are removed.

### 3. Verification and Development Update

Status: validated.

- Run focused backend/browser/API and frontend tests, build/lint/contract checks.
- Update the development backend and staged PWA, preserving the execution profile. Verify synthetic real-browser filling and public Apple verification-field structure without reading secrets.
- Review and commit the completed diff.

Exit criteria: automated checks and dev smoke pass; remaining human acceptance is reported.

## Tests

- Extend existing browser coverage for single and split codes, ambiguity, field mutation, stale/owner bindings and masked previews.
- Extend API coverage for staged credential reuse, direct code submission, retries, expiration and secret-free metadata/notifications.
- Extend LoginPanel component coverage for one preview, code-only submission, clearing drafts and errors.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- test/login.spec.ts
npm run test:e2e -- test/login.e2e-spec.ts
npm run openapi:check
cd ../frontend
npm run check
npm run test:unit -- test-unit/login-panel.test.tsx test-unit/reload-safety.test.ts
npm run api:check
npm run check:ui
npm run trim
```

## Overall Exit Criteria

- Stored credentials are reused across stages; one relevant inspection is visible.
- PWA code entry fills only freshly validated verification targets, with no code in vault/database/model output.
- Relevant checks pass, documentation matches behavior, dev is updated and the diff is committed.

## Validation Results

- Browser/provider checks cover single/split filling, masking, ownership, freshness and invalid destinations. Current model-selection checks are recorded in the linked plan.
- Two PostgreSQL-backed API cases pass against an isolated test database. The staged flow saves once, refuses unnecessary collection on the password step, reuses the stored account, allows replacement after a fill attempt, fills codes on direct submission, acknowledges repeat submissions without refilling, expires requests and keeps values out of metadata/results/events/notifications.
- Frontend strict checks and three focused component/reload-safety tests pass. Coverage includes one preview, code-only entry without vault setup, error retry, draft clearing and no browser storage writes. API generation/check, UI ownership and unused-code checks pass.
- Backend build, lint, adapter boundaries, generated OpenAPI check and diff whitespace check pass.
- The Apple Store verification iframe has six native inputs with accessible digit labels. Current role/group selection belongs to the model. No real code was read or entered during verification.
- Development backend migration/rebuild and staged production PWA build/update completed. The persistent execution container was retained. A synthetic execution-Chrome smoke validates bound worker tabs, username/password and split-code filling, unrelated-field isolation and secret-free results.
- Human acceptance: resume the Apple sign-in task after the backend restart and complete a fresh OTP through Logins. Full real-account authentication is not asserted. Production deployment and vault TOTP generation are outside this change.
