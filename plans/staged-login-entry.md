# Staged Login Entry

## Status

Done

## Goal

Make phone-, username-, password-, PIN-, and verification-code login stages request only the private values needed by the current page while preserving one remembered website account and clear worker recovery.

## Implemented Behavior

- The interaction worker assigns inspected fields to the existing `username`, `password`, or `code` roles.
- Credential requests render only the roles selected for the current page; single-role stages use a deterministic vault label instead of asking for one.
- Tool schemas and host validation accept only opaque refs from the latest inspection.
- A successful secure fill followed by a failed browser action returns filled status with a separate failed action status.

## Target Data Shape

- `login_requests.fields` remains the source of requested roles; no database migration is required.
- The first-party request response exposes selected credential roles, deterministic user-facing labels, and the active flow account when one exists.
- Vault login items may temporarily contain only the credential fields collected so far and are merged by later stages.

## Milestones

### 1. Staged credential capture

Implementation tasks:

- Render and validate only the selected credential roles.
- Derive concise field labels from inspected metadata.
- Merge later username/password stages into the active vault account.
- Keep verification codes transient and separate.

Exit criteria:

- A phone-only request collects and fills only the phone identifier; a later PIN request collects and fills only the PIN while retaining one vault account.

### 2. Worker contract and recovery

Implementation tasks:

- Require opaque inspection refs in tool schemas and host validation.
- Return a structured partial success when filling succeeds but the requested browser action or resulting inspection fails.
- Clarify authentication guidance for identifier, reusable PIN/password, OTP, refs, and partial-action recovery.

Exit criteria:

- Literal labels/values and all-null selections are rejected before browser work; the worker is told not to refill after an action-only failure.

### 3. Validation and development rollout

Implementation tasks:

- Add focused backend and frontend regressions for phone-to-PIN staging and hardened tool results.
- Regenerate the first-party API contract, run relevant checks, rebuild development, and inspect the running role configuration.

Exit criteria:

- Focused backend/frontend tests, build, lint, contract checks, and development health pass with Terra-medium interaction still configured.

### 4. Production rollout

Implementation tasks:

- Publish immutable AMD64 agent-service and web images with one release identity.
- Preserve paired application state and deploy through the existing Komodo Compose definition.
- Verify migrations, runtime roles, secure browser filling, API/PWA/SSE and desktop routing.

Exit criteria:

- Production runs the staged-entry release with Terra-medium interaction and retained account/profile state.

## Tests

- One backend end-to-end journey covers phone-only capture, active-account merge, PIN-only capture, and vault reuse.
- Existing native tool coverage checks opaque-ref rejection and fill/action partial success.
- One frontend browser journey checks role-specific fields, labels, and submissions.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm run test:e2e -- test/login.e2e-spec.ts
cd ../frontend
npm run api:generate
npm run check
npm run test:unit
npm test -- secure-entry.spec.ts
cd ..
./scripts/dev-local rebuild
./scripts/dev-local status
```

## Validation

- Backend build, lint, OpenAPI check, focused login/skill/tool tests, and the eight-case login E2E suite pass.
- Frontend type, generated API, unit, UI ownership, unused-code, and desktop/mobile secure-entry browser checks pass.
- The rebuilt development stack is healthy. Runtime inspection confirms the interaction worker uses `gpt-6.1-terra` with medium effort and exposes the expected browser, secure-entry, computer, and authentication-skill surface.
- The disposable integration-test database and runtime inspection helper were removed. Protected development volumes and the execution desktop were preserved.
- Production runs release `eb9afb1` through GitOps revision `9df4c1f`; migration, health, HTTPS/PWA release identity, contract 7, SSE, desktop HTTP/RFB and isolated synthetic credential/OTP filling pass.
- Live role inspection confirms Terra medium and the expected secure-entry contract. Two pre-existing pending secure-entry cards survived the restart and were not opened or modified during acceptance.

## Overall Exit Criteria

- Staged identifiers and reusable secrets merge into one vault account without entering model context or application storage.
- The inline UI matches the current website stage and verification codes remain transient.
- Invalid refs and post-fill action failures give precise, non-secret recovery signals.
- Documentation, generated API types, tests, and the development runtime reflect the implemented behavior.
