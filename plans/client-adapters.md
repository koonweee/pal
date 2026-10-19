# Client and Provider Adapter Boundaries

## Status

Done

## Goal

Make Pal's application behavior independent of client protocols and provider APIs. Ship the playground through a first-party adapter and one owner Telegram DM through a shared secondary-adapter contract. Define and test the first-party contract for a hypothetical new iOS app without preserving legacy wire protocol.

## Agreed Scope

- One owner and one Main conversation. Secondary provider threads supply quote context; they do not create agent conversations or authorize messaging other people.
- First-party clients support Main chat, direct Task chat, Task views, and existing management features. Secondary adapters support Main chat only; a reply to a Task final goes to Main with quoted context.
- Playground is the first canonical web client. iOS is a separate canonical app-family audience represented by contract fixtures. A native iOS app, APNs, and device registration are deferred.
- Telegram v1 supports text, photos/files, and optional quotes in one configured owner DM. Groups, buttons/actions, typing indicators, edits, deletions, and reactions are deferred.
- Participation records contributing destinations. A separate Pal policy computes notification audiences. Initially only participating app families/destinations are eligible to notify; commentary never notifies. A later all-first-party policy must not require adapter changes.
- First-party synchronization uses snapshot refresh plus live events. There is no durable client event replay in v1.
- Keep private-network access without a new login system. Telegram validates its configured owner and DM. Destination IDs are routing identity, not credentials.
- Run adapters as modules in the existing NestJS process. Explicit contracts and import checks enforce ownership. No plugin loader, separate services, internal HTTP hop, or additional agent controls.
- Known-safe transient delivery failures get bounded retries/backoff. Uncertain sends are logged and never automatically resent. Exhausted/permanent failures are logged. No user-facing delivery status or retry controls.

## Implemented Behavior

- `adapters/first-party` owns controllers, DTOs, multipart framing, browser-origin checks, and HTTP error translation. Application and domain services contain no client protocol types or HTTP exceptions.
- Canonical message idempotency prevents duplicate input. Known pre-acceptance failures may retry with the same key during the current process; ambiguous, accepted, and post-restart duplicates do not rerun agent work.
- Destinations are persisted identities. Participation, resolved delivery, and notification audiences are separate message facts, with policy owned by Pal.
- Main-visible assistant publication and secondary delivery jobs commit atomically. The dispatcher applies bounded safe retries before provider acceptance and never retries partial or ambiguous delivery.
- Shared secondary ingress maps provider events, files, and quotes into Main. Telegram implements the configured owner DM through the shared driver contract.
- Playground and the hypothetical iOS fixture use first-party contract v1 with snapshot-plus-live reconciliation. HTTP history remains authoritative.

References: [backend architecture](../architecture/backend.md), [participant delivery](participant-delivery.md), [chat files](chat-files.md), [playground](frontend-playground.md). The legacy client's `src/transport.ts`, `src/chat-server.ts`, and iOS `ChatService` are comparison material; their provider IDs, event protocol, and app wiring are not compatibility requirements.

## Boundaries and Layout

Keep existing domain folders rather than moving the entire backend. Add the following explicit boundaries:

```text
backend/src/
  application/
    contracts/                 # transport-neutral inputs, views, errors, ports
    ...                        # use cases and adapter-facing Nest module
  chat/, tasks/, files/, ...    # application rules, persistence, runtime
  delivery/                    # destinations, notification policy, durable jobs
  adapters/
    first-party/               # HTTP/SSE/controllers/DTOs and error translation
    secondary/                 # shared ingress, reference maps, delivery driver
    telegram/                  # provider SDK, parsing, rendering, owner checks
  app.module.ts                # composition root wiring core and adapters
```

The first-party wire schema is owned by `adapters/first-party`; the internal application contract is owned by `application/contracts`. These may reuse transport-neutral value types. Do not introduce duplicate models or pass-through services unless a boundary actually needs translation.

| Concern | Owner | Boundary rule |
| --- | --- | --- |
| Agent execution, tasks, canonical messages/files | Pal application | No client/provider SDKs or HTTP request/response types. |
| Input acceptance and runtime handoff | Pal application | Shared by all adapters; no adapter calls agent internals. |
| Participation, visibility, destination roles, notification policy | Pal application/delivery | Adapters cannot choose audiences or override policy. |
| Delivery job persistence, dispatch and retry decisions | Pal delivery | Provider-neutral intent and classified outcomes. |
| Client JSON, routes, SSE names, HTTP errors, multipart framing | First-party adapter | Uses exported application ports, not repositories or runtime objects. |
| Secondary deduplication and canonical/external references | Shared secondary infrastructure | Opaque provider IDs; Main-only input and output. |
| Telegram owner validation, polling, media APIs, formatting | Telegram adapter | Uses the secondary contract and adapter-owned binding storage. |
| Provider tokens, addresses, polling offsets | Adapter-owned configuration/state | Core sees opaque destination/binding references only. |
| HTTP bootstrap and module registration | Composition root | May import both core and adapters; contains no routing policy. |

Nest dependency injection may remain in application services. HTTP error classes/status codes must be translated at the first-party boundary; core attachment failures must retain explicit application error classification when HTTP exceptions are removed.

### Contracts

Use focused ports for messages, files, Tasks/management, and live changes rather than a universal facade with unrelated methods. First-party controllers use the appropriate ports. Secondary infrastructure receives only the Main submission, attachment, and delivery capabilities it needs.

The implemented secondary contract uses these shapes:

```ts
type SecondaryInput = {
  externalEventId: string;       // idempotency scope includes adapter + destination
  externalMessageId: string;
  externalThreadId?: string;    // reply context, never an agent thread ID
  text: string;
  attachments: SecondaryAttachmentInput[]; // imported through Pal's file port
  replyToExternalMessageId?: string;
};

type SecondaryOutput = {
  deliveryId: string;
  message: UserVisibleMessage;  // canonical text and attachment descriptors
  notify: boolean;              // resolved by Pal; not a model option
  replyTo?: ExternalReference;  // populated only for a mapping in this destination
  openAttachment(attachment): Promise<{ stream; contentType; sizeBytes }>;
};

type DeliveryOutcome =
  | { kind: 'accepted'; references: ExternalReference[] }
  | { kind: 'retryable'; code: string; retryAfterMs?: number }
  | { kind: 'permanent'; code: string }
  | { kind: 'uncertain'; code: string; references?: ExternalReference[] };
```

An adapter is constructed with its validated destination binding; callers do not supply arbitrary recipients. The shared ingress resolves quotes, deduplicates inputs, and submits Main input. A provider driver sends output using attachment content streams supplied by the application contract. Its explicit lifecycle starts/stops intake and shuts down cleanly; v1 does not invent a webhook contract for providers not yet implemented.

External references use opaque strings and an optional thread identifier. One canonical message can map to several external messages because providers split text or media. A quote uses a suitable known reference in the same destination; missing mappings produce an ordinary message. Provider thread context never changes the logical destination or creates new agent sessions.

The shared contract carries plain text with the existing Markdown convention, files, and optional quotes. Provider formatting/escaping, splitting, media limits, and fallback rendering belong to the driver. There is no universal rich-content AST or speculative capability negotiation. Preserve canonical content even when a provider cannot represent it.

Canonical apps consume the first-party HTTP/SSE contract; they do not implement the secondary sending interface. Future notification transports will consume resolved notification intents using adapter-owned registrations. Do not force APNs to act like a chat-message transport or create unserviceable push jobs before a transport is configured.

### Enforcing and Documenting Boundaries

- Expose an explicit adapter-facing application module and public contract exports. Avoid exporting repositories, database handles, agent sessions, or host filesystem paths.
- Adapters may import application contract exports and their own infrastructure. Core cannot import adapters, provider SDKs, Express types, HTTP DTOs, or controllers. Provider drivers cannot import domain repositories. The composition root has explicit wiring exceptions. Adapter-owned repositories may use shared database infrastructure for their own tables; they cannot query core tables. Keep their schema definitions separate so the import check can enforce this. Shared configuration, logging, and Nest DI are infrastructure dependencies, not application escape hatches.
- Add an automated import-boundary check to normal validation. Prefer existing lint support; if insufficient, use a small focused dependency test. Check re-exports as well as direct imports, and prove it detects representative forbidden dependencies.
- Use JSDoc on public contracts and registration entry points to document boundaries and extension responsibilities. Keep existing backend architecture documentation consistent with the implemented structure.

### Required JSDoc

Document exported application ports, adapter/driver interfaces, and registration entry points with JSDoc. Explain ownership, required implementation methods, lifecycle, destination and external-ID scope, attachment handling, quote fallback, and delivery outcome/retry semantics where applicable. Include small examples on the relevant interfaces to show how a first-party client or secondary driver integrates.

Keep shared rules on shared contracts and provider-specific mappings beside driver implementations. Update JSDoc with contract changes. No separate client guides, driver READMEs, or documentation walkthrough are required.

## Target Data Shape

### Destinations and Participation

Persist stable destination records with opaque ID, canonical/secondary role, adapter identity, and enabled state. Initial composition/configuration provisions web and iOS first-party destinations plus one Telegram destination. Platform labels occur in composition, fixtures, and provider code, not core routing branches. A destination represents an app-family audience or configured secondary inbox; it is not a physical device or arbitrary correspondent.

Adapter-owned bindings resolve destination IDs to provider addresses. Prefer existing environment configuration for the single Telegram binding; add adapter-owned persisted state only for mutable values such as polling offsets and external references. A core destination never contains a Telegram chat ID or APNs token. Destination disablement cancels unsent jobs; IDs are not reassigned to a different recipient.

Inputs record their origin destination. Preserve `source` as informational provenance if useful, using adapter-assigned values rather than a core platform enum. First-party ingress accepts only configured first-party destinations; Telegram cannot be selected by a web request. This is routing validation within the private-owner access boundary, not app authentication.

Replace enum channel arrays with destination IDs in participant state, native signal/delegation metadata, schedule snapshots, and message delivery metadata. Record the participant snapshot separately from resolved delivery and notification destination IDs at publication. Keep the existing 60-second approximation and restart semantics. Resolve notification audiences in one pure policy function; do not infer participation from who received a canonical copy.

Migration maps legacy channels to provisioned destinations and updates native saved schedule attributes without losing schedule identity. Historical messages remain historical: no enqueue or replay. Legacy participant snapshots that cannot be established are left unknown/empty rather than invented. API-origin records may have no origin destination. Tests cover pre-migration messages and saved schedules.

### Delivery and References

- Insert external delivery jobs atomically with the canonical assistant message. Snapshot resolved destination and notify intent so retries do not recompute against later participants or policy.
- Queue secondary jobs only for Main-visible assistant messages. Task finals qualify; Task commentary and task-only inputs do not. Canonical first-party views retain existing visibility and get live change events independently of external jobs.
- One logical job per message/destination/effect, protected by a uniqueness constraint. States: pending, sending, accepted, failed, uncertain, cancelled; retain attempts, next attempt time, and sanitized error classification.
- Use the existing PostgreSQL service and an in-process dispatcher. Do not add a broker or a general workflow engine. Known-safe retryable failures use a bounded documented backoff and provider retry hints. Network failures after possible provider acceptance are uncertain. Interrupted sending jobs become uncertain on restart; pending work resumes.
- Store external message mappings under adapter/destination scope for incoming and outgoing messages. External IDs are strings; one-to-many mappings support provider splitting. A failure after any accepted part makes the job uncertain and prevents a retry of the batch.
- Atomic publication prevents a crash between message persistence and job insertion from silently losing delivery. Provider acceptance followed by a crash before local acknowledgment remains uncertain; do not claim exactly-once external delivery.
- Provider callbacks/edits/reactions are absent in v1. No delivery-status events or retry endpoints are exposed to users. Operational logs include delivery/message/destination IDs and safe error codes, without tokens or message bodies.

## First-party Synchronization Contract

Preserve current routes where practical while moving ownership into the adapter. Publish a documented, versioned contract with representative JSON fixtures. Explicitly cover message IDs/versions, idempotency, accepted-input correlation, history ordering/pagination, Task views, files, actions' current limits, error responses, and missing quote targets. Updating playground and the new iOS contract together is allowed; compatibility with the pre-Pal app is not required.

Clients subscribe and buffer changes before fetching snapshots, then merge by ID/version. On reconnect/foreground, reconcile all retained state, including previously loaded older messages and Task views, rather than only fetching the newest chat page. Discard stale snapshots/connection generations. Treat SSE IDs as transport details, not replay cursors. A disconnected client cannot infer durable catch-up from `Last-Event-ID`.

Contract fixtures model both web and iOS as canonical app families. iOS needs no Swift project in this milestone: executable conformance scenarios demonstrate its required behavior, while contract JSDoc describes the client implementation obligations. There are no APNs/background freshness requirements in v1.

## Milestones

### 1. Application Ports and First-party Adapter

Implementation tasks:

- [x] Define focused transport-neutral application ports, errors, and value types; use existing services as their implementation where practical.
- [x] Move chat/SSE, files, Tasks, preferences, and MCP settings controllers/HTTP DTOs into the first-party adapter. Keep agent-facing tools and MCP provider connectivity in their existing application owners.
- [x] Replace HTTP DTO dependencies in submission and separate multipart parsing from file storage/import streams. Preserve file validation, limits, cleanup, and attachment-recovery behavior.
- [x] Add module export restrictions, import-boundary checks, and JSDoc describing ownership and how to implement/register adapters and drivers.
- [x] Keep existing playground functionality working through the adapter; preserve private ingress and reject unintended cross-origin browser mutations without blocking native clients.

Exit criteria:

- Existing relevant API/playground checks pass through the first-party adapter; core file and message ports can be exercised without Express requests.
- Forbidden imports are detected. Provider SDKs and HTTP protocol types are absent from application contracts.

### 2. Destinations and Separate Notification Policy

Implementation tasks:

- [x] Add configured/persisted destination identities and adapter bindings; document introduced configuration in `.env.example`.
- [x] Migrate channel-based message metadata and native schedule snapshots to destination IDs. Preserve existing history, schedule IDs, and idempotency behavior across rollout.
- [x] Record origin/participation independently from resolved notification audiences. Preserve the shared participant set and idle grace period.
- [x] Bind web/iOS to separate canonical audiences; keep Telegram secondary. Validate origins at ingress and apply Main visibility before secondary delivery.
- [x] Update playground and first-party wire fixtures. Add a policy test showing an all-first-party notification policy can be substituted without changing participation or adapter inputs.

Exit criteria:

- Web/iOS/Telegram combinations match agreed delivery/notification behavior; commentary stays quiet.
- Adding a configured destination for an existing adapter requires no core enum/schema change. Unknown or mismatched ingress destinations are rejected.
- Migration does not trigger historical sends or redirect stored schedules to a different owner/inbox.

### 3. Reliable Secondary Infrastructure and Telegram

Implementation tasks:

- [x] Implement shared Main-only ingress, scoped idempotency, external reply mappings, and provider-neutral attachment ingestion.
- [x] Inspect the pinned Mastra acceptance/idempotency API before changing submission recovery. Canonical idempotency prevents duplicate input. Process-local retry eligibility handles a known pre-acceptance failure without adding durable handoff state; ambiguous and post-restart duplicates do not rerun agent work.
- [x] Implement transactional delivery job creation and a small dispatcher with classified outcomes, bounded retries/backoff, restart recovery, and shutdown behavior. Keep intake/routing independent of provider-send latency.
- [x] Add the Telegram provider driver using the Bot API: configured owner DM checks, durable polling offset, text/photos/files, formatting/splitting, optional quotes, and silent commentary delivery.
- [x] Handle accepted multipart-send progress, permanently unsupported files, and ambiguous provider outcomes without resending confirmed parts or rerunning the agent. Persist offsets only after input is safely recorded; duplicate updates must not duplicate work.
- [x] Log unresolved/exhausted failures; expose no user-facing delivery status or retry controls.

Exit criteria:

- Synthetic Telegram ingress → Main → canonical publication → external send works through the shared contract, including files and quotes.
- Task final replies return to Main; task-only material is never emitted through the secondary driver.
- Known-safe failures retry; uncertain outcomes do not; restart resumes pending work and preserves confirmed external mappings.
- Unauthorized Telegram identities are rejected before content is ingested into Pal.

### 4. First-party Contract and End-to-end Validation

Implementation tasks:

- [x] Document/test snapshot-plus-live synchronization, loaded-history reconciliation, idempotent input, files, missing quotes, and Task views with web and hypothetical iOS contract fixtures.
- [x] Verify playground reconnects and active cross-client steering with the real application ports and a scripted agent/provider fixture. No new model routing decisions or structured-output fields are introduced.
- [x] Document extension points for Android and future secondary providers in JSDoc; keep shared semantics on the contracts and Telegram-specific behavior on its driver.
- [x] Review complexity and remove wrappers/state without a concrete requirement. Update architecture to implemented behavior and mark validated plan tasks complete.
- [x] Deploy the validated build with data backups. A live Telegram check requires a selected development bot/owner DM and an explicitly requested test exchange; fixture evidence must remain distinguished from live provider delivery. Do not reuse a legacy production bot or run competing pollers for its development bot.

Exit criteria:

- Playground uses the first-party boundary exclusively. A hypothetical iOS client has a complete, executable integration specification without depending on legacy API.
- Telegram adapter and shared infrastructure pass the failure/identity cases. Live verification status and any remaining deployment prerequisites are stated explicitly.
- No provider SDK/type or client protocol leaks into Pal core; plan/architecture describe the same ownership rules.

## Scenarios and Extension Examples

### Telegram request, then web steering

**Deterministic:** Telegram validates the owner and imports any files, then submits Main input through shared ingress. Web steering adds the canonical web destination to the participant set. Subsequent Main-visible answers are available to canonical clients and sent to Telegram; finals notify the participating web and Telegram audiences, while iOS remains quiet. Task commentary stays first-party. Earlier messages are not replayed to newly participating destinations.

**Model judgment:** Main interprets the request and steering, chooses whether to delegate, and composes content. It never chooses recipients or notification audiences.

### Telegram quote of a Task final

**Deterministic:** The adapter resolves a destination-scoped external reply reference to a canonical message. The new input goes to Main. Main can use the quote as context. Missing mappings yield an ordinary Main input with no invented canonical ID. Outgoing quotes similarly fall back to ordinary delivery when the target is unavailable in that destination.

**Model judgment:** Main decides whether the new request requires resuming a Task; quoting alone does not make that decision.

### Delivery timeout and client reconnect

**Deterministic:** Canonical publication and the delivery job remain stored. A provider reports a safe rejection or an uncertain outcome. Safe transient failures retry within the bound; uncertainty is logged without resend. The first-party client reconnects using snapshots and buffered events, irrespective of the provider outcome. No user-facing retry/status control appears.

**Model judgment:** None is required for delivery recovery or synchronization.

### Adding Android

Implement the same first-party client API and synchronization contract. Configure another canonical audience and add client conformance fixtures. A future FCM integration owns registrations and notification sending behind the first-party notification boundary. Core participation/visibility policy is unchanged; Android-specific routes or core enums are unnecessary.

### Adding email

Implement provider ingress and sending under the shared secondary contract. Bind a configured owner mailbox; map Message-ID/In-Reply-To/thread identifiers to opaque external references, import attachments, and render outgoing content. Define provider-specific retry/uncertainty and thread fallback semantics then. Provider threads remain context in Main. Email-specific MIME, authentication, subject selection, and thread choice stay inside the driver; no generic email abstraction is required before implementation.

### Adding iMessage

Implement the supported bridge's input/send lifecycle, identity validation, attachments, external references, and outcome classification. Bind its owner conversation as a secondary destination. The bridge's actual APIs and reliability may require a narrow contract extension; no platform accessibility or delivery guarantees are assumed now.

## Complexity Review

- Application services remain the adapter ports where their existing public methods already fit. Separate interfaces exist only for submission/chat views and the provider driver contract.
- `SecondaryDriverHostService` is the one provider-facing wrapper; it prevents drivers from importing persistence and owns registration plus opaque adapter state.
- Secondary schema definitions are separate from core tables. Drivers return external references with their outcome; partial delivery becomes uncertain instead of adding per-part job checkpoints.
- Telegram uses the small Bot API surface directly through `fetch`; no provider SDK or plugin loader is added.
- The old channel enum/resolver and transport-coupled file storage were removed. Notification transports, capability negotiation, webhooks, and durable first-party event replay remain deferred.
- Participant lifecycle keeps the existing 60-second idle approximation. No task-status workflow or model recipient controls were introduced.

## Tests

Keep tests focused on observable behavior and reuse existing suites:

- Boundary check: representative forbidden imports/re-exports fail; approved composition and public-port imports pass.
- Existing chat/files/Tasks/preferences/MCP API suites plus playground smoke retain behavior after controller movement and file-port extraction.
- Destination policy/migration: mixed participants, quiet canonical copies, Main visibility, grace-period reset, snapshot schedules, and no historical enqueue.
- First-party synchronization fixture: buffered changes during snapshot, disconnect/reconnect, older loaded-message update, stale response, quote missing locally, and idempotent submission correlation for web/iOS.
- Shared secondary integration with fake driver: owner input dedupe, same external ID in different scopes, attachments, Task-final quote routed to Main, no Task commentary, one-to-many reference mapping, and missing-reference fallback.
- Delivery failure/restart test: safe retry/backoff, exhaustion, uncertain outcome without resend, interrupted sending, partial-delivery uncertainty, external references, and disabled destination.
- Telegram adapter fixtures cover owner/chat rejection, text/photo/document normalization, limits/formatting, and provider outcome classification. Live tests are a separate, explicitly identified acceptance step.

## Validation Commands

Existing commands to run against relevant changed suites:

```bash
cd backend
npm run build
npm run lint
npm test
npm run test:e2e

cd ../frontend-playground
npm run build
npm test
```

Use focused file selections during implementation before required broader validation. `npm run check:boundaries` is part of lint. Adapter/conformance tests run in the existing Vitest suites. No native iOS build command or real-model delivery evaluation is required for this scope.

## Validation

Backend build and type-aware lint pass, including the boundary checker. The service integration suite passes 28 tests in 14 files, and the end-to-end suite passes 20 tests in five files. The playground production build and all 21 Playwright tests pass.

Private deployment applied migrations 0010 and 0011 after verified backups. Service health, API, frontend, desktop, SSE, record invariants, destination configuration, and tested-code identity checks pass.

Backups are under ignored `backend/data/backups/deploy-20261009-client-adapters/`; rollback image `pal-local:pre-client-adapters-20261009` retains the previous deployment. Telegram behavior is fixture-tested only. No live Telegram message was sent.

## Overall Exit Criteria

- [x] First-party and secondary adapters consume documented, enforced application contracts; protocol/provider logic has an unambiguous home.
- [x] Exported contracts and extension points have JSDoc sufficient to implement/register a client adapter or provider driver, including lifecycle and failure semantics.
- [x] Playground works as a canonical web client; iOS has tested contract fixtures and JSDoc describing integration requirements.
- [x] Telegram owner-DM integration supports text/files/quotes and only Main chat, with explicit fixture/live evidence.
- [x] Participation and notification policy remain independent and deterministic; no model controls are added.
- [x] Durable external delivery obeys the agreed retry/uncertainty policy without user-facing controls.
- [x] Existing persisted data/schedules survive migration; historical content is not resent.
- [x] Relevant checks pass, deployment prerequisites/evidence are recorded, and complexity is reviewed.

## Deferred Work

Native iOS implementation, APNs/FCM/Web Push and device registration; Android/email/iMessage implementations; groups or additional recipients; secondary actions, edits, deletes, reactions, and typing; durable client event replay; app-level login; independently deployed adapters; a plugin system; configurable notification UI/rules; user-facing delivery controls.
