# Header Activity Bubble

## Status

Done

## Goal

Show the configured agent name beside the profile icon while idle, and replace the name with a compact soft speech activity bubble during activity. The header has no visible connection dot. Keep activity collection and presentation contained so future feeds and display policies have explicit owners.

## Current Behavior

- `backend/src/agent/agent-activity.service.ts` tracks Main and Task run IDs and emits a global working/idle flag only when that flag changes.
- Task lifecycle callbacks include direct and scheduled runs. Task identity must be carried into the activity owner.
- Tasks have titles, goals, and objective statuses: in-progress, needs-input, completed. Recurring tasks remain in-progress between runs.
- Public Task messages carry taskId and optional commentary/final_answer phase. Publication occurs at text-end. A final answer can be an outcome, question, or blocker.
- `frontend/src/chat/use-chat.ts` owns the current activity boolean. Its message cache is scoped to the selected conversation; task lists are paginated.
- `frontend/src/shell/AppHeader.tsx` renders the profile icon, name or activity bubble, desktop button, preferences button, and screen-reader connection status.

## Display Policy

The header summarizes global activity independently of the selected conversation. Apply these rules in priority order:

| Condition | Bubble | Interaction |
| --- | --- | --- |
| Browser offline | Configured agent name; avatar at 50% opacity | No task navigation; suppress stale activity |
| Stream unavailable while browser is online | Configured agent name; avatar pulses between 50% and 100% opacity | No task navigation; suppress stale activity |
| Stream connected, first activity snapshot pending | … | No stale task content |
| One unarchived task needs input | `need your input` | Open that task |
| Several unarchived tasks need input | `need your input on {n} tasks` | Open a compact task list |
| Multiple distinct tasks running | `working on {n} tasks` | Open the running-task list |
| One task running with current-run public commentary | Latest commentary, single line | Open the task at the source message |
| One task running without commentary | Task title | Open that task |
| Main working with no running tasks | Animated … | No task navigation |
| Recently settled completed task, with no higher-priority state | Task title and completion check | Open that task |
| No applicable state | Configured agent name, without a status dot | Profile icon remains available |

- Keep fixed bubble copy casual, lowercase, and brief, without terminal periods. Use actual counts in place of `{n}`. Preserve task titles, names, acronyms, and quoted commentary as written; do not apply blanket CSS lowercasing or rewrite source messages.
- Needs-input and running counts represent different facts. Keep the initial bubble to one message; expanded task rows can show status and activity together.
- Main and internal workers do not increment the task count. Count distinct live task IDs, including scheduled checks.
- Task status changes are agent-maintained application facts. Never infer completion from a final answer, silence, or a run ending.
- Completed status arms the completion cue; the task's last successful active run ending publishes it with a fresh timestamp. Display the completion check for five seconds, including alongside higher-priority activity. Expired cues do not replay on reconnect. [Pocket quest](pocket-quest-header.md) defines its motion and lifecycle.
- Collapse commentary whitespace and render plain text with CSS ellipsis. Keep the canonical message unchanged. Use commentary only from the current run; clear it when the run ends. Fall back to title, then ellipsis if identity data is temporarily unavailable.

## Target Data Shape

Extend the existing agent.activity event with a complete, revisioned snapshot. Preserve its status field for existing consumers. The snapshot contains:

- mainWorking.
- runningTasks: distinct task IDs, titles, and optional current-run public commentary references/text.
- needsInputTasks: unarchived task IDs and titles, independent of frontend task pagination.
- latestCompletion: optional task ID/title, unique cue ID, and occurrence timestamp.

Use message identity and sequence for navigation and ordering. Keep run IDs and run-to-task bookkeeping internal. Activity snapshots carry facts; frontend selection owns wording, priority, and animation. Finalize exact DTO names during implementation.

AgentActivityService owns this ephemeral projection. Canonical tasks and messages remain the durable source of truth. Initialize pending-input state from task records, and maintain it from committed application events. Build snapshots from the projection rather than querying the database for each stream subscriber. No schema migration or separate persisted activity history is expected.

Publish on relevant run membership, task metadata/status, and commentary changes. Return the same current snapshot on stream connection. Prevent older initialization reads or overlapping updates from overwriting newer state. Process restart clears live runs and transient completion cues; durable needs-input state is rebuilt.

## Milestones

### 1. Backend activity projection and contract

Status: Done

Implementation tasks:

- Extend the existing activity service with explicit Main/run lifecycle inputs and Task identity mapping. Cover direct runs, scheduled runs, aborts, errors, and shutdown.
- Feed committed task changes and public commentary into this owner through existing application integration points. Keep dependency direction acyclic and avoid a new generic event framework.
- Associate commentary with its originating run in internal publication context; reject late output from an ended or superseded run for header purposes.
- Derive running task counts, unarchived needs-input tasks, and actual transitions into completed. Archival removes pending-input entries; startup loading creates no completion cue.
- Extend event DTOs, validation, generated frontend API types, and relevant contract fixtures. Preserve existing activity consumers.
- Document the activity ownership and snapshot contract in architecture/backend.md.

Exit criteria:

- A client connecting during live work receives accurate task identity and current-run commentary.
- One-to-two and two-to-one running-task transitions emit updates even while global status remains working.
- Failures, late output, scheduled execution, and restart cannot leave phantom running tasks or stale commentary.
- Pending-input counts are complete even when the frontend has loaded only one task page.

### 2. Contained frontend state and selection

Status: Done

Implementation tasks:

- Add `frontend/src/activity/` with an activity state owner/hook, pure `select-bubble` policy, and bubble component/styles.
- Route activity events through the existing SSE connection. Move the activity boolean out of useChat as consumers migrate; retain one activity owner and one stream connection.
- Gate activity presentation on connection freshness and the initial snapshot. Disconnected states keep the configured name visible and use avatar opacity for connection feedback. Use revisions to ignore obsolete snapshots within a connection and timestamps for completion expiry. Reset revision acceptance on reconnect so a restarted backend can establish a fresh snapshot.
- Implement the priority table with explicit navigation targets. Keep task/message navigation in existing application callbacks.
- Add a compact accessible list for multiple running or needs-input tasks, using the supplied activity snapshot rather than task-list pagination. Reuse existing dialog/popover primitives.

Exit criteria:

- Changing selected chats does not change the global bubble's meaning.
- Reconnection replaces stale content from a full snapshot; expired completions never flash again.
- Feed changes remain in the backend activity owner; presentation-policy changes remain in the selector.

### 3. Soft speech header and acceptance

Status: Done

Implementation tasks:

- Replace the visible agent name and dot with the selected bubble. Preserve avatar conversation navigation, configured avatar/accent, accessible identity, desktop, and preferences controls.
- Use Pal's existing theme tokens: compact rounded neutral surface, small left-facing speech tail, subtle border/shadow, 12px text, and a gentle entry/content transition. Match the soft speech preview.
- Use a single-line flexible text region with min-width: 0 and ellipsis. Keep header height stable and reserve the full desktop/settings targets at narrow widths.
- Animate ellipsis during ambiguous activity. Respect reduced motion; avoid continuously bouncing ordinary commentary and duplicate avatar activity animation.
- Keep the full accessible label available and support touch/keyboard activation. Open full commentary in task chat; preserve existing noninteractive connection semantics.
- Update plan status only after validation; rebuild the local development stack for backend/API changes during implementation.

Exit criteria:

- All policy states work in light/dark themes at 320px mobile width and desktop widths, including 44px touch targets.
- Long titles and commentary never displace header actions or change header height.
- Existing chat, avatar navigation, desktop access, and preferences remain functional.

### 4. Deployment validation

Status: Done

Implementation tasks:

- Validate and commit the implementation. Rebuild the isolated development stack and staged PWA through scripts/dev-local; verify health, the activity snapshot, and the rendered header.
- Build the runtime and web images from reviewed source, then deploy through the private release workflow.
- Verify live health, matching release IDs, activity SSE fields, static assets, and header rendering.
- Roll back to retained compatible runtime/web image pins if acceptance fails. There is no application schema migration in this feature. Preserve state and diagnose before retrying uncertain operations.

Exit criteria:

- Development and production run the reviewed implementation and pass the health, SSE, and header acceptance checks.
- Private deployment verification passes; temporary test resources and delivery artifacts are removed.

## Out of Scope

- Additional bubble designs, theme settings, user-configurable priorities, or pluggable feed registries.
- Private reasoning, worker transcripts/counts, raw tool arguments/results, or generated per-tool status narration.
- New agent tools, prompts, status-writing instructions, or LLM summarization calls.
- Progress percentages, ETAs, elapsed timers, rotating messages, schedule countdowns, or idle monitoring badges.
- A separate activity history, full task dashboard, or notification/read/unread system.
- Native iOS header implementation.

## Tests

- Focused backend coverage for concurrent distinct tasks plus Main, scheduled-run lifecycle, current-run commentary ownership, and cleanup after abort/error.
- Snapshot integration coverage for startup/reconnect, needs-input changes beyond one task page, archival, completion transitions, and revision ordering.
- A compact table-driven selector test covering priority, fallback, disconnected/initial states, and completion expiry.
- Focused browser coverage for long content at narrow widths, switching conversations, task/message/list navigation, light/dark appearance, and reduced motion. Reuse existing fixtures and stream mocks.

## Validation Commands

Focused checks use an isolated PostgreSQL test database through TEST_DATABASE_URL.

```bash
cd backend
npm run build
npm run lint
npm run openapi:check
npm test -- test/agent-activity.spec.ts test/task-agents.spec.ts
npm run test:e2e -- test/client-contract.e2e-spec.ts test/openapi-contract.e2e-spec.ts test/chat.e2e-spec.ts

cd ../frontend
npm run check
npm run check:ui
npm run trim
npm run api:check
npm run test:unit -- test-unit/activity.test.ts
npx playwright test test/activity.spec.ts test/chat.spec.ts test/tasks.spec.ts
```

Run the existing API generation workflow when updating public DTOs. From the repository root, use `./scripts/dev-local rebuild` for local integrated acceptance, then `./scripts/dev-local pwa-up` to refresh the configured staged PWA after backend readiness.

## Overall Exit Criteria

- The soft speech bubble shows accurate global activity with the defined state priorities and navigation. When it is absent, the configured agent name appears without a status dot.
- Live execution, task objective status, and connection freshness remain distinct in data and behavior.
- Activity has one backend projection owner and one frontend state/presentation boundary.
- Reconnect, restart, pagination, and run boundaries preserve the stated invariants.
- Relevant checks pass, architecture and generated contracts match implementation, and plan progress is accurate.

## Implementation Progress

- Backend projection, runtime commentary association, generated contract, frontend activity feature, and soft speech header are implemented.
- Backend build/lint/OpenAPI verification, 3 activity/runtime tests, 20 focused API tests, frontend type/ownership/unused-code/generated-contract checks, 4 activity unit tests, and 19 activity/chat/task browser tests pass. The activity browser scenario also passes with 44px touch targets, both themes, and reduced motion.
- Development backend and staged PWA rebuilt through dev-local. Health, full activity snapshot, actual configured avatar/header, and desktop control passed in a touch browser with no page errors.
- Private deployment health, artifact identity, SSE, touch header, desktop control, and offline/reconnect checks pass. Idle correctly hides the bubble.
- The isolated temporary PostgreSQL test container and exact temporary rollout files/screenshots are removed.

The idle-name follow-up passes frontend type/ownership checks and the existing activity browser scenario with a custom agent name. The private deployment shows the configured name with no idle bubble or status dot, visible desktop controls, and zero browser page errors.

## Commentary validation

Synthetic delayed-tool samples confirm that commentary remains model-dependent. The parser accepts omitted reply references, rejects invalid explicit values, and passes backend build/lint plus focused public-output/activity tests. Private deployment health and the complete activity snapshot pass.
