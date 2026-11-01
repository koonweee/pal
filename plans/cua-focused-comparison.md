# Focused Cua Comparison

## Status

Complete. Concurrent-input root cause isolated; production behavior is unchanged.

## Goal

Compare current tools and Cua with Terra-medium workers on five decision-relevant scenarios in a pre-Android worktree and dedicated stack. Preserve raw evidence outside disposable containers.

## Current Behavior

- The earlier 32-sample comparison lost raw evidence during shared-container replacement.
- Commit f86a502 contains the benchmark and pre-Android application source.
- Both arms retain Pal private entry; Task uses Sol medium.

## Milestones

### 1. Isolated reproducible setup

Status: Done. Both desktop smoke samples passed; host-visible trace writes and cleanup were verified. The agent is built from pre-Android source; execution, egress and web reuse separately tagged unchanged images. Cua 0.38.0 ARM64 archive SHA-256 is `80c9ae66bc7322052dd426c6133c96086b33894bf06c972bca8215384400b33d`. Runtime versions: Mastra core 1.80.0, MCP 2.6.0, AI SDK 6.0.300.

- Use branch bench/cua-focused with unique Docker images, networks, volumes and execution identity.
- Bind raw evidence to the host; alternate first backend by repetition.
- Separate deterministic cancellation checks from scored login outcomes.

Exit: focused tests and capability checks pass; Android stack remains untouched.

### 2. Frozen evaluation

Status: Done. All 30 samples completed with full provider usage and durable evidence; no provider errors, timeouts or cleanup errors. Dataset: `.local/cua-focused`, harness commit `ec9b450`. Smoke runs are excluded.

- Run concurrency, resumed phone/PIN/code login, payment, desktop handoff and timeout recovery, three times per backend: 30 samples.
- Record correctness, privacy, latency, input/output/cached tokens, tool errors and final-answer quality.
- One sample at a time; concurrent workers only inside the concurrency scenario.

Exit: all samples have durable raw evidence or explicit failure records, with lifecycle checks reported separately.

### 3. Report and cleanup

Status: Done. Removed five task containers, three disposable volumes (about 180 MiB, including copied model login and synthetic database), three task networks, the task-built agent image, three task-only tags on shared images, and 89 MiB of downloaded binaries. The desktop's temporary Cua/Mousepad packages disappeared with its container. Shared images, volumes and Android services remain healthy. No global cache pruning was performed. Retained the isolated worktree plus about 1.6 MiB of result/smoke evidence; deleted runtime resources are reproducible, while synthetic database transcripts were intentionally discarded after review.

- Report all-gate success before successful-run timing; identify answer-quality and safety failures.
- Remove task-created disposable stack resources and retain source/report/evidence.

Exit: findings and limitations documented; local commits verified; shared development resources preserved.

## Protocol Boundaries

Three repeats are exploratory, not a precise reliability or tail-latency estimate. Backend-first order alternates per scenario; an odd repeat count cannot be perfectly balanced. Fresh synthetic tasks use immediate simulated private-entry replies. The current and Cua arms retain identical Pal private-entry business logic; Cua is not a standalone authentication replacement. Desktop foreground input shares one screen only within the explicit concurrency case. The private-observation gate flags ordinary observation of populated fields; it is not image-level redaction verification. Live sites, CAPTCHA, long idle and process-restart recovery are outside this matrix.

Containers are isolated from Android changes, but share the host machine without dedicated CPU reservation. Timing remains exploratory. This compares the implemented Pal integrations, including their different schemas, observations and routing; it does not isolate intrinsic driver-library performance.

## Results

Cua passed 13/15 all-gate checks; current passed 9/15. Ignoring safety gates, the requested fixture state was reached in 15/15 Cua and 11/15 current attempts. All final answers were reviewed against fixture state and worker outputs; failures generally reported uncertainty rather than claiming success.

Medians below include all three attempts, including failures. Input tokens include cached input and sum Task plus workers across all requests, not just the final context.

| Scenario | Current passes | Cua passes | Current seconds | Cua seconds | Current input tokens | Cua input tokens |
| --- | --- | --- | --- | --- | --- | --- |
| Concurrent workers | 0/3 | 3/3 | 37.6 | 35.2 | 101,052 | 161,440 |
| Resumed phone/PIN/code login | 1/3 | 1/3 | 99.8 | 102.6 | 274,161 | 340,409 |
| Payment and receipt | 2/3 | 3/3 | 58.7 | 62.9 | 137,665 | 155,348 |
| Desktop document → browser | 3/3 | 3/3 | 29.5 | 32.0 | 69,924 | 213,406 |
| Timeout recovery | 3/3 | 3/3 | 30.6 | 30.6 | 65,627 | 82,853 |

There is no broad latency advantage. Across the eight matched pairs where both passed all gates, aggregate elapsed time was 287.8 seconds current versus 311.9 seconds Cua (8.3% longer). Those pairs comprise two payments, three desktop handoffs and three recovery tests; they exclude concurrency and resumed login. Successful-run medians, ranges and per-sample usage are retained in `report.html` and `summary.json`.

| Across 15 attempts per backend | Current | Cua |
| --- | --- | --- |
| Input tokens | 2,003,482 | 2,828,225 |
| Cached input subset | 1,723,520 | 2,432,384 |
| Uncached input | 279,962 | 395,841 |
| Output tokens | 16,431 | 18,147 |
| Model requests | 316 | 315 |
| Task + worker tool calls | 263 | 263 |
| Worker tool calls | 186 | 187 |
| Worker tool errors, including injected timeouts | 13 | 11 |

Cua used 41% more input and 10% more output tokens. Both cached approximately 86% of input. Three worker errors per backend are the deliberately injected timeout. These are token usage, not dollar costs; cached and uncached input have different billing treatment. Cua's larger native schemas/observations and adapter output contribute to a different context footprint; their individual contribution was not isolated.

### Failure and answer-quality review

- Current concurrency missed the alpha save in all three runs while beta saved once. Workers overlapped, and final answers accurately reported alpha unconfirmed. Cua saved both lanes exactly once with distinct owners in all three runs. The diagnostic reproduction below isolates background navigation before the page's first rendered frame as the trigger.
- All six resumed logins authenticated, but each backend made ordinary observations of populated private fields in two of three runs. One current browser snapshot demonstrably included the synthetic phone number; `.local/cua-focused/private-output-audit.json` retains a redacted transcript excerpt. Cua had no text-secret matches, which does not prove image-level confidentiality. No real credentials were used.
- The separate cancellation probe passed 3/3 current and 2/3 Cua. The remaining Cua probe errored with “Browser tab is not owned by this session” before cancellation was verified. This shared host-code probe does not measure cancellation of in-flight native Cua input.
- All three Cua payments were submitted once. Two current payments were submitted once; the third stayed on checkout with required fields empty despite a private-fill completion report. The exact cause of that failed fill/submit sequence was not isolated. No payment was duplicated.
- Task unnecessarily delegated follow-up payment verification in all three current and two Cua runs. New workers lacked prior action history; the Cua adapter opened fresh checkout tabs. Both successful current payments and two successful Cua payments ended with unconfirmed final answers despite the initial worker's receipt evidence. Only Cua's third payment had a clean completion answer. This is a coordination/session-continuity gap, not an intrinsic inability to enter payments.
- All desktop documents remained unchanged. Both backends verified committed receipts after injected timeouts without repeating saves.

### Recommendation

Keep production unchanged. Cua merits continued integration work because of its reproducible concurrency advantage, but it is not a clear speed/cost improvement and does not solve private-input safety or Task verification continuity.

Before considering rollout: enforce private-field observation protection in host code for either backend; preserve worker/session and action evidence for payment follow-ups; ensure target rendering readiness for trusted input; investigate the failed private fill; then rerun those targeted regressions. Production fixes are outside this comparison.

Evidence: `.local/cua-focused/report.html`, `summary.json`, `results.jsonl`, `trace.jsonl`, `assistant-review.json`, `private-output-audit.json` and provenance/checkpoint files. Raw results and the generated report remain unchanged by the separate assistant review. All 21 focused tests pass.

## Tests

### Concurrency diagnosis

Implementation and regression results: [Browser click readiness](browser-click-readiness.md).

Root cause: a new document navigated while its tab is already hidden can expose its DOM and accept text while never running its first animation frame. Agent-browser 0.38.2 sends correct trusted mouse coordinates without making that target render. Chromium 156.0.8078.47 acknowledges the input, but no mouse/click/submit event reaches the page. The roughly five-second delay is in `Input.dispatchMouseEvent(mouseMoved)`. Concurrent workers make background navigation likely; simultaneous clicks are unnecessary to reproduce it.

| Model-free condition | Both lanes saved | Alpha animation frame |
| --- | --- | --- |
| Navigate alpha while hidden | 0/3 | Never ran |
| Same setup, temporary focus emulation before click | 3/3 | Ran |
| Same setup, render visibly once, hide again, then click | 3/3 | Ran |

A separate uninstrumented-animation-frame reproduction also failed 3/3. Earlier passing scripts navigated the document while visible before hiding it, so they did not reproduce the prerequisite. The model-free result excludes prompts, model judgment, Mastra delegation and ownership checks as necessary causes.

Full-harness protocol controls failed 2/2 without a guard and passed 3/3 with temporary target-specific focus emulation; models and guidance were unchanged. All effects were exactly-once and correctly owned. Protocol captures show correct coordinates and successful acknowledgements even on dropped input.

The [pinned Chromium focus-emulation implementation](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.47/content/browser/devtools/protocol/emulation_handler.cc#1042) increments a capturer with `stay_hidden=false`, enabling rendering as well as focus. Its [input injector](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.47/content/browser/devtools/protocol/input_handler.cc#737) can acknowledge events that were not queued. [Cua 0.38.0](https://github.com/trycua/cua/blob/85e2b1318bd77ccf3cfa88ccdf875a4bb7eaed19/libs/cua-driver/rust/crates/cua-driver-core/src/browser/tools.rs#L1498) enables focus emulation around trusted clicks. This is a deterministic input-readiness gap, not a reason to strengthen model guidance or globally serialize workers.

Evidence: `.local/cua-rootcause` contains protocol logs, standalone reproduction, animation-frame controls, full-harness datasets and the temporary control patch. Earlier diagnostic datasets remain separate. Instrumented timings are diagnostic, not a replacement for the frozen latency comparison. All 22 focused tests pass. Experimental hooks are removed; no production or Android changes. Disposable stacks, copied authentication and test data are removed after evidence export.

- Focused benchmark tests, including two-backend order alternation.
- Host-visible raw evidence verified during execution.
- Deterministic cancellation probe recorded independently of login score and latency.

## Validation Commands

```sh
node --test backend/scripts/browser-benchmark/benchmark.test.mjs backend/scripts/browser-benchmark/cua.test.mjs backend/scripts/browser-benchmark/driver.test.mjs
python3 backend/scripts/browser-benchmark/run.py --container pal-cua-focused-agent-service-1 --remote-root /bench-evidence --variants driver-current,driver-cua --cases driver-concurrent,driver-resume,driver-payment,driver-handoff,driver-recovery --contexts fresh --repetitions 3 --timeout 240 --output .local/cua-focused
```

## Overall Exit Criteria

- Same fixture/model settings across arms, with documented adapter differences.
- Durable correctness/latency/token evidence for a focused recommendation.
- No production or Android configuration changes; owned resources cleaned up.
