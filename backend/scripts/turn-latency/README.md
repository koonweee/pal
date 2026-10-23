# Task model-turn timing

From the repository root, with the default dev agent idle:

```sh
python3 backend/scripts/turn-latency/profile.py
python3 backend/scripts/turn-latency/analyze.py
```

The temporary inspector probe prepares the next request through the running Task agent with Mastra read-only memory, aborting before the outbound request. It compares the existing synthetic-login Task with a fresh benchmark Task using the same natural login-opening prompt and full tool set. Existing Task history, compressed observations and dynamic instructions are retained in the reused context.

Prepared requests stay in process memory. The normal OAuth fetch wrapper replays each context at the configured model's medium/low effort and `gpt-6-luna` medium effort. An availability warmup precedes five interleaved samples per supported setting and context. No generated tool calls execute. Validation checks that the model chooses `login_inspect` with the exact requested tab-opening URL; it does not establish multistep login quality.

Only timing, token/cache counts, context sizes, tool names and action-validation booleans are written under `.local/turn-latency/`. Prompts, model text, tool arguments, request headers and credentials are excluded. `comparison.html` shows medians/ranges; `summary.json` retains numeric results. Previous output is archived automatically.

Cleanup restores fetch, discards in-memory requests, archives the benchmark Task, closes the loopback debugger and removes container probe files. Equality fingerprints verify the reused Task's messages, thread, thread state and application record are unchanged. The benchmark never changes normal model settings, agent tools or guidance. An interrupted orchestrator requires running the copied inspector with `stop` before removing its files. Do not run concurrently with another diagnostic probe or active dev-agent work.
