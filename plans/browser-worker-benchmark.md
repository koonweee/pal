# Browser worker benchmark

## Status

Done; full benchmark collection pending

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

- Verify each saved dummy credential is discoverable at the login URL before starting the timed sample; fail setup if readiness cannot be established.
- Remove created credentials on setup failure, tolerate an already absent credential during deletion, and attempt credential cleanup even if route removal fails.
- Label cleanup errors by browser, fixture or task stage without logging secret-bearing responses.
- Validation: seven focused tests, targeted lint and syntax checks pass. All three Sol-high billing reruns passed with no cleanup errors; evidence is in `.local/browser-benchmark/fix-vault-readiness/`. The original cleanup exception lacked a stage, so its precise cause remains unproven.

## Remaining Benchmark Operations

- Collect the full 324-sample matrix and review live answers before ranking configurations.
- Evaluate production observational-memory behavior separately from the controlled raw-context experiment.
