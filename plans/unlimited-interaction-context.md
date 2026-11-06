# Unlimited Interaction Context Eviction

## Status

Done

## Goal

Keep interaction workers capable of unlimited tool turns while bounding screenshot-heavy model context and active message history. Preserve complete worker evidence in PostgreSQL and keep Main and Task on their existing observational-memory policy.

## Current Behavior

- Main and Task persist raw messages in PostgreSQL and use thread-scoped Observational Memory with a 12,000-token observation threshold and 3,000-token raw retention target.
- Interaction workers start without inherited conversation history and have unlimited steps, but they do not use Observational Memory during a long active run.
- Completed worker results are projected before parent aggregation, so screenshot evidence remains canonical only in worker history. A long worker can still carry repeated screenshots until it finishes.

## Milestones

### 1. Add native worker context eviction

Implementation tasks:

- [x] Enable thread-scoped Observational Memory for interaction workers with the existing 12,000-token observation and reflection budgets.
- [x] Retain about 3,000 recent raw tokens after activation.
- [x] Keep attachments in durable worker history while sending only their readable placeholders to the Observer.
- [x] Preserve unlimited `maxSteps` and disabled `stopWhen` behavior.

Exit criteria:

- Worker memory uses native observe-and-evict behavior without inheriting parent or prior raw history.
- Complete worker tool evidence remains stored.

### 2. Remove stale visual tool payloads from provider requests

Implementation tasks:

- [x] Add a native `ToolCallFilter` for screenshot-bearing computer, Android inspection, and private-field inspection tools.
- [x] Preserve the two most recent tool-producing steps and filter older matching call/result pairs only from provider requests.
- [x] Leave the active message list, PostgreSQL history, and UI history unchanged by the filter.

Exit criteria:

- Long visual loops keep recent actionable state without repeatedly sending old screenshots.
- Non-visual tool results and durable evidence are unaffected.

### 3. Validate repeated and overlapping work

Implementation tasks:

- [x] Add focused tests for worker memory configuration, transient visual filtering, and durable raw evidence.
- [x] Run the existing worker projection and repeated-memory coverage.
- [x] Run a development soak with repeated and overlapping interaction runs.

Exit criteria:

- Focused build, lint, and tests pass.
- Development evidence shows bounded model-facing context without imposing a tool-turn limit.

## Tests

- Verify worker Observational Memory thresholds, attachment policy, and disabled historical recall.
- Verify visual tool filtering removes only old matching call/result pairs, retains the newest two tool-producing steps, and does not mutate the source prompt.
- Verify raw worker evidence remains in PostgreSQL after model-facing compaction.
- Reuse worker-result projection and runtime-memory soak coverage.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/interaction-tools.spec.ts test/task-workers.spec.ts test/worker-result-projection.spec.ts
npm run benchmark:runtime-memory
cd ..
./scripts/dev-local rebuild
./scripts/dev-local status
```

## Overall Exit Criteria

- Main, Task, and Interaction can continue for unlimited tool turns.
- Interaction raw history and screenshots remain durable while old visual payloads leave the live model context.
- Worker observation and reflection keep active history bounded without changing parent-result projection or user-visible behavior.
- Automated checks and a production-shaped development soak pass before deployment.

## Deferred Work

- Add execution rollover only if retained-allocation telemetry shows that native message eviction leaves completed step aggregates strongly referenced. Do not add a second lifecycle until that concrete gap is demonstrated.

## Validation Results

- Backend build, lint, boundary checks, and all 106 tests pass.
- The worker-memory regression observes a 12,000-token raw tool result, keeps it for the immediately actionable next step, removes it from the following provider prompt, and verifies that the original remains in PostgreSQL.
- Twelve combined cycles ran 30 screenshot actions alongside a 27-call monitoring task. Peak RSS stayed between 0.68 and 0.94 GiB after early cycles; final forced GC measured 437 MiB RSS, 83 MiB heap used, and 17 MiB large-object space while PostgreSQL retained 351 MiB of worker evidence.
- A three-cycle OpenAI Responses provider fixture produced the same result: final forced GC measured 473 MiB RSS, 82 MiB heap used, and 16 MiB large-object space.
- The protected development stack was rebuilt and is healthy. The execution container, Android sidecar, and persistent volumes were preserved.
- Exclusive interaction acceptance could not start because `adb devices` reported no connected phone; the runner restored the healthy dev backend. This does not block the automated context and retention coverage.

## Production Rollout

- Pal source `fe50e8e1e79008bf66f70f4986566b066321ada3` produced Linux AMD64 image `ghcr.io/koonweee/pal:fe50e8e@sha256:417fbb863cd425dff409b22da4ccd2c84a8ce87efbd3ec802891410593afa3c0` in Build update `6aed6e5cc7c3aa9585156a2c`.
- Stack v2 `eb07b5f` changed only the agent-service image. Targeted pull `6aed70fa2ef4de9d290d2f22` and deploy `6aed71452ef4de9d290d2f2e` succeeded with temporary `--no-deps`; normal Stack arguments are restored.
- Agent-service is healthy with zero restarts and no OOM, fatal, uncaught, ENOMEM, or startup-error markers. Web, execution, PostgreSQL, Google MCP, Android, and egress retained their exact container identities. All 52 tasks and 2,692 pre-nudge public messages were retained.
- The running image contains the two-step visual `ToolCallFilter` and worker Observational Memory with historical recall and attachment observation disabled. A live resumed interaction showed completed computer-tool and observation cycles while the backend used 548 MiB of its 4 GiB limit.
- Seven older in-progress tasks are active scheduled monitors. One unscheduled Gap return run lost its terminal span during the preceding crash; idempotent message `#2695` resumed it as run `d8401a08-fbef-482d-8c3a-54708e7189c1`, which produced new completed tool and memory spans after deployment.
