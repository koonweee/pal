# Secure Payment Entry

## Status

Complete

## Goal

Extend the existing inline secure-entry workflow to Bitwarden cards and transient payment details, preserving login behavior and keeping secrets outside model output and application storage.

## Current Behavior

- Secure entry supports credentials and verification codes.
- LoginBrowser binds opaque references to live HTTPS inputs; BitwardenService owns vault access.

## Target Data Shape

- Existing secure requests gain kind `card`; fields contain payment roles and opaque references only.
- Private card submissions use the first-party API. Saved-card metadata contains ID, label, brand and last four digits.

## Milestones

### 1. Shared secure entry

- [x] Extend field validation, hosted-frame and expiry-select filling, vault card operations, request lifecycle and private API.
- [x] Extend the existing UI and applicable worker guidance.

Exit criteria: saved cards, one-time entry and missing fields use the existing lifecycle without exposing secret values.

### 2. Validation and dev acceptance

- [x] Validate focused backend and frontend tests, types and contracts.
- [x] Rebuild dev and exercise synthetic saved-card, new-card, missing-details and stale-binding scenarios.
- [x] Remove test resources and commit validated changes.

Exit criteria: synthetic scenarios pass, existing login coverage passes, and dev remains healthy.

## Tests

- Field roles, cross-frame ownership, dropdown expiry and stale navigation.
- Private API idempotency, opt-in vault saving and secret-free state/output.
- Inline card selection, transient entry and completion.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- test/login.spec.ts
npm run test:e2e -- test/login.e2e-spec.ts
cd ../frontend
npm run check
npm run test:unit
```

## Overall Exit Criteria

- Payment entry works in dev with synthetic data, and login behavior remains intact.
- Secrets are absent from persisted requests and model output; filling does not submit purchases.
- Documentation, API contracts and plan status reflect validated behavior.

## Validation

- Backend build, lint/boundary checks and generated OpenAPI verification pass. First-party contract is 7; migration 0027 admits card requests.
- Nine browser/vault tests and sixteen login/payment/client-contract API tests pass.
- Frontend types and ownership checks pass. All 32 existing unit tests pass; the final required-field regression brings secure-entry coverage to six passing tests. Both 390px and 900px browser scenarios pass.
- Dev backend and staged PWA are rebuilt and healthy. The execution desktop remains running.
- The dev execution-browser smoke passes saved-card selection, hosted frames, month dropdown/two-digit year, transient entry, opt-in save/idempotency, CVV-only entry, stale recovery, secret-free records/output and no purchase submission. Vault operations use a temporary synthetic Vault Management API, without reading or writing real cards.
- The reusable smoke uses a separate `pal_payment_smoke_test` database so normal dev agents cannot observe its requests. Initial fixture tasks and generated records were removed. Both disposable databases (about 18 MB total), fixture browser groups and temporary vault servers are removed.
- Active dev images and persistent volumes are retained; superseded task images are absent. Shared build cache remains intact (about 14.2 GB).

To repeat synthetic dev acceptance, create `pal_payment_smoke_test` in the dev PostgreSQL container, run `docker exec -i -w /opt/pal pal-dev-split-agent-service-1 node --input-type=module < backend/scripts/payment-entry-smoke.mjs`, then drop that database.
