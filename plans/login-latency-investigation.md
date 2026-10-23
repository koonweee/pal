# Browser Login Latency Investigation

## Status

Done

## Goal

Measure actual dev-agent login latency, particularly after private PWA submissions, using synthetic pages and natural user prompts.

## Current Behavior

- Login tools provide secure entry, remembered-account selection and browser filling; the model navigates each website.
- Credential save and account selection notify the owning Task, which inspects and fills afterward. Verification-code submission fills directly before notifying the Task.
- Dev uses gpt-6.1-sol with medium thinking effort. Existing native span storage has no timing records.

## Milestones

### 1. Capture representative flows

Implementation tasks:

- [x] Review recent user request phrasing without exposing credentials.
- [x] Attach temporary metadata-only timings to the running dev process without restarting it.
- [x] Create isolated HTTPS fixture sites for username/password/verification/trust, rejected-password correction and ambiguous-account selection.
- [x] Run the real dev agent through the fixtures, using the actual PWA to submit dummy credentials, verification codes and account choices.

Exit criteria:

- Prompts describe the user's objective and test URL without naming tools or coaching execution.
- Traces separate model requests, login operations, vault operations, browser operations, notification handoff and PWA HTTP timing.

### 2. Attribute latency and clean up

Implementation tasks:

- [x] Produce per-interaction timing tables and a trace artifact with no secret-bearing payloads.
- [x] Identify measured bottlenecks and distinguish evidence from optimization hypotheses.
- [x] Remove fixture vault entries, synthetic tabs, diagnostic instrumentation and its loopback interface.

Exit criteria:

- Report includes observed outcomes, sampling limits and practical next actions.
- Dev remains healthy and application tools/guidance remain unchanged.

## Tests

- Actual dev runs cover first-time username-first login, split verification inputs, website persistence choice, automatic password correction and ambiguous saved-account selection.
- Fixture responses are immediate and all credentials are synthetic. The driver fills the real PWA forms; it does not invoke login tools on the model's behalf.

## Validation Commands

The local harness and metadata-only artifacts live under `.local/login-latency/`.

```bash
node --check .local/login-latency/fixtures.mjs
node --check .local/login-latency/run.mjs
node .local/login-latency/run.mjs
./scripts/dev-local status
```

## Overall Exit Criteria

- [x] Three representative login flows complete or have their failure traced.
- [x] Each user submission has measured HTTP, notification and browser-fill latency.
- [x] The timing report and trace are available locally; temporary resources are removed.

## Results

All three synthetic sites reached a signed-in account page. Prompts were short requests to log in to the supplied test URL, based on recent dev examples. The driver submitted dummy data through the actual staged PWA. Main reused the existing login Task, so measurements include its accumulated context.

| Flow | Prompt to signed-in page | Task model calls before sign-in |
| --- | ---: | ---: |
| Username-first, password, six verification inputs, Trust browser | 109.9 s | 17 |
| Username-first, password rejection, corrected credentials | 107.7 s | 16 |
| Combined login with two saved accounts and inline picker | 52.5 s | 9 |

### After user submission

Times start when the PWA sends the private POST. First fill is completion of the first secure fill after that submission. For username-first flows, website submit is the later password submission; for verification it is the Continue action. HTTP timings include private service work. Columns overlap and should not be added.

| Interaction | HTTP response | Notification dispatched | First browser fill | Website submit |
| --- | ---: | ---: | ---: | ---: |
| First username/password entry | 0.64 s | 0.62 s | 15.89 s | 38.16 s |
| Six-digit verification entry | 1.52 s | 1.51 s | 1.50 s | 9.61 s |
| Username/password entry before rejection | 0.51 s | 0.51 s | 15.12 s | 37.47 s |
| Corrected username/password entry | 0.60 s | 0.59 s | 20.07 s | 23.65 s |
| Saved-account selection | 0.88 s | 0.86 s | 11.22 s | 15.04 s |

### Attribution

- Serial Task model requests dominate: median 4.22 s per request. Between a user POST and website submission, Task model time accounts for 64–75% of elapsed time. Model spans include provider latency and streamed output; they do not isolate provider queueing, prefill and inference internally.
- Credential save and account selection store state and wake the Task. The Task then decides to inspect, fill and advance, typically using separate model requests. Verification entry fills directly in the submission handler, which explains its 1.50 s first-fill time.
- Notification dispatch starts within 2–10 ms of service completion in these samples. The ten-second recovery sweep adds no visible polling delay to these handoffs. Acceptance into a live Task does not imply immediate execution of its next model step.
- Inspection has a 1.62 s median. Screenshot/input extraction itself has a 0.34 s median; inspection also selects the browser tab and queries the vault.
- Vault matching has a 0.90 s median and a 9.91 s maximum. The longest call includes 9.57 s in Bitwarden `/sync`, before the picker appears. Matching synchronizes on each call; it runs during inspection, filling and some request-view loads.
- Secure fill has a 1.60 s median; browser input filling itself has a 0.20 s median. Browser commands have a 0.22 s median and execution calls a 0.08 s median.
- Model context is large: Task requests carry roughly 26k–50k input tokens; Main carries 120k–124k. Main's first request for each new user turn has about 2.2k cached input tokens, while following steps often reuse most of the prefix. Context/cache behavior merits an A/B measurement; this run does not establish its causal contribution.
- The agent requested corrections roughly 11 s after explicit password rejection, without a corrective user prompt. It selected Trust browser and the Keep me signed in control in the applicable fixtures.

### Next experiments

1. Measure batching already-known fill and click actions through the existing code-mode tool. This can remove model round trips while preserving model-selected controls and current destination checks.
2. Evaluate filling the bound credential fields directly after private save/account selection, following the verification submission pattern. Retain stale-field validation/recovery; let the agent navigate and verify success.
3. Measure shared or throttled Bitwarden sync while retaining its URI matcher for every fill. Avoid redundant remote sync work.
4. Compare a small fresh login task and a stable prompt prefix against this accumulated context, using the same fixtures and model settings.

### Artifacts and limits

The ignored local directory `.local/login-latency/` contains `report.html`, `summary.json`, `trace.jsonl`, `chrome-trace.json`, the fixture pages/router and the PWA driver. The Chrome trace uses complete spans for model/backend operations and instant events for PWA/website milestones. Nested operation durations overlap.

Each site has one measured run. Fixture pages respond immediately; the UI driver adds small form-handling delays. These samples measure Pal's orchestration with the current dev history. They do not measure real-site network, CAPTCHA or anti-bot delays. Background model requests without a session header are retained separately and are not attributed to the login critical path without evidence.

The driver attempted a redundant second picker click after the valid request; it timed out after the fixture had confirmed successful sign-in. There was one actual selection POST. The replay guard is fixed. Initial fixture-routing and textarea-selector setup errors occurred before any prompt was delivered and are excluded from the measurements.

### Cleanup

Four fixture vault items were removed and a fresh match against each unique test domain returned zero items. Synthetic browser tabs were already closed by normal task cleanup. All temporary method/fetch wrappers were restored, the container-loopback Node diagnostic interface was closed, and injected container files were removed. Dev services remain healthy. Application tools and agent guidance were unchanged.
