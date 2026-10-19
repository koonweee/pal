# Task Schedules

## Status

Done

## Goal

Let users ask a task to perform recurring work. Task agents manage persistent Mastra schedules through conversation, retain context between checks, and report results according to the user's notification criteria. Carry the client's timezone from message submission to agent input and scheduling.

## Current Behavior

- Main and task threads support delegation, steering, memory, task chat, and phase-based result sharing.
- Browser message timezone is validated, persisted, returned through history/SSE, and forwarded as native message attributes.
- Task agents manage recurring schedules through TaskSchedulesService and native Mastra storage/workers.
- Task guidance loads from sectioned Markdown at startup and defines cadence, quiet checks, and overall task status.
- Mastra owns schedule persistence and dispatch. The application database stores message metadata and task records.
- TaskSchedulerWorker starts Mastra's native consumer before polling to preserve overdue startup ticks in core 1.74.0.

## Scope and Decisions

- Task agents choose a reasonable cadence when omitted and tell the user the chosen cadence, timezone, and notification criteria.
- Schedule management is conversation-only. Main delegates; task agents create, list, update, pause, resume, and delete their own schedules.
- Use native Mastra behavior for overdue ticks, restart, dispatch, and failures. Add no custom replay queue, retry policy, execution backend, or worker registry.
- Deliver scheduled signals into an active task run; wake an idle task using the same thread. Include model-visible automation source, schedule ID, and task ID.
- Use an explicit IANA timezone on each schedule, inferred from message context unless the user specifies another. Ask when timing depends on a timezone that is unavailable. A later browser timezone change does not silently change an existing schedule.
- Quiet completion is prompted: no user-facing text when notification criteria are unmet. Commentary remains task-only; nonempty finals retain the existing Main/task sharing contract.
- Task status describes the overall objective. Monitoring stays in-progress between checks. The agent pauses active schedules before marking the overall task completed. These are tool/guidance decisions; no automatic status-to-schedule coupling.
- Archive retains its existing visibility behavior. Archive instructions are unnecessary in the task prompt.
- Scope is recurring cron schedules. One-off reminders, schedule UI, shared preference memory, custom notification delivery, and guaranteed exactly-once execution are deferred.

## Native Primitives and Application Integration

| Responsibility | Native Mastra | Pal integration |
| --- | --- | --- |
| Scheduling and persistence | [Schedules](https://mastra.ai/docs/harness/schedules) and PostgreSQL schedules storage | Start native workers after the agents and observers are registered; recover stored schedules at startup. |
| Schedule management | [mastra.schedules](https://mastra.ai/reference/schedules/overview) | Thin TaskSchedulesService validates task association, binds thread/resource identity, and exposes a small view to tools. |
| Scheduled task input | [Signals](https://mastra.ai/docs/harness/signals), active delivery and idle wake | Set automation attributes and seed thread/resource request context for dynamic task instructions. |
| Context and publication | Existing native Memory, Agents, and output processor | Reuse task context and publication; observe scheduled execution for activity, errors, and shutdown. |
| Client timezone | Native message attributes expose metadata to the model | Browser inference, API validation, message persistence, idempotency, and forwarding through Main/task inputs. |

TaskSchedulesService is the application boundary, with Mastra as the authoritative schedule store. It must not maintain synchronized schedule rows in a second database table. Tools call the service; business checks stay out of agent adapters.

## Target Data Shape

- Add optional `metadata: { timezone?: string }` to message submissions. Initially accept only this typed metadata field.
- Persist message metadata in a JSONB column with an empty-object default, and return it through history/SSE. Keep message text unchanged.
- Include supplied timezone in idempotency comparison. Preserve old retry identities for submissions with no metadata; normalize empty metadata consistently.
- Bind schedules to `agentId: pal-task-agent`, `threadId: pal-task:<task UUID>`, and `resourceId: pal-owner`. Use native schedule IDs and list filters; no task/schedule mapping table.
- Each schedule stores its prompt, cron, explicit timezone, and native active/paused status. Multiple schedules may belong to a task.
- Use `signalType: reactive`, `tagName: scheduled-execution`, and attributes identifying `source: automation`, schedule ID, and task ID. Configure `ifActive.behavior: deliver` and `ifIdle.behavior: wake`.
- Seed Mastra thread/resource keys through persisted `ifIdle.streamOptions.requestContext`. Signal attributes identify the trigger to the model; request context supplies runtime identity.
- Return schedule ID, task ID, prompt, cron, timezone, status, and native next-fire time to agent tools. Updates are scoped to the current task and owner.
- Remove the application automation table and type after verifying its records have been handled.

## Milestones

### 1. Client Timezone Through Agent Input

Implementation tasks:

- [x] Have the browser infer its timezone using `Intl.DateTimeFormat().resolvedOptions().timeZone` and send it as message metadata for both chats.
- [x] Add typed optional metadata validation, persistence, history/SSE serialization, and backward-compatible idempotency handling. Generate the additive database migration.
- [x] Pass timezone as native message attributes to Main and direct task inputs, covering idle starts and active-run delivery. Ensure it reaches the actual model prompt and retained thread history.
- [x] Keep Main's guidance short: include relevant timezone context when delegating. Task schedule creation uses that context or an explicit user timezone, with no global preference store.

Exit criteria:

- [x] A browser submission carries timezone through HTTP, persistence, and the model input without altering the visible message text.
- [x] Invalid timezones are rejected; legacy requests and retries remain valid; changing metadata under the same idempotency key conflicts.
- [x] Delegated and directly messaged task agents receive the timezone context needed to create schedules.

### 2. Working Scheduled Task Flow

Implementation tasks:

- [x] Introduce TaskSchedulesService and task-scoped create/list/update/pause/resume/delete tools backed by `mastra.schedules`. Reuse Mastra validation for cron/timezone and native schedule IDs.
- [x] Wire native scheduler startup after Task Agent registration and observation setup. Verify both runtime-created schedules and restored schedules fire in our Nest/Controller host.
- [x] Create schedules on existing task threads using the signal and wake configuration above; preserve active delivery and per-task context.
- [x] Extend the small runtime adapter so schedule-started runs participate in working/idle, sanitized failures, and orderly shutdown. The native signal runtime drives scheduled streams; avoid duplicate stream consumption or publication.
- [x] Split task.md into short sections: Role, Communication, Schedules, Task status, and Shared workspace. Retain concise existing guidance.
- [x] Add brief schedule guidance: establish a cadence and timezone, recognize automation signals, follow notification criteria, stay silent on unremarkable checks, and keep addressing outstanding user requests.
- [x] Expand the set_task_status tool description to distinguish the overall objective from one run/check. Keep a short reminder in task.md to use the tool and pause schedules before completing monitoring.
- [x] Verify the native scheduling APIs while building this flow; do not introduce a separate orchestration-validation milestone.

Exit criteria:

- [x] Main delegates recurring work; the task creates a schedule and communicates its configuration.
- [x] A native scheduled tick wakes the same task with retained context or joins its active run with identifiable automation metadata.
- [x] A quiet check completes and clears activity without a public message; a reportable result appears through existing final sharing.
- [x] Scheduling survives runtime recreation. Pause/resume/delete work through task tools; pausing future ticks does not abort a current run.

### 3. Remove Legacy Automations and Finish Validation

Implementation tasks:

- [x] Recheck existing automation records before migration. With an empty table, remove it through a generated migration without building a backfill framework. If records have appeared, preserve their task/prompt/UTC cadence through the native API and verify them before dropping the table.
- [x] Remove AutomationsService, AutomationsRepository, their module/type, createWithTask, stale module wiring, and the direct cron-parser dependency if no callers remain.
- [x] Update test cleanup and replace obsolete automation transaction tests with the relevant schedule journey coverage. Task creation and schedule creation are separate operations; a scheduling failure leaves the task available for retry.
- [x] Update current-state architecture/API models, backend/frontend maintenance documentation, and this plan's validation record.
- [x] Build the container, apply the validated migrations explicitly, and verify startup, bundled prompts, persisted schedule restoration, and API availability.

Exit criteria:

- [x] Mastra is the only schedule store/executor; no unused automation code or duplicate cron validator remains.
- [x] Existing task/chat behavior and stored conversations are preserved.
- [x] Relevant checks pass and implementation documentation reflects validated behavior.

## Tests

Keep coverage small and reuse existing journeys:

- Extend the existing chat API journey for metadata validation, persistence, idempotency, and legacy submissions.
- Extend the existing task-agent integration journey for timezone in actual model inputs, schedule creation and a real native due tick, active-run delivery, restart/context recall, quiet completion, activity, pause/resume/delete, and rejection of a schedule update for another task. Use an isolated test database/schema; do not create production schedules for validation.
- Extend the existing browser submission journey to check inferred timezone on Main and task requests. No schedule UI journey is needed.
- Run one bounded real-model probe with revised guidance: no-change check, reportable change, and stop-monitoring request. Verify silence, final phase, ongoing status, and pause-before-complete. Add further targeted tests only for gaps or bugs found.

## Validation Commands

Run from the indicated directories; select the existing journeys above.

```bash
cd backend
npm run db:generate
npm run build
npm run lint
npx vitest run test/main-session.spec.ts test/task-agents.spec.ts test/services.spec.ts
npx vitest run --config vitest.config.e2e.ts test/chat.e2e-spec.ts
```

```bash
cd frontend-playground
npm run build
PLAYWRIGHT_PORT=5176 PLAYWRIGHT_CHANNEL=chrome npm test
```

Database generation follows schema changes. Apply migrations during controlled deployment after tests, using the existing `npm run db:migrate` command. Reuse a small fixture probe for real-model behavior rather than introducing a new test framework.

## Overall Exit Criteria

- [x] Browser timezone reaches Main and task model context and can inform an explicitly zoned schedule.
- [x] Task agents manage durable schedules through conversation using the thin service and native Mastra primitives.
- [x] Active tasks accept automation ticks; overdue execution follows native behavior.
- [x] Quiet checks produce no public message, monitoring remains ongoing, and the agent pauses schedules before completion.
- [x] Native scheduled runs integrate with existing memory, publication, aggregate activity, and shutdown.
- [x] Legacy automation storage/code is removed safely and guidance remains brief and sectioned.
- [x] Focused checks and deployment verification pass; plan status and documentation are current.

## Planning Evidence

- Read-only production check on 2026-10-07: zero rows in the application automations table.
- A synthetic probe using the configured gpt-6.1-sol model at medium reasoning completed two unchanged-price checks with no assistant text and emitted final_answer for a price drop. All three marked the task completed, establishing the need for overall-task status guidance.
- Source inspection confirms native user-message attributes are rendered into model input, native schedule wake options accept serialized request context, and the scheduler advances an overdue tick to a future occurrence.
- The working integration journey verifies native creation, active tick delivery, overdue restart/context recall, quiet activity, sanitized failures, pause/resume/delete, and task ownership. API and browser journeys verify timezone and retry behavior.

## Validation Record

Validated on 2026-10-07:

- Backend build and type-aware lint passed.
- Focused Main/task/service integration suites: 7 tests passed. The existing task journey includes scheduled creation, active delivery, quiet Working/Idle, overdue restart recall, ownership checks, invalid cron, pause/resume/delete, and sanitized scheduled errors.
- Chat API journey: 4 tests passed, including timezone validation/persistence/SSE, metadata conflicts, and legacy retry normalization.
- Frontend build and Chrome browser journeys: 7 tests passed, including inferred timezone for Main and task submissions.
- Real-model probe using gpt-6.1-sol at medium reasoning: unchanged checks emitted no text and stayed in-progress; a price drop emitted final_answer and stayed in-progress; stopping paused the schedule before setting completed.
- Production automations remained empty. The guarded migration applied successfully, removed that table, and added message metadata.
- Docker image built and Pal was recreated. API history returned HTTP 200; API/dbus/desktop/viewer were RUNNING; bundled prompts and scheduler adapter were present.
- Production record-invariant checks pass. Native schedules and trigger tables exist in the Mastra schema.

The startup regression required a small supported SchedulerWorker subclass: Mastra 1.74 otherwise polls before subscribing its agent schedule consumer. The adapter starts that native consumer first; native cron, persistence, delivery, and overdue advancement remain unchanged.
