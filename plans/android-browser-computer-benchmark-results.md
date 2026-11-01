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
