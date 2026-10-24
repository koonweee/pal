# Browser worker benchmark

## Status

In Progress: collection complete; live semantic review pending

## Goal

Compare direct Task interaction with a compact-context interaction worker across the requested model/effort matrix using repeatable synthetic and public live websites. Measure correctness, elapsed time, model/tool time, and tokens.

## Current Behavior

- Task and general workers share model settings and interaction guidance/tools.
- Existing login-latency and turn-latency scripts instrument the running dev agent.
- Native Mastra delegation supports filtering inherited messages.

## Milestones

### 1. Dev harness and experiment matrix

- Add an isolated dev diagnostic runner with direct control and eight worker settings.
- Keep Task on gpt-6.1-sol medium; remove interaction tools, workspace and guidance from delegated Task.
- Use native delegation with empty inherited history and a model-written handoff.
- Provide fresh and established synthetic conversation contexts and interleaved repetitions.

Exit: matrix validation and a real delegated run confirm distinct role models and tool/context boundaries.

### 2. Scenarios and scoring

- Add synthetic billing/login, accommodation selection, support draft and desktop expense workflows.
- Add public read-only live reference tasks with evidence and explicit review status.
- Reset each synthetic case and independently validate website state and answers.

Exit: fixture validators pass positive/negative cases and browser interactions complete against dev.

### 3. Measurement and reporting

- Capture per-request provider usage and timing, actual tool timing, handoffs, failures and final answers.
- Write JSONL evidence and HTML/JSON summaries; preserve unsuccessful runs and missing usage.
- Add subset, repetition, timeout and resume controls; cleanup benchmark-owned resources.

Exit: reports reproduce recorded results; documented commands run the requested matrix.

### 4. Six isolated execution lanes

- Provision six Compose execution lanes using existing immutable dev images, private home/service/database volumes and distinct routed execution networks.
- Copy only model authentication into private lane storage; isolate local vault processes and synthetic hosts while retaining the same hosted account.
- Gate startup and parallel smoke on VM/host memory and swap; record container CPU/memory and provider throttling.
- Run a sequential browser/desktop reference and six concurrent equivalents, then distribute all 27 variant/round jobs (324 samples) across six lanes. Preserve unique round keys and record lane ownership.

Exit: six lanes pass isolation and contention checks; the complete matrix starts detached with compact monitoring and graceful stop support.

## Tests

- Fixture state transitions and scoring reject incorrect/incomplete outcomes.
- Matrix and report aggregation include every requested setting and failures.
- Dev smoke: control, delegated and public live scenario; availability probes for all settings.

## Validation Commands

```bash
node --test backend/scripts/browser-benchmark/benchmark.test.mjs
python3 backend/scripts/browser-benchmark/run.py --check
python3 backend/scripts/browser-benchmark/run.py --variants control,sol-medium --cases billing --contexts established --repetitions 1
```

## Overall Exit Criteria

- Benchmark is runnable without changing normal Pal agents.
- Exact requested matrix, synthetic/live cases, token/speed/accuracy reporting and limitations are documented.
- Live validation results and remaining work are recorded accurately.

## Validation Results

- All nine requested configurations passed streaming OAuth availability probes.
- Six focused scoring/report tests and all four isolated browser fixture checks pass; benchmark scripts pass Oxlint.
- Established-context billing completed correctly through both control and Sol-medium worker: 69.0s and 53.3s in one smoke pair. These are setup checks, not comparative conclusions.
- Luna-low completed hotel selection, support drafting and computer-only expense entry. A scorer regression for “retried” was corrected and saved evidence was rescored without changing raw results.
- Both live reference cases completed with verified visits, captured public source text, complete token usage and valid Task/worker tool boundaries. Live semantic grades remain pending human review.
- Diagnostic hooks and owned browser/vault resources were restored without cleanup errors.
- Reports are under `.local/browser-benchmark/smoke-billing/`, `smoke-suite/` and `smoke-live-evidence/`.

## Runtime Hardening

- Validation of vault refresh: seven regression tests and targeted lint pass; two Astra-low billing dev runs passed with clean teardown (`.local/browser-benchmark/fix-vault-sync/`).
- Refresh the vault on a lookup miss: a reproduced CLI inconsistency made an item retrievable by ID but absent from lists; sync restored visibility. Refresh and retry deletion on 404 as well.
- Verify each saved dummy credential is discoverable at the login URL before starting the timed sample; fail setup if readiness cannot be established.
- Remove created credentials on setup failure, tolerate an already absent credential during deletion, and attempt credential cleanup even if route removal fails.
- Label cleanup errors by browser, fixture or task stage without logging secret-bearing responses.
- Validation: seven focused tests, targeted lint and syntax checks pass. All three Sol-high billing reruns passed with no cleanup errors; evidence is in `.local/browser-benchmark/fix-vault-readiness/`. The original cleanup exception lacked a stage, so its precise cause remains unproven.

## Remaining Benchmark Operations

- Review live answers from the user-selected four-configuration matrix and Astra-low follow-up. The larger model matrix was pruned by user choice.
- Evaluate production observational-memory behavior separately from the controlled raw-context experiment.


## Nine-Lane Capacity Result

- Provisioning uses pinned available images, per-lane Compose volumes/networks, copied model authentication and independent local vault processes. Hosted account limits remain shared.
- Host: 16 GiB physical RAM; Docker VM: 7.82 GiB and 10 CPUs. Initial available VM memory was 4.44 GiB.
- Four lanes became healthy. Available memory fell to 2.09 GiB and swap usage grew by 414 MiB before browser tasks. Startup was interrupted during lane five; all benchmark containers were stopped and dev remained running.
- Evidence: `.local/browser-benchmark/nine-lanes/capacity.jsonl` and `manifest.json`. Automatic provisioning gates require 1 GiB available and no more than 256 MiB additional swap.
- Nine concurrent model/browser runs, provider-contention checks and full parallel collection remain unvalidated. Additional capacity is needed before continuing at nine lanes.

## Six-Lane Validation

- OrbStack memory allocation is 12,288 MiB; Linux reports 11.73 GiB usable and 10 CPUs. Six isolated lanes are healthy.
- Eight focused tests, Python syntax checks, scoped Oxlint and matrix validation pass. A simulated worker I/O failure verifies graceful SIGINT fallback and child settlement.
- Initial smoke: sequential 2/2 passed, concurrent 11/12 passed. One model request hit the existing 120-second first-content timeout. All eight runner cleanup records verified settlement and artifact preservation.
- Completed model-request medians were 3.30s sequential and 3.49s concurrent (1.06×); this excludes the failed request and cannot establish tail-latency behavior. No HTTP errors or memory guard breaches occurred.
- Evidence remains in `.local/browser-benchmark/six-lane-smoke/`. The bounded repeat in `six-lane-smoke-repeat/` was stopped and cleaned up after a vault setup rejection. A six-way vault-only diagnostic reproduced hosted HTTP 429 wrapped in local HTTP 400. Fixture setup now backs off only for explicit rate-limit responses, with three retries maximum and a recorded retry count. Nine focused tests and scoped lint pass. The patched fixture setup, discovery and cleanup passed concurrently on all six dev lanes (`six-vault-fixed.json`). A new smoke dataset gates full collection.

## Reduced Matrix

- Preserve the incomplete six-lane dataset: 101 rows before host swap growth triggered the guard; all runners settled.
- User-selected follow-up: four configurations, six cases, two contexts, three repetitions (144 samples). Use four lanes with two unused lanes stopped and fresh service processes before validation.
- Retain the same scoring, model settings, resource guards and live-review requirements. A new four-lane smoke gates detached collection; the same automation follows its health snapshot.


## Completed Collections

- The user-selected control/Sol-medium/Luna-high/Luna-low matrix collected 144 unique rows with verified cleanup: 93 passed, 5 failed and 46 live answers pending review.
- The separate Astra-low follow-up collected 36 unique rows with verified cleanup: all 24 synthetic cases passed and 12 live answers remain pending review.
- API-equivalent Standard cost estimates include Task and Worker, cached-input discounts, missing-usage exclusions and cache-write uncertainty. The three Task-boundary comparison is tracked in [Interaction delegation benchmark](interaction-delegation-benchmark.md).
