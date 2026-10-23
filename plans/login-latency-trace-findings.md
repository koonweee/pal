# Detailed Login Timing Findings

## Status

Reference

## Goal

Identify the specific serial work worth changing after vault prewarming and direct private filling. The diagnostic harness is in `backend/scripts/login-latency/` and runs against the existing dev agent with ordinary user prompts.

## Measurement Boundaries

- Provider request, response headers, first argument fragment, complete arguments and response completion.
- Actual tool execution start/end, per-step discovery and the next provider request.
- Browser submit handlers, responses, DOMContentLoaded and load on unique fixture pages.
- Existing browser, execution, vault and private-submission service spans.

Capture excludes tool arguments/results, model text and secrets. The fixture contains only dummy credential constants. Native call IDs are preferred; a missing ID is correlated only when exactly one pending call has the same thread/tool. All correlated executions in the first sample resolve unambiguously.

## Results

Two detailed samples complete all flows. The first sample records: Apple-style 71.6s, Amazon-style with correction 58.3s and combined form/account picker 32.7s. The repeat records 79.2s, 68.5s and 39.9s respectively. The vault is warm. These are measurements of the current implementation, without the proposed changes below. The table below describes the first sample; the repeat confirms the same boundary attribution.

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

## Proposed Changes

### 1. Allow an action before masked inspection

Extend the existing tool with one optional browser-argument array:

```ts
login_inspect({ action: ['click', '@e4'] })
login_inspect({ action: ['tab', 'new', 'https://example.com/login'] })
login_inspect({})
```

The service executes the action through the existing task/worker-owned BrowserService, observes the resulting page, then performs the existing masked inspection. Output remains field metadata, opaque refs, matching accounts and an annotated masked image. The model continues choosing the browser action and assigning field roles. Navigation readiness must use bounded browser events/current-page evidence and return inspection or an actionable error on failed navigation, rather than introducing a fixed sleep.

Use it when initially opening the login page and when advancing from a privately filled username page to the password page. It stays a direct multimodal tool. Shared execution guidance should describe this in the existing login section, with the tool description explaining action-before-inspection semantics.

The specific inspection-only model requests to remove represent:

| Flow | First sample | Repeat | Model calls removed |
| --- | ---: | ---: | ---: |
| Apple: initial open + username → password | 8.672s | 7.628s | 2 |
| Amazon: initial open + username → password | 6.062s | 7.685s | 2 |
| Combined picker: initial open | 3.283s | 3.519s | 1 |

Estimated savings to validate are roughly 7–9s for Apple, 6–8s for Amazon and 3s for the combined picker flow. Actual savings depend on the new call's argument length, model behavior and page readiness. Browser load and inspection costs remain.

The password-to-verification transition is excluded from that estimate. Its password fill/click is already batched in code mode; splitting it into fill followed by action+inspection would retain two model calls. Collapsing all three operations would require additional media-aware composition or another tool change and should be evaluated separately.

### 2. Shorten opaque field refs

`LoginBrowser` currently emits an input marker plus a UUID for each field. Keep generation-specific, opaque refs but use a compact 96-bit random base64url representation (for example, an input marker plus a 16-character nonce). Preserve owner, expiry, document, element and URL validation; never reduce refs to a reusable ordinal such as `i1` alone.

The Apple code request sends six refs in 348 argument characters and spends 4.715s streaming them within a 7.791s request; the repeat spends 3.187s streaming the same 348 characters within an 8.242s request. A compact nonce format could reduce repeated text and plausibly recover 1–2s on this six-field request, with smaller gains elsewhere. That is a hypothesis bounded by the measured streaming time, not a measured improvement; do not add the full 4.715s to projected savings.

## Validation Required for Implementation

- Reuse the same natural prompts and private PWA submissions, then compare total time, number of serial model calls, argument-streaming time and transition idle time.
- Cover ownership, failed/no-navigation actions, fresh-page refs, masking and stale-ref rejection after compacting refs.
- Keep the existing fill/click batch unless the replacement reduces total model calls or measured latency.
- Leave provider/runtime scheduling unchanged unless a later trace identifies a material delay there.

## Artifacts and Cleanup

Run with `python3 backend/scripts/login-latency/profile.py`. JavaScript syntax checks, Python compilation, interactive HTML rendering/filtering and both full traced runs pass. One additional three-flow run passed functionally but had no fresh instrumentation due to Node caching the injector module; it is excluded from timing evidence. Attachment now evicts that CJS cache entry and initializes a fresh trace. The successful repeat validates reattachment and automatic teardown.

Detailed HTML, numeric summary and Chrome/Perfetto trace are under `.local/login-latency-detailed/`; archived runs sit beside it. The harness restores methods/fetch, closes the debugger and removes injected files and exact-host dummy accounts/tabs on completion. Raw traces and runtime data remain outside version control.

Final checks across all nine hosts find zero remaining fixture vault entries, active cards, fixture tabs, injector files or open debugger endpoints. The execution desktop retains its original container/start time; dev services are healthy. Only diagnostic scripts and planning evidence change in this milestone.
