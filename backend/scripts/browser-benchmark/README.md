# Browser worker benchmark

Runs isolated benchmark Task agents inside the existing local dev service, using Pal's OAuth model adapter, native Mastra delegation, browser ownership, login services, workspace and computer tools. Normal agent configuration stays unchanged. Main routing and PWA transport are outside the measured boundary.

## Matrix

Task always uses `gpt-6.1-sol` with `medium` effort.

| Variant      | Interaction owner | Model       | Effort |
| ------------ | ----------------- | ----------- | ------ |
| control      | Task              | gpt-6.1-sol | medium |
| sol-low      | Worker            | gpt-6.1-sol | low    |
| sol-medium   | Worker            | gpt-6.1-sol | medium |
| sol-high     | Worker            | gpt-6.1-sol | high   |
| luna-low     | Worker            | gpt-6-luna  | low    |
| luna-high    | Worker            | gpt-6-luna  | high   |
| luna-xhigh   | Worker            | gpt-6-luna  | xhigh  |
| astra-low    | Worker            | gpt-6-astra | low    |
| astra-medium | Worker            | gpt-6-astra | medium |

Control has current Task instructions, tools, skills, workspace and MCP discovery, with no child agent. Delegated Task retains planning, public output, task management and preferences. It has no browser/login/computer tools, workspace, execution guidance, authentication skill or MCP discovery. Worker owns interaction tools, workspace and authentication guidance. Shared voice/file policies reuse existing instruction files. Its native `messageFilter` returns no inherited messages; Task writes the assignment. Per-request tool lists and context sizes verify these boundaries.

Each case runs with a short conversation and a fixed established conversation containing about 80k characters of realistic synthetic project discussion. The original constraints appear early in both. These are controlled raw message histories; observational memory is disabled, so this measures context isolation rather than memory-compaction policy. No private user history is copied.

## Cases

| Case           | Website/workflow                                                                                              | Scoring                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| billing        | Stripe-style billing portal with Amazon-style staged sign-in; saved dummy account; identify September invoice | Authentication, visited invoice, number/amount/due date/status                  |
| stays          | Booking/Airbnb-style listing and room detail pages with fees, breakfast and differing cancellation deadlines  | Correct qualifying cheapest option, total, deadline; no reservation             |
| support        | Zendesk/Linear-style form; carry troubleshooting history into a high-priority draft                           | Actual saved draft fields and retained facts; no submission                     |
| desktop        | Concur/Expensify-style expense form operated through screenshot/mouse/keyboard                                | Actual draft fields, computer-tool use, absence of browser/shell automation     |
| live-mdn       | Public MDN Cache-Control reference                                                                            | Browser visit, answer/source checks, captured public evidence and human review  |
| live-wikipedia | Public Golden Gate Bridge reference                                                                           | Browser visit, numeric/source checks, captured public evidence and human review |

Synthetic sites are original simplified layouts inspired by common workflows; they do not replicate production website complexity. Unique HTTPS `.example.test` hosts are intercepted in the dev browser. Every sample starts with fresh state and its own saved dummy login where required. Desktop starts with the fixture already open and focused; that setup is excluded from both arms. Live tasks are read-only and use no login. Site availability, bot challenges and changing content remain part of live results.

## Run

Prerequisites: the isolated dev stack is up, dev agent is idle, Chromium/desktop and Bitwarden are configured, and ChatGPT login works. Use this while no other agent/user is operating the shared dev desktop. No API key is needed. Runs consume ChatGPT usage.

From the repository root:

```sh
# Validate the complete 324-sample schedule without model calls.
python3 backend/scripts/browser-benchmark/run.py --check

# Availability probes only, through the same streaming OAuth route.
python3 backend/scripts/browser-benchmark/run.py --preflight-only

# Small end-to-end comparison before the full run.
python3 backend/scripts/browser-benchmark/run.py \
  --variants control,sol-medium --cases billing \
  --contexts established --repetitions 1

# Full requested matrix: 9 variants × 6 cases × 2 contexts × 3 repetitions.
python3 backend/scripts/browser-benchmark/run.py

# Resume missing samples; completed failures remain in the dataset.
python3 backend/scripts/browser-benchmark/run.py --resume .local/browser-benchmark/RUN

# Rebuild reports after reviewing live answers.
node backend/scripts/browser-benchmark/report.mjs .local/browser-benchmark/RUN
```

`--cases`, `--variants` and `--contexts` accept comma-separated IDs. `--timeout` is the whole-sample deadline in seconds (default 600). `--output` selects a new output directory. `--container` defaults to the local dev agent service. The default full run is intentionally substantial; use subsets for iteration. Variants rotate order across cases/contexts/repetitions; runs are sequential to avoid shared-desktop contention. Provider caches remain enabled and cache usage is reported.

## Results

Each timestamped directory under `.local/browser-benchmark/` contains:

- `config.json`, `environment.json`: exact matrix, code revision, container image and harness source hashes. Resume rejects changed harness sources.
- `availability.json`: text-inference availability of every selected model/effort, separate from tool-task success.
- `trace.jsonl`: request/tool/delegation timings, model/effort, tool names, context sizes and provider token counts. No prompts, raw arguments, credentials or request headers are logged.
- `results.jsonl`: benchmark answers, synthetic website state, live source evidence, scoring checks, status and timing. These files contain only benchmark task data.
- `summary.json`, `report.html`: per-case/context/variant pass/fail/review counts, all-run and successful-run latency, tokens, role breakdown and evidence.

Input and output tokens are summed across Task and Worker calls. Cached input and reasoning tokens are subsets. Missing usage from failed/aborted requests stays unknown and is flagged. Live evidence capture adds small measured overhead (`evidence.capture`) after browser calls. Model time and tool time can overlap; delegation time includes worker execution, so they are not additive wall-clock categories. `websiteMs` marks the fixture's final-page/draft event and is diagnostic, not proof of complete correctness. End-to-end time includes Task planning, handoff, worker execution and Task synthesis. Fixture setup, availability probes and cleanup are excluded.

Synthetic `success` means the specified objective checks passed; review answers for unsupported extra claims before drawing broader quality conclusions. Live success stays pending until human review. Add `reviews.json` keyed by sample UUID:

```json
{
  "sample-uuid": {
    "passed": true,
    "note": "Verified each requested fact against the captured source and checked the recommendation."
  }
}
```

Then regenerate the report. To apply a corrected scorer to saved website state, add `--rescore` to the report command. The report preserves original checks and records the scoring source hash; raw samples remain unchanged. Failures, timeouts and unavailable variants stay visible. Do not compare successful-run speed alone. Three repetitions support exploratory comparisons, not precise tail-latency or reliability estimates.

## Lifecycle

The runner temporarily opens the dev Node inspector on loopback, installs a session-scoped fetch tap and task-scoped synthetic navigation handler, and restores them after the run. It stops if normal dev work is active between samples. Locks keyed by canonical container ID prevent overlapping runners on the same service; the dev service also retains its legacy lock. A runner writes compact progress and cleanup ownership metadata. Creating `stop.request` in its output directory requests graceful settlement. Do not run it alongside the older latency probes.

Billing setup verifies that its exact dummy account is discoverable through the vault login lookup before timing begins. A lookup miss triggers one vault sync before bounded readiness retries. Deletion also refreshes and retries a 404 before treating the account as absent. Explicit hosted HTTP 429 responses, including CLI-wrapped HTTP 400, receive at most three bounded retries during fixture setup. Retry counts remain in fixture state. Other errors fail setup. Missing credentials fail setup instead of counting as a model login failure.

Cleanup records owned Task/account/session identifiers in the trace, closes benchmark-owned browser groups/sessions, deletes exact created dummy vault entries and archives benchmark Task records. Benchmark private transcripts remain in dev storage. An abrupt process/container kill may leave owned resources; preserve the output and inspect `cleanup.error` events. If the runner reports that settling failed, run the displayed `inspect.mjs stop` command before removing the lock. Never clear unrelated tabs, vault entries or user tasks.

## Validation

```sh
node --test backend/scripts/browser-benchmark/benchmark.test.mjs
node backend/scripts/browser-benchmark/fixtures-check.mjs
python3 backend/scripts/browser-benchmark/run.py --check
```


## Six-lane execution

The Docker VM is allocated 12 GiB. `lanes.py prepare` provisions six isolated Compose projects using pinned local images. Each has an independent database, service/home volumes, local vault process and routed desktop network; ChatGPT and hosted vault accounts remain shared. Only model authentication is copied from dev. No ports are published. `status` reports capacity; `stop` stops the manifest's containers while preserving evidence and volumes.

```sh
python3 backend/scripts/browser-benchmark/lanes.py prepare
python3 backend/scripts/browser-benchmark/parallel.py smoke --output .local/browser-benchmark/SMOKE
python3 backend/scripts/browser-benchmark/parallel.py run \
  --output .local/browser-benchmark/PARALLEL \
  --validated-smoke .local/browser-benchmark/SMOKE
```

The smoke compares a single-lane billing/desktop pair with six concurrent pairs. A full run requires a passing smoke on the same images. The matrix uses a six-slot pool for 27 jobs: nine configurations × three rounds, each containing six cases × two contexts. Variant order rotates by round. `--round-offset` preserves unique matrix keys when partitioning. Each service runs one job at a time.

The combined `results.jsonl` and `trace.jsonl` identify lane and job index; original job artifacts remain intact. The manifest records job start/end times, assignments and baseline capacity. `capacity.jsonl` records VM memory/swap, host swap and container CPU/memory. `health.json` refreshes about every 12 seconds without model calls. Creating `stop.request` in the parallel output directory requests graceful settlement of all active jobs. Incomplete jobs, unverified cleanup and interrupted runs cannot mark the matrix complete.

Memory guards stop new work and settle active jobs below 1 GiB available VM memory, above 256 MiB additional VM swap, or above 512 MiB additional host swap. Provider HTTP errors and task failures remain visible. The smoke also rejects a model-request median above three times its sequential reference. This small same-model check cannot establish the absence of contention: caching, output length, shared-account limits and changing active concurrency still affect results. Preserve capacity timelines when interpreting full-run latency.

The current reduced matrix selects control, Sol medium, Luna high and Luna low. Pass `--lanes 4 --variants control,sol-medium,luna-high,luna-low` to both `parallel.py smoke` and `parallel.py run`. It produces 144 samples across twelve variant/round jobs. Smoke validation must match the requested lane count and images. Stop unused lane services before collecting capacity measurements.


## Delegation boundary experiment

All three arms keep Task and the separate general worker on Sol medium, interaction on Luna high, and both worker histories empty except for explicit assignments. Production agents are unchanged.

| Variant | Task capabilities | Worker capabilities |
| --- | --- | --- |
| `luna-coordinator` | Planning, task tools, preferences, publication | Interaction: browser/computer/login and execution; general: non-interaction execution |
| `luna-services` | Above plus file reading, web search and service/MCP discovery | Same workers |
| `luna-execution` | Above plus shell and file processing | Same workers |

The interaction worker has authentication skill discovery; Task and general workers do not. Native workspace tool configuration excludes computer tools from Task and general workers. Shell-enabled roles can technically reach shared execution; instructions prohibit operating websites from those roles. Request telemetry verifies the declared tool boundaries, distinct models and empty inherited history.

Use `--variants luna-coordinator,luna-services,luna-execution --cases billing,stays,support,desktop,live-mdn,live-wikipedia,support-file`. The three-round matrix contains 126 samples. The new support-file case supplies essential troubleshooting facts only in a temporary local text file, so the comparison includes file inspection followed by browser work. Files are created before timing and removed during cleanup. It uses the existing support-draft checks. The other six cases retain their original scoring.

`parallel.py run` accepts the same `--cases` list and distributes nine variant/round jobs on the existing four-lane pool. Its default nine-model/six-case matrix remains 324 samples. Use a new output directory after any source change.

`python3 backend/scripts/browser-benchmark/cost.py RUN` prints a reproducible Standard API-equivalent cost summary, including Task, interaction and general worker calls. Rates were verified on October 24, 2026 from official OpenAI pricing; they are not actual ChatGPT subscription charges. Cached input receives its model-specific rate and reasoning is already in output. Trace data lacks cache-write counts: ranges assume ordinary input versus default 30-minute cache-write pricing for all noncached input. Twelve-hour writes would cost more. Requests over 272k input tokens require per-request long-context costing. Samples with missing usage stay in accuracy/latency and are excluded from cost means. Setup/probes and infrastructure are excluded.
