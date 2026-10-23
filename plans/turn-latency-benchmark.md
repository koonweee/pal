# Task Turn Latency Benchmark

## Status

Done

## Goal

Measure whether Task context, reasoning effort, or model choice explains slow browser-action decisions, without changing normal Pal settings or existing conversations.

## Current Behavior

- Synthetic login traces show roughly 4.3 seconds per tool-producing model request.
- Dev uses `gpt-6.1-sol` at medium effort, with persistent Mastra observational memory and recent messages.
- Existing login instrumentation separates provider timing from tool execution.

## Milestones

### 1. Isolated request benchmark

- Prepare genuine fresh and reused Task requests through the running agent with read-only memory; stop before network or tool execution.
- Replay the same natural browser-opening request across the configured model at medium/low effort and an available smaller model.
- Interleave repeated samples and record timing, token/cache counts, and action correctness, without persisting prompts, credentials, or model text.

Exit criteria:

- Both contexts and supported settings have repeated measurements; unsupported settings are reported explicitly.

### 2. Analysis and cleanup

- Compare context size, time to first arguments, full request time, and valid intended actions.
- Restore temporary hooks, remove diagnostic files, archive only the benchmark Task, and verify existing Task history/settings and desktop are preserved.
- Record measured conclusions and limitations.

Exit criteria:

- A reproducible metadata-only report supports a concrete next recommendation.

## Tests

- Syntax-check benchmark scripts and validate every reported sample against the requested tool and URL.
- Compare existing Task message counts before/after and verify debugger/hooks/settings cleanup.

## Validation Commands

```bash
python3 backend/scripts/turn-latency/profile.py
node --check backend/scripts/turn-latency/probe.cjs
```

## Overall Exit Criteria

- Fresh/reused context and supported model/effort comparisons are measured.
- Production code, agent guidance, model settings, and real Task state remain unchanged.
- Results distinguish model-only timing from end-to-end task quality and browser time.

## Findings

Thirty model-only requests used the same natural prompt: “Let's log in to the test store https://pal-turn-latency.example.test/login”. Five samples per context/setting were interleaved after availability warmups. Each used the running Task agent's prepared instructions, memory and 45 tools. No model-generated tools executed.

Median request-to-response-complete time:

| Model | Effort | Fresh Task | Reused Task | Immediate opening action, fresh/reused |
| --- | --- | --- | --- | --- |
| gpt-6.1-sol | medium | 2.70 s | 4.15 s | 5/5, 5/5 |
| gpt-6.1-sol | low | 2.98 s | 4.60 s | 5/5, 5/5 |
| gpt-6-luna | medium | 2.39 s | 4.00 s | 3/5, 5/5 |

- The fresh context contained 18,193 input tokens; the reused synthetic-login Task contained 53,623. Median cached tokens were 18,048 and 53,504 respectively. The context difference persisted with warm prompt caches.
- On the current model, fresh versus reused saved 1.45 seconds (35%) for this opening decision. Time to headers was similar (1.11/1.14 seconds); time to first tool arguments was 2.06/3.49 seconds. The context comparison includes Task metadata, compressed observations, recent history and resulting response behavior; it does not isolate token length alone. Reported output tokens were 33/64 despite identical opening arguments.
- Low effort provided no measured improvement. Both current-model settings reported zero reasoning tokens for this simple decision. This does not predict effort sensitivity on harder decisions.
- Luna saved 0.31 seconds on fresh context and 0.15 seconds on reused context. Two fresh samples selected `update_task` before opening, which would require another turn to reach the browser action. These are bookkeeping choices, not unsafe credential fills; no action executed. The three immediate-opening Luna samples had a 2.38-second median.
- Observed ranges overlap: current medium fresh 2.59–3.41 seconds, reused 3.41–6.26; Luna fresh 1.92–3.06, reused 3.06–4.04. Five samples per group support a directional comparison, not a stable production speedup estimate.

The evidence favors investigating context size and accumulated behavior before changing the default model or effort. The reused Task has served many synthetic flows and is unusually history-heavy. Fresh Task creation is a benchmark control, not a recommendation to discard useful Task continuity. A follow-up can attribute the fresh 18k-token baseline and selectively reduce unnecessary history/tool/instruction context while preserving continuity. This experiment does not measure Main routing, browser execution, credential submission, or multistep login quality.

Artifacts: `.local/turn-latency/comparison.html`, `summary.json`, and metadata-only `samples.jsonl`. The original Task's 293 Mastra messages, thread, thread state and application record passed before/after equality fingerprints. The benchmark Task is archived; fetch is restored, the debugger is closed, probe files are removed, and the execution desktop and model settings are unchanged.
