# Interaction delegation benchmark

## Status

In Progress: three-arm, coordinator and Task-execution/interaction-MCP collections and comparisons complete; live semantic review pending.

## Goal

Compare three Task tool boundaries with a Luna-high interaction worker and a Sol-medium general worker. Both workers receive explicit assignments without inherited history. Measure correctness, end-to-end latency and API-equivalent cost before choosing the production boundary. A coordinator follow-up also compares Luna high for the general worker. A two-role follow-up assigns local execution to Task and UI/MCP work to interaction, removing the general worker.

## Current Behavior

- The selected production design is Task-owned MCP/local execution with a compact Luna-high UI worker and explicit assignments. Implementation/deployment status is tracked in [Task execution and interaction worker](interaction-worker-runtime.md). The experimental MCP-on-interaction arm remains separate evidence.
- The three boundary arms use Sol medium for Task and general workers, and Luna high for the interaction worker. The coordinator follow-up uses Luna high for both workers. Browser, computer and login tools belong to the interaction worker.
- Coordinator Task plans and delegates; services Task also reads files, searches and discovers MCP; execution Task also has shell and file processing. General-worker use is model judgment.
- The two-role `luna-interaction-mcp` arm removes the general worker: Task owns local execution and web search, while interaction owns UI/login and MCP. Each retains code mode for its available tools.

## Milestones

### 1. Experimental boundaries — complete

- Implement the three boundaries, shared role guidance, empty inherited worker history and request telemetry.
- Validate file-backed support constraints, role inventories, models and cleanup.

Exit validated: twelve focused tests, scoped lint, Python syntax, matrix checks and six real dev samples. Five dev samples passed; the retained coordinator desktop failure used a browser tool despite saving correct fields. The initial checker scope error is fixed, cleanup is protected if result recording throws, and its evidence is preserved.

### 2. Collection and comparison — complete

- Collect three repetitions across seven cases and fresh/established contexts in two isolated lanes, with Docker fixed at 12 GiB.
- Preserve all outcomes and compare accuracy, latency and role-priced costs.

Exit validated: 126 unique matrix rows, all nine jobs with cleanupVerified/artifactsCopied true, interrupted false and ownership locks released. Sequential and two-lane capacity validation passed. Matrix collection ran from 2026-10-24 05:54:28 to 07:29:26 UTC. Resource checks reported no contention; VM swap stayed unused.

### 3. Live semantic review — pending

- Review the 60 live rows across the three-arm collection, coordinator follow-up and interaction-MCP follow-up for answer correctness, citations and observed website evidence, retaining both coordinator stream errors as failures.
- Record semantic judgments before making live-quality claims or selecting the production boundary.

Exit: every live row has a documented semantic disposition and the production-boundary decision states the evidence and tested limits.

### 4. Task execution and interaction MCP — complete

`luna-interaction-mcp` uses Sol-medium Task for shell, files, web search, task management, preferences and local code mode. Luna-high interaction owns browser/computer/login, MCP discovery and code mode. No general worker is registered. Assignments are explicit with zero inherited history. The code runners share the execution sandbox; tool placement is not a process/filesystem security boundary.

Exit validated: fresh sequential/two-lane capacity checks and two boundary samples passed, followed by 42 exact unique case/context/round rows. All three jobs verified cleanup and artifact copying, interrupted false and released ownership locks. Actual models/efforts, role inventories and zero inherited messages passed verification. Task read the brief in all six support-file samples. Thirteen focused tests, scoped lint, syntax and the 42-sample matrix check passed before collection.

Workflow `.local/browser-benchmark/interaction-mcp-20261024T171747Z/` uses harness source `362ef54`; job revision `ff06b12` adds only launch-status documentation and all harness hashes match. Matched comparisons and role-priced costs are saved. Twelve new live rows remain pending semantic review; the MCP catalog was empty, so service effectiveness is untested.

## Results

Default synthetic aggregate: five cases, 30 samples per variant. Costs include Task, interaction and general workers.

| Task boundary | Synthetic accuracy | Mean latency | Mean API-equivalent cost | Cost coverage |
| --- | --- | --- | --- | --- |
| Coordinator | 30/30 | 89.6 s | $0.0434–0.0508 | 29/30 |
| Services | 30/30 | 85.9 s | $0.0460–0.0540 | 30/30 |
| Execution | 29/30 | 91.1 s | $0.0516–0.0602 | 30/30 |

Services was 3.6 s faster on average across 30 paired case/context/round samples (median difference 1.0 s; faster in 17/30). Its paired no-write cost was $0.00274 higher across 29 measured pairs. Execution was 1.6 s slower than coordinator and 5.2 s slower than services on average. These small samples do not establish a universal ranking.

| Task boundary | Fresh synthetic mean / cost | Established synthetic mean / cost |
| --- | --- | --- |
| Coordinator | 82.5 s / $0.0246–0.0283 | 96.6 s / $0.0610–0.0719 |
| Services | 77.7 s / $0.0278–0.0319 | 94.2 s / $0.0642–0.0761 |
| Execution | 89.5 s / $0.0366–0.0422 | 92.8 s / $0.0666–0.0783 |

Each context contains 15 synthetic samples per arm. Coordinator fresh cost coverage is 14/15; all other context cells have full coverage. Established context adds synthetic raw conversation history with observation memory disabled; it does not measure production compaction.

Support-file passed 6/6 in each arm. Mean latency was 95.9/78.3/105.8 s for coordinator/services/execution. Coordinator used the general worker in 2/6 support-file samples; other arms never used it. Availability is fixed, while handoff choice remains model judgment.

Live mean latency was 70.3/55.1/68.7 s and measured mean cost was $0.0475–0.0562 / $0.0550–0.0657 / $0.0585–0.0692. All 12 live rows per arm remain subject to semantic review: coordinator has one stream error and 11 pending rows; each other arm has 12 pending rows. The coordinator error coincided with 120-second first-content timeout logs, with healthy resource/provider checks and subsequent successful model calls. Its cost coverage is 11/12.

The execution desktop failure called browser_group during a computer-only task; saved fields and role boundaries were correct. Both failures are retained. Across all 126 rows, 89 passed, two failed and 35 await review; all role-boundary checks passed.

## Interpretation and Cost Basis

- Coordinator has the lowest measured cost. Services offers a modest synthetic latency improvement at higher cost. Shell access showed no aggregate benefit in these cases.
- Browser workflows chiefly measure tool/prompt overhead; support-file exercises real inspection handoffs. Broader MCP/API/shell benefits remain untested.
- Compare only this matched three-arm dataset. Earlier collections have different mixes or concurrency and are separate evidence.
- Costs are Standard API-equivalent inference estimates using rates verified 2026-10-24: Sol input/cached/output $2/$0.10/$10 and Luna $0.10/$0.01/$0.50 per million tokens. They are not ChatGPT subscription charges.
- Reasoning is already included in output; cached input is a subset of input. Per-request input stayed within the script's 272k short-context guard. Setup, probes and infrastructure are excluded.
- Trace data has no cache-write counts. Ranges assume no writes versus all noncached input at the default 30-minute 1.25x write rate; 12-hour caching could cost more.
- Two coordinator samples lack complete usage: successful support-file/fresh/round2 and errored live-mdn/established/round2. They remain in accuracy and latency, and are excluded from cost means. Overall cost coverage is 124/126.

## Artifacts and Validation

- Completed workflow: `.local/browser-benchmark/delegation-two-20261024T054936Z/`.
- Report and raw evidence: `matrix/report.html`, `matrix/summary.json`, `matrix/results.jsonl`, `matrix/trace.jsonl` and nine job directories.
- Reproducible outputs: `cost-comparison.json`, `comparison-details.json`, `completion-verification.json`.
- Boundary dev validation: `.local/browser-benchmark/delegation-smoke-20261024T052657Z/`.
- Preserved four-lane dataset: `.local/browser-benchmark/delegation-20261024T053055Z/`. It stopped at 45 rows after host swap grew 697 MiB; four final timeout rows were resource-guard cancellations. All started jobs cleaned up and released locks. It is excluded from this comparison.
- Collection monitoring automation `6abe533b-f3f3-4a15-ae38-21a05e75147c` is paused after verification and comparison.

```bash
node --test backend/scripts/browser-benchmark/benchmark.test.mjs
python3 backend/scripts/browser-benchmark/run.py --check --variants luna-coordinator,luna-services,luna-execution --cases billing,stays,support,desktop,live-mdn,live-wikipedia,support-file
python3 backend/scripts/browser-benchmark/cost.py .local/browser-benchmark/delegation-two-20261024T054936Z/matrix
```

Pricing references: [Standard rates](https://developers.openai.com/api/docs/pricing?latest-pricing-expanded=true), [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

## Coordinator Follow-Up — Complete

`luna-coordinator-both` keeps Sol-medium Task and the coordinator boundary, with Luna-high interaction and general workers. Worker tools, explicit assignments, zero inherited history, seven cases, two contexts and three rounds stay fixed. Production behavior is unchanged.

The fresh dataset `.local/browser-benchmark/coordinator-both-20261024T155432Z/` contains 42 unique rows. Fresh capacity and two boundary samples passed; all three matrix jobs verified cleanup and artifact copying, interrupted false and released locks. Actual request models/efforts, empty inherited history and all role boundaries were verified. General-worker requests were observed in the matrix. Collection ran 16:05:48–16:48:43 UTC on October 24, 2026, using two lanes with a final one-lane tail and Docker at 12 GiB. No resource guard or provider HTTP errors occurred.

Comparison uses only the earlier `luna-coordinator` arm, with separate datasets and matched case/context/round pairs. The earlier coordinator used a Sol-medium general worker. Both interaction workers are Luna high.

| General worker | Synthetic accuracy | Mean latency | Mean API-equivalent cost | Cost coverage |
| --- | --- | --- | --- | --- |
| Sol medium | 30/30 | 89.6 s | $0.0434–0.0508 | 29/30 |
| Luna high | 28/30 | 103.9 s | $0.0404–0.0471 | 28/30 |

The follow-up's measured synthetic cost mean is about 7% lower, with mean latency 16% higher. Across 30 matched synthetic pairs, it was faster in 11/30; mean latency difference was +14.3 s and median difference +6.8 s. The 27 pairs with complete usage in both datasets averaged $0.00162–0.00218 less. Different missing-usage subsets affect the aggregate cost means.

| General worker | Fresh synthetic mean / cost | Established synthetic mean / cost |
| --- | --- | --- |
| Sol medium | 82.5 s / $0.0246–0.0283 | 96.6 s / $0.0610–0.0719 |
| Luna high | 99.3 s / $0.0256–0.0295 | 108.5 s / $0.0552–0.0646 |

Each context has 15 synthetic samples. Follow-up accuracy is 14/15 in each context, with 14/15 cost coverage. Baseline fresh coverage is 14/15 and established coverage 15/15.

General-worker use was 2/42 samples in each dataset, exclusively support-file. The follow-up has four observed general requests, all Luna high. Support-file passed 6/6 in each dataset; mean latency increased from 95.9 to 113.2 s, while measured mean cost fell from $0.0534–0.0632 to $0.0311–0.0353. General-worker selection and assignment differ by model judgment; two uses do not establish broader general-worker performance.

The follow-up synthetic mean cost comprises Task $0.03309–0.03901, interaction $0.00723–0.00796 and general $0.000074–0.000088 per measured sample. Model-aware pricing uses Sol rates for Task and Luna rates for both workers.

Live mean latency was 68.4 s versus 70.3 s previously. Follow-up live measured cost was $0.0519–0.0615 versus $0.0475–0.0562; coverage is 11/12 in each. Each coordinator dataset has one live error and 11 pending semantic reviews. No live-quality ranking is established.

Three first-content timeout errors are retained: support/established/round0, desktop/fresh/round1 and live-mdn/fresh/round1. The first two saved the correct draft/expense fields; timeout status still makes them failures. The live error had an unfinished Task Sol-medium request. General was unused in all three failures. Resource and HTTP checks were healthy and collection continued, but the timeout root cause is unestablished. Accuracy and latency include these rows. Cost excludes their incomplete usage, giving total follow-up coverage 39/42. Per-request input peaked at 69,883 tokens, within the short-context guard.

The collections are noncontemporaneous. Host/provider/cache variation, timeout frequency and final one-lane tails limit causal attribution to the general-worker model. These workflows chiefly measure interaction overhead, with a small real file-handoff case. Broader MCP/API/shell benefits remain untested. The follow-up does not establish an overall improvement from changing the general worker.

Twelve focused tests, changed-file lint, Python syntax and the 42-sample matrix check passed before collection (source `58e4de8`). Completion artifacts are `cost-comparison.json`, `comparison-details.json`, `completion-verification.json` and `matrix/report.html` in the follow-up root. The collection automation is paused; live semantic review remains open.

## Task Execution / Interaction-MCP Follow-Up — Complete

The two-role collection ran 17:25:12–17:51:54 UTC on October 24, 2026, on the two existing lanes with a final one-lane tail and Docker fixed at 12 GiB. All 30 synthetic samples passed; all 12 live samples completed and await semantic review. No stream errors, provider HTTP errors, resource guard events or cleanup errors occurred. VM swap remained unused. Owned tasks are archived/completed, temporary briefs and probe directories are absent, inspectors are closed and owned fixture tabs are gone.

The primary comparator is the saved `luna-execution` arm from the earlier three-arm dataset. Task and interaction models are unchanged. The earlier arm also offered a Sol-medium general worker, which it never used, and gave interaction local execution and web-search tools. Several prompt/tool boundaries differ together.

| Architecture | Synthetic accuracy | Mean latency | Mean API-equivalent cost | Cost coverage |
| --- | --- | --- | --- | --- |
| Earlier execution arm | 29/30 | 91.1 s | $0.05158–0.06024 | 30/30 |
| Task execution / interaction MCP | 30/30 | 60.7 s | $0.05134–0.06085 | 30/30 |

Mean synthetic latency is 33.4% lower. The new arm was faster in 27/30 matched case/context/round pairs, with mean difference −30.4 s and median difference −21.0 s. Estimated cost is effectively unchanged: the paired mean difference is −$0.00024 under no writes and +$0.00061 under the all-noncached-write assumption. Each estimate prices both roles; new synthetic mean cost comprises Task $0.04696–0.05588, interaction $0.00438–0.00497 and general $0. General requests were zero.

| Architecture | Fresh synthetic mean / cost | Established synthetic mean / cost |
| --- | --- | --- |
| Earlier execution arm | 89.5 s / $0.03660–0.04219 | 92.8 s / $0.06656–0.07829 |
| Task execution / interaction MCP | 60.1 s / $0.03847–0.04525 | 61.3 s / $0.06420–0.07646 |

Each context contains 15 samples with full cost coverage. Support-file passed 6/6 in both collections: new mean latency 60.3 s versus 105.8 s and cost $0.05204–0.06119 versus $0.05607–0.06454. Task performed all six brief reads before interaction. Its code mode was used three times in three samples. Interaction retained code mode but never invoked it; all service catalog counts and MCP discovery/service calls were zero. This establishes UI/file handoff behavior, not MCP performance.

Against saved services/coordinator arms, new synthetic mean latency was lower by 25.2/28.9 s, with faster results in 28/30 and 26/30 pairs. Paired measured costs were higher by $0.00534–0.00685 (30 pairs) and $0.00858–0.01079 (29 pairs), respectively. The earlier services and coordinator synthetic accuracy was 30/30.

New live mean latency was 45.3 s versus execution's 68.7 s, and measured mean cost $0.06270–0.07505 versus $0.05846–0.06919; both have 12/12 coverage. All 12 rows in each remain pending semantic review. Automated live checks establish no semantic quality ranking.

These are separate, noncontemporaneous datasets. Host/provider/cache variance, changed guidance/tool inventories and final one-lane tails limit causal attribution and generalization. Browser cases chiefly test tool/prompt overhead; support-file adds real file inspection. Broader MCP/API/shell benefits remain untested. The run supports a faster measured UI workflow at similar synthetic inference cost, without establishing the best production architecture.

Standard API-equivalent costing follows the basis above, including unobserved cache-write uncertainty and excluding setup/probes/infra. Usage coverage is 42/42, with no exclusions; maximum per-request input was 59,995 tokens, below 272k. Artifacts in the new workflow root: `cost-comparison.json`, `comparison-details.json`, `completion-verification.json`, `ownership-verification.json`, reproducible `analyze.py` and `matrix/report.html`. Collection and comparison are complete; the monitoring automation is paused. Live semantic review remains open.
