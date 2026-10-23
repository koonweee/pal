# Browser Login Latency Improvements

## Status

Done

## Goal

Reduce latency after private PWA interactions and reprofile the same three synthetic login flows against the recorded baseline.

## Current Behavior

- Private credential save, account selection and verification submission fill the bound browser fields directly, then notify the Task. Stale targets preserve saved credentials or account selection for recovery.
- Bitwarden syncs on first use and hourly in the background. Pal writes are immediately available through its normal read-before-write workflow.
- Shared Task/Worker guidance batches known fill/click actions and continues from successful private fills without redundant confirmation.

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
- [x] Deploy to dev while preserving the execution desktop, then repeat the three synthetic flows with human-style prompts.
- [x] Compare submission-to-fill/submit times, model round trips, vault syncs and remaining hotspots. Record sampling limits and clean up profiler/fixture resources.

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

- [x] All three improvements are implemented, documented, checked and committed locally.
- [x] Dev profiling reports measured before/after changes and remaining hotspots.
- [x] Temporary profiler resources and fixture vault entries are removed; dev is healthy.

## Verification

- All 27 focused tests pass: seven browser/vault tests, thirteen login/client-contract integration tests, five card/reload-safety tests and two desktop/touch browser workflows. Backend build/lint/boundaries/OpenAPI and frontend type/ownership/unused-code checks pass.
- The mobile browser check now waits for the picker entrance animation to finish before asserting its 44-pixel rendered target height.
- No schema migration, private API arguments or model-facing parameters were added. Private credential completion uses the existing filled status and an accurate Login filled label.
- Dev is running the updated backend and PWA. A concurrent routed-network refactor initially prevented Compose from recreating the existing network. Profiling deployment uses an isolated committed Compose/frontend snapshot and preserves the running execution container. The subsequent routed-network deployment remains separate work.

## Profile Results

Same natural prompts, actual dev Main/Task, gpt-6.1-sol at medium effort, synthetic HTTPS routes and real private PWA forms. Times end when the website renders its authenticated page; subsequent agent verification/reporting is excluded.

| Flow | Baseline | Updated | Reduction | Task model requests before → after |
| --- | ---: | ---: | ---: | ---: |
| Apple-style username → password → six-digit code → Trust | 109.9s | 68.9s | 37% | 17 → 13 |
| Amazon-style username → rejected password → correction | 107.7s | 65.3s | 39% | 16 → 11 |
| Combined form with two ambiguous saved accounts | 52.5s | 32.3s | 39% | 9 → 4 |

All three flows reached authenticated pages with valid fixture values. Apple selected Trust, Amazon honored Keep me signed in, and the combined flow selected the user's Work account through the inline picker.

| Private PWA submission | First fill before → after | Website submission before → after |
| --- | ---: | ---: |
| Apple credentials, initially username-only | 15.9s → 1.18s | 38.2s → 17.1s |
| Apple verification code | 1.50s → 1.68s | 9.61s → 6.14s |
| Amazon initial credentials | 15.1s → 1.12s | 37.5s → 15.3s |
| Amazon corrected credentials | 20.1s → 1.37s | 23.7s → 4.97s |
| Account selection | 11.2s → 1.16s | 15.0s → 5.73s |

First fill on username-only pages means the username field. Website submission measures the later password submission and includes intervening navigation and model decisions. OTP already filled directly before this work, so its fill latency is essentially unchanged.

- Warm comparison windows contain zero remote vault syncs versus 32 in the baseline. A separate cold-start attempt performs one initial sync (3.0s); its first inspection takes 12.7s including CLI startup/unlock. Hourly refresh remains covered by the focused test rather than a one-hour live wait.
- Both multistep flows batch password filling and the known submit click in code mode. The click starts approximately 3ms after secure_fill returns, with no intervening model request. This is observed guidance adherence; direct private filling is enforced in service code.
- Private HTTP responses now include browser filling and take 1.15–1.69s. Notification dispatch starts within approximately 6–9ms of service completion. There is no extra polling delay.
- An additional explicit account-switch run also succeeds: selection-to-fill 1.46s and selection-to-website-submit 5.44s.

### Remaining Hotspots

1. Model round trips dominate: median Task request 3.89s, accounting for 58–76% of each flow's elapsed time. Task context ranges from 29k–51k input tokens. Initial routing takes 6.2–12.4s before the first Task model request; Main context is 129k–136k tokens, with some cache misses. These are observed costs, not proof that context size causes the full delay.
2. Multistep navigation still needs model judgment after the immediate username fill. Apple/Amazon take 17.1/15.3s from private credential submission to password submission. The combined form and password correction need only 5.7/5.0s. Further combining inspection and preparation of known actions is the next candidate to measure.
3. Cold vault startup remains a separate 12.7s first-inspection cost. Prewarming could move this outside the first login request if first-use latency matters.
4. Warm inspection is about 1.5s end to end. Actual browser inspection is about 0.32s, vault matching median 0.46s, ordinary browser commands median 0.24s and execution calls median 0.08s. These are smaller than model round trips. Status-setting calls after entry requests add another possible turn to examine.

### Sampling and Artifacts

One completed comparable sample per flow; provider timing and accumulated conversation context vary. Two initial attempts hit test-driver locator/removal races. The driver now follows private request IDs and records successful POSTs before advancing. The final ambiguity sample confirms both seeded accounts are visible before starting. An earlier sample exposed only one account and is excluded from the paired account-picker comparison. Seeding now follows Pal's read-before-write sequence; a separate dummy-entry diagnostic confirms both own writes are visible without syncing.

Metadata-only local artifacts:

- `.local/login-latency-improved/comparison.html`: before/after tables.
- `.local/login-latency-improved/report.html`: interactive scenario timelines.
- `.local/login-latency-improved/chrome-trace.json`: Chrome/Perfetto trace.
- `.local/login-latency-baseline/`: original baseline.
- `.local/login-latency-picker/`: explicit account-switch follow-up.

Reports render correctly in Chrome, including scenario filtering. Profiler methods and fetch are restored, the debugger is closed, injected runtime files are removed, and checks across all 24 fixture hosts find zero remaining dummy vault entries or unfinished secure-entry requests. Fixture tabs are closed. Dev services are healthy; the execution desktop retains its original container and start time.
