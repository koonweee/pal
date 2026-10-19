# Message Replies and Structured Assistant Output

## Status

Done

## Goal

Let users and Pal quote earlier user or assistant messages when a reference helps clarify the conversation. Support Main and task chats through one client-independent API, with reply selection, previews, and navigation in the playground. Preserve prompt acknowledgments and the existing persistence-backed Read behavior.

## Current Behavior

- `backend/src/chat/chat.dto.ts`, `chat.service.ts`, and `chat.repository.ts` accept, persist, and expose optional reply relationships. Submission idempotency includes a reply ID when one is supplied.
- Main includes Main messages and task assistant finals; task chats include messages belonging to that task. A task final has one identity across both views.
- `backend/src/agent/publish-text.processor.ts` parses native structured output for each completed public text block, retaining its provider phase. Main and task sessions receive input through native signals/messages with public references.
- Shared voice instructions are loaded from `backend/src/agent/instructions/voice.md`. The playground reconciles optimistic sends against SSE/history using idempotency keys.
- An isolated equal-wording benchmark compared native structured output and a text prefix across 20 trials. Both passed; native output added approximately 0.2–0.5 seconds to median publication times, with overlapping ranges. The full Controller/task smoke confirms native JSON format on each provider call.

## Decisions

- Users and Pal can quote either user or assistant messages visible in the current chat.
- Pal may quote any public message it generates, including acknowledgments. Shared guidance asks it to quote sparingly when the reference would otherwise be unclear and avoid repeating a quote in consecutive responses.
- All model-generated public messages use native structured output with `text` and nullable `replyTo`. Reply selection occurs during normal generation. Use one publication path and no separate formatting model call.
- Clearly plain-text model output publishes without a reply reference and logs a warning. Malformed JSON and invalid structured values publish a generic failure message without exposing raw JSON.
- The backend owns IDs, role, timestamps, phase, and task association. User input persists directly through the message API.
- Invalid model-selected references fall back to publishing the text without a quote. Invalid explicit user references reject the submission before persistence or agent delivery.
- Delegation may carry an optional source message reference in the existing tool call. It supplies context; it does not automatically quote every task response or infer the latest user message as the source.
- Quote visibility follows the destination chat. A task final quoting task-only commentary shows that quote in the task chat and appears without it in Main.
- Clicking a playground quote loads older history as needed, scrolls to the original, and briefly highlights it.

## Target Data Shape

### Storage and client API

- Add a nullable self-reference `messages.reply_to_message_id`; existing messages have no reply.
- Add optional `replyToMessageId` to `POST /chat/messages`, alongside the existing optional `taskId`. Clients use Pal message IDs. Include the normalized reference in the idempotency payload; omission and null mean no reply.
- Expose `replyToMessageId` and a nullable, nonrecursive `replyTo` summary in `UserVisibleMessage` for snapshots and message events. The summary contains the target ID, sequence, role, bounded text preview, task ID, and phase. Resolve previews in batches and keep the relationship authoritative in storage.
- Use the target's task ID, role, and phase to determine quote visibility in each chat. The existing global SSE feed carries canonical messages; clients apply the same visibility rule for history and live rendering. This presentation rule does not add a new authorization boundary.
- Reject malformed, missing, or out-of-chat user targets with a documented 400 response. Preserve idempotent replay of already accepted requests.
- Telegram adapters will map platform message IDs to Pal IDs for incoming replies and back to platform IDs for outgoing replies. Native clients use Pal IDs directly. Implementing connectors is deferred.

### Agent output and context

```typescript
// Native structured output for every generated public text block.
{ text: string; replyTo: number | null }
```

- Use the existing public message sequence as the model-facing reference. Resolve it to a stored ID in the application service.
- Include reference identity for user input, published assistant messages, and task-result context. Explicit user replies include the referenced message's identity, role, and text as quoted conversation data, without replacing the new user input.
- Add optional `sourceMessageRef` to the existing delegation tool input. Validate it in the host and attach relevant source context to the delegation signal. Preserve known references through supported memory/context mechanisms.
- Model references must point to an existing earlier message visible in at least one destination receiving the generated message. Render the quote only in destinations where the target is visible. This lets a task final address its originating Main message while keeping task-only quotes out of Main.
- Retain a single stored relationship for finals shared across chats.

## Milestones

### 1. Verify Native Structured Output in the Runtime

Implementation tasks:

- [x] Configure one shared schema through supported Mastra native output options for Main and task sessions. Do not set a separate structuring model.
- [x] Parse and validate each completed public text block before publication, preserving provider phase and thread identity. Use this same path for quoted and ordinary messages.
- [x] Preserve early acknowledgments, tool execution, multiple public blocks in one turn, restored sessions, and silent scheduled runs. Keep native tool arguments and internal signals outside this public-output schema.
- [x] Publish clearly plain-text output without a reply reference and log a warning. Replace malformed/incomplete JSON with a generic failure message, and handle provider errors through sanitized runtime failure handling; never publish raw JSON or add an automatic formatting retry. Empty text produces no public message. Valid structured refusal text publishes normally.
- [x] Validate the actual Controller and task session lifecycle with the deployed model. Measure time to first published acknowledgment and final output, and provider-call counts.

Exit criteria:

- [x] Main and task acknowledgments publish before subsequent tool work completes; finals keep their existing phase-based visibility.
- [x] A scheduled run can finish without public text, and follow-ups work with restored memory.
- [x] No extra model pass, JSON leakage, or duplicate publication occurs. Record measured latency and integration evidence in this plan.

### 2. Persist and Propagate Reply Relationships

Implementation tasks:

- [x] Add the migration, message types, request validation, transactional reply validation, idempotency payload, and batched reply summaries.
- [x] Apply existing chat-membership rules to explicit user replies. Resolve and validate generated references before publication, dropping only an invalid model reference.
- [x] Carry explicit user reply context into Main and direct task input; expose public message references consistently to the agents.
- [x] Carry optional delegation source context and task-result references through the existing signals. Keep delegated source context separate from the final reply choice.
- [x] Add concise shared guidance for selecting replies and following the output contract. Define guidance once and reuse it across Main and tasks.
- [x] Update `architecture/backend.md` to document implemented request, event, history, validation, and agent-publication contracts.

Exit criteria:

- [x] User and assistant replies survive reload and appear consistently in history and SSE with stable target identity.
- [x] Invalid user references have no persistence or agent-delivery side effects; invalid model references preserve the answer as plain text.
- [x] Main and task inputs receive the intended quoted context, and delegated finals can select their source reference without another model call.

### 3. Add Playground Reply Composition and Navigation

Implementation tasks:

- [x] Add an accessible Reply action to persisted user and assistant messages in Main and task chats, usable with mouse, keyboard, and touch.
- [x] Show a compact, dismissible composer quote. Submit its Pal ID with the existing send request; preserve it on failed sends and clear it after a successful submission. Keep reply selection scoped to its chat.
- [x] Render a compact quote inside user and assistant bubbles when the target is visible in the current chat. Use the current theme and retain the existing Read placement and bubble sizing.
- [x] Reconcile optimistic reply bubbles with SSE/history using the existing submission key without duplicates or lost quote state.
- [x] On quote activation, load older pages using the existing history cursor until the target is available, then scroll and briefly highlight it. Cancel stale navigation on chat switches and preserve the viewport while prepending history.
- [x] Update the playground README with implemented behavior.

Exit criteria:

- [x] Users can select, cancel, send, and revisit replies in either chat, including targets outside loaded history.
- [x] Shared task finals show quotes only where their targets are visible, consistently after live events and reload.
- [x] Existing Read, themes, ordinary sends, and active-run follow-ups continue to work.

## Tests

- Extend existing chat integration/e2e coverage with a compact visibility matrix: both target roles, Main, task, shared finals, rejected missing/out-of-chat references, idempotent replay/conflict, and persisted snapshot/SSE summaries.
- Add focused output-processor/runtime coverage for block-level parsing with phases, invalid-reference fallback, malformed/incomplete output, and silent output. Reuse runtime fixtures for explicit reply and delegation context.
- Extend browser coverage with reply selection/cancel/send/reconciliation, older-message navigation, and one shared-final case whose quote is hidden in Main and visible in its task chat.
- Run a small real-model smoke through Main and task sessions covering an acknowledgment plus tool/final, a delayed delegated reply, a direct task reply, and a silent scheduled check. Record timings and provider-call counts; avoid a large additional benchmark unless failures warrant it.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test
npm run test:e2e
npm run agent:smoke
node scripts/task-routing-smoke.mjs direct delegate-known
node scripts/task-schedule-smoke.mjs unchanged changed stop
cd ../frontend-playground
npm run build
PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=5175 npm test
```

The runtime smoke uses isolated Mastra storage in a test database and never writes public Pal messages. The additive migration was applied to the local Pal database with `npm run db:migrate` before updating the backend image.

## Deferred Work

- Telegram and native app implementations, including platform ID mapping.
- Cross-chat quote navigation and quote targets absent from the displayed chat.
- Nested quotes, multiple targets per message, and dedicated reply threads.
- Independent message editing/deletion workflows and specialized quoted-content revision tracking.

## Overall Exit Criteria

- [x] Native structured output works throughout Main/task runtime without extra formatting calls and retains early acknowledgments and silent automation.
- [x] Client-independent reply relationships are validated, durable, and available through history and SSE.
- [x] User and model-selected replies follow the agreed visibility and failure behavior.
- [x] Playground composition, quote rendering, and navigation work in Main and task chats.
- [x] Migration, relevant backend checks, focused browser tests, and real-model integration smoke pass; architecture and README reflect the implemented contracts.

Validation: backend build and type-aware lint passed; all four backend service suites (11 tests), both end-to-end suites (7 tests), playground build, and all 11 Playwright tests passed. The Main-session tests confirm plain-text output publishes with no reply, continues through tool calls, and logs a warning; malformed JSON publishes only a generic failure message. The latest real-model Controller/task smoke made seven provider calls, all with native JSON response format. Main's first acknowledgment published at 2.5 seconds and final answer at 5.3 seconds; Task's acknowledgment and final followed before and after its tool call. An unchanged scheduled check published nothing, and Main answered after restart. The local migration and rebuilt image serve history with reply fields through the live playground proxy; the restarted API returned HTTP 200. A live invalid reply request returned 400 without changing history. A focused browser screenshot was inspected for quote placement.
