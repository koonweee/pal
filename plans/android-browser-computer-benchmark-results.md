# Android, Browser and Computer Benchmark Results

## Status and evidence

Independent collection and review are complete. The [full plan](android-browser-computer-benchmark.md) remains In Progress for the separate assisted phase.

Primary dataset: `.local/android-browser-comparison/main-reset-verified/` on this Mac. It contains the frozen protocol/environment, incremental traces, original results, independent reviews, `audit.json`, `summary.json`, `report.html` and `assisted-queue.json`. Collection ran on November 1, 2026, 03:27–04:10 UTC (October 31 locally), using implementation `1b3bb0e` and reset correction `d136e5a`.

All 36 scheduled cells are accounted for: **15 executed, 12 passed, 3 failed retrieval, 21 deferred for setup**. All six executed live outcomes were independently reviewed; none remain pending. Apple Store was not executed.

## Outcomes

| Flow | Method | Pass / executed | Deferred | Median elapsed | Range |
| --- | --- | --- | --- | --- | --- |
| Username, password, OTP, single draft | Browser | 3/3 | 0 | 139.0 s | 138.7–141.6 s |
| Username, password, OTP, single draft | Computer | 3/3 | 0 | 126.2 s | 120.8–135.6 s |
| Username, password, OTP, single draft | Android | 3/3 | 0 | 122.4 s | 112.0–155.5 s |
| Amazon product comparison | Browser | 0/3 | 0 | 175.1 s | 170.5–181.4 s |
| Amazon product comparison | Computer | 3/3 | 0 | 175.9 s | 171.1–386.5 s |
| Amazon product comparison | Android | — | 3 | — | — |
| Amazon login and order lookup | Each method | — | 3 each | — | — |
| Facebook login and event lookup | Each method | — | 3 each | — | — |

Elapsed includes Task planning/delegation, worker interaction, private submission and final response. All measured human waits were zero, so active and total elapsed coincide. Setup and final host scoring/reset are outside this interval. Browser product timing includes failed retrievals; it has no successful-run median. For the other executed groups, successful-run and all-run medians are equal.

All nine fixture journeys performed actual private username, password and transient OTP fills: **27 fills**, exact authenticated state, the expected draft and one save per journey. Android's initial username screen and post-run reset were independently verified in all three repetitions. All 15 executed samples passed method-boundary and privacy gates. Synthetic secrets were absent from exported traces/results.

There were 13 tool error events/results: nine `login_inspect` results in browser fixture flows, three screenshot exceptions in computer fixture flows, and one browser error in a product attempt. Fixture flows recovered and passed. No provider, sample or cleanup errors were recorded. These errors remain in the telemetry; passing outcomes do not imply error-free execution.

## Retrieval failure is signal

Every browser product attempt verified the original Bose QuietComfort Black listing but failed to retrieve a new Sony WH-1000XM5 Black offer. The answers explicitly reported inability to open or populate the buying-options panel. This is a task failure even though the model avoided inventing a price. The root cause is unproven; **no CAPTCHA was detected** in the captured observations.

Computer retrieved both new offers in all three repetitions. Host evidence confirmed the model/variant, Bose price and stock. The bounded host extractor missed the Sony seller panel, so independent review inspected each completed benchmark worker's stored public screenshot: the New filter and $263.95 offers were visible. Review notes identify the exact thread/observation and screenshot hash. Temporary review images were removed. The reported Bose price was $169.00. These are historical benchmark observations, not current shopping quotes.

Verified absence of a new offer could satisfy a retrieval task. Inability to determine whether one exists leaves this task incomplete. Setup deferrals are also distinct from failures during eligible execution.

The hypothesis that Android succeeds more often because web encounters CAPTCHA or access friction remains **untested on live native workflows**. Native product access stopped at Amazon permission setup; live login cells lacked matching saved accounts. Fixture success cannot establish a live-service reliability advantage.

## Usage and interpretation

Medians below sum Task and worker requests per sample. Cached input and reasoning output are subsets of the corresponding totals. Repeated context is counted on each request; these are not unique prompt sizes or monetary costs.

| Flow / method | Input tokens | Cached input | Output tokens |
| --- | ---: | ---: | ---: |
| Fixture / browser | 244,887 | 198,272 | 2,133 |
| Fixture / computer | 303,048 | 249,856 | 2,294 |
| Fixture / Android | 279,793 | 228,992 | 2,360 |
| Products / browser | 4,375,326 | 4,001,024 | 2,037 |
| Products / computer | 677,618 | 619,648 | 1,592 |

All executed samples have complete recorded usage. Task used `gpt-6.1-sol` medium and the interaction worker `gpt-6.1-terra` medium, with fresh handoffs and enforced method inventories. Computer navigation used screenshots/mouse/keyboard with shared private inspection/filling allowed. Role timing and usage are available in the HTML/JSON report. Delegation is recorded separately from ordinary tool-call counts. Observation-capture overhead is included in tool/elapsed timings but not separately instrumented; the generic report's zero `evidenceCaptureMs` is not proof of zero overhead. Exact authentication-acceptance latency is not independently broken out.

This is an exploratory three-repetition comparison on one phone, one execution desktop and one public shopping task. Product runs used an anonymous Amazon.com session under the recorded protocol amendment. Delivery context was reported by the model and was not independently matched to native Android. Native/web layout, platform, connection and session differences remain confounders. The roughly four-second Android/computer fixture median difference is too small to establish a general priority.

The earlier `main-20261101/` dataset is excluded from primary aggregates. Android repetition 2 started already authenticated because setup matched `Start again` while accessibility exposed `START AGAIN`. The no-fill row correctly failed; collection was stopped and the interrupted browser row retained. The fix matches case-insensitively and verifies starting state. Exact old sources and reviews are preserved. `reset-acceptance/` passed all three methods, including real post-draft reset, before primary collection. Calibration datasets are not pooled with scored results.

## Guidance recommendation

Keep service/API preference and current production prompts unchanged pending review. For this Amazon offer-panel workflow, the evidence supports computer interaction as a fallback after browser retrieval fails; repeating the same failed browser interaction has low value. Report the blocker and missing facts explicitly.

Native Android is viable for supported private-fill flows, but current evidence does not justify a universal Android-first rule. Test the live assisted cases before ranking app access against browser/computer access. Unsupported native login destinations, WebViews, an occupied phone or a device challenge require another supported method or a human handoff. Structured or bulk web work was not measured here.

## Separate assisted phase

The validated manifest has **27 samples**, preserving source links to all 21 deferred main cells, then appending six Apple Store browser/computer samples last.

1. Prepare matching Amazon and Facebook accounts through Pal's private UI/account picker. Never enter credentials or verification codes in benchmark chat. Verify native login surfaces and trusted app signer/origin mappings after setup; the current real-app mapping is empty. Unsupported native surfaces retain an explicit capability outcome.
2. Resolve Amazon's Android permission/setup screen. Confirm account, marketplace and delivery context for matched live comparisons. Facebook reaches its installed app, but no eligible input fields were observed in preflight.
3. Run the deferred account/order/event/product comparisons, handling challenges through the existing private UI or directly on the device. User authorization for benchmark sign-outs remains in effect.
4. Confirm the intended Apple Store URL (planned `https://www.apple.com/shop/account/home`), then execute its six samples last. Passkey-only paths without field filling must be labeled accordingly.

```sh
python3 backend/scripts/browser-benchmark/run.py --suite interaction --phase assisted \
  --parent .local/android-browser-comparison/main-reset-verified \
  --output .local/android-browser-comparison/ASSISTED
```

Independent execution is complete; the full comparison plan remains open until assisted coverage and final recommendations are reviewed.

## Validation and cleanup

Twenty focused harness tests pass, including the uppercase-reset and failed-reset regressions. The real browser fixture checks cover exact Unicode credentials, OTP, one draft save and persisted receipt. Existing secure-fill acceptance supplies owner/app/signer binding, stale reference, cancellation/late submission, retained-worker resume and lost-response/no-duplicate-fill evidence for the unchanged helper/runtime. No redundant fault-injection matrix was added. Completed-run checkpoint resume was verified before collection; primary source hashes were checked again after collection.

The primary run exported all artifacts and completed cleanup. Scratch databases and copied runner directories are absent; the fixture app is uninstalled; the phone power setting is restored to 15. Owned tasks are archived and sessions closed, including the exact stale crash-owned browser group. The idle helper forward and temporary review images were removed. Personal apps/data, ADB authorization and the protected development stack remain intact. Existing Mobile MCP service forwards are retained because individual ownership is not established.

Sanitized local benchmark artifacts occupy about **5.2 MB** and are retained for audit. Current development images are retained: Android about 520 MB, backend 2.17 GB, execution desktop 4.33 GB and web 87 MB. Docker reports 7.49 GB of image storage, 2.31 GB of volumes and 13.97 GB of shared build cache; these totals include unrelated resources. Android SDK/Gradle/signing caches remain for reproducible builds. No global prune or shared-container recreation was performed.

| Tool/guidance | What changed | Affected agent (Main/Task) | Availability |
| --- | --- | --- | --- |
| Benchmark method inventory | Enforce one UI method and shared private filling per sample | Task / interaction worker | Always on during benchmarks |
| Authentication and Android procedures | Reuse existing skills during comparison | Task / interaction worker | Discovered on demand |
| Production method priority | Recommendations await live assisted evidence/review | Main / Task | Guidance only |


## Signed-in Amazon Android follow-up — stopped

Dataset: `.local/android-browser-comparison/amazon-products-signed-in/`, November 1, 2026, 05:10–05:32 UTC. Preflight found one matching Amazon vault account and no native setup blocker. The running backend/Android images include secure-fill simplification; screenshot masking was still deployed. The source-only mask removal was not deployed, per user instruction.

Two completed native Amazon product attempts timed out at 601.3 and 601.4 seconds. Both produced partial worker findings, with no final complete comparison. The first opened a Bose charger bundle and failed to resolve the standalone variant. The second reported both models/prices but left Sony availability/link and Bose offer condition unverified; the share sheet offered Copy, but the worker could not retrieve its URL through the permitted tools. These are worker-reported observations, not independently validated product facts. Neither reported a CAPTCHA or login challenge.

The user stopped collection. The third attempt had already started and was interrupted at 96.1 seconds. The harness labels aborts `timeout`; exclude this interrupted attempt from completed-run reliability counts. Two completed attempts yielded zero complete retrievals. No order cases ran. Do not combine this with a three-repetition result or infer general native-app reliability from it.

Earlier Android acceptance covered Chrome navigation, native Settings lookup, and synthetic native login/draft/private-fill flows. The original live Amazon Android cells were deferred before retrieval. This follow-up exercises multi-product search, exact variant/offer selection, availability and share-link retrieval in the real signed-in Amazon app.

Runtime restoration and scratch database/fixture cleanup are verified. Local evidence (~740 KB) is retained. Investigation should distinguish inaccessible/masked visual information, native share-link tooling and repeated navigation from CAPTCHA/access friction before resuming comparisons.


## Android tooling evaluation

This evaluation uses the two completed Amazon timeouts, their benchmark-owned worker transcripts, the deployed Mobile MCP 1.0.15 implementation and Pal source. No benchmark was restarted and nothing was deployed. The interrupted third sample is excluded. Aggregated evidence is in `amazon-products-signed-in/tooling-evaluation.json`; it contains sizes, counts and timings, not raw device observations.

| Measure | Run 1 | Run 2 |
| --- | ---: | ---: |
| Completed sample duration | 601.3 s | 601.4 s |
| Inspection calls | 51 | 46 |
| Swipes | 40 up | 34 up, 19 down |
| Explicit screenshot calls | 1 | 2 |
| Median inspect payload | 32,921 characters | 33,466 characters |
| Median observed nodes | 158.5 | 159.5 |
| Nodes without text or label, across captures | 77.7% | 76.0% |
| Median inspection latency | 3.83 s | 3.62 s |
| Sum of inspection latency | 218.2 s | 182.0 s |
| Model requests | 124 | 136 |
| Largest reported input context | 349,858 tokens | 194,089 tokens |
| Same sanitized snapshots through upstream text formatter, median | 13,855 characters | 14,037 characters |

One first-run inspection did not supply a parseable successful snapshot, so payload statistics cover 50 captures there. Input context counts include accumulated history; they are not generated tokens. Model/tool/delegation durations may overlap and should not be added to derive wall time. Formatting replay was offline using the pinned upstream formatter, without dropping nodes or changing the phone.

### Findings and confidence

1. **The visual fallback was disabled by our deployed masking policy.** Amazon's native app exposes product content through WebViews; the helper masked entire WebViews. The workers requested screenshots when facts were missing, but this path could not restore the missing visual evidence. Source removal exists but was deliberately undeployed. Removing it is necessary to evaluate visual fallback, but the runs do not prove it alone fixes retrieval.
2. **Ordinary observation is verbose and loses useful semantics.** Pal returns full JSON objects for visible containers, including blank strings, false/default flags and long class names. Its helper suppresses text on every node with children, and content descriptions on non-leaf nodes. It omits selected/checked state, clickability and scrollability. Upstream's pinned model-facing formatter uses compact lines, omits empty/default fields and includes selected/checked state. Formatting alone reduces the saved payloads by about 58%. Blank-node counts do not mean all those nodes can be deleted: some are useful targets or containers. Parent text suppression is a demonstrated code behavior; whether a particular missing Amazon fact was suppressed or absent in the app cannot be established from already-sanitized transcripts.
3. **Observation/action handoffs impose avoidable work.** Ordinary inspect calls the private helper, which captures and PNG-encodes a screenshot even when the service returns only text. Before an action Pal pauses the helper, then uses Mobile MCP. The next inspection starts instrumentation again and stops Mobile CLI's DeviceServer. This follows from the code; the trace does not isolate exact restart versus accessibility/screenshot costs. The measured inspection cost alone is 30–36% of each timeout.
4. **The wrapper removes useful navigation affordances.** Pal's swipe accepts direction only. The active upstream MobileDevice implementation uses a centered 400-pixel default swipe; upstream already accepts x/y/distance for targeted swipes. Pal also provides no copied-link read path even though pinned upstream includes `mobile_clipboard`. The second worker reached Share/Copy but could not retrieve the URL. These are concrete gaps, not reasons to build an Amazon scraper. Clipboard support is present in installed code but still needs a synthetic device acceptance check; no personal clipboard was read during this evaluation.
5. **Task/worker recovery keeps spending time without a new capability.** The first handoff identified a Bose bundle mismatch and missing facts; Task delegated another attempt. The second sample produced partial findings and revisited already-found details. The harness permits continued execution until the 600-second cutoff (`maxSteps: 0`, `stopWhen: false`), so partial worker findings can be lost from the final sample answer. Identical-consecutive snapshot counts were only 2 and 4: a simple repeated-screen hash alone would not catch most of this semantic lack of progress. Returning partial facts and a precise missing capability earlier would be more useful than spending ten minutes scrolling.
6. **Some difficulty is real task/model behavior.** Search results include bundles, variants and installment offers. The worker must distinguish them, but should not require a literal “one-time purchase” label where the selected offer context establishes the fact. Seller/shipper and other auxiliary checks should not become extra completion requirements. No completed run reported CAPTCHA, login failure or provider outage. This evidence does not establish a general Android reliability disadvantage.

### Upstream guidance and existing capabilities

The [upstream mobile-automation skill](https://github.com/mobile-next/mobile-mcp/blob/main/skills/mobile-automation/SKILL.md) recommends accessibility-first observation, screenshots for missing/visual information, center-of-bounds targets, focused inputs, and verification after actions. Pal's Android skill already follows most of that. The [clicking-accuracy wiki](https://github.com/mobile-next/mobile-mcp/wiki/Improve-clicking-accuracy) favors accessibility identifiers over guessed image coordinates; its platform implementation descriptions predate current Mobile CLI and are not used here as current implementation evidence.

The [server's own instructions](https://github.com/mobile-next/mobile-mcp/blob/main/src/server.ts) additionally recommend batching known sequences to reduce device round-trips. Its tool description says re-list after navigation/layout changes, rather than treating every call as requiring a separate dump. These instructions are also present in installed 1.0.15, but Pal connects through custom wrappers and does not pass upstream server instructions through to its worker. Port applicable guidance into existing role/skill owners; do not expose device/cloud configuration or unrelated upstream tools.

Installed upstream already supplies compact text observations, selected/checked state, reference-based taps, positioned/distance-controlled swipes, clipboard read/write, and `mobile_batch_commands` with optional final inspection. Its [current source](https://github.com/mobile-next/mobile-mcp/blob/main/src/mobile-device.ts) and [formatter](https://github.com/mobile-next/mobile-mcp/blob/main/src/format-elements.ts) are useful references; installed code was inspected to avoid assuming main equals the pin. An upgrade alone is not the proposed fix: these capabilities exist in our installed version.

### Recommended order of work

1. **Restore a useful visual fallback and copied-link retrieval.** Validate the already-requested unmasked screenshots, including ordinary screenshot wording and private preview. Expose an on-demand read of text deliberately copied during the current UI workflow using upstream clipboard support. Keep credential submission on the existing private fill path. First verify with synthetic share text; Android clipboard access has [platform restrictions](https://developer.android.com/about/versions/10/privacy/changes#clipboard-data), so do not promise device compatibility from the tool declaration alone. A small [share receiver](https://developer.android.com/develop/ui/compose/sharing/receive) is a fallback only if the supported clipboard primitive fails; do not build one preemptively.
2. **Use upstream ordinary observation/action together; reserve the custom helper for secure inspection/filling.** Prefer the supported compact observation format and upstream refs. Preserve structured editable-value redaction in the adapter, and test that it remains correct. Pause/switch automation only on actual transitions to/from private filling. If upstream observation cannot satisfy a concrete retained privacy requirement, keep the custom observation path but add its missing semantics, skip image capture for text-only inspect and avoid engine switching for ordinary actions. Choose one ordinary observation/action owner after a small compatibility test, not two configurable modes.
3. **Expose the useful swipe controls and small known action sequences.** Pass through upstream x/y/distance where a scroll region or longer movement is needed; choose a useful host default. Use the existing batch primitive for known ordinary sequences such as tap-search/type/submit plus final inspection. Batch must remain sequential and preserve the existing allowlist/ownership; secrets and uncertain writes must not be replayed. Android [node actions](https://developer.android.com/reference/android/view/accessibility/AccessibilityNodeInfo) provide a possible scroll-container action if the simpler upstream controls prove insufficient; no need to implement both initially.
4. **Improve recovery and benchmark reporting.** Worker guidance should preserve confirmed facts, make a bounded targeted attempt for each missing fact, then return a concrete blocker or partial result. Task should not re-delegate the same missing-capability problem without a new method. Put generally applicable recovery guidance in the shared owner. Keep worker partial findings as bounded evidence in the benchmark, distinguish user cancellation from timeout, and track observation size/tool latency alongside success. Do not relax required factual checks to manufacture passes.

Do not start with a larger model, more retries, arbitrary DOM/network bypasses, Amazon-specific selectors, a new clipboard app, or a general-purpose planning framework. The evidence supports improving the existing adapter and recovery behavior first.

### Small validation before another full comparison

- Offline replay of saved sanitized observations: smaller output with all useful text/identifiers retained and selected/checked semantics represented where available. Target at least the measured upstream-format reduction, not a new heuristic pruning engine.
- One synthetic native/WebView screen: ordinary inspect/tap/scroll retains one automation owner, text inspection avoids image generation, screenshots are readable, and private-fill transitions still work.
- One synthetic share/copy/read case and one nested-scroll case, using the supported upstream tools. Confirm no stale clipboard result is mistaken for the current item.
- One real Amazon product, verify model/variant, offer price/availability and link. Record facts that remain inaccessible. Then one two-product run. Only resume three repetitions after the basic complete retrieval succeeds.

This is an evaluation and proposed sequence, not implementation or deployment authorization beyond the user's existing requests.


## Upstream-owned Android rerun

Development now uses Mobile MCP 1.0.15 for ordinary inspection, refs, screenshots, clipboard, swipes and batching. The helper supplies private field inspection/fill only. Task remains Sol medium and the interaction worker Terra medium. These are existing-session diagnostics, separate from fresh-login and human-assisted comparisons. No browser/computer cells were rerun.

| Native Amazon case | Elapsed | Reviewed retrieval outcome | Execution notes |
| --- | ---: | --- | --- |
| Products, first attempt | 199.9 s | Partial: Bose facts and both links; Sony new offer unresolved | Returned a concrete limitation after one targeted alternative; no timeout |
| Most recent order | 45.0 s | Complete: date, first item and delivery status match stored UI observations | No unintended mutation observed |
| Products, repeat | 201.0 s | Complete: both exact Black variants, new-offer prices, availability and copied links | Accidental Shopping List save was reversed; removal confirmed in UI |

Product retrieval is complete in 1/2 attempts. The complete attempt is **not a clean read-only execution**: the actual screen reported both “Item saved to Shopping List” and “Item removed from Shopping List.” No cart/checkout action was observed. The report review records retrieval success and the recovered mutation separately. Order details remain in local benchmark evidence, not this document. Reviews were performed by Codex against recorded tool observations, not by the user.

| Product-run measure | Previous helper path (two timeouts) | Upstream path (two completed answers) |
| --- | --- | --- |
| Whole sample | 601.3 / 601.4 s | 199.9 / 201.0 s |
| Direct inspection calls | 51 / 46 | 21 / 24 |
| Median direct inspection text | 32,921 / 33,466 characters | 12,626 / 12,100 characters |
| Median direct inspection latency | 3.83 / 3.62 s | 2.07 / 1.40 s |
| Sum of direct inspection latency | 218.2 / 182.0 s | 49.1 / 53.5 s |
| Largest reported model input | 349,858 / 194,089 tokens | 70,493 / 88,333 tokens |
| Clipboard reads | 0 / 0 | 2 / 2 |
| Batch calls | 0 / 0 | 3 / 2 |

Batch-contained inspections are not included in direct inspection counts/latencies. All three diagnostics completed without a reported tool transport/result error or CAPTCHA/login challenge. Correct transport does not guarantee the intended UI effect, as the recovered save demonstrates. Live offers and initial app state vary; these samples establish capability and failure modes, not a controlled reliability ranking.

The unresolved first-run Sony offer was described as a blank buying-options panel by the worker. Its only screenshot showed the search condition filters, so the run does not prove that the offers panel was visually blank. The repeat retrieved a clearly labelled New offer successfully. This supports checking the visual fallback before concluding an accessibility-empty panel is unavailable.

The accidental save used `@e112`, which the preceding inspection explicitly labelled **Share**. Upstream forwards ref taps to Mobile CLI; its implementation comment states that ref taps dump the UI again. This points to a possible reference freshness/re-identification problem on changing app content. Screenshot scaling metadata was present and correct. The exact cause needs isolated reproduction against upstream before adding custom target logic to Pal.

Device acceptance also passes native and WebView Unicode username/password/OTP filling, stale private refs, ordinary ref taps after private fill, clipboard read/write/restoration, positioned swipes, batching and unmasked screenshots. The real Task/worker private HTTP flow and saved-vault reuse both reach the authenticated fixture. Backend build/lint and focused adapter, private-entry, helper transport and benchmark protocol tests pass.

Local evidence: `upstream-products-first` and `upstream-amazon-followup` under `.local/android-browser-comparison`, plus acceptance logs under `.local/android-upstream`. Each diagnostic directory has raw results, trace, explicit evidence reviews and tooling metrics. Both runners verified cleanup. Disposable databases, fixture APK installation, copied scripts and temporary screenshots were removed; original phone power policy and persistent app sessions were preserved. About 900 KB of local benchmark/acceptance evidence is retained. Current dev images/volumes and the shared 14.1 GB build cache remain intact; replaced image IDs were already absent, so no unrelated images or caches were pruned.

## Android navigation friction follow-up

The Android procedure requires a screenshot of the current panel before concluding missing accessibility content is unavailable, uses upstream coordinate targeting for dynamic content, and reuses batch end observations. Native target checks found Share at the historical coordinates but under `@e116`; historical Share ref `@e112` now identified Save. Three settled snapshots were stable, and both fresh-ref and coordinate taps opened Share. This supports avoiding stale refs but does not reproduce the original race or establish its exact cause.

Guidance-only diagnostics use the same models and signed-in native session as the upstream rerun:

| Case | Time | Reviewed result | Total inspections, including batch | Model requests |
| --- | --- | --- | --- | --- |
| Products, first | 224.3 s | Complete; no unintended mutation observed | 29 | 50 |
| Most recent order | 50.8 s | Complete; matches current first list row and detail | 7 | 17 |
| Products, repeat | 136.8 s | Complete; no unintended mutation observed | 16 | 34 |

The first product run used the seller-panel screenshot to find Filter, then verified explicitly New offers for both models after a condition follow-up. The repeat used screenshots to verify Sony's New $263.95 offer and same-day delivery; Bose's $169/In Stock state and both product links match stored observations. No human-assisted work ran. Order records share the newest displayed date; the current first row differs from the previous diagnostic, so review uses each run's actual observations. Private order details remain local.

The prior product runs used 24/25 total inspections and 54/57 model requests, counted by the same method and excluding availability probes. Guidance-only results show fewer round trips in the repeat, but the first run took longer after a condition follow-up; these samples do not establish a stable speed improvement. Both guidance-only product runs encountered one caught batch clipboard validation error and recovered with a standalone read. The prior incomplete upstream run also contains this error. Upstream embeds batch-step failures in text without marking the outer result as an error, so transport/result error counters alone miss them.

Pal now omits null arguments inside batch steps, whose untyped argument records bypass ordinary tool-schema optional-value handling. Build, lint and the focused adapter regression pass. A device check verifies the exact `text: null` clipboard-read batch and a subsequent foreground-app step complete without failure; no clipboard value is logged or changed. Final deployed product verification passes in **133.4 s**, with **17 total inspections**, **33 model requests**, both clipboard reads inside batches, and zero observed batch-step failures or unintended mutations. Exact product/variant, prices, availability and links match stored observations. The final run used omitted clipboard arguments naturally; the separate device check exercises the explicit-null regression. Across this follow-up, all three product samples and the order lookup complete successfully. Only the last product sample includes the adapter fix; the first two isolate the guidance changes.

Evidence: `.local/android-browser-comparison/friction-followup`, `friction-products-repeat`, and `friction-final`; explicit Codex reviews and tooling metrics accompany the runs; review used stored worker observations and screenshots. Guidance-only samples are separate from the final adapter-fix sample.

Build/lint, the focused adapter regression and live batch-null acceptance pass. All three benchmark runners verified cleanup, dropped their scratch databases, removed copied scripts/fixture installation and restored the original phone power setting. Temporary review screenshots, raw observation extracts and the review helper were removed. App data, sign-in sessions and protected dev resources remain. Current dev services are healthy; no dangling images remain. The shared 14.16 GB build cache is retained for dev builds. Local benchmark evidence and metrics are retained for review.
