# Core Task Agents

## Status

Done

## Goal

Main delegates substantial or ongoing work to independently running task conversations. Users can steer tasks through Main or directly in task chat. Tasks retain private context across runs and backend restarts. Task finals appear in both task chat and Main.

Reference: [draft architecture brain dump](../architecture/draft-architecture-brain-dump.jpg).

## Scope and Decisions

- One backend process, one Main Agent configuration, and one reusable Task Agent configuration. Each task has a persistent Mastra thread; executions can come and go.
- Custom runtime integration is a small adapter for input, output, and shutdown. Do not introduce a generic orchestration framework, custom worker registry, new event bus, lifecycle state machine, or interchangeable execution backends.
- Main guidance stays short: answer simple requests directly; prefer delegation when unsure; reuse a confidently matched task, otherwise create a new task. Pass relevant background and preferences when delegating.
- Task guidance covers execution, explicit status updates, and being mindful that users and other agents share the workspace. Tasks may run concurrently with no custom workspace locks, execution queues, or per-task isolation.
- Users can send text directly to task chat. The task agent sets `in-progress`, `needs-input`, or `completed` through a tool, including when follow-up work changes its status.
- Archiving only changes task-list visibility. Active work continues. There are no stop/resume controls.
- Main commentary and finals appear in Main. Task commentary appears in task chat; task `final_answer` messages appear in task chat and Main as one shared message.
- Published task finals also enter Main's private context: deliver while Main is active, persist without waking while idle. Main is told the result is already visible.
- Restart preserves stored context. New input starts a fresh run; interrupted executions are not automatically replayed or resumed.
- Deferred: schedules, shared preference memory, attachment submission, action-driven agent continuation, durable execution recovery, additional helper subagents, and background-task orchestration.
- Mastra Goals are outside scope. The task's goal remains a Pal domain description. No phase field is added to public messages or application tables.

## Current Behavior

- [Main runtime](../backend/src/agent/main-session.ts) registers Main's AgentController Session and one reusable Task Agent, sharing model/auth/workspace infrastructure and PostgreSQL storage.
- [Runtime adapter](../backend/src/agent/mastra-agent-runtime.ts) routes native input, consumes task streams, publishes phase-based text, shares results privately with Main, and cancels runs during shutdown.
- [Task tools](../backend/src/agent/task-tools.ts) connect Main lookup/delegation and task status updates to application services. Stable task thread IDs require no mapping table.
- [Chat coordinator](../backend/src/application/chat-coordinator.service.ts) accepts Main and task text while preserving submission ordering and idempotency.
- [Frontend playground](../frontend-playground/README.md) provides task navigation, details/status, direct chat, archive/unarchive, reconnect recovery, and the shared desktop.
- Dependencies remain pinned to `@mastra/core@1.76.0`, `@mastra/memory@1.37.0`, and `@mastra/pg@1.29.0`. No application migrations or configuration variables are required.

## Native Primitives and Custom Integration

| Responsibility | Native Mastra | Application integration |
| --- | --- | --- |
| Agent execution | [Agents](https://mastra.ai/docs/agents/overview) and existing [Main Session](https://mastra.ai/docs/harness/agent-controller) | Configure Main and Task Agent instructions and toolsets. Task execution uses direct Agent APIs. |
| Task context | [Memory](https://mastra.ai/docs/memory/overview) and [Observational Memory](https://mastra.ai/docs/memory/observational-memory) | Stable task-to-thread identity and task-specific instructions. |
| Delegation | [Tools](https://mastra.ai/docs/agents/tools) | Task lookup, create/reuse, and a small delegation adapter calling task services. Tools call application services. |
| Start and steer | [Messages/signals](https://mastra.ai/docs/harness/signals) | Route forwarded user input with message semantics and Main-generated instructions with signal semantics. Await native acceptance. |
| Publication | [Output processors](https://mastra.ai/docs/agents/processors) | Associate output with its task; apply phase visibility; commit messages and emit SSE. |
| Results to Main | [Signals](https://mastra.ai/docs/harness/signals) | Send a reactive `task-result` signal after final publication, containing task ID, message ID, and final text marked already visible. |
| Product state | Storage supports agent history; public domain state stays in existing services | Task metadata/status, archive behavior, public history, UI, and error presentation. |

Communication paths:

- Main -> custom `search_tasks` / `delegate_task` -> resolve task thread -> native Task Agent message/signal -> Mastra delivers to an active run or wakes the idle thread with stored memory.
- Task output -> native processor -> custom phase routing -> existing ChatService/database/SSE -> task and Main views.
- Published task final -> custom result payload -> native Main Agent signal -> Main's private context.
- Direct task composer -> existing chat endpoint with `taskId` -> task thread; Main routing is bypassed.

## Target Data Shape

- Use a deterministic internal thread identity such as `pal-task:<task UUID>`, with owner resource `pal-owner`. This avoids a mapping table or runtime IDs in the public task model.
- Keep task status values and archive state unchanged. Business status is agent-managed and is not inferred from final output, stream end, or restart.
- Accept text-only `POST /chat/messages` requests with optional `taskId`. Preserve existing idempotency and failed-handoff behavior.
- Task commentary publishes with `taskId` and `showInMainChat: false`; task `final_answer` publishes with `showInMainChat: true`. Main output remains main-only.
- If phase is absent, retain task text in task chat without projecting it into Main; validate that the configured model supplies phase before acceptance.
- Do not create a second public copy of Main's delegation prompt. Direct task messages are persisted once in task chat.
- Retain the existing global activity event shape; `working` gives a rough indication that any Main/task run is active. Use minimal in-memory bookkeeping over native run events. Task business status remains separate; persistent activity tracking and per-task live activity events are deferred.

## Milestones

### 1. Working Delegation and Steering Slice

Implementation tasks:

- [x] Resolve the uncertain OpenAI phase-metadata path with a small probe against the installed provider/Mastra stack, including the text-completion boundary.
- [x] Register one reusable Task Agent with shared runtime/storage, thread-scoped memory, and existing model/auth/workspace infrastructure.
- [x] Keep Main's toolset focused on conversation, lookup, and delegation; expose execution tools on Task Agent.
- [x] Implement `delegate_task` for task creation and known task IDs: resolve the stable thread, send input, and await native acceptance.
- [x] Allow direct task text input through ChatCoordinatorService, preserving validation, submission ordering, and idempotency.
- [x] Extend the output processor to attribute task output and apply phase-based visibility through ChatService. Avoid duplicate publication from stream observation or history replay.
- [x] After committing a task final, send Main its result signal with stable source identifiers and the agreed active-delivery / idle-persistence policy. Tell Main that results are already visible.
- [x] Add only the adapter/subscription wiring needed for input, output, errors, and shutdown. Verify native start/steer/wake behavior while implementing this slice.

Exit criteria:

- Main delegates a task, the task starts, a user steers it through task-addressed input, and its final appears once in both chat histories through the existing API.
- Task commentary remains task-only; Main can continue independently.
- Idle Main does not wake just to repeat the result; its next turn can use the persisted result. Active Main receives the result.
- The phase probe and native API findings are recorded here. No separate runtime-validation framework is introduced.

### 2. Task Continuity and Product Behavior

Implementation tasks:

- [x] Add bounded task lookup using existing PostgreSQL metadata and wire it into Main's short create/reuse guidance.
- [x] Provide a task-status tool calling TasksService for the current task. Add short Task Agent guidance for status updates and shared-workspace etiquette.
- [x] Complete the small runtime adapter's sanitized failure reporting and clean shutdown, including concurrent task runs.
- [x] Keep global activity simple: aggregate native Main/task run start/end events using minimal in-memory bookkeeping. Some active run means `working`; task business status stays separate.
- [x] Extend the backend integration journey to cover independent task context, idle wake, runtime recreation, and recall. Keep task-specific state in invocation/thread context rather than mutable shared Agent fields.
- [x] Keep result delivery lightweight and observable. Prevent duplicate delivery within the live publication path; document the crash window between public publication and signal persistence. Durable outbox/replay remains deferred.

Exit criteria:

- Main can find/reuse a task; uncertain matches create a new task. Main-routed and direct follow-ups reach the correct thread.
- Two tasks retain separate context. Task agents explicitly update status through existing versioned events; final publication does not imply completion.
- Restart launches no task work automatically; new input recovers stored context.
- The global indicator provides a rough aggregate working/idle view and clears when observed runs finish. There is no persistent activity state or per-task activity UI.
- Application integration remains a small adapter and domain services, without a generic orchestration framework.

### 3. Task Chat and End-to-End Validation

Implementation tasks:

- [x] Add task navigation/details, status display, archive/unarchive controls, an archived-task view, task history, and a text composer to the playground.
- [x] Reuse snapshot/SSE version merging and reconnect recovery for task lists and the selected chat. Extend the Vite proxy for task APIs.
- [x] Keep Main and task history membership correct, including shared messages and paginated history.
- [x] Preserve the shared desktop viewer and allow task input while agents work.
- [x] Update architecture/API and frontend documentation to reflect validated implementation. Update configuration examples only if configuration is introduced.
- [x] Complete the browser journey and relevant checks below, record results here, and update the plan index status.

Exit criteria:

- A user delegates through Main, opens the resulting task, steers it directly, and sees its final in both chats.
- Archive hides a task from the active list while work continues; users can open and unarchive it from the archive view.
- Refresh/reconnect preserves task status, history membership, and message identity.

## Tests

Reuse existing fixtures and coverage. Build two journeys incrementally with the implementation:

- One backend integration journey: Main creates/reuses a task, direct input steers it, phase controls publication, Main receives the result, and subsequent input recalls task context after runtime recreation. Include a second task to check context/output isolation. Reuse existing idempotency and archive coverage.
- One browser journey: Main delegation, task navigation/direct input, shared final, status display, archive/unarchive, and reconnect.

Add a targeted case only when an essential behavior cannot be covered reliably by these journeys or an actual bug requires a regression test. Do not mirror the same behavior across separate runtime, service, publication, and end-to-end suites.

Use the small real-model phase probe from milestone 1 and existing memory smoke infrastructure for evidence deterministic fixtures cannot provide. Extend the existing smoke command only where task-specific behavior needs verification.

## Validation Commands

Run build/lint and the affected backend and browser suites. The commands below are available checks; select targeted tests rather than duplicating the new journey across suites or repeatedly running every suite.

```bash
cd backend
npm run build
npm run lint
npm test
npm run test:e2e
npm run agent:smoke
```

```bash
cd frontend-playground
npm run build
npm test
```

Extend the existing smoke command for the task path only as needed. Real-model checks use the configured ChatGPT login and are recorded separately from deterministic tests.

## Overall Exit Criteria

- [x] Main follows the agreed short delegation guidance; uncertain matches create new tasks.
- [x] Main and users can start/steer task agents, with persistent per-task memory across runs and restart.
- [x] Native Mastra primitives own execution, input delivery, and memory; custom code owns task mapping, tools, publication, and UI through a small adapter and domain services, with no generic orchestration framework.
- [x] Task agents explicitly manage business status; archive/unarchive controls and the archived-task view work while archive only affects task-list visibility.
- [x] Global activity provides a simple aggregate indication that Main or a task is working.
- [x] Phase controls visibility without being stored; shared finals retain one public message identity and enter Main's private context.
- [x] The implementation has no automatic recovery, schedules, shared preference system, stop/resume UI, execution queue, workspace locks, or per-task isolation.
- [x] Relevant checks pass and current-state documentation and plan status agree with the validated implementation.

## Native API Findings

- Direct Agent execution defaults to five model/tool steps; AgentController supplies a fixed 1,000-step budget. Main and task runs use native `maxSteps: 0` with `stopWhen: () => false` to remove step-count limits. Main overrides Controller options through the public Session machinery boundary for initial runs and resumes. Unfinished task status remains independent of run activity.

- Native `sendMessage` and reactive `sendSignal` acceptance report `wake` with a stream or `deliver` into the active run. Consuming wake streams supplies completion/error/activity bookkeeping. Mastra owns active-thread lookup and stored-context restoration.
- Seed `MASTRA_THREAD_ID_KEY` and `MASTRA_RESOURCE_ID_KEY` in wake `requestContext`: dynamic instructions resolve before automatic memory-context initialization in the installed version. Instructions and status tools read invocation context; task identity is never mutable Agent state.
- At `text-end`, phase is available at `part.payload.providerMetadata.openai.phase`, with matching `text-start` as fallback. The processor uses native `streamParts` for completed text. The real configured provider supplied `final_answer`; the controlled journey verifies commentary stays task-only.
- Main result delivery uses native `Agent.sendSignal` with active `deliver` / idle `persist`, awaiting both `accepted` and `persisted`. The Session convenience API exposes acceptance before idle persistence finishes, so direct Agent delivery makes persistence completion observable.
- Each task final is committed once, then signaled once in the live publication path. Delivery errors are logged without withdrawing the public message. A crash between public commit and private signal persistence can leave Main unaware of a visible result; durable outbox/replay is deferred.
- The existing Vite `/api` proxy already covers task endpoints. UI additions reuse existing snapshot/SSE and desktop infrastructure.

## Validation Record

2026-10-07:

- Backend `npm run build` and `npm run lint` passed.
- `npx vitest run test/task-agents.spec.ts test/main-session.spec.ts` passed six tests. The single task journey verifies actual native delegation, active steering, submission idempotency, separate task contexts, explicit status, aggregate activity, shared final identity, idle Main persistence without wake, active Main delivery, and recall after runtime recreation.
- `npx vitest run --config vitest.config.e2e.ts test/chat.e2e-spec.ts` passed four API/SSE/submission tests.
- Frontend `npm run build` and `PLAYWRIGHT_PORT=5176 PLAYWRIGHT_CHANNEL=chrome npm test` passed all seven browser tests. The task journey covers direct input, shared finals, status, archive/unarchive, reconnect, and reload. Desktop and 390px task-chat screenshots were inspected; the composer stays visible without horizontal overflow. Existing desktop tests remain passing.
- `npm run agent:smoke` passed real Main/task recall after restart and forced observation/reflection, private memory output, task final phase metadata at the publication boundary, and Main's private result context. Temporary test thresholds exercise compressed recall without requiring a production-size conversation.
- A bounded real-model probe using the production `search_tasks` / `delegate_task` schemas passed lookup, creation, and existing-task reuse. It used a temporary test schema and performed no workspace actions.
- The task journey requires seven model steps before its final. It reproduced the default five-step cutoff and passes with unlimited task steps. The journey also checks Main's actual invocation, resume options, and task defaults for disabled step limits. The live Vettel task stopped after one status call and four command calls; its idle indicator correctly reflected the ended run.
- `git diff --check` and documentation relative-link checks passed.

## Remaining Work

None within this plan's scope. Deferred capabilities remain listed in Scope and Decisions.
