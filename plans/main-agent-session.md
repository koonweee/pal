# Main Agent Session

## Status

Done

## Goal

Run one persistent Main conversation using Mastra inside the NestJS backend, authenticated through ChatGPT login. Main-chat text submissions enter the same conversation immediately, including while the agent is working. Completed assistant text is published through Pal chat and SSE independently of input submission.

Scope: one owner, one backend process, Main text chat, PostgreSQL-backed agent history, and Mastra Observational Memory. Start with a fresh conversation; legacy assistant history and the iOS app are not migrated.

## Current Behavior

- [ChatCoordinatorService](../backend/src/application/chat-coordinator.service.ts) preserves submission order through public persistence and native Main acceptance, then returns `{ messageId }` independently of generation.
- [MastraAgentRuntime](../backend/src/agent/mastra-agent-runtime.ts) owns the persistent session, activity, asynchronous failure notices, and shutdown. [Main session](../backend/src/agent/main-session.ts) configures native PostgreSQL history and Observational Memory.
- [ChatService](../backend/src/chat/chat.service.ts) owns public persistence and emits `message.added` after commit. Existing idempotency results are returned without resubmission.
- Main's private context comes from its stable Mastra thread. Pal's visible history includes shared task messages and is independent of the model context.

## Target Data Shape

- Keep Pal's public message model, SSE payloads, and successful send response `{ messageId }` unchanged.
- Store Mastra conversation history and Observational Memory in the existing PostgreSQL database, using a separate schema and the supported `@mastra/pg` initialization/migration lifecycle verified in milestone 1.
- Use one stable owner resource identity and Main thread identity across process restarts. Restore the binding through native storage where supported.
- Keep ChatGPT credentials in a private persistent location outside version control. Document required configuration in `backend/.env.example` without credential values.
- No submission-status column, outbox, delivery ledger, or automatic input recovery in this slice. No Pal domain-table migration is expected; document any concrete schema requirement found during the spike.

## Behavior and Boundaries

### Input

Replace `reply()` with an acceptance-oriented `submit(message): Promise<void>` boundary. The promise resolves when Mastra accepts the input, before generation completes. Use native message acceptance APIs; session `sendMessage()` and agent `sendMessage()` have different promise semantics that must be verified in the pinned release.

For a new valid submission:

1. Persist the user message through `ChatService.accept()`.
2. Submit it to the initialized Main session/thread using Mastra's native immediate message delivery.
3. Return `{ messageId }` after acceptance. Map a handoff failure to a sanitized HTTP 503 response.

An active Main receives the new input through the native user-content signal route used by `sendMessage()`. An idle Main wakes. Do not wait for the previous turn to finish or add a custom turn drain. Reserve interrupting `steer()` behavior for future explicit interruption requirements. Initialize and bind Main once before accepting traffic; verify back-to-back delivery and the active-to-idle boundary.

Reject task-scoped submissions and attachments with HTTP 400 before message persistence for this slice. Existing history, file, and task APIs remain available; action-driven agent continuation is deferred.

### Output

Main's output processor handles live `text-end` independently of input calls, reducing the matching text deltas from Mastra's native `streamParts` collection. Session events own activity and terminal errors. The pinned release's session events omit text completion, so its assembled display parts cannot provide this boundary.

Publish completed, nonempty text parts from the live Main assistant through `ChatService.publish()`. Both commentary and final text are visible. Phase is not a visibility condition. Preserve native provider metadata in agent history.

Exclude reasoning, tool calls/results, signals, history replay, memory processing, and other agents' output. Publish each completed text part once through its live completion hook, matching native span identity. Do not additionally publish a run's aggregate final text. Unfinished text on abort/error remains private; already completed text remains visible.

Main's instructions state that ordinary assistant text is user-facing. One input can produce multiple visible messages, and several inputs can contribute to one response. Publication commits the message and emits the existing SSE event. No token streaming to clients is required.

### Failure and Restart

- A failed submission leaves its persisted user message in history, including the already emitted SSE event.
- Preserve existing idempotency behavior: a repeated key returns the original message ID and does not resubmit, including after a failed handoff. The user can send again with a new key.
- No automatic retries of the Pal-to-Mastra handoff or reconciliation of uncertain acceptance. Missed or duplicate processing around failures is an accepted limitation.
- Generation failures after acceptance are handled asynchronously: sanitized operational logs and a concise user-visible failure notice through `ChatService`. Intentional shutdown cancellation does not generate a failure notice.
- Completed agent history and memory survive restart. Interrupted work does not automatically resume. Use native cancellation and teardown on shutdown, and release subscriptions/storage resources.
- Drive `agent.activity` from Main's runtime lifecycle rather than the number of submitted HTTP requests. An accepted additional message must not independently mark Main idle when its handoff completes.

## Milestones

### 1. Verify Native Mastra Integration

Implementation tasks:

- [x] Pin compatible published Mastra and provider versions; inspect their actual exports and types.
- [x] Prove ChatGPT OAuth login, credential persistence/refresh, and a streamed model call using the reusable Mastra provider path. Ensure Pal's assistant instructions are applied correctly despite coding-oriented provider defaults.
- [x] Identify the supported AgentController/session initialization, persistent thread binding, acceptance acknowledgement, and teardown APIs.
- [x] Verify immediate input delivery while active and delivery at the active-to-idle boundary using controlled model execution. Check ordering during concurrent submission/startup; resolve demonstrated gaps with the smallest acceptance-only gate.
- [x] Verify the completed text-part event contract, including commentary followed by tools and final text, reasoning exclusion, and interrupted text. Prefer native assembly; document a concrete gap before adding custom assembly.
- [x] Verify PostgreSQL storage setup and Observational Memory with observer/reflection models explicitly using the ChatGPT-authenticated provider.
- [x] Record the selected APIs, versions, and validation limits in this plan. Keep reusable spike coverage as the minimal integration tests.

Exit criteria:

- [x] A real ChatGPT-authenticated call succeeds, with no separate API-key requirement.
- [x] Native input acceptance, active-run delivery, assembled output boundaries, and persistent storage are demonstrated in the pinned release.
- [x] Any unsupported dependency behavior has a documented, minimal resolution before production integration.

### 2. Connect Main to Pal Chat

Implementation tasks:

- [x] Add `backend/src/agent/mastra-agent-runtime.ts` and wire it through `AgentModule`; retain an injectable test double.
- [x] Configure one Main agent/session, PostgreSQL memory, a concise personal-assistant instruction set, and one selected model. Add a terminal login command and document credential location and configuration.
- [x] Replace the runtime's request/response boundary with submission acceptance and update `ChatCoordinatorService.send()` accordingly.
- [x] Add Main-only text admission checks, retaining the agreed persistence, idempotency, and HTTP failure behavior.
- [x] Connect Main's completed text output to `ChatService.publish()` through the smallest adapter. Keep persistence and SSE ownership in application services.
- [x] Wire activity, asynchronous generation failures, cancellation, and shutdown to native runtime lifecycle events. Handle publication failures in operational logs without regenerating the response.

Exit criteria:

- [x] A Main message receives an asynchronous model response through history and SSE; the HTTP request waits only for input acceptance.
- [x] B reaches Main while A is active, with no custom turn queue and no assumed one-input/one-reply mapping.
- [x] Only completed Main assistant text is published, once per live text part; activity reflects the session's actual execution.
- [x] Submission errors, repeated keys, unsupported input, and shutdown follow the documented behavior.

### 3. Validate Conversation Continuity

Implementation tasks:

- [x] Verify follow-up context after backend restart with the same resource/thread identity.
- [x] Force an observation/reflection cycle with a short controlled conversation containing a correction, an exact identifier, and unfinished work; verify later continuation.
- [x] Run one bounded live smoke scenario for ChatGPT login, conversation continuity, and memory compression; retain outcomes and distinguish live evidence from fixtures.
- [x] Update backend architecture and configuration documentation to describe the implemented contracts and storage lifecycle. Keep deferred work and validation progress in this plan.

Exit criteria:

- [x] Completed conversation context survives restart and a memory compression cycle.
- [x] Build, lint, and targeted integration/e2e checks pass. Live authentication and memory behavior are verified, or explicitly recorded as blocking validation.

## Tests

Keep coverage focused and reuse milestone 1 fixtures:

- Native runtime integration: controlled A/B delivery while active and at completion, with commentary/reasoning/tool/final events. Assert publication boundaries, one publication per completed part, and unfinished-part exclusion.
- Chat e2e: acceptance precedes HTTP success, replies arrive independently over SSE, definite handoff failure leaves history intact, repeated keys do not resubmit, and unsupported inputs are rejected before persistence.
- Lifecycle/continuity integration: activity and shutdown, asynchronous failure notice, and context restored from PostgreSQL. Reuse the fixture for restart coverage.
- A bounded real-model scenario for ChatGPT authentication and recall after observation/reflection. Assert semantic outcomes rather than exact response wording; record failed attempts as well as successes.

## Validation Commands

Run from `backend/`, using targeted spec paths as the implementation adds them:

```bash
npm run build
npm run lint
npm test -- test/main-session.spec.ts
npm run test:e2e -- test/chat.e2e-spec.ts
```

Terminal login: `npm run agent:login`. Bounded live validation: `npm run agent:smoke`. Documentation checks: `git diff --check` and relative-link validation.

## Overall Exit Criteria

- [x] One persistent Mastra Main conversation accepts new input while working and publishes completed assistant text through Pal's existing chat/SSE services.
- [x] ChatGPT login supplies the main and memory model connections; credentials remain private.
- [x] Native primitives own delivery into the active agent, message assembly where supported, context compression, and thread persistence.
- [x] Failure behavior stays within the agreed simple contract, with no automatic handoff recovery or added submission state.
- [x] Minimal automated coverage and bounded live validation pass; documentation and plan/index status match the verified implementation.

## Deferred Work

Task sessions, agent tools and integrations, attachments as model input, action continuations, iOS migration, legacy assistant history import, token-level SSE, explicit interruption controls, auth UI, multiple backend replicas, durable handoff/reply recovery, and automatic retries.

## References

- [Mastra signals and message delivery](https://mastra.ai/docs/harness/signals)
- [Agent API and acceptance semantics](https://mastra.ai/reference/agents/agent)
- [AgentController](https://mastra.ai/docs/harness/agent-controller) and [Session API](https://mastra.ai/reference/agent-controller/session)
- [Observational Memory](https://mastra.ai/docs/memory/observational-memory)
- [Mastra Code OpenAI OAuth provider source](https://github.com/mastra-ai/mastra/blob/main/mastracode/sdk/src/providers/openai-codex.ts)

## Selected Primitives and Verified Gaps

- Pinned: `@mastra/core` 1.76.0, `@mastra/code-sdk` 1.10.1, `@mastra/memory` 1.37.0, `@mastra/pg` 1.29.0, `@ai-sdk/openai` 3.0.124, and `ai` 6.0.300.
- Input: `Session.sendMessage()` waits for generation when idle. Its native `sendSignal({ content }, { requireDelivery: true }).accepted` route resolves at actual delivery and preserves active-run interjection behavior. `steer()` aborts the current run and is reserved for explicit interruption.
- Ordering gap: concurrent idle `sendSignal()` calls were observed presenting D before C to the model after asynchronous preparation. The coordinator serializes public persistence and acceptance in invocation order. Its promise chain releases at acceptance and recovers after rejection; it never waits for generation.
- Completion gap: session `message_end` carries only an ID; text-end produces no session event. Main's output processor uses native `text-end` and native collected `streamParts`, avoiding a separate buffer/subscription. Completed commentary survives a later error; unfinished text stays private.
- Auth: native `AuthStorage` and `buildOpenAICodexOAuthFetch` supply login, storage, refresh, account headers, and endpoint routing. The coding provider's fixed software-engineering instructions are replaced with a small middleware that preserves each caller's system instructions and sets `store: false`/reasoning effort.
- Storage/lifecycle: `PostgresStore.init()` initializes the separate schema. Session creation binds the stable thread. Cancellation completes before deleting the live session; `Memory.settled()` joins native background work and `Mastra.shutdown()` releases storage and runtime resources. No Pal domain migration was needed.

## Validation Record

2026-10-06:

- Native PostgreSQL fixtures demonstrate A/B delivery during a tool step, idle/concurrent wake-up, commentary/reasoning/tool/final boundaries, abort exclusion, restart continuity, and observation/reflection with a correction and unfinished task.
- The production runtime fixture verifies the asynchronous sanitized failure notice, preserved completed commentary, lifecycle activity, and silent shutdown.
- Chat e2e verifies public persistence/SSE, idempotency, acceptance ordering, independent multiple updates, failed handoff HTTP 503, and rejection of unsupported input before persistence. File history remains available through application services and GET APIs.
- ChatGPT browser login completed. Native credential refresh succeeded and a streamed authenticated call returned the requested fixture marker.
- `npm run agent:smoke` passed real recall after restart, private observation/reflection, and corrected-identifier/unfinished-task recall after compression and restart. Observation was forced through a temporary per-thread threshold of one token; reflection used the native manual API. This validates the real models and compressed context without exercising a production-size 30k/40k-token conversation.
- `npm run build` and `npm run lint` passed. `npm test` passed six service/runtime tests; `npm run test:e2e` passed five API/SSE/file tests. `git diff --check` and relative-link validation passed. Credentials were verified outside version control with directory mode 0700 and file mode 0600.
- Full live HTTP/SSE validation passed against the user's running Nest backend on `127.0.0.1:3000` with its real ChatGPT provider. Two submissions returned HTTP 201 in 40 ms and 12 ms before any assistant reply; the correction was accepted while Main was working. SSE delivered both assistant replies, including the corrected identifier and unfinished task, then reported idle. All four live message events matched persisted `/chat/history` records exactly, with unique IDs. Services stayed running; this check did not restart the process or force memory compression.
