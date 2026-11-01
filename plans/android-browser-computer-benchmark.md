# Android, Browser and Computer Comparison

## Status

In Progress. The 27 warm Amazon/Facebook samples are complete and reviewed; all nine initial Apple checks have recorded outcomes, but authenticated Apple comparison needs login setup. Both benchmark runners passed cleanup audit. See [results and evidence](android-browser-computer-benchmark-results.md).

## Goal

Measure when Pal should prefer Android apps, browser automation or desktop computer interaction, using correctness, human intervention, latency and model usage. Treat incomplete retrieval as outcome evidence and distinguish setup dependencies from failures in eligible tasks. Live logins are setup only; the user does not want repeated login comparisons or sign-outs. Earlier staged secure-fill results remain separate evidence.

## Current Behavior

- Task coordinates with `gpt-6.1-sol` medium and delegates UI work to an interaction worker using `gpt-6.1-terra` medium.
- Ordinary Android interaction uses Mobile MCP; the Android helper supplies private field inspection/fill. Installed apps require no trust registration. Observations are unmasked.
- Browser automation and computer use share persistent execution Chromium cookies. Native Android apps and Android Chrome have their own sessions.
- Shared method/recovery policy lives in `backend/src/agent/instructions/interaction-methods.md`. Production prompts remain unchanged during collection and pending review of recommendations.
- [Android Secure Fill](android-secure-fill.md) passes development acceptance. The historical matched fixture completes username, password, OTP and one saved draft in all nine samples, with 27 actual private fills.

## Protocol and Evidence

### Current matrix

| Case | Methods | Repetitions per method | Required outcome |
| --- | --- | ---: | --- |
| Amazon latest order | Browser, computer, native Android | 3 | Date, first item and delivery/status from the current first order; no addresses, payment details, full order IDs or mutations |
| Amazon products | Browser, computer, native Android | 3 | Sony WH-1000XM5 Black and Bose QuietComfort Headphones Black; exact variant, new one-time price, availability and links; no cart/checkout |
| Facebook public event | Browser, computer, native Android | 3 | Identical event name, date/time with timezone and location; no RSVP, posts or messages |
| Apple Store account access | Browser, computer, Android Chrome | 3 | Authenticated account destination; no purchase or account changes |

The main matrix has 27 cells. Apple has nine cells in a separate final run. Facebook uses [Quarry Lakes 25th Anniversary Celebration](https://www.facebook.com/events/1711829129869706/). Apple uses `https://www.apple.com/shop/account/home`; the Android method uses `com.android.chrome` rather than a native Apple Store app.

Rotate method order across repetitions and collect sequentially. Freeze models, effort, case prompts, role/skill guidance, tool inventories, repository source hashes and container images. Force one UI method per sample; service/API/search/shell/code-mode bypasses are unavailable. Preserve failed attempts and the original raw rows. Review actual UI evidence independently before counting success.

Use existing sessions and preserve profile/app data. Do not sign out, fill credentials or wait for user input during warm samples. Stop at authentication challenges and queue setup after independent work. Reuse saved credentials only in separate dev PWA setup; the user handles missing credentials or verification through secure entry, never benchmark chat.

Each sample has a 600-second deadline. Measured elapsed includes Task planning, delegation, worker interaction and final answer. Setup and explicitly measured human wait are separate. Browser pages are opened before timing; Android navigation occurs inside the measured task. Report this starting-state difference and three-repetition uncertainty. Include failed elapsed times in all-run medians and distinguish successful-run medians.

### Local artifacts

Gitignored datasets under `.local/android-browser-comparison/` contain frozen config/protocol/environment, incremental traces, original outcomes, reviews, reports and cleanup/source audits. No secret values belong in exported evidence. Temporary screenshots used for independent review are removed afterward; public product excerpts and bounded findings remain.

- `main-reset-verified`: historical fixture and anonymous-web baseline, 36 scheduled cells, 15 executed and 21 setup deferrals.
- `warm-retrieval`: current 27-cell Amazon/Facebook matrix; 23 passes and four incomplete results, all reviewed.
- `warm-apple`: initial nine Apple checks; eight authentication dependencies and one error before measured execution. No eligible authenticated retrieval ranking.
- `warm-apple-authenticated`: planned separate collection after Apple setup. Preserve the initial outcomes rather than overwriting them.

## Milestones

### 1. Validate prerequisites and freeze cases — complete

Implementation tasks:

- Reuse validated native/WebView Unicode fill, OTP, saved-vault reuse, stale-reference and lifecycle acceptance.
- Verify the same Task/worker models and method boundaries.
- Select exact Amazon products, order fields, Facebook event and Apple URL.
- Prepare sessions through normal dev PWA tasks; record setup separately.

Exit criteria:

- Secure-fill acceptance precedes collection; concrete case requirements, capability gates and setup dependencies are recorded.

### 2. Extend the existing harness — complete

Implementation tasks:

- Reuse the existing runner, private-entry services, ownership and telemetry.
- Verify real synthetic private HTTP filling and native fixture reset across three methods.
- Add warm-session scheduling without sign-outs or credential-fill scoring requirements.
- Add Android Chrome to the separate Apple matrix and test scheduling/arm constraints.
- Preserve incremental evidence and require source/image consistency for resume.

Exit criteria:

- Three-arm real fixture acceptance passes. The warm dry run contains 27 main cells and nine separate Apple cells. Focused harness tests pass; original results remain immutable.

### 3. Collect and review live outcomes — main complete; Apple setup pending

Implementation tasks:

- Collect and independently review all 27 main samples.
- Execute Apple last and retain explicit authentication/setup outcomes.
- Complete separate Apple desktop and Android Chrome login setup, then collect the authenticated Apple matrix in a new dataset.
- Preserve all failures, manual dependencies and timing/usage limitations.

Exit criteria:

- Every scheduled cell has a reviewed outcome or explicit setup/unavailable reason. Eligible live successes are supported by actual UI observations. Apple authenticated access is either measured after setup or clearly remains pending user action.

### 4. Report recommendations and clean up — in progress

Implementation tasks:

- Report correctness before latency, with per-method ranges, successful/all-run medians and complete/unknown usage.
- Separate historical secure-fill reliability, login setup and warm retrieval.
- Recommend conditional method priorities without introducing an unsupported universal winner; keep service tools/APIs first.
- Audit exact benchmark-owned tasks, scratch databases, copied scripts, fixture installation and locks. Restore tracked phone settings and preserve personal app/profile data and protected dev resources.
- Keep sanitized audit evidence and commit harness/report changes locally. No production rollout.

Exit criteria:

- Reproducible reviewed results support specific recommendations; unresolved comparisons are explicit. Resource cleanup and source provenance pass audit.

## Tests

- Existing protocol/scoring tests cover arm isolation, rotation, actual private filling and independent live review.
- Warm scheduling regression checks 27 main cells, session preservation, the canonical Facebook event and nine separate Apple cells including Android Chrome.
- Reuse secure-fill lifecycle and real-device acceptance; no redundant fault-injection matrix.

## Validation Commands

```sh
node --test backend/scripts/browser-benchmark/comparison.test.mjs backend/scripts/browser-benchmark/benchmark.test.mjs
python3 backend/scripts/browser-benchmark/run.py --suite interaction --phase warm --check
python3 backend/scripts/browser-benchmark/run.py --suite interaction --phase warm --cases apple-store --check
python3 backend/scripts/browser-benchmark/run.py --suite interaction --phase warm --output .local/android-browser-comparison/warm-retrieval
# After main collection and cleanup:
python3 backend/scripts/browser-benchmark/run.py --suite interaction --phase warm --cases apple-store --output .local/android-browser-comparison/warm-apple
node backend/scripts/browser-benchmark/report.mjs .local/android-browser-comparison/warm-retrieval
node backend/scripts/browser-benchmark/report.mjs .local/android-browser-comparison/warm-apple
```

Use a new output directory after material protocol/source changes. Do not resume across changed source hashes or unverified cleanup. Existing-run replay and historical fill phases remain available in the harness; they are outside current collection scope.

## Overall Exit Criteria

- Secure-fill implementation is validated, including actual native/browser fixture fills and OTP.
- Current method-isolated comparisons use matched requirements and explicit platform/session differences; all scheduled outcomes and unresolved human dependencies remain visible.
- Every live success has independent evidence. Correctness, assistance, elapsed time and model usage are reported without treating setup blockers as an authenticated retrieval ranking.
- Reports/plans are current, commits are local, and benchmark-owned cleanup is verified while personal sessions and the dev stack are preserved.

## Current Follow-up

Apple setup reuses dev PWA task `fd8eb1d0-bb59-492f-8a54-af3b769a4052`. Desktop account access was verified at 07:38 UTC, but later checks required sign-in; cause is unproven. Android Chrome also requires sign-in. Setup is outside scored timing, follows all independent work, and yields for any user verification. The queue is recorded in `warm-apple/human-follow-up.json`.
