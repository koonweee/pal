# Cua Driver Comparison

## Status

Complete — partial evaluation; remaining repetitions deferred at user request.

## Goal

Compare current Pal browser/computer tools with Cua native tools through Mastra MCP, with Terra medium and matched fixtures. Production configuration stays on the current backend until results support a separate migration decision.

## Current Behavior

- Interaction workers use agent-browser, X11Computer and Pal private login tools.
- The existing browser benchmark records model usage, timings, fixture state and cleanup ownership.
- Development runs Linux ARM64; Cua Driver 0.38.0 publishes a matching binary.
- Measured runtime: Mastra core 1.80.0, MCP 2.6.0 and AI SDK 6.0.300.

## Milestones

### 1. Capability checks

Status: Done.

- Pin and verify the Cua binary; run it in the development execution environment.
- Check desktop observation, MCP image delivery, exact Chromium binding, Linux clicks and private-fill tab identity.
- Record unsupported operations before scoring agent runs.

Exit: executable evidence identifies supported routes and integration blockers.

Evidence: `.local/cua-comparison/preflight`. Cua 0.38.0 ARM64 archive SHA-256 matches the release checksum. Exact existing-profile Chromium binding, native screenshots, foreground trusted clicks and private-fill interoperability work. The installed Mastra MCP conversion needs an image/structured-result adapter. Native accessibility reports degraded in this execution image; screenshot interaction works.

### 2. Matched comparison

Status: Blocked. The development agent container was replaced at 2026-11-01 00:26 UTC during sample 33. Its container-local raw results and traces were lost before export; `matched-v2` is incomplete and cannot support a final comparison.

Progress: initial search 2/2; billing/support/desktop 6/6; extended smoke 13/14 fixture passes. The current-backend concurrency sample missed the beta save. One Cua payment final answer became uncertain after a fresh verification worker opened a new checkout tab. The repeated dataset is `.local/cua-comparison/matched-v2`. The partial `matched` dataset is excluded: its recovery verifier required a call to be both an action and an observation. A regression test covers the corrected separate action/observation sequence. The new matrix checks recovery and lifecycle first.

- Extend existing benchmark infrastructure with a Cua arm using Terra medium.
- Exercise search/comparison, stateful forms, staged authentication, billing, desktop handoff, recovery, concurrent ownership and pause/resume/cancellation.
- Alternate backends and run three repetitions per scenario, with concurrency tested separately.
- Keep private-entry policy and fixture outcomes identical; record backend-specific guidance and adapters.

Exit: 48 scored runs or explicit capability blockers, with correctness, latency, usage, retries, privacy and ownership evidence.

Protocol: one sample at a time, two overlapping workers in the concurrency case, four-minute sample limit. Task stays Sol medium; workers stay Terra medium. Both arms use the same fixture and private-entry business logic. Cua uses native schemas with host-owned session/tab/window routing and foreground input. Private-entry persistence and vault submissions are synthetic and isolated. User wait time is simulated. Cancellation checks the shared private-request contract, including a late submission; it does not test killing an in-flight native input event. Smoke runs are separate datasets and are not pooled into repeated results.

Integration boundary: Cua replaces model-facing general browser/computer tools. Pal still creates and owns tabs and uses its existing private-entry helpers, including their optional agent-browser actions. Authentication therefore tests interoperability with Pal's secure path, not a Cua-only authentication implementation. Fixture success and final-answer quality are reviewed separately.

Order limitation: the existing scheduler alternates which backend runs first across scenarios, but its rotation plus reversal repeats that within-scenario order for two-arm repetitions. Both backends run first in four scenarios. Per-scenario latency differences remain exploratory; the matrix is not a fully order-counterbalanced experiment.

### 3. Report and cleanup

Status: Done for the partial evaluation requested by the user.

Partial observations: the saved progress checkpoint records 32 completed samples, 28 passing all gates. Across two repetitions, Cua passed both concurrent-worker cases while current missed one save in each. One Cua resumed login observed populated private-code inputs through general browser state; no text-secret match was recorded. One current resumed login succeeded but its separate cancellation probe failed during login inspection, leaving cancellation unverified. Both arms passed both search, form/upload, uninterrupted authentication, payment, desktop handoff and timeout-recovery repetitions. One Cua payment follow-up opened a fresh checkout and added unnecessary uncertainty after receipt verification. These are provisional observations from inspected outputs, not a retained full raw dataset or evidence for a production migration.

Deferred work: rerun the frozen matrix in a coordinated quiet development window and retain evidence outside the disposable agent container during execution. Concurrent Android integration changes are outside this spike and must not be mixed into the interrupted dataset.

## Findings and Recommendation

Keep production on its current backend. Cua is a viable Mastra MCP integration candidate, but the partial comparison does not establish readiness to replace the current tools. Preserve Pal's private-entry and worker/session ownership services when evaluating a replacement.

The checkpoint and inspected outputs cover two repetitions per scenario:

| Scenario | Current | Cua |
| --- | --- | --- |
| Search and comparison | 2/2 | 2/2 |
| Form, dialog and attachment | 2/2 | 2/2 |
| Phone, PIN and code authentication | 2/2 | 2/2 |
| Hosted payment and receipt | 2/2 | 2/2 |
| Desktop document → browser | 2/2 | 2/2 |
| Timeout recovery without duplicate save | 2/2 | 2/2 |
| Concurrent worker ownership and saves | 0/2 | 2/2 |
| Pause/resume plus privacy/cancellation gates | 1/2 | 1/2 |
| All gates | 13/16 | 15/16 |

These counts are provisional: the progress checkpoint survives, but complete raw records do not. Do not treat the apparent Cua advantage as statistically established. Current concurrency failures missed one lane's save and honestly reported uncertainty; their root cause was not isolated. The Cua privacy failure was a general observation after private code fill, not a detected text-secret disclosure. The current cancellation failure occurred before cancellation was exercised, so it demonstrates an unverified lifecycle check, not a proven late-fill bug.

Integration findings: native MCP tools work through Mastra with host-owned routing. This runtime needs an adapter to preserve structured references and image content. Foreground trusted browser input works on Linux; background trusted clicks were refused. Native accessibility was degraded in preflight, while screenshot-based desktop use worked. Cua sessions need a persistent MCP connection for tested pause/resume behavior.

Evidence gaps: 16 planned samples were not completed; no defensible final latency/token comparison is available from the lost raw dataset. Long-idle and process-restart recovery, live-site variability, CAPTCHA, and Cua-only authentication remain untested. The benchmark's private-observation gate is conservative and does not establish image-level redaction. Repeating the evaluation requires incremental external evidence export and an isolated or coordinated execution window.

Validation: 20 focused tests pass; independent headless checks passed the five existing and six distinct new synthetic fixtures. Smoke evidence and interrupted-run metadata remain under `.local/cua-comparison`; `matched-v2/assistant-review.json` records the assistant's inspected-output notes, not reconstructed raw data. No production configuration was changed.

Cleanup: removed the Cua daemon and fixture server, their owned tab/state/socket, the disposable database, stale benchmark locks, downloaded binaries and 15 temporary desktop/accessibility packages. Approximately 143 MB of binaries and 20.8 MB of packages were removed; binaries/packages can be downloaded again. Retained smoke evidence and partial metadata are about 2 MB. No task-created Docker images or volumes exist; shared stack resources and unrelated Android work are preserved.

- Report completion rate before successful-run speed and distinguish deterministic checks from agent judgment.
- Remove task-created runtime artifacts and preserve benchmark evidence.

Exit: results and remaining limitations documented; development state restored.

## Tests

- Reuse benchmark fixture and boundary tests; verify Cua session ownership and tool/media mapping.
- Independently score actual fixture state and duplicate submissions.

## Validation Commands

```sh
node --test backend/scripts/browser-benchmark/benchmark.test.mjs
node --test backend/scripts/browser-benchmark/cua.test.mjs backend/scripts/browser-benchmark/driver.test.mjs
node backend/scripts/browser-benchmark/fixtures-check.mjs
node backend/scripts/browser-benchmark/driver-fixtures-check.mjs
python3 backend/scripts/browser-benchmark/run.py --variants driver-current,driver-cua --cases driver-recovery,driver-resume,driver-concurrent,stays,driver-form,driver-auth,driver-payment,driver-handoff --contexts fresh --repetitions 3 --timeout 240 --output .local/cua-comparison/matched-v2
```

Runtime prerequisites for repeating the experiment:

- Cua release `cua-driver-rs-v0.38.0`, Linux ARM64; archive SHA-256 `80c9ae66bc7322052dd426c6133c96086b33894bf06c972bca8215384400b33d`, binary SHA-256 `26e9eee8165e9ce7b614b5e3d68e5d963231385a82b65236406718b5ce1ff936`.
- Place the verified binary at `/tmp/pal-cua-comparison/cua-driver` in execution and run `serve --socket /tmp/pal-cua-comparison/driver.sock --grant existing-profile --no-overlay` with `DO_NOT_TRACK=1` as the desktop user. The stdio bridge uses the existing Docker connection.
- Install Mousepad for the document fixture. The accessibility preflight also installs `at-spi2-core`, but Cua still reports degraded native accessibility in this image.
- Create disposable PostgreSQL database `pal_cua_comparison_test`; migrations are applied by the fixture. No real vault is used by the repeated matrix.
- Use an idle local development agent and dedicated desktop; preserve existing tabs. Use a fresh output directory after any harness change. The runner records source hashes, image identity and per-sample evidence.

## Overall Exit Criteria

- Both backends evaluated against the same requirements, or failures explicitly identify why a fair comparison cannot proceed.
- Privacy, duplicate-action and ownership gates precede latency conclusions.
- No production configuration changes; temporary resources cleaned up.
