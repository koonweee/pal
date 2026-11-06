# Scheduled Run Memory Retention

## Status

In Progress

## Goal

Identify the production-only references that retain screenshot-heavy agent-run data across completed scheduled runs, then define the smallest safe fix.

## Current Behavior

- Production five-minute idle heap ratchets upward across runs and has twice reached the V8 heap limit.
- A successful forced collection reduced heap from 1,650.1 MiB to 1,010.2 MiB, leaving 774.5 MiB in large-object space.
- The existing combined development soak returns to about 78 MiB heap and 14 MiB large-object space after 42 cycles despite persisting 1.58 GiB of worker history.
- Production schedules use Mastra's native schedule worker, which accepts a woken run without consuming its returned output stream. User-triggered Task runs consume the full stream in `MastraAgentRuntime`.
- Production traces end cleanly apart from the run interrupted by the process crash, so abandoned trace trees do not explain the retained floor.

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

### 3. Define and validate the fix

Implementation tasks:

- Implement the smallest supported lifecycle cleanup at the owning boundary.
- Add a targeted regression and rerun the reproducing soak.

Exit criteria:

- Completed scheduled runs return to the established post-GC baseline without changing visible scheduling behavior.

## Tests

- Bounded diagnostic soak variants against an isolated temporary schema.
- One targeted lifecycle regression for the confirmed owner.
- Backend build and lint after a source fix.

## Validation Commands

```bash
cd backend
node --expose-gc scripts/runtime-memory-soak.mjs --scenario=combined --cycles=42 --gc=end --consumption=accepted-only
node --expose-gc scripts/runtime-memory-soak.mjs --scenario=combined --cycles=42 --gc=end --consumption=accepted-only --memory=observational --worker-model=provider-http
npm run build
npx vitest run test/runtime-memory-telemetry.spec.ts
npm run lint
```

## Overall Exit Criteria

- Evidence distinguishes schedule output retention, observational memory, provider request construction, HTTP transport, and the live upstream provider from the remaining production-only boundary.
- The confirmed fix prevents cycle-over-cycle live heap growth in the reproducing scenario.
- Production remains unchanged until deployment is explicitly requested.
