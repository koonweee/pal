# Browser Login Latency Improvements

## Status

In Progress

## Goal

Reduce latency after private PWA interactions and reprofile the same three synthetic login flows against the recorded baseline.

## Current Behavior

- Private credential save and account selection wake the Task to inspect and fill. Verification submission fills directly.
- Every vault lookup performs a remote sync. Shared Task/Worker guidance describes inspection, filling and clicking as separate actions.
- The baseline investigation records 11–20 seconds to first credential fill and 1.5 seconds to verification-code fill.

## Target Data Shape

Reuse existing request kinds, statuses, private endpoints and model-facing arguments. A successful private credential/account submission finishes as `filled`; a saved/selected request whose browser binding is stale retains `saved`/`selected` and notifies the Task to continue from fresh fields. Successful authentication still requires explicit agent verification and login_session completion.

## Milestones

### 1. Reduce critical-path work

Implementation tasks:

- [x] Sync Bitwarden once on lazy vault-service initialization and hourly in the background. Share concurrent syncs, preserve cached reads after background refresh failure and clear timers on shutdown.
- [x] Fill the original validated credential fields directly after private save/account selection, retaining account flow metadata and idempotent submissions.
- [x] Preserve stored credentials/account choice if browser filling cannot complete; notify the Task with accurate filled/fallback instructions.
- [x] Render Login filled for credential requests, retaining Code filled for verification.
- [x] Update shared execution guidance to continue immediately after filled notifications and batch known fill/click actions through existing code mode, conditional on successful filling.

Exit criteria:

- New/updated vault entries are immediately usable without another sync; every fill retains current website and destination checks.
- Direct submissions never click or confirm authentication. Duplicate submissions do not refill, and stale references cannot retarget credentials.
- No new model controls, persistence selectors or live checkbox synchronization are introduced.

### 2. Verify and profile dev

Implementation tasks:

- [x] Extend focused vault, private-fill, idempotency and stale-binding integration coverage; verify credential/code completion labels.
- [x] Update architecture documentation and run relevant backend/frontend checks.
- [ ] Deploy to dev while preserving the execution desktop, then repeat the three synthetic flows with human-style prompts.
- [ ] Compare submission-to-fill/submit times, model round trips, vault syncs and remaining hotspots. Record sampling limits and clean up profiler/fixture resources.

Exit criteria:

- Relevant automated checks pass and all synthetic outcomes or failures have traces.
- The before/after report separates backend-enforced improvements from observed model batching behavior.

## Tests

- Existing vault integration: concurrent initial sync, own-write visibility, hourly background refresh, cached reads after refresh failure and sanitized provider errors.
- Existing login/browser integration: immediate save/selection fill, duplicate submissions, current-origin matching and successful storage with stale-field fallback.
- Shared card component: distinct Login filled and Code filled labels.
- Three actual dev-agent flows cover username/password/verification, rejected-password correction and account selection.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/login.spec.ts
npm run test:e2e -- test/login.e2e-spec.ts test/client-contract.e2e-spec.ts
cd ../frontend
npm run check
npm run test:unit -- test-unit/secure-entry-card.test.tsx test-unit/reload-safety.test.ts
PLAYWRIGHT_CHANNEL=chrome npm test -- test/secure-entry.spec.ts
npm run check:ui
npm run trim
cd ..
./scripts/dev-local rebuild
./scripts/dev-local pwa-up
```

## Overall Exit Criteria

- [ ] All three improvements are implemented, documented, checked and committed locally.
- [ ] Dev profiling reports measured before/after changes and remaining hotspots.
- [ ] Temporary profiler resources and fixture vault entries are removed; dev is healthy.
