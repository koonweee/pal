# Android, Browser and Computer Comparison

## Status

Planned. [Android Secure Fill](android-secure-fill.md) meets development acceptance. All comparison milestones remain open. This plan authorizes planning only; implementation and benchmark collection are subsequent work.

## Goal

Measure when Pal should prefer Android apps, browser automation or desktop computer interaction, including actual credential and verification-code filling. Produce task-specific priority guidance based on correctness, human intervention, latency and model usage.

## Current Behavior

- Task owns coordination and delegates UI work to an interaction worker. Current shared guidance prefers service tools/APIs, then suitable Android apps for UI workflows, with browser/computer available as appropriate. See `backend/src/agent/instructions/interaction-methods.md`.
- The interaction worker uses `gpt-6.1-terra` at medium effort; Task uses `gpt-6.1-sol` at medium effort. Android controls are configured through the development sidecar; detailed procedures load on demand.
- [Existing benchmark infrastructure](../backend/scripts/browser-benchmark/README.md) already measures Task/Worker timing, usage, boundaries and fixture results. [Cua comparison findings](cua-driver-comparison.md) identify evidence-loss and interpretation limits to avoid repeating.
- Android private filling passes new private-entry and saved-login fixture journeys with OTP. Ordinary observations are masked; WebView screenshots are fully masked, so Android Chrome visual verification is unavailable through that path. Amazon and Facebook remain blocked by first-run setup; benchmark preflight must verify their actual login surfaces and configure trusted package/signing identities. Existing acceptance evidence does not establish live-app fill capability or benchmark results.

## Comparison Protocol

### Arms and boundaries

| Arm | Navigation and ordinary interaction | Private filling |
| --- | --- | --- |
| Browser | Current Pal browser automation | Shared secure-entry workflow through browser adapter |
| Computer | Screenshots, mouse and keyboard in Pal's execution desktop | Same shared workflow through browser adapter |
| Android | Current Mobile MCP on the USB phone | Same shared workflow through Android adapter/helper |

Keep Task/worker models, effort, user objective, account permissions and scoring constant. Force the assigned method by tool availability and verify boundaries from tool traces. Task delegates; neither Task nor worker can bypass the assigned UI through service MCP, web search, shell, direct HTTP, DOM scripting in the computer arm, or code-mode escape routes. Host setup and independent scoring are outside the agent tool boundary.

Private inspection/fill is explicitly allowed in the computer arm. Its result measures screenshot-driven navigation with Pal's shared secure entry; label that hybrid accurately. It is not a mouse-only authentication implementation. Browser and computer use the same execution desktop/profile setup, with matched fresh state for login samples.

Reuse current browser/computer tooling. Cua and alternative models are outside this matrix. Capture exact role prompts, skill sources, tool inventories, model/effort, repo revision, images and helper versions; leave production defaults unchanged during collection.

### Cases

Freeze concrete objectives and eligibility after preflight, before scoring. These are the initial cases:

| Case | Starting state and actual work | Success evidence |
| --- | --- | --- |
| Matched staged login and OTP | Signed out of equivalent web/native fixtures; fill identifier, reusable password/PIN and OTP through real private-entry requests, then save a harmless draft | Independent authenticated identity, expected draft, stage-specific requests, transient OTP and no duplicate write |
| Amazon login and order lookup | Signed out; use the matching saved vault account to fill login, then retrieve agreed details from an existing order | Fill operation occurred, correct authenticated account, correct requested order facts; no order/account changes |
| Amazon product comparison | Warm session; compare agreed exact products/variants and return a small structured comparison | Correct variants, current price/availability and useful links; no checkout |
| Facebook login and event lookup | Signed out; perform actual private filling, then locate an agreed event and its requested details | Fill operation occurred, authenticated account and correct event facts; no posting, RSVP or messages |
| Apple Store browser login | Signed out of the intended Apple Store website; fill the supported login stages, verify account access and perform an agreed read-only check | Actual private fill, correct site/account and verified account destination; no purchase or account changes |

The first four cases are three-arm comparisons. Apple Store is a separate browser/computer comparison; an equivalent native Android Apple Store workflow is not assumed. Verify the user's intended Apple Store URL before login. If the offered path is passkey-only or otherwise performs no field filling, record that limitation and do not label it a completed fill case.

Use a native fixture only for repeatable lifecycle/privacy and staged-OTP evidence. The live cases must exercise the actual services and actual fill paths, rather than fixture-only or already-logged-in shortcuts. If a named live app lacks a supported login destination, retain its capability result. A substitute service requires a recorded protocol amendment before scored collection.

### State, repetitions and timing

- Minimum matrix: four matched cases x three arms x three repetitions = 36 samples; Apple Store x two arms x three repetitions = six additional samples. Total 42, excluding preflight, smoke and separate recovery probes. Keep incomplete/unavailable cells visible. Three repetitions are exploratory.
- Run sequentially in a quiet window; the phone and desktop are shared resources. Rotate first arm across repetitions, using all three cyclic orders for matched cases. Alternate Apple Store order; report the unavoidable imbalance with three repetitions.
- Match account, marketplace/region, delivery location, locale, currency, product variants and account access across app/web. Record device/browser versions, connectivity/egress and native/web differences. Do not attribute all differences to the tools alone.
- Login cases start demonstrably signed out with credentials ready in the shared vault or an explicitly defined private-entry scenario. Prefer dedicated accounts or isolated profiles. Obtain user agreement before signing out an existing personal app session; never clear app data or reset credentials to manufacture state.
- Warm-session cases retain an authenticated account. Setup, installation, vault readiness and resetting fixture state occur outside measured samples and are recorded separately. Do not erase the measured difference between a naturally warm app and web during a later operational recommendation.
- Time request-to-final-answer, including Task delegation and actual private filling. Record observation, model, tool, fill, authenticated-destination and human-wait spans. Report both total elapsed and elapsed excluding explicitly measured user waits. Retain the original total; waiting is part of practical friction.
- Fix a per-sample active-time deadline and a separate human-wait policy after preflight. Freeze both in the manifest before collection. Preserve timeouts, retries, CAPTCHA, device permission prompts and uncertain outcomes.
- A login case needs private-fill evidence plus independent authentication/post-login evidence. A filled field, successful transport or model claim alone cannot pass. Known auto-submit/auto-advance behavior belongs in the case definition.

## Target Data Shape

Extend the existing harness rather than create a second orchestration system. Store a frozen run manifest and incremental per-sample results under a gitignored `.local/android-browser-comparison/RUN/` directory on the Mac, outside disposable containers.

Each sample records case/arm/round, account alias, starting-state check, capability/eligibility, tool inventory/hash, fill source and stage counts, outcome checks, retries, manual intervention type/count/wait, timing, Task/Worker token usage and usage completeness. Account aliases and review notes must avoid unnecessary personal/order data.

Record privacy and ownership gates separately from task correctness. Keep final-answer quality separate from independently verified state. Missing usage remains unknown. Do not log credentials, OTPs, raw arguments, request bodies/headers, raw hierarchies, unmasked screenshots or private card contents. Persist only sanitized evidence and explicitly needed metadata. Preserve raw outcome rows; reviewed/rescored reports identify their scorer revision.

## Milestones

### 1. Preflight accounts and freeze the protocol

Implementation tasks:

- Verify prerequisite secure-fill acceptance, Android app coverage and masked observation after filling. Probe the exact browser/computer/Android tool boundaries and actual Task-to-worker models.
- Select the concrete live objectives with the user where account/order/event details are needed. Check vault mappings privately, account readiness and native/web state-reset feasibility without opening secrets in chat.
- Loop the user in at the Apple Store browser login. Prepare the page and explain the private entry/device action needed; let the user handle credential entry, 2FA, passkeys or account challenges through the existing private UI or directly. Record assistance and wait time. Do not request passwords or codes in chat.
- Separate one-time setup assistance from assistance during a scored sample. Schedule a quiet collection window with the user; do not run repeated Apple logins unattended if a fresh user step is required.
- Freeze cases, tool boundaries, repetition order, account aliases, state resets, deadlines, scoring and known unsupported cells. Verify all 42 scheduled cells with a dry-run manifest check.

Exit criteria:

- A versioned protocol identifies supported actual fill flows, pending user steps and capability blockers. No scored collection starts before Android privacy/direct-fill acceptance.

### 2. Extend the harness and prove real filling

Implementation tasks:

- Add method arms and the native fixture adapter to existing benchmark infrastructure. Reuse private-entry/vault services, ownership, Task/Worker telemetry and independent scoring.
- Synthetic samples must traverse the actual private-request submission/fill path. Supply synthetic values through the private HTTP boundary; do not mutate fixture auth state directly or expose synthetic secrets to model prompts.
- Add live vault/private-entry execution without recording secret-bearing arguments. Include resume after an actual private submission, rather than treating filling as setup.
- Export results/evidence incrementally to the Mac after every completed sample, with bounded trace checkpoints during samples. Do not rely on copying container-local files at the end. Record owned task/session/fixture/vault/helper identifiers for cleanup and resume.
- Run one synthetic staged-login smoke per arm. Check actual fixture state, direct fill, model observation privacy and method isolation. Keep smoke results separate from the scored dataset.

Exit criteria:

- All three arms complete a real synthetic private-fill journey with equivalent outcome checks. A container interruption leaves previously completed evidence intact; resume cannot silently mix different code/protocol versions or duplicate completed samples.

### 3. Collect matched and live results

Implementation tasks:

- Collect the frozen matrix sequentially, including the user-assisted Apple Store browser flow. Verify starting state before timing; record setup failures separately from agent-task failures while preserving unavailable cells in the report.
- Preserve failed attempts and manual interventions. Stop and repair privacy or wrong-destination failures before continuing; retain affected samples and start a new versioned dataset after material fixes.
- Run a small separate synthetic recovery check for late private submission after cancellation/ownership release, changed screen/ref, helper disconnect with uncertain fill response, and pause/resume. Reuse prerequisite evidence where runtime and contracts are identical; avoid redundant matrix expansion.
- Independently verify each live outcome and review final answers against sanitized evidence. Identify native-only/web-only functionality and do not score unavailable features as invented equivalents.

Exit criteria:

- All 42 cells have a scored outcome or an explicit unavailable/pending reason. Actual-fill cases have stage and authenticated-state evidence. Human assistance, incomplete usage, privacy failures and uncertain state remain visible.

### 4. Report priorities and clean up

Implementation tasks:

- Report correctness, privacy/ownership gates and human intervention before latency. Include all-run outcomes, successful-run timings, total/active time, token usage and coverage per case/arm.
- Separate fixture reliability, live login/setup friction and warm-session productivity. Report three-repetition uncertainty and ordering/native-web differences; avoid an unsupported universal winner.
- Recommend conditional UI priorities: installed/supported app with usable session, supported private-fill login, structured/bulk web work, unsupported native login, CAPTCHA/manual challenges, and an occupied phone. Keep service tools/APIs first unless separate evidence changes that policy.
- Keep guidance recommendations in the report until reviewed. Any later prompt change should update the existing shared method policy once and preserve role boundaries; implementation completion includes the required tool/guidance availability table.
- Remove owned fixture apps/data, synthetic vault items, scratch tasks/databases, helper test resources and temporary sessions. Preserve personal app data/logins, ADB authorization, unrelated browser tabs and protected dev resources. Restore only changes tracked as benchmark-owned. Inspect Docker usage after builds and remove exact disposable artifacts.
- Keep sanitized benchmark evidence outside containers; commit harness/report documentation locally. Production rollout and unrelated driver/model changes remain separate.

Exit criteria:

- A reproducible report supports specific priority recommendations and lists unresolved comparisons. Cleanup ownership is reconciled; incomplete live review prevents a definitive ranking.

## Tests

- Extend existing harness tests for arm boundaries, schedule rotation, actual-fill requirements, independent scoring, human-wait accounting and incremental evidence/resume.
- Reuse secure-fill privacy and lifecycle regressions. Add one native/web staged fixture acceptance per arm and only distinct recovery probes.
- Live correctness requires independent review; mocked or fixture-only success cannot satisfy live exit criteria.

## Validation Commands

Existing relevant checks:

```sh
./scripts/dev-local android-status
./scripts/dev-local status
node --test backend/scripts/browser-benchmark/benchmark.test.mjs
node backend/scripts/browser-benchmark/fixtures-check.mjs
```

Implementation must add documented commands for the frozen matrix dry run, capability preflight, three-arm synthetic smoke, selective live collection, safe resume and report regeneration. Run backend build/lint and targeted tests when harness/runtime adapters change. Do not describe new commands as available before implementing them.

## Overall Exit Criteria

- Android secure fill is validated before collection. The comparison includes actual native and browser private filling, staged OTP coverage and Apple Store browser login with user assistance as needed.
- Same-model, method-isolated arms have matched requirements and explicit platform differences. Correctness, manual assistance and privacy gates are visible alongside time and usage.
- Durable evidence supports conditional method-selection guidance, with unavailable/pending cases and uncertainty stated. Existing development resources and personal account state are preserved.
