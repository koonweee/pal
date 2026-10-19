# Main-Owned Messaging and Agent-Selected Delivery

## Status

Done

Milestones 1–5 complete, including the concluding complexity review. Validation limitations and deferred work are recorded below.

Validation: 43 backend service/native-runtime tests, 22 API/adapter end-to-end tests (including a later passing adapter rerun with reaction delivery), build/lint/boundary/OpenAPI checks, frontend type/API/unit/UI checks, reaction/visibility/Task browser scenarios, and iOS simulator build/unit tests. The local stack rebuild/migration succeeds and advertises contract version 3. The full affected browser run passes 12 of 13 checks; its timing-sensitive typing assertion passes in isolation. Real-model smoke was rejected by automatic approval review; production Mastra runtime behavior is covered with a controlled model.

## Goal

Make Main the sole owner of user communication through `sendToUser`. Give Main dependable message provenance and registered destination information so it chooses delivery and notifications. Keep Task commentary and finals as task-local logs, automatically report Task finals to Main, and support agent reactions across native surfaces and external adapters.

Use existing application services, Mastra signals and memory, destination registration, message storage, delivery jobs, notification intents, and adapter mappings. Keep model controls and instructions minimal. This plan defines implementation scope; publishing, pushing, and deployment remain separate actions.

## Current Behavior

- `backend/src/agent/publish-text.processor.ts` parses and publishes structured assistant text for Main and Tasks. It handles reply references, attachment selection, generated files, validation, and correction feedback.
- `backend/src/agent/mastra-agent-runtime.ts` persists Task finals and sends `task-result` signals describing answers already visible to the user. Idle Main persists these signals without waking. The public commit and signal persistence have a crash gap.
- `backend/src/chat/chat.types.ts` and repository queries include Task finals in Main based on phase. ChatService owns publication transactions, file associations, delivery jobs, notification intents, and events.
- `backend/src/agent/delivery-participants.ts`, `delivery-context.processor.ts`, and `delivery-memory.ts` maintain activity-based participant sets. `backend/src/delivery/destination-policy.ts` derives delivery and notifications from participants and final-answer phase. Schedules retain participant snapshots.
- User messages store `source` and `originDestinationId`. Native inputs expose source metadata. Delegation accepts one optional source reference and forwards selected source text/files, but not explicit per-message origin metadata. `inspect_message` can recover the stored facts.
- `backend/src/adapters/secondary/secondary-driver.ts` and its driver host own external sends, provider mappings, and retry outcomes. Telegram implements the existing driver contract; first-party clients consume canonical history and events.
- `backend/src/agent/agent-instructions.ts` composes shared and role-specific guidance. Main and Tasks currently share `texting.md`, including structured-publication instructions that must diverge under this plan.

## Target Data Shape

- Retain one canonical messages table for Main sends and Task logs. New Main sends have no task identity; Task logs retain their task identity. Phase remains descriptive and triggers Task reporting, without controlling new-message Main visibility or notification eligibility.
- Every Main send is visible in canonical Main history, including external-only delivery. Selected destination IDs determine delivery/alerts, not canonical history retention. A native destination with `notify: false` supports a quiet Pal-only send.
- Replace participation-derived publication input with explicit selected destination IDs and one required `notify` boolean. Validate against enabled registered destinations; derive notification destinations deterministically from these inputs. Retain persisted resolved delivery fields where they serve existing delivery/API consumers; remove participation state and unused policy variants.
- Expose one always-available Main-only `sendToUser` tool with message and reaction forms. Message form preserves text, intentional message boundaries, optional reply reference, existing attachments, and generated-file declarations. Reaction form supplies a target message reference and emoji. Both select destinations and one notification boolean. Do not expose phase, task visibility, notification destination lists, provider IDs, or transport controls.
- Persist one agent reaction slot per target message. Reuse existing delivery-job identity and ordering; add only a targeted stale-update guard if the current queue cannot prevent older updates from replacing newer ones. Reactions are not new canonical text messages. No user reactions or removal operation. Reuse existing accepted-operation retry protection; an intentional subsequent update is a new operation. Do not build a general reaction revision or reconciliation framework.
- Extend canonical DTOs, history/event contracts, and native client models with the reaction state. Persist reaction delivery through the existing job/adapter pipeline; avoid a second transport framework or a generalized interaction subsystem.
- Replace singular delegation `sourceMessageRef` with plural source references. Carry selected message references and their resolved origin destinations in existing signal metadata. Reuse existing source text/file forwarding where needed; do not automatically expand every historical reference into full content and attachments. Use existing inspection tools for later lookup. Provenance is factual context, never an inferred recipient union.
- Preserve the identity of existing historical messages, reply relationships, and their existing visibility during migration. Prefer a one-time data migration and one resulting visibility rule. Add persisted visibility only if required to preserve existing membership; avoid permanent competing legacy/new policies or duplicated historical Task finals.

## Milestones

### 1. Establish explicit publication and provenance contracts

Implementation tasks:

- Trace publication, history/reply visibility queries, schedules, model context, SSE, notification intents, and adapter contracts before editing. Reuse each existing owner; document only concrete dependency gaps.
- Define the minimal tool schema around current public-output/file validators and numeric message references. Keep publication identity and retry deduplication host-owned, using supported tool-call identity where available.
- Include the small enabled-destination list directly in Main’s existing dynamic context, with stable IDs and concise adapter descriptions. Reuse destination registration; add no discovery tool, registry, capability-negotiation system, or redundant source fields.
- Add plural delegation references and automatic resolution of origin facts. Keep Main responsible for selecting relevant references and forwarding semantic context/preferences. Preserve per-input provenance for steering rather than attributing an entire Task to one origin.
- Use references in existing native signal metadata and `inspect_message` for provenance recovery after compression/restart. Resolve facts from canonical messages rather than maintaining a second Task input history. Document a concrete missing lookup capability before adding any persisted association.
- Replace schedule participant snapshots with factual originating references and explicit user delivery instructions available to the agent. Scheduled Task outcomes must follow the same Main handoff; do not retain hidden recipient defaults.
- Prepare schema/API migrations, including historical visibility, reactions, removal of obsolete participant fields, and existing pending delivery/notification records. Keep accepted jobs valid through cutover.

Exit criteria:

- Contracts distinguish canonical visibility, selected delivery, notification choice, and provenance.
- A Task receiving referenced Telegram and web inputs retains both origins across steering and recovery without deriving recipients.
- Migration preserves existing history, quotes, attachments, and accepted delivery work.

### 2. Make Main the sole sender and Tasks local publishers

Implementation tasks:

- Register `sendToUser` only for Main. Route it through ChatService, existing generated-file import, reply validation, delivery jobs, and notification intents. Return concise accepted publication information; do not imply provider/device receipt.
- Remove Main structured public-output requirements and automatic commentary/final publication. Private Main output and deliberate silence create no user message.
- Keep the existing Task publication processor and reusable validators. Persist every nonempty public Task text/attachment block only in task chat; create no external delivery or notification work for these logs.
- Remove new Task-final inclusion from Main history and reply visibility. Preserve the historical behavior established by migration. Main sends are independent messages, not copies sharing a Task-final ID.
- On each published Task final, send a native result signal to Main that wakes idle Main or reaches active Main. Include result identity, content, attachments, and preserved source provenance. Results include questions/blockers as well as completed outcomes; do not infer task completion from run termination.
- Use supported Mastra signal persistence, acceptance, and wake behavior first. Verify the existing commit-to-signal crash boundary and record the actual recovery guarantee. A custom outbox, dispatcher, or replay/deduplication subsystem is not a default deliverable: introduce only a targeted fix for a demonstrated lost-result gap that native primitives cannot cover, with its necessity documented. Do not claim exactly-once delivery.
- Consolidate error publication paths: Task failures must remain task-local and reach Main through the handoff; host generation-failure notices must not retain an accidental Task-to-user bypass. Represent Main generation failures through existing operational error state; do not introduce an automatic assistant-message bypass around `sendToUser`.
- Ensure direct task-chat user input and standalone schedules receive the same provenance and reporting behavior. A new Main send remains visible in Main, not automatically echoed into task chat.

Exit criteria:

- Main can send messages/files with selected destinations and alerts, or remain silent.
- Task progress and finals stay local; a Task final wakes Main without a separate model handoff call.
- Mid-task questions and results reach Main through the same mechanism. Native persistence/restart behavior is validated; any remaining pre-acceptance crash gap is recorded explicitly with its impact and a justified fix or deferred follow-up.

### 3. Add reactions through the existing adapter boundary

Implementation tasks:

- Implement Main-only reaction upsert in the shared application service, including target visibility/reference validation, persistent state, events, and selected delivery/notification intent.
- Extend the existing secondary output/driver contract with the smallest discriminated reaction operation. Keep native reaction capability, mapped-target selection, and fallback behavior in adapters. Models never choose fallback behavior.
- Implement Telegram native reactions when supported and a target mapping is available. Otherwise send a new emoji-only message, optionally quoting a known target. Every distinct fallback update sends a new message; do not edit or delete previous fallback messages.
- Preserve existing retry classifications and avoid fallback after ambiguous native acceptance. Use existing job ordering to prevent stale reaction writes; add a narrow guard only if a targeted case demonstrates a gap. Do not add a new scheduler or speculative provider capabilities/configuration.
- Define supported emoji handling at the adapter boundary: unsupported provider reactions use the same fallback. Keep one canonical reaction even when delivery fails or falls back.
- Add the screenshot-style attached emoji bubble in web/PWA and native iOS using their existing message components, theme, stores, and events. Updates replace the slot in place; history reload and reconnect recover persisted state. Follow the applicable frontend/iOS instructions and accessibility requirements. No user reaction controls.
- Apply the single notification choice using each adapter’s supported behavior. Document provider limits; add no cross-provider notification guarantee or capability negotiation.

Exit criteria:

- Main can set a reaction before work finishes and replace it later; only one canonical reaction appears on the target.
- Native clients render the attached bubble accessibly. Telegram uses native reaction or a fresh emoji-only fallback as appropriate.
- Delivery recovery cannot revert the latest reaction or accidentally repeat an already accepted fallback operation.

### 4. Minimize guidance and remove superseded machinery

Implementation tasks:

- Compare Main, Task, worker, and shared instructions before editing. Keep common voice, concise writing, file handling, and other genuinely shared policies in their existing shared files, loaded only for applicable roles.
- Keep Main-specific guidance short: communicate through `sendToUser`; use supplied provenance/destinations to choose delivery and alerts; a reaction can suffice, including while work is underway; use Task results to decide what to send. Do not add scenario-specific routing rules or force a reply.
- Keep Task-specific guidance short: commentary records useful progress locally; final answers report useful outcomes, questions, or blockers to Main; include relevant findings and deliverables. Retain required structured-output guidance only for the roles that use it. Workers gain no messaging capability.
- Remove obsolete instructions about Task finals already being user-visible, Main never relaying results, and shared structured Main publication. Do not duplicate tool schemas in prose or add a new shared file for a single role.
- Remove participant sets, idle reset logic, routing context processors, the delivery-specific Memory subclass if no longer needed, schedule participant codecs/snapshots, phase-based notification policies, and unused compatibility APIs/tests. Use ordinary supported Mastra Memory once the custom routing prerequisite is gone.
- Keep Task output parsing, ChatService, FilesService, destination validation, queues, notification dispatch, and adapter mapping/retry infrastructure where still needed. Remove only obsolete uses, not useful shared primitives.
- Update `architecture/backend.md`, API/generated contracts, configuration examples only if configuration changes, and plan statuses to match the implemented system. Keep deferred scope and validation evidence in plans.

Exit criteria:

- Each state/policy has one owner; no participation routing remains active alongside explicit routing.
- Role prompts contain minimal capability guidance with no duplicated policy or obsolete publication rules.
- Documentation reflects current contracts and all required checks pass.

### 5. Review complexity, workarounds, and abstraction boundaries

Implementation tasks:

- Review the complete implementation diff and final call paths after functional validation. Look for duplicate state/policy, unnecessary model controls, retained compatibility layers, speculative configuration, repeated adapters, and prompt rules that restate schemas or ordinary user instructions.
- Inspect workarounds for dependency internals, timing assumptions, special-case branching, and ambiguous retry handling. Prefer supported dependency APIs and existing service boundaries; remove a workaround when the simpler path satisfies the demonstrated requirement.
- Evaluate abstractions against concrete evidence: repeated logic (consider the rule of three), an invariant needing one owner, or an external integration boundary. Extract only when it reduces actual duplication or protects that invariant; do not add interfaces or frameworks for hypothetical consumers.
- Pay particular attention to handoff recovery, provenance storage, historical visibility, reaction ordering, and instruction composition. Each new mechanism must identify the gap it solves and why an existing primitive is insufficient.
- Simplify justified findings in the current scope and rerun only affected checks. Record remaining findings here with impact, rationale for retaining them, and concrete follow-up scope. A review finding does not automatically authorize a broader rewrite.

Exit criteria:

- Review findings and dispositions are recorded in the plan. No unexplained workaround, duplicate policy owner, or speculative abstraction remains in the changed scope.
- Necessary custom mechanisms have a brief evidence-backed justification. Deferred improvements are explicit and do not obscure unmet correctness criteria.
- Relevant checks pass after simplification; the completion report summarizes material retained limitations.

## Complexity Review Findings

- Reused ChatService transactions/idempotency, native Mastra Memory/session signals, destination registration, delivery jobs, notification intents, and adapter reference maps. Removed participation tracking, its memory subclass/processors, phase-based delivery policy, and obsolete routing tests/experimental smoke scripts. No new registry, provenance table, outbox, scheduler, or generic interaction framework.
- Message/reaction forms share one Main-only tool; the existing public-output schema/validators remain the source for message bodies. One reaction column and existing message versions supply canonical state and stale-job cancellation. No additional reaction revision model.
- Historical Task-final visibility needs one backfilled membership flag to preserve IDs and quotes. Current queries use the same membership rule for historical and new records.
- Provenance uses the native execution boundary and canonical references. The [routing and provenance follow-up](messaging-routing-simplification.md) bounds lookup to the current execution and makes first-party audiences automatic.
- Canonical Task-result commit and native signal persistence are separate. Crash recovery before persistence remains a documented follow-up; native acceptance does not imply user delivery. A replay subsystem is deferred.
- Accepted publication retries reuse database idempotency. Generated-file import currently precedes that check, so an accepted-call replay can create an unused file snapshot; canonical messages and delivery jobs remain deduplicated. Moving file preparation inside the existing idempotency boundary is a narrow future improvement if replay occurs.
- Compared Main/Task/worker guidance: common writing/file policies stay shared, structured-output guidance stays Task-specific, Main communication uses a short role paragraph, and workers receive no messaging tool. Removed redundant Task-result guidance and schema-restating instructions.
- Real-model smoke was rejected by automatic approval review for external prompt/destination authorization. The production Mastra runtime is validated using the controlled-model integration scenario instead; the maintained real-model smoke script uses the new tool contract and remains unexecuted.
- Browser suite timing is unstable under load: the changed checkout’s typing-animation assertion passes in isolation but has failed in the full suite; an unchanged checkout also fails a viewport-anchor timing assertion. Reaction, history visibility, and separate Main/Task browser scenarios pass. These animation checks remain a documented limitation rather than a broader animation rewrite.

## Tests

Extend existing suites and fixtures. Test each invariant at its owning layer, then run one integrated flow; do not repeat the publication/routing matrix across service, API, adapter, and UI suites. Add regression cases only for concrete failure modes.

- Publication integration: Main tool-only publication, canonical history, explicit destinations/notify, quiet native send, Task-only logs, attachment/reply preservation, and invalid destination/reference feedback. Verify Tasks/workers cannot call `sendToUser`.
- Signal/provenance integration: Telegram request plus web steering with multiple references; Task final wakes Main; question/blocker uses the same path; stored provenance remains recoverable; native signal persistence/wake behavior matches the documented recovery guarantee. Add interruption coverage for any targeted recovery fix actually implemented. Include intentional Main silence.
- Reaction/adapter integration: set/replace slot, mapped native reaction, missing/unsupported-target fallback as a new emoji-only send, retry uncertainty, deduplication, and update ordering. Reuse existing secondary-driver/Telegram fixtures.
- Migration/API regression: historical Task-final visibility/quotes, pending jobs, scheduled context, new Task-local visibility, reaction history/events, and removal of participant fields from active contracts.
- Focused native-client coverage: attached reaction placement, replacement and reload/reconnect, no reaction controls, accessible labeling. Reuse web browser/component and iOS fixtures rather than adding a parallel test harness.
- One real-runtime scenario exercises Main reaction, delegation, steering, Task progress, Task final, and Main delivery. Record model choices separately from deterministic assertions; do not assert a specific wording or emoji choice.

## Validation Commands

Run targeted existing suites during milestones, then the relevant integration/contract checks. Record exact test selectors and any newly necessary commands during implementation.

```bash
cd backend
npm run build
npm run lint
npm test -- test/main-session.spec.ts test/task-agents.spec.ts test/delivery-retry.spec.ts test/telegram-adapter.spec.ts test/notifications.spec.ts
npm run test:e2e -- test/chat.e2e-spec.ts test/secondary-adapter.e2e-spec.ts test/client-contract.e2e-spec.ts
npm run openapi:check

cd ../frontend
npm run api:check
npm run check
npm run check:ui
npm run test:unit
npm test -- <affected-chat-spec>
```

Use current `ios/README.md` simulator/build and contract validation commands for changed iOS scope. Read applicable local instructions before implementation. Use `./scripts/dev-local rebuild` when validating the integrated backend/guidance/native changes; no publishing or deployment is implied. Documentation-only planning does not require application builds.

## Overall Exit Criteria

- Only Main has `sendToUser`; Main chooses explicit destinations and a single notification boolean. Silence is accepted, and all sends remain in canonical Main history.
- Task text is local and finals automatically report outcomes/questions/blockers to active/idle Main through supported signal persistence. The actual recovery guarantee and any remaining crash gap are documented.
- Multi-input provenance survives delegation, steering, memory compression lookup, and result reporting without becoming host-selected routing.
- Agent-only reactions work during any part of a Main turn, with one replaceable slot, native adapter support, and fresh-message fallback. No removal or user reaction UI.
- Existing history, replies, attachments, schedules, and accepted delivery work survive migration.
- Superseded routing/publication code and guidance are removed; existing services and supported dependency primitives own the replacement.
- The concluding complexity review is complete, findings are resolved or explicitly recorded, and abstractions have concrete justification.
- Relevant checks pass; plan status and remaining work are accurate. Commit coherent implementation boundaries locally after reviewing staged scope.
- The implementation completion report includes the required short tool/guidance table: change, affected Main/Task agent, and availability. No reactions-removal, per-destination notification switches, Task routing autonomy, fallback editing, or generic multi-user interaction system is included.
