# Scheduled Run Memory Retention

## Status

In Progress

## Goal

Measure the production request shape that drives active-run growth and cross-run retention, then define the smallest safe fix without limiting tool turns.

## Current Behavior

- Production five-minute idle heap ratchets upward across runs. A long-lived worker can also add more than 1 GiB while active; a concurrent second run has triggered the final climb to the V8 heap limit.
- A successful forced collection reduced heap from 1,650.1 MiB to 1,010.2 MiB, leaving 774.5 MiB in large-object space.
- The existing combined development soak returns to about 78 MiB heap and 14 MiB large-object space after 42 cycles despite persisting 1.58 GiB of worker history.
- Production schedules use Mastra's native schedule worker, which accepts a woken run without consuming its returned output stream. User-triggered Task runs consume the full stream in `MastraAgentRuntime`.
- Production traces end cleanly apart from the run interrupted by the process crash, so abandoned trace trees do not explain the retained floor.

## Target Data Shape

`pal.model.request` records one sanitized log at each provider request boundary. It contains the inferred agent role, message/content/tool/image counts, estimated request/prompt/category bytes, and process RSS/heap counters. It never contains message text, tool arguments/results, file data, or identifiers derived from their content.

## Milestones

### 1. Reproduce the schedule consumption boundary

Implementation tasks:

- Extend the bounded soak harness with full-output, full-stream, and accepted-only run-consumption modes.
- Run the production-shaped 42-cycle combined scenario through accepted-only consumption.
- Preserve temporary-schema cleanup and forced-GC measurements.

Exit criteria:

- Results show whether accepted-only scheduled execution retains live heap after completed runs.

Validation evidence:

- Both full-output and accepted-only 42-cycle combined runs returned to about 78 MiB heap and 14 MiB large-object space after forced collection while persisting 1.58 GiB of worker history. Native schedule output consumption is not the retention owner.
- Accepted-only execution with observational memory enabled returned to about 81 MiB heap and 15 MiB large-object space. Observational memory is not the retention owner in the local reproduction.

### 2. Isolate remaining production behavior

Implementation tasks:

- Repeat accepted-only execution with production observational memory behavior.
- Exercise the OpenAI Responses provider with cumulative screenshot-bearing request history through both an in-process response fixture and a real loopback HTTP/Undici transport.
- Run a bounded live-upstream development variant with synthetic prompts and a generated screenshot fixture.
- Stage a one-shot sampling heap profiler that records only top live-allocation call sites after the existing high-idle forced collection.
- Identify the dominant retaining path without reading production message content.

Exit criteria:

- The retained object class and owning runtime boundary are identified, or the remaining production-only gap is stated precisely.

Validation evidence:

- The in-process OpenAI Responses provider fixture completed 42 cycles and 1,302 provider calls, then returned to 85.6 MiB heap and 15.8 MiB large-object space after forced collection.
- The loopback HTTP/Undici provider fixture completed the same 42 cycles and 1,302 calls, then returned to 86.4 MiB heap and 16.0 MiB large-object space after forced collection. The run persisted 1.58 GiB of worker history without a post-GC ratchet.
- Three live-upstream development runs each performed 30 sequential model/tool turns with a generated 320.6 KiB PNG and persisted 112.8 MiB of worker history. Their post-GC heap floors were 77.5, 78.2, and 78.8 MiB; large-object space was 15.6 MiB after every cycle. The live model/auth response lifecycle is not the retention owner in the local reproduction.
- The remaining gap is a reference owned by the long-lived production service but absent from the isolated runtime replica. Stage a one-shot sampling heap profiler that emits only allocation call-site metadata after the existing high-idle forced collection; deploy it only with explicit production authorization.
- The staged profiler samples at 512 KiB intervals, reports at most 12 sanitized call stacks, and starts before runtime initialization. A real-process smoke captured retained allocations without values, and the focused seven-test telemetry suite passes.

### 3. Measure active requests and add diagnostic headroom

Implementation tasks:

- Record allocation-light request composition measurements at the shared model boundary for Main, Task, and workers.
- Persist only numeric counters and the agent role through the telemetry sanitizer.
- Raise production V8 old-space from 2.5 GiB to 4 GiB and the agent-service container limit from 4 GiB to 6 GiB.
- Confirm the deployed limits and a live sanitized measurement without reading request content.

Exit criteria:

- Production has enough headroom to capture the next large request sequence, and each provider call can be correlated with request composition and current process memory.

Validation evidence:

- Source `3cf6615` is deployed to `agent-service` with 4096 MiB Node old-space and a 6 GiB container limit. The replacement is healthy with zero restarts or OOM state, and every retained dependency container kept its identity.
- No model boundary occurred during the first two production minutes, so the first live `pal.model.request` storage sample remains a follow-up observation. The focused persistence test verifies the event's numeric field allowlist and strips sentinel content.

### 4. Define and validate the fix

Implementation tasks:

- Implement the smallest supported lifecycle cleanup at the owning boundary.
- Add a targeted regression and rerun the reproducing soak.

Exit criteria:

- Completed scheduled runs return to the established post-GC baseline without changing visible scheduling behavior.

## Tests

- Bounded diagnostic soak variants against an isolated temporary schema.
- One targeted lifecycle regression for the confirmed owner.
- Backend build and lint after a source fix.
- Focused request-measurement and telemetry-sanitization tests.

## Validation Commands

```bash
cd backend
node --expose-gc scripts/runtime-memory-soak.mjs --scenario=combined --cycles=42 --gc=end --consumption=accepted-only
node --expose-gc scripts/runtime-memory-soak.mjs --scenario=combined --cycles=42 --gc=end --consumption=accepted-only --memory=observational --worker-model=provider-http
npm run build
npx vitest run test/runtime-memory-telemetry.spec.ts
npx vitest run test/chatgpt-model.spec.ts test/run-telemetry.spec.ts
npm run lint
```

## Overall Exit Criteria

- Evidence distinguishes schedule output retention, observational memory, provider request construction, HTTP transport, and the live upstream provider from the remaining production-only boundary.
- The confirmed fix prevents cycle-over-cycle live heap growth in the reproducing scenario.
- Production limit changes are restricted to agent-service and preserve all application state and unrelated service identities.
