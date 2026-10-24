# Interaction delegation benchmark

## Status

Blocked: host swap guard stopped four-lane collection at 45 of 126 samples

## Goal

Compare three Task tool boundaries with a Luna-high interaction worker and a Sol-medium general worker. Both workers receive explicit assignments without inherited history. Measure correctness, end-to-end latency and API-equivalent cost before choosing the production boundary.

## Current Behavior

- The existing isolated browser benchmark varies worker models while fully delegating execution.
- Production Task and general workers share tools, model settings and inherited context.
- Previous four-variant and Astra follow-up collections are complete; live semantic review remains pending.

## Milestones

### 1. Experimental boundaries

- Add coordinator-only, files/search/MCP, and shell/files/search/MCP Task arms.
- Keep browser, computer and login tools exclusive to Luna high; retain a separate Sol-medium general worker in all arms.
- Reuse shared role guidance; remove browser/login guidance from Task and general workers.
- Record request tool sets, role model/effort, delegation counts and source hashes.

Exit: focused tests and real dev smokes verify role tools, models and empty inherited history.

### 2. Collection and comparison

- Retain the six browser cases and add a support draft requiring a local troubleshooting brief.
- Run three repetitions in fresh and established contexts on the existing four-lane pool: 126 samples.
- Preserve all outcomes, verify cleanup and monitor lightweight health with ETA.
- Compare paired latency, accuracy and role-priced API-equivalent cost with missing-usage and live-review uncertainty.

Exit: 126 unique rows, verified cleanup and a reproducible comparison; automation paused after completion or a definitive blocker.

## Tests

- Enforced tool boundaries and file-backed support constraints.
- Existing fixture/scorer, matrix and missing-usage regressions.
- Dev smoke for each boundary, including file reading and computer interaction.

## Validation Commands

```bash
node --test backend/scripts/browser-benchmark/benchmark.test.mjs
python3 backend/scripts/browser-benchmark/run.py --check --variants luna-coordinator,luna-services,luna-execution --cases billing,stays,support,desktop,live-mdn,live-wikipedia,support-file
```

## Overall Exit Criteria

- Three isolated boundaries run with unchanged production agent behavior.
- Source changes use new datasets and scoped validated commits.
- Results state tested limits and do not treat unreviewed live answers as passes.


## Validation Results

- Twelve focused tests, scoped lint with undefined-name checks, Python syntax and 126-sample matrix validation pass.
- Six established-context dev samples completed: five passed and one coordinator computer-only sample saved correct fields but called a browser tool. That model grading failure is retained.
- All three Task tool inventories, separate Sol-medium general and Luna-high interaction models, empty inherited histories and cleanup were verified from request telemetry. Coordinator used the general worker to read its brief.
- The initial validation dataset reproduced a checker scope error. Resource cleanup now runs even if result recording throws. Its evidence is preserved; trace-owned groups/tasks were cleaned and the three isolated fixture connections reset before fresh validation.
- Validation artifacts: `.local/browser-benchmark/delegation-smoke-20261024T052657Z/`.


## Active Collection

- Workflow: `.local/browser-benchmark/delegation-20261024T053055Z/`; tmux session `pal-bench-four`.
- Nine variant/round jobs run on the existing four isolated lanes with unchanged pinned images and 12 GiB Docker allocation. The prior passing four-lane capacity smoke is reused; fresh boundary validation covers the changed harness.
- Model-free health refreshes every ten seconds; the existing automation checks every two minutes with progress and ETA, investigates new failures and compares speed, accuracy and cost at completion.


## Collection Interruption

- The four-lane workflow stopped at 45/126 rows when host swap rose from 1368.38 to 2065.75 MiB, exceeding the 512 MiB growth guard. VM swap stayed unused and VM available memory was about 4.8 GiB at the guard. The available data does not identify the cause of host pressure.
- All four started jobs settled with verified cleanup, preserved artifacts and released locks. Four final rows labeled timeout were cancellations from the resource guard; they do not establish model timeouts or task failures.
- This dataset is incomplete and cannot support the final three-arm ranking. Recovery needs a capacity/concurrency decision before a new collection; the guard remains enforced.
