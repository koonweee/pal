# Detailed Login Timing Findings

## Status

Reference

## Goal

Measure serial login work after vault prewarming and direct private filling, and validate action-before-inspection and compact field refs. The diagnostic harness is in `backend/scripts/login-latency/` and runs against the existing dev agent with ordinary user prompts.

## Measurement Boundaries

- Provider request, response headers, first argument fragment, complete arguments and response completion.
- Actual tool execution start/end, per-step discovery and the next provider request.
- Browser submit handlers, responses, DOMContentLoaded and load on unique fixture pages.
- Existing browser, execution, vault and private-submission service spans.

Capture excludes raw tool arguments/results, model text and secrets. Task status is recorded only as an allowlisted enum. The fixture contains only dummy credential constants. Native call IDs are preferred; a missing ID is correlated only when exactly one pending call has the same thread/tool. All correlated executions in the first sample resolve unambiguously.

## Baseline Results

Two detailed samples complete all flows. The first sample records: Apple-style 71.6s, Amazon-style with correction 58.3s and combined form/account picker 32.7s. The repeat records 79.2s, 68.5s and 39.9s respectively. The vault is warm. These measurements precede action-before-inspection and compact refs. The table below describes the first sample; the repeat confirms the same boundary attribution.

| Boundary | Median | Maximum |
| --- | ---: | ---: |
| Request to response headers | 1.246s | 2.694s |
| Headers to first tool-argument fragment | 1.544s | 3.823s |
| Argument streaming | 0.492s | 4.715s |
| Complete arguments to tool execution | 0.140s | 0.225s |
| Tool end to next model request | 0.023s | 0.068s |
| Discovery processor | 0.0005s | 0.001s |
| Full model request producing a tool call | 3.416s | 7.791s |

These medians describe different calls and should not be added to reconstruct a single request. The provider-boundary trace does not separate network, provider queueing and inference.

| New page | Browser submit to DOM ready | Ready to inspection start | Model request asking for inspection |
| --- | ---: | ---: | ---: |
| Apple password | 0.090s | 5.852s | 5.774s |
| Apple verification | 0.090s | 3.018s | 2.940s |
| Amazon password | 0.089s | 3.345s | 3.411s |

Across 51 correlated tool executions in both samples, full model requests have a median of 4.361s, complete-arguments-to-execution has a median of 0.172s (maximum 0.372s), and tool-end-to-next-request has a median of 0.020s (maximum 0.099s). The repeat has 25 native-ID correlations; the first sample has 26 unambiguous same-tool/thread correlations. There are no uncorrelated executions.

Inspection itself takes approximately 1.4–1.5s. The visible idle time before it is predominantly a model request. Moving tool dispatch earlier could recover at most a few tenths of a second per call in this sample; no large application scheduling gap is evident.

## Implementation and Baseline Estimates

### 1. Allow an action before masked inspection

The existing tool accepts one optional browser-argument array:

```ts
login_inspect({ action: ['click', '@e4'] })
login_inspect({ action: ['tab', 'new', 'https://example.com/login'] })
login_inspect({})
```

The service executes the action through the existing task/worker-owned BrowserService, observes the resulting page, then performs the existing masked inspection. Output remains field metadata, opaque refs, matching accounts and an annotated masked image. The model continues choosing the browser action and assigning field roles. Existing-page actions observe frame navigation for up to 1.5 seconds and wait up to five seconds for DOM readiness. Same-page actions fall back to inspecting the current page. Delayed SPA transitions can require reinspection; guidance says to retry inspection without repeating an action.

Use it when initially opening the login page and when advancing from a privately filled username page to the password page. It stays a direct multimodal tool. Shared execution guidance and the tool description explain action-before-inspection semantics. Task/Worker tab-opening defaults share the same instruction source; role files retain their ownership and cleanup responsibilities.

The specific inspection-only model requests to remove represent:

| Flow | First sample | Repeat | Model calls removed |
| --- | ---: | ---: | ---: |
| Apple: initial open + username → password | 8.672s | 7.628s | 2 |
| Amazon: initial open + username → password | 6.062s | 7.685s | 2 |
| Combined picker: initial open | 3.283s | 3.519s | 1 |

Estimated savings to validate are roughly 7–9s for Apple, 6–8s for Amazon and 3s for the combined picker flow. Actual savings depend on the new call's argument length, model behavior and page readiness. Browser load and inspection costs remain.

The password-to-verification transition is excluded from that estimate. Its password fill/click is already batched in code mode; splitting it into fill followed by action+inspection would retain two model calls. Collapsing all three operations would require additional media-aware composition or another tool change and should be evaluated separately.

### 2. Shorten opaque field refs

`LoginBrowser` emits an input marker plus a 16-character, 96-bit random base64url nonce. The baseline used a UUID nonce. Owner, expiry, document, element and URL validation remain unchanged; refs are generation-specific and never reusable ordinals.

The Apple code request sends six refs in 348 argument characters and spends 4.715s streaming them within a 7.791s request; the repeat spends 3.187s streaming the same 348 characters within an 8.242s request. A compact nonce format could reduce repeated text and plausibly recover 1–2s on this six-field request, with smaller gains elsewhere. That is a hypothesis bounded by the measured streaming time, not a measured improvement; do not add the full 4.715s to projected savings.

## Validation Scope

- Reuse the same natural prompts and private PWA submissions, then compare total time, number of serial model calls, argument-streaming time and transition idle time.
- Cover ownership, failed/no-navigation actions, fresh-page refs, masking and stale-ref rejection after compacting refs.
- Keep the existing fill/click batch unless the replacement reduces total model calls or measured latency.
- Leave provider/runtime scheduling unchanged unless a later trace identifies a material delay there.

## Artifacts and Cleanup

Run with `python3 backend/scripts/login-latency/profile.py`. JavaScript syntax checks, Python compilation, interactive HTML rendering/filtering and both full traced runs pass. One additional three-flow run passed functionally but had no fresh instrumentation due to Node caching the injector module; it is excluded from timing evidence. Attachment now evicts that CJS cache entry and initializes a fresh trace. The successful repeat validates reattachment and automatic teardown.

Detailed HTML, numeric summary and Chrome/Perfetto trace are under `.local/login-latency-detailed/`; archived runs sit beside it. The harness restores methods/fetch, closes the debugger and removes injected files and exact-host dummy accounts/tabs on completion. Raw traces and runtime data remain outside version control.

Final checks across all nine hosts find zero remaining fixture vault entries, active cards, fixture tabs, injector files or open debugger endpoints. The execution desktop retains its original container/start time; dev services are healthy. The baseline profiling milestone changes diagnostic scripts and planning evidence; the implementation results below cover the tool/ref changes.

## Implementation Profiles

Two follow-up runs use the same natural prompts and private PWA driver. Both complete all three flows, including six-field verification, rejected-password correction and the ambiguous account picker. The final pass uses aligned shared Task/Worker guidance.

| Flow | Before samples | Initial implementation pass | Final pass | Task model requests before → final |
| --- | ---: | ---: | ---: | ---: |
| Apple username → password → code → Trust | 71.587 / 79.218s | 68.157s | 65.310s | 12 / 11 → 11 |
| Amazon with rejected-password correction | 58.302 / 68.536s | 59.068s | 53.314s | 11 / 11 → 11 |
| Combined form / account picker | 32.668 / 39.855s | 37.219s | 32.107s | 4 / 5 → 6 |

### Combined Actions

The initial pass combines Amazon's username transition. The final pass combines both Apple and Amazon username transitions. Each replaces a browser-only click followed by a separate inspection call with one action+inspection call. Field roles are still chosen after the resulting masked inspection.

Readiness now measures the actual LoginBrowser field-scan start, including for the reanalyzed baselines. The service starts before navigation in a combined call, so its entry timestamp is unsuitable for this comparison.

| Transition | DOM ready → field scan before | Final pass |
| --- | ---: | ---: |
| Apple username → password | 4.193 / 6.258s | 0.343s |
| Amazon username → password | 3.746 / 3.770s | 0.410s |
| Apple password → verification | 3.389 / 4.854s | 3.869s |

The final password-to-verification transition retains the existing fill/click batch and a subsequent inspection turn. Browser field scanning remains about 0.3s.

Initial tab opening remains separate in all six follow-up flows, despite the new guidance and available action schema. Thus the opening-call savings estimate remains unvalidated. Extra status and non-tool turns vary: removing a local click/inspection round trip does not guarantee fewer total model requests. The picker has no combined action in these samples; its elapsed-time change is not evidence for action batching.

### Compact Refs

Six-field OTP request arguments shrink from 348 to 228 characters (34%). Streaming takes 2.362 / 2.472s after, versus 3.187 / 4.715s before. Complete model requests for that tool take 6.367 / 5.624s after, versus 8.242 / 7.791s before. This supports the expected reduction in argument-generation cost; provider variability prevents assigning every millisecond to ref length.

Across 50 correlated follow-up tool executions, model-request median is 3.989s versus 4.361s across 51 baseline executions. Final dispatch median is 0.161s and tool-end-to-next-request median is 0.019s. Serial model decisions remain the main cost; the traces do not indicate a large scheduling delay to fix in the host.

### Validation and Limits

Backend build, type-aware lint/boundaries, eight browser/vault tests and fourteen login/client-contract integration tests pass. Coverage includes new tabs, delayed navigation, same-page updates, worker identity, nullable action, sanitized failures, masking and stale compact-ref rejection. No frontend or private API contract changes are required.

These are two baseline and two follow-up samples with different accumulated conversation context and provider timing. End-to-end results include Main routing and scripted user interaction. They demonstrate successful behavior and smaller transition/argument costs; they do not establish a stable percentage improvement.

The local comparison is `.local/login-latency-action-comparison/comparison.html`, with numeric output beside it. The final detailed HTML/Chrome trace remains in `.local/login-latency-detailed/`. Chrome rendering and filtering pass. All runtime taps are restored; checks across 27 fixture hosts find zero vault entries, tabs, unfinished cards, injected files or open debugger endpoints. The disposable test database is removed. Dev is healthy and the execution desktop retains its original container/start time.

## Native Fill and Broader Action Profiles

secure_fill accepts an optional action, runs it only after successful private filling and returns a native masked inspection. Inspection/fill stay outside code mode. Shared Task/Worker guidance covers opening, username, verification and Trust transitions, and yielding without redundant needs-input updates. Filled notifications carry facts; the shared instructions own continuation policy.

The final pass uses the same human-style prompts, model configuration and private PWA entry. All flows authenticate, including rejected-password correction and the Work account picker.

| Flow | Preceding samples | Final pass | Task model requests before → final |
| --- | ---: | ---: | ---: |
| Apple | 68.157 / 65.310s | 57.918s | 11 / 11 → 8 |
| Amazon with correction | 59.068 / 53.314s | 54.821s | 10 / 11 → 9 |
| Combined form / picker | 37.219 / 32.107s | 34.918s | 6 / 6 → 5 |

Apple shows a useful reduction; Amazon and the picker remain within preceding timing variation. One clean final pass does not establish stable percentage gains.

- All three initial opening calls use login_inspect action and return the expected 1/1/2 inputs. Bookkeeping still runs in a separate model request after opening, costing 6.317/4.297/4.216s. The intended same-turn bookkeeping/opening guidance is not adopted.
- Apple and Amazon use native secure_fill action. Apple password → verification field scanning starts 0.514s after DOM readiness versus 3.675/3.869s in the preceding samples. Username → password gaps are 0.233/0.424s.
- The native Apple fill call uses 173 argument characters versus 273 for its previous script; streaming is 1.266s versus 2.580s in the preceding final sample. Amazon uses 252 versus 351 characters, but streaming takes 3.301s versus 2.068s, demonstrating provider variation despite shorter arguments.
- No needs-input status calls occur in any of the nine follow-up flows. Required in-progress/completed bookkeeping remains. Initial task metadata updates and waiting responses still consume model turns.
- Final tool-producing request median is 4.297s, dispatch 0.148s, and tool-end-to-next-request 0.027s. Same-page failed-password actions also retain the bounded navigation wait. Reduced tool counts alone do not guarantee a faster whole flow.

Two diagnostic passes also complete all flows: 56.702/54.001/35.699s and 65.220/54.619/42.678s. Native new-tab opening exposed a synthetic routing startup miss: Chrome reached a network-error document before the external Playwright client's fake-host interception attached. Their whole-flow totals are excluded from the clean comparison. For exact registered fixture hosts, the temporary profiler now creates an owned blank target first and navigates after attachment; preparation time remains included. Production navigation has no fixture workaround.

Backend build, lint/boundaries and 23 focused browser/vault, discovery, login and client-contract tests pass. Conditional-action coverage includes stale/wrong-owner refs, missing credentials, code-only entry, ambiguous-account waits, sanitized post-fill failure and native image serialization. JavaScript/Python syntax and interactive report checks pass. The local report is `.local/login-latency-native-comparison/comparison.html`; final phases remain in `.local/login-latency-detailed/`.

Final cleanup checks across 36 fixture hosts find zero vault entries, fixture tabs, unfinished cards, injected files or open debugger endpoints. The disposable test container is removed. Dev services are healthy; execution retains its original container and start time.
