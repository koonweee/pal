# pal backend

Agent run telemetry uses selective native Mastra observability in the existing PostgreSQL store. Pal records input/publication references and worker parent identities; telemetry expires by UTC day after 30 days. The runtime refreshes telemetry partitions daily and prunes hourly. [Agent run queries](agent-run-queries.md) describes read-only storage APIs and evidence limits.

## Security

The first-party API uses private Tailnet ingress. Execution has no direct backend/database route; the web gateway rejects execution-subnet requests and a separate routed egress container filters private destinations. Service credentials and canonical files remain in service-private storage.

## Implementation

- NestJS with PostgreSQL, Drizzle, and `pg`. The application pool handles idle connection failures so unexpected database loss is logged and later queries can reconnect. Process stop signals mark planned shutdown before asynchronous Nest cleanup, suppressing expected pool-termination noise while the pool closes.
- Compose separates agent-service orchestration, persistent execution/desktop, the PWA gateway, and PostgreSQL. Connection settings use `DATABASE_URL`; [deployment](deployment.md) defines paths and persistence.
- Drizzle generates committed SQL migrations, applied through an explicit command.
- Controllers and agent tools call application services. Services own business rules and transactions; repositories handle persistence using the same transaction context.
- Client protocols live under `src/adapters`. The first-party contract owns HTTP, SSE, DTO validation, multipart framing, browser-origin checks, runtime contract/release identification, and application-error translation; `FIRST_PARTY_CONTRACT_VERSION` marks breaking wire changes. Shared secondary infrastructure owns Main-only ingress, external references, delivery dispatch, and retry state. Provider drivers implement `SecondaryDriver`; Telegram owns Bot API polling, owner-DM validation, rendering, and provider failure classification. Provider-neutral notification intent lives under `src/notifications`; native registration and dispatch live under `src/adapters/notifications`, while `src/adapters/apns` owns Apple authentication, payloads, and response classification. `src/adapters/web-push` owns browser subscriptions, Web Push transport, and per-installation delivery. `scripts/check-boundaries.mjs` is architecture lint run by `npm run lint`: it checks ordinary static imports/exports and file placement for core-to-adapter imports, protocol packages in core, and repository access from first-party and Telegram adapters. It is a focused maintenance guard, not a TypeScript parser or security boundary.
- File uploads, generated-file imports, and downloads stream through Pal, with a 25,000,000-byte per-file limit shared with native read_file image/PDF inspection. Canonical files are stored privately in `PAL_UPLOAD_DIR`; attachment metadata is stored in PostgreSQL. Manifests materialize copies in the shared agent home. Generated-file imports resolve paths inside execution and snapshot bytes into private storage. New storage names preserve a recognized or original extension for native workspace reading. Incoming messages and delegation carry private manifests with attachment IDs, filenames, content types, sizes, and absolute paths. `inspect_message` retrieves earlier public messages with resolved paths; `inspect_task` enriches attachment metadata in its optional message history. Main and Task guidance defaults to inspecting relevant user files before making content claims, with exceptions for explicit no-read requests, copy/resend actions, already-inspected unchanged files, and unrelated attachments. Main delegates substantial inspection to Task; interaction workers receive the relevant file-derived facts in their assignments. Message associations retain received and delivered attachments. Files imported during an unsuccessful publication expire after 24 hours if never attached to a message. Unattached uploads and stale temporary/orphaned files expire after 24 hours.
- Main runs through one native [AgentController Session](https://mastra.ai/docs/harness/agent-controller) in the Nest process, with session `pal-main-session`, stable owner `pal-owner` and thread `pal-main`. Mastra initializes and owns its conversation/memory tables in the `mastra` PostgreSQL schema; Pal services own the public application tables.
- Main, task, and worker instructions load from `src/agent/instructions/main.md`, `task.md`, and `worker.md` at runtime startup. The role composer loads `voice.md` for all agents; file, preference, texting and preference-learning policies for Main/Task; shared `workspace.md` for Task/interaction; and role-specific `execution.md` or `interaction.md` guidance. Shared texting guidance owns message grouping, source links, and silence requests. Main guidance owns the ordinary 80-word answer budget and compact-answer examples for its own user-facing messages. Delegation forwards user-requested communication constraints; Main's presentation and acknowledgment rules and earlier handoff wording do not establish Task communication preferences. Task guidance asks for brief commentary before investigations or work with several steps and useful progress as work proceeds, with detail proportional to the task. Task commentary is public task-chat text and can feed the header activity bubble. Nest includes them as build assets. Task instructions append current metadata using the invocation's thread ID.
- Developer-owned feature guidance uses native Mastra agent skills. `src/agent/agent-skills.ts` maps skill-directory names to receiving Task/Worker roles; Main has no skills. Add `src/agent/skills/<name>/SKILL.md` with a name and trigger description, then one role-map entry. Nest packages Markdown skill files and references with the backend; Mastra reads them from agent-service independently of the execution filesystem. The initial prompt receives skill metadata; native `skill` loads the body, `skill_read` reads supporting files, and `skill_search` searches content. These tools stay direct to preserve instruction results in conversation history. Authentication skills are assigned only to interaction. Loaded bodies remain in the active worker conversation; each new assignment starts without inherited history and loads needed skills on demand. Skills provide guidance; feature tools retain their existing application-service registration.
- Main, Task Agent and interaction workers use role-specific native Workspaces backed by the Compose-owned Docker execution container. Shell and model-authored code run there. Filesystem operations delegate to native LocalFilesystem inside execution, scoped to the shared agent home, preserving stale-write checks and sending large writes through stdin. Code SDK SandboxFilesystem omits expected-mtime checks and places write bodies in command arguments. Backend-private paths cannot be read through agent-provided symlinks. Main retains its read-only file tool. Task owns shell/files, web search and MCP/service tools; interaction owns browser/computer/login. Both Task and interaction retain code mode for their available text tools. Workspaces share execution providers; exposed-tool placement is not a process/filesystem security boundary. X11Computer executes xdotool/Pillow through Docker and supplies native computer tools with private screenshots. Providers start lazily. Backend shutdown cancels owned calls and disconnects from execution while leaving the desktop and user processes running.
- Before an interaction worker's first desktop action, host code snapshots browser page target IDs. Completion cleanup runs before FIFO desktop handoff and closes only pages created during that worker; pages that predate the turn remain untouched, while a pending secure-entry continuation retains its snapshot and selected page. Cleanup counts and two-minute execution samples retain only booleans and counters for cgroup memory/swap/OOM events, processes/threads, Chromium renderers and browser target types. URLs, titles, command arguments and page content are excluded.
- Main, Task, observer and reflector model calls use `PAL_AGENT_MODEL` (default `gpt-6.1-sol`) and `PAL_AGENT_THINKING_EFFORT` (default `medium`) through ChatGPT OAuth. Interaction uses `gpt-6.1-terra` with medium effort. Mastra Code owns private credential persistence and refresh. Provider middleware preserves the caller's instructions and supplies the subscription endpoint's required options. Main and Task Agent model calls send their stable thread IDs in the `session-id` header; worker calls use `pal-worker:<worker UUID>`.
- One reusable native [Task Agent](https://mastra.ai/docs/agents/overview) runs independent task threads identified by `pal-task:<task UUID>`, with owner resource `pal-owner`. Main searches title, goal, and description across all task statuses and archived records. Up to five alternative queries match literal terms across these fields; results sort by creation time and ID descending with a query-bound continuation cursor. Candidates contain ID, title (120 characters), goal (240 characters), status, archived state, and one matching description excerpt (up to 240 characters plus ellipses). `inspect_task` returns current details and optional paginated public history. Main answers directly when context suffices, and delegates substantial work, task updates, or ongoing ownership. Main acknowledges non-immediate user work before task discovery or extended reasoning, including work without tools, and leaves delegated substantive answers to the task. Main and Task share retained-context guidance that distinguishes user constraints from revisable agent assumptions; current evidence verifies remembered capability claims. Main and Task instructions include a shared concise voice profile at initialization; follow-ups use retained context and focus on what changed. For delegated work, Main refines searches, reuses a strong fit, creates after no suitable match, and clarifies material ambiguity. Main groups related checks with a combined answer in one task and allows parallel tool calls. Mastra handles streamed tool arguments and completed tool calls, including Codex calls without argument deltas. Text streams normally. Search batches alternative queries within one call. Task instructions include current metadata, status, UTC time, and shared-workspace guidance.
- Task Agent exposes one reusable native child agent through `agents: { worker }` and `agent-worker`. Native delegation hooks allow three concurrent workers per task, attach trusted parent-task and worker identities, and release slots after execution finalization. The interaction role uses Terra medium with computer/Android/secure-entry, on-demand authentication skills and code mode. Task uses the configured model (Sol medium by default), local execution, web search and MCP discovery/code mode. The parent owns public updates, task metadata, schedules, and synthesis. Workers have no child agents or task-management tools. Native delegation propagates cancellation, filters all inherited messages, stores separate private worker transcripts without observational memory, and returns private text findings. Task supplies complete assignments with facts, constraints and requested interaction methods. Guidance permits concurrent independent UI branches and keeps file inspection/service work on Task. A public `SubAgent` boundary projects completed tool results to call identity before native delegation builds the parent result or forwards the worker stream. Answer text, thread/resource references, pending calls and lifecycle control remain intact; full tool evidence stays in the worker thread.
- Main, task, and worker runs have no step-count limit, using native `maxSteps: 0` with `stopWhen: () => false`. Main's public Session machinery adapter overrides the Controller's fixed 1,000-step options for initial runs and resumes. Task model calls allow one retry, wait up to 120 seconds for first content, and cap each model step including retries at five minutes. Runs end when the model finishes, execution fails, or shutdown cancels them.
- [Native schedules](https://mastra.ai/docs/harness/schedules) persist task execution in Mastra's PostgreSQL schema. TaskSchedulesService wraps [mastra.schedules](https://mastra.ai/reference/schedules/overview), binds task/owner identity, validates ownership, and returns schedule identity, prompt, cron, timezone, status, and next fire time. Tasks may have multiple schedules. The Task Agent creates, lists, updates, pauses, resumes, and deletes them through conversation.
- Schedules use `cron` and an explicit IANA `timezone`. One-off reminders use a date-specific cron and agent guidance: the prompt records the full intended date/time; the agent skips earlier annual occurrences and deletes the triggering schedule when due before delivering the reminder. Cancellation depends on agent execution. Mastra owns timing, persistence, and dispatch.
- The parent Mastra host registers Main's Controller and Task Agent before starting native workers. TaskSchedulerWorker starts the native agent schedule consumer before polling, addressing Mastra 1.80's lost overdue tick at startup. Restored and runtime-created schedules use native overdue/restart behavior. Each tick sends a reactive `scheduled-execution` signal with automation source, schedule ID, and task ID; active tasks receive it and idle tasks wake with the same memory thread and seeded request context. Native run callbacks track activity and sanitized failures. Shutdown stops workers and aborts active task runs.
- Task guidance establishes cadence, explicit timezone, notification criteria and bounded workspace retention. Monitoring keeps one compact current checkpoint, may overwrite one rolling previous checkpoint, and removes superseded task-created run artifacts after a successful update. Failed sources retain their last successful checkpoint with a compact error status. Unremarkable checks can finish without assistant text. Status describes the overall objective: monitoring remains in-progress between checks; the agent pauses schedules before completing monitoring. Task archiving retains its visibility behavior.
- Main and Task Agent share [Memory](https://mastra.ai/docs/memory/overview) with thread-scoped [Observational Memory](https://mastra.ai/docs/memory/observational-memory) to compress each private conversation independently of Pal's visible history. Observation activates at 12,000 recent-history tokens and targets 3,000 retained raw tokens; reflection activates at 12,000 observation tokens. Native asynchronous buffering remains enabled, with end-of-turn idle buffering disabled. Thresholds allow temporary overshoot while background work completes. Observer and reflector share retained-context authority guidance with Main/Task and preserve source attribution and uncertainty without treating hosted-search metadata gaps as verification failures. Memory-generated suggested responses are disabled; current-task summaries remain enabled. Task checkpoints retain current findings and notification history rather than model-maintained tool-count audits.
- ChatCoordinatorService serializes persistence and native acceptance to preserve user-input order. Canonical message idempotency prevents duplicate input records. A process-local set permits the same key to retry a known pre-acceptance failure during that process; ambiguous, accepted, and post-restart duplicate submissions do not rerun agent work. Main receives input through `session.sendSignal({ type: "user", contents, attributes }, { requireDelivery: true, ifIdle: { attributes: { executionStart: true } } }).accepted`. Direct task input uses `taskAgent.sendMessage`; delegation uses a reactive `delegation` signal. Native [messages/signals](https://mastra.ai/docs/harness/signals) wake idle threads with stored context or deliver to active runs. Task wake options seed thread/resource request context for dynamic instructions. Accepted generation proceeds independently of HTTP submissions. Optional message metadata carries the client IANA timezone through persistence, history/SSE, and native user-message attributes. User input carries its public sequence, recent visible references, and any explicit quoted message. Task instructions include recent task references. Delegation can select multiple public source references.
- Main publishes exclusively through its always-available `sendToUser` tool. Host code derives secondary destinations from input origins in the current native execution. Main may supply optional `explicitDestinationIds` to add enabled secondary channels when the current user instruction requests them; it also selects one notification boolean. The tool sends either a message envelope or one emoji reaction on a Main-visible message. Ordinary Main output remains private. Task agents use structured `{ text, replyTo, attachmentIds, files }` output, parsed at completed `text-end` blocks and persisted only in task chat. Omitted reply references default to null; omitted attachment/file lists default to empty arrays. Explicit references and file declarations retain their validation. Empty text arrays normalize to empty strings with full envelope validation; valid file-only responses remain deliverable. Ordered text arrays preserve message boundaries; only the first quotes a reply and files attach to the last. Existing validators, generated-file snapshots, managed storage, and Task attachment correction feedback serve both paths. Main tool validation failures return to the agent for correction. Main sends and Task logs share canonical message storage; reasoning, tools, signals, memory output, and history replay remain private.
- After committing each Task `final_answer`, the runtime sends Main a reactive `task-result` through the native session API, delivering to active Main or waking idle Main. Results include public message identity, text, attachment manifests, current-execution input origins and routing destination IDs reconstructed from stored native signals, plus schedule IDs when triggered by automation. The idle-waking input carries a persisted execution-start attribute; lookup reads the live native message list back through that input, falling back to newest stored messages with total counts disabled when context has been compressed. Active steering joins that execution; explicitly selected older references remain eligible. Existing schedules receive the marker through the native update API. Finals can report outcomes, questions, or blockers. Main chooses what to communicate; no send is forced. Canonical result commit and native signal persistence are separate; a crash in that interval can leave a result unreported. Automatic replay is deferred.
- AgentActivityService owns the in-memory activity projection. Main start/end events and direct/scheduled Task run callbacks identify live work; distinct task IDs determine the running-task count. Public commentary is associated with its originating run and cleared at run end. Committed task events maintain titles and unarchived needs-input tasks. A completed-status transition arms a completion cue; the task's last successful active run ending timestamps and publishes it. Idle completion transitions publish immediately. Interruption, reopening, archival, and reset discard armed completion. Startup loads unarchived task summaries, while run state and completion cues start empty. The revisioned `agent.activity` snapshot includes these facts alongside the aggregate `working`/`idle` flag and is sent on stream connection and relevant changes. The web activity feature owns snapshot freshness, bubble selection, wording, and navigation independently of conversation caches and task pagination. Disconnected states suppress stale activity and keep the configured name visible; offline dims the avatar, while initial connection and reconnection use the same opacity pulse. Its pocket quest speech bubble uses a turning charm and stacked cards for multiple tasks. A five-second completion check and brief sparkle can appear alongside ongoing activity; idle completion shows the task title, then restores the configured name. Reduced motion disables animation. Shutdown cancels Main and active task streams, settles memory work and publications, and tears down the runtime/storage. Nest closes open HTTP/SSE connections through `forceCloseConnections` so connected clients can reconnect after restart. Stored context survives restart; new input starts another run. Interrupted executions are not automatically resumed.

## Preferences

Pal stores current user preferences in application-owned `preferences` records and immutable full snapshots in `preference_revisions`. Each record has a free-form topic, statement, optional applicability, user-stated or model-inferred basis, public user-message source IDs, active or retired status, and an optimistic version. Every create or update writes the current record and its attributed revision in one transaction. Main and Task attribution comes from trusted tool placement and invocation context; HTTP writes are human-attributed. Model changes to meaning require user-message evidence. A human meaning edit becomes user-stated and clears old evidence unless the caller deliberately supplies sources. Retired records remain auditable and are excluded from normal lookup.

`read_preferences` supports bounded literal search, current-record inspection, and revision history. Search accepts up to five alternative queries across topic, statement, and applicability and returns preference values plus source IDs without source-message text. `get` resolves bounded source summaries on demand. Main, Task, and Worker have read access; Main and Task have `update_preference`. Both tools expose operation-specific provider schemas built from the same limits and enum values used by the HTTP and service boundaries. No preference values are placed in initial agent context. Guidance asks agents to look up current records for preference-dependent choices and to keep one-off constraints in conversation or task context. Lookup relevance, preference interpretation, and learning remain model judgments; transactions, evidence identity, attribution, and version conflicts are code-enforced. Existing runs are not interrupted when a preference changes.

Management API:

| Route                          | Behavior                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /preferences`             | Browse or search active records by default; filter by topic/status and paginate with a filter-bound cursor.                                          |
| `POST /preferences`            | Create a human-authored preference.                                                                                                                  |
| `GET /preferences/:id`         | Read the current record with source-message summaries.                                                                                               |
| `PATCH /preferences/:id`       | Apply a human correction, retirement, reactivation, or historical restore using `expectedVersion`; stale edits return `409` with the current record. |
| `GET /preferences/:id/history` | Read immutable revision snapshots and actor/reason metadata.                                                                                         |

The playground preference manager searches active or retired records, edits and restores records, navigates to source messages through the same older-message path used by reply quotes, and preserves a draft across conflicts. It and connected-service settings use shared dialog styles with feature-specific behavior scoped separately. Retirement preserves revision and conversation history. Preference changes are refreshed when the manager opens or after a write; there is no preference SSE event.

## Interaction resources

`InteractionCoordinator` owns independent FIFO admission queues for desktop and Android. The first ordinary device call binds a worker execution to one device; another device requires a fresh worker delegated by Task. Calls wait in host code and execute serially within an active turn. Model thinking retains the turn. Completion, failure, cancellation and parent termination immediately retire the execution and admit the next owner. Retired executions cannot start new calls; dispatched operations may finish after handoff. Agents inspect current UI state and adapt as prior actions settle. Model-response and device-operation deadlines exclude queue waiting. Queue state is local to one backend and starts empty after restart.

With `PAL_DESKTOP_ENABLED`, workers receive native computer tools and private-entry tools. Desktop commands use the execution provider's ordinary 30-second process timeout. `SharedBrowserService` connects to the persistent shared Chromium profile for private inspection and filling. A small content-versioned extension resolves the active browser target using Chrome's tab/debug-target APIs. It creates or groups no tabs. Playwright connects with `noDefaults`; each private inspection binds its explicit page and later filling validates that target independently of the currently active tab. Browser and desktop launchers share the profile. Native computer interaction also supports non-browser applications.

Workers manage temporary tabs and app UI during their turn and report any deferred cleanup to Task for a later queued assignment. Tabs/app state persist across worker completion, task archive, idle time, and backend shutdown. Private-entry waits release device access while retaining the request and required target metadata. External user submissions take fresh short FIFO turns, validate the original target, and fill or invoke bounded stale-field recovery. Nested private operations reuse their current turn. Browser private operations have a 30-second deadline; Android calls use their ordinary transport deadlines. Unconfirmed fills return an error without automatic replay. Failures do not disable future device admission. Continuation uses a fresh execution identity even when the request restores the same private-entry session identity. UI takeover and cleanup are agent responsibilities; the host owns turn admission and preserves UI state.

Production and exclusive device acceptance share `interactionSession` for the worker model, tools, processors, workspace and private-target cleanup. Coordinator dependencies are required and refer to the same application-owned instance.

## Exposed API

The first-party HTTP contract is generated from adapter-owned Nest DTO metadata into `backend/openapi/first-party-v1.json`. `npm run openapi:generate` updates the committed artifact and `npm run openapi:check` detects drift. Stable operation IDs cover chat, Tasks, files, preferences, connected services, health, SSE, and the frontend deployment marker. Browser fetches send `X-Pal-Contract-Version`; responses return that version plus `X-Pal-Release-Id`. Browser mutations with an absent or stale version are rejected, while native clients remain usable during coordinated rollout. EventSource supplies its version as a query and receives the authoritative contract/release pair in the initial `frontend.updated` event. A successful frontend-only staging build posts its opaque revision to `POST /frontend-updates`, which publishes the same event as an immediate service-worker update-check hint without restarting Pal. Representative PostgreSQL-backed tests validate real HTTP and SSE bodies against the component schemas. Breaking wire changes require an explicit update to `FIRST_PARTY_CONTRACT_VERSION`; documentation-only or backward-compatible schema additions do not.

Web clients generate types from the committed artifact. HTTP goes through their generated-path adapter; SSE uses the same component schemas through a dedicated EventSource boundary because OpenAPI does not own stream lifecycle or recovery. Snapshots remain authoritative after malformed input or a stream gap.

### Instance settings

`GET /instance-settings` returns `{agentName, agentAvatarAttachmentId, accentColor, version}`. Defaults are `pal`, no image, and `#0066d6`. `PATCH /instance-settings` saves supplied fields and preserves omitted fields; a null image restores the donut fallback. The singleton `instance_settings` row uses the fixed key `1`, typed columns, and an increasing version. Successful writes publish `instance.settings.updated` as a refetch hint. Main and Task receive the current `agentName` as their name on every model run; the other appearance settings are client-only.

Avatars use the existing file upload/content APIs. Assignment validates the detected PNG format, signature/IHDR, a 2 MB byte limit, and dimensions up to 2048 × 2048. The settings transaction locks the selected attachment using the file repository's existing lock before saving its reference. Cleanup retains attachments referenced by messages or instance settings; unreferenced uploads become eligible after 24 hours from upload. The web favicon follows the saved avatar, with the accent-colored donut as its loading and unavailable-image fallback. Settings synchronization and reconnects refresh it. The backend serves a network-only `/manifest.webmanifest` with the profile PNG’s original URL and actual dimensions; Apple touch icon endpoints redirect to the same file. PNG bytes and transparency are preserved. Missing or unavailable images use the bundled installation icons. `PAL_APP_VARIANT` selects the stable Pal or Pal Dev name/ID and fallback images. Uploaded images and installation metadata remain outside the PWA static-shell cache.

### Private authentication and payment entry

Interaction workers have `inspect_private_fields({accountOrigin?})`, `enter_private_fields({fields, chooseAccount?, keepMeSignedIn?})` and `confirm_authentication({keepMeSignedIn?})`. Main delegates UI work. Private inspection derives the device from the coordinator's binding for the trusted execution ID and has no model-facing target selector. Android requires an HTTPS account origin for shared vault matching because a native app has no verified web origin. LoginService owns workflow policy, LoginRepository owns PostgreSQL metadata, BitwardenService isolates the vault, and LoginDestinations owns browser and Android mechanics.

Computer tools are native Mastra workspace tools guarded by the shared resource coordinator. Workers navigate the shared browser visually. Private inspection resolves the active browser tab, then retains that explicit target for validation and filling. It enumerates up to 200 visible editable inputs and expiry selects across HTTPS frames and returns opaque refs, metadata, and a masked screenshot with matching input badges. The model selects refs and assigns semantic roles; HTML hints are evidence. Username/password pairing and OTP classification/grouping remain model decisions.

Fill and entry tools accept the same fields union: a nonempty username/password selection, an ordered code-ref array (one ref for a single input), or payment field roles. Each selected value must be an opaque input ref from the latest inspection; literal labels, selectors and values are rejected before browser work. Compact refs combine the numbered input marker with a random 96-bit base64url nonce. Browser references bind the caller, page, frame, document, URL and actual elements for ten minutes and expire on reinspection/restart. The backend rejects mixed login/code frames/documents, duplicate refs, stale or uneditable controls and invalid role/type combinations. Login/code roles reject declared credit-card purposes. Passwords require password inputs and reject declared new-password/OTP purposes. Username selection rejects password and declared password/OTP purposes. Code selection needs editable text-like inputs and preserves the model's supplied order. Every destination is validated before writing; each element is rechecked immediately before filling. Values never pass through selectors, shell commands or current focus. Private submissions and model-requested fills never click submit; sites may advance automatically when a code is filled. The worker uses computer or Android controls for navigation and submission. Secure-entry tool schemas expose no browser-command action parameter.

LoginService selects an active caller-owned flow account, the last successful matching account, or a sole match, in that order. Ambiguous matches automatically publish an inline account picker and return `awaiting_user`; missing values open private entry. `login_flows` retains account IDs and session intent for 24 hours across stages and restarts. `login_sites` owns the last successful vault item ID and Keep me signed in preference per credential origin. Saving, selecting and filling never promote an account. After verifying authentication, including verification challenges, Task/Worker calls `confirm_authentication()`; confirmation is idempotent and an old duplicate cannot overwrite a newer successful choice. The model owns verification; the host records the selected flow account, including after a redirect to the merchant.

`enter_private_fields` accepts the current inspection refs once and deterministically fills a reusable account, opens an ambiguity or explicitly requested picker, or opens private entry. Credential entry collects only the selected roles for the current page. Email, phone and other account identifiers use the username role; reusable passwords and PINs use the password role; verification codes use the transient code role. Agents continue existing authenticated sessions unless the user requests another account, reuse the current selection across stages and request corrected credentials after explicit rejection. The picker lists matching saved accounts and Use a new account. Selection revalidates vault matching against the bound origin, fills the original bound fields after matching their current frame URL, records the caller-owned flow and resumes the owning Task through a metadata notification.

Credential forms and account pickers include Keep me signed in, initially false and subsequently restored from the website preference. Each form owns its checkbox draft. The save and selection APIs accept an optional boolean; omitted values preserve the request's bound preference. Entry and confirmation accept an optional nullable `keepMeSignedIn` for explicit user text. Fill results and credential-completion notifications deliver intent to the model. The agent finds and chooses or declines website persistence controls using page evidence. There are no persistence selectors or guarantees; the checkbox neither disables credential reuse nor requests sign-out at task completion. On an already authenticated page without a selected flow, confirmation with an explicit preference stores the page origin preference without inventing a successful account.

Hosted Bitwarden owns credentials and URI matching through its supported CLI Vault Management API. The CLI runs on agent-service loopback with private state and temporary files. Account API credentials authenticate; the separately configured master password unlocks the vault automatically. The service prewarms the configured vault during application startup without delaying API availability: it unlocks the CLI and performs its initial sync in the background. Concurrent login requests share initialization and sync work; failed prewarming logs a sanitized warning and retries on demand. The service refreshes hourly in the background, sharing concurrent refreshes. Lookups use the local vault between refreshes; failed background refreshes preserve local reads. Pal writes remain immediately visible locally and push to Bitwarden through the write API. External changes appear after refresh. A staged credential request may create an item with only the current identifier or reusable secret; later stages merge into the active flow account without replacing previously collected fields. New items use HTTPS Host matching; each fill rematches the current frame URL. There is no model-facing read/export operation. Missing configuration leaves inspection available and reports `not_configured`.

Payment entry uses the same request lifecycle with kind `card`. Card roles are cardholderName, number, expiry (MM/YY), expMonth, expYear and securityCode; a selection contains only one entry kind. HTTPS payment fields may span frames from the same inspection and owned page. Every binding retains both the frame and top-level document/URL; navigation, replacement and stale references require recovery. Month/year selects are validated before filling.

For card fields, `enter_private_fields` opens private entry or a Bitwarden picker and accepts no login preference. The first-party request view exposes only ID, label, brand and last four digits. A website-saved card can request just missing fields without a Bitwarden item. Card submissions fill directly, optionally saving a complete card to Bitwarden when the user checks Save to Bitwarden. A request marker makes saves idempotent. Transient entry and stale-binding recovery retain no payment values. Filling never submits a purchase or changes merchant save-card preferences. Card requests do not change login account/session preferences.

Inspection masks all text-like controls, including unclassified, readonly and disabled inputs beyond the metadata limit, textareas, selects and editable regions. It never reads input values. Private tool results carry metadata and a PNG; public request views expose only their bound preview ID. Private `login_inspections` rows retain images for 24 hours.

Canonical Task messages carry a `secureEntryRequestId` reference and a text fallback. Trusted secure-entry metadata makes the same message visible in Main through `mainVisible`; Task ownership and completion routing remain unchanged. `login_requests` owns the card identity, verified origin, kind, account-picker flag, status, inspection and input references, worker identity and recovery metadata. It stores no usernames, passwords, verification codes or payment values. Each request records its browser or verified native-app destination. One active request exists per task/origin/kind/destination. Flow selection also records its destination, preventing cross-surface staged credential merges. A replacement code selection or agent-requested change between account picking and credential entry gets a new submission ID under the same card identity; reads through the canonical reference resolve the latest request. An old submitted draft cannot fill the replacement fields. Request creation and card publication reconcile idempotently; the notification sweep repairs interrupted publication. Mastra transcripts remain private execution history.

The PWA renders dense inline account pickers and credential/code/payment forms in Main and the Task conversation. Cards render identically in both conversations and inherit the standard message maximum width. Cached Main messages display text fallbacks until authoritative history arrives; only authoritative messages mount live forms. Only credential/code/payment forms offer a collapsed annotated preview below the card header. Use a new account opens the existing credential form locally, with Back returning to saved accounts; each view shares the local checkbox draft. Correction entry retains its Save to vault-replacement control. Credentials and codes submit directly to the backend; drafts stay in component memory and clear on completion, replacement or unmount. Active forms collectively block automatic PWA reloads. Request views refresh on `login.updated` and reconnect. Credential requests expose the selected roles, deterministic labels derived from inspected input metadata and the active flow account. The form renders and submits only those roles; later stages merge into the same account. Requests remain valid for 24 hours. Credential save, account selection and code submission revalidate the original selection and fill it directly before notifying the Task. Credential saves/account choices persist even if filling fails, returning saved/selected for fresh agent-driven filling. Successful direct filling returns filled; the PWA labels credential completion Login filled and verification completion Code filled. Codes are discarded after submission. Completed submissions acknowledge retries without refilling. Saved/selected/filled states describe storage, account choice or filling, independently of authentication success. Vault-backed TOTP generation is deferred.

Unused optional tool arguments accept null or omission. Invalid argument shapes return `invalid_input`; stale references return a field conflict. Stale code submissions transition to `updating`, discard the submitted code and notify the owning Task to inspect and select fresh fields. The ten-second sweep also detects missing/expired bindings after restart and reference expiry. Each card allows two automatic recovery attempts, with a two-minute deadline per attempt; failure exposes explicit retry/cancel actions. User retry resets the attempt budget. Cancellation and Task completion close active requests. Invalid passwords/codes alone do not trigger recovery. Notifications contain metadata only and retry independently of vault writes or code filling. Workers report pending input to their parent Task.

| Route | Behavior |
| --- | --- |
| `GET /login/requests/:id` | Current card request, bound preview ID and matching account labels; no secrets |
| `GET /login/inspections/:id/image` | Masked PNG; `Cache-Control: no-store` |
| `POST /login/requests/:id/save` | Direct selected credential-role entry; optional matching/active account merge and Keep me signed in preference |
| `POST /login/requests/:id/select` | Select a matching saved account and optional Keep me signed in preference; fill the bound browser fields |
| `POST /login/requests/:id/card` | Private saved-card selection or card values; optional explicit vault save; fills only bound payment fields |
| `POST /login/requests/:id/code` | Direct transient code entry; fill or automatic recovery |
| `POST /login/requests/:id/retry` | Retry a failed recovery using fresh browser inspection |
| `POST /login/requests/:id/cancel` | Close an active request without submitting input |

`login.updated` carries only task identity. Login-tool outputs, SSE, chat, errors and shared files receive no credential values. Task shell access remains within the accepted model trust boundary; removing worker browser tools simplifies navigation choices rather than creating a new isolation boundary. Shared Task/Worker guidance retains the secret-handling rule and directs authentication work to the on-demand website-authentication skill. That skill owns field selection, account choice, private-entry continuation, persistence, recovery and result verification. Private filling and subsequent computer navigation are separate operations. Secure-entry tools set needs-input when publishing an inline card. Filled notifications carry facts and persistence intent. These tools remain available within the accepted model trust boundary. The website and execution browser necessarily receive filled values.

### Android interaction

The PWA Phone drawer uses Tango's ADB/scrcpy client and WebCodecs renderer with stock scrcpy 3.3.3 (checksum-pinned in the sidecar image). Opening the drawer starts a 1280-pixel, 30fps, 4Mbps H.264 stream; closing releases its scrcpy process. The drawer follows video dimensions and supports touch/drag/long press, an explicit client-keyboard toggle, ordinary keyboard input/paste, a toolbar action that reads the client clipboard and injects text into the focused Android field, Android navigation, reconnect and fullscreen. WebCodecs requires HTTPS or localhost. Unsupported browsers and unavailable phones show a local status without blocking desktop use. PWA updates defer while the drawer is open.

`/api/android/viewer` upgrades through the existing private web gateway to `AndroidViewerService`, which checks the browser origin and injects the sidecar bearer token. The sidecar `/viewer` uses the configured USB serial and exposes scrcpy control only. Binary video messages have a nine-byte envelope: packet kind (0 configuration, 1 delta, 2 keyframe), unsigned 64-bit big-endian PTS, then Tango's packet data. Initial text metadata supplies the codec. Client binary messages are Tango-serialized scrcpy controls. No audio, clipboard synchronization or control-ownership UI is enabled. Human interaction can run alongside the agent, as with Desktop.

A separate control-only scrcpy session keeps a Tango HID keyboard attached while the sidecar runs, independently of viewers. The sidecar sets `show_ime_with_hard_keyboard=0` and reconnects the keyboard after session loss. Android's normal IME stays hidden while agent typing, secure fill and PWA text injection continue through their existing paths. Apps may still show custom keypads. The PWA toolbar explicitly focuses a client textarea to summon the user's touch keyboard; text, Backspace, Enter and committed composition are forwarded, and the textarea clears after each committed input. Scrcpy exposes no focused-input event, so opening the client keyboard is user-controlled. Unicode remains limited by scrcpy's existing text-injection support.

`AndroidModule` owns the configured phone integration. Android connection and tool-list requests each have a three-second timeout. Failed discovery logs a warning and omits Android tools for that worker run; computer and secure-entry tools remain available. Failed discovery connections are discarded and a later worker run retries. `AndroidService` injects one USB serial into a fixed Mobile MCP action set. Workers receive app discovery/launch, screen inspection/screenshot, taps, ordinary typing, swipes and navigation. Task receives availability guidance and delegates complete workflows. Service-specific MCP discovery remains Task-owned.

Ordinary and private Android calls use the shared interaction coordinator. Awaiting private entry releases the device; subsequent user submission reacquires access and validates helper session, generation, package, and field bindings. Native refs expire or become stale after navigation/helper handoffs and require fresh inspection. Connection/helper mechanics remain Android-owned. App sessions remain on the phone. Coordination assumes manual viewers send no input and development/production never control the physical phone simultaneously.

The sidecar's rootless instrumentation helper supplies editable native and WebView field metadata, bound-node `ACTION_SET_TEXT` filling and unmasked screenshots. Installed apps are operator-controlled and need no trust registration. Android private inspection takes an HTTPS account origin selected by the interaction worker for shared vault matching; it is account context, not a verified WebView origin. Refs bind the worker, helper session, foreground package, window/node and freshness. Input metadata helps the worker assign roles without requiring a password flag. Browser actions, persistence preferences and card roles are unavailable for Android filling. Fields without an accessible editable node require manual entry.

Ordinary Android tools use Mobile MCP's schemas, compact observations, refs, screenshots, results and errors. Pal selects navigation, clipboard and batch tools, injects the configured device, and serializes access per interaction worker. Batch steps use the same selected tools and bound device. Pal omits null step arguments because the batch record bypasses ordinary tool-schema optional-value handling. Visible UI text and screenshots are unmasked; the private-fill response contains no submitted values. Tool definitions load from the sidecar when the worker starts.

Android has one UI Automation connection. The helper is used only for private inspection, validation and filling. Before helper startup, the sidecar releases the pinned Mobile CLI DeviceServer; the next ordinary operation stops instrumentation and invalidates private refs. Ordinary navigation remains within Mobile MCP. Mobile CLI exposes no public Android stop operation, so the sidecar targets its exact daemon class for the private handoff. ADB authorization, private app-cache bootstrap and per-connection HMAC challenges authenticate the helper before credentials are transmitted. Requests/responses bind fresh nonces. Bootstrap keys are deleted at helper startup; submitted credentials never enter ADB arguments, clipboard, helper files or logs.

`interaction-methods.md` supplies method selection and continuation handoffs to Task and Worker. The worker-only authentication skill owns shared account/private-entry policy; the Android skill owns native navigation and unsupported-flow handoff. Android tools are available only when configured, and detailed procedures load on demand. These tools retain the existing accepted model trust boundary.

## Connected services (MCP)

`McpService` loads general HTTP MCP connections at startup and explicit Apply. Task agents discover MCP tools with native Mastra `search_tools`; matches load automatically for the next model step. Server instructions are available from the start. Main remains a fast conversational router with task tools and generic connected-service delegation guidance. External checks use ordinary visible tasks and reuse suitable existing work.

`TaskToolDiscoveryProcessor` uses native `ToolSearchProcessor` for Task-only MCP discovery and composes the shared `CodeModeProcessor`. The latter uses native `createCodeMode` to generate `execute_typescript` and signatures for the receiving role’s tools; interaction uses it without MCP discovery. Core and workspace tools stay available. Each step's runner exposes available text/data tools, including discovered MCP tools, through generated `external_*` TypeScript functions. Direct calls remain available. File reads, browser screenshots, and computer tools use direct calls to preserve native image output. Worker delegation stays direct to preserve native streams and invocation context. Programs run inside execution using native validation, execution context, and tracing. The service writes runner files under the shared `/home/pal/tmp`; both containers use the same UID and absolute paths. Tool RPC returns over Docker stdin/stdout and executes allowed tools in agent-service with their original context. Discovery state comes from completed search results containing `loaded` tool names in the native conversation (`storage: 'context'`), survives restart, and expires when those results leave context. Apply refreshes the searchable tool implementations without a separate discovery database. The ChatGPT-login model route uses ordinary function tools for this flow.

Tool placement for new capabilities:

| Capability                                                                                                             | Placement                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Feature-specific procedures and supporting guidance | Developer-owned native skills, scoped to receiving Task/Worker roles. |
| Conversation routing, quick file reading, task search, inspection, delegation, preference read/write                   | Main's small always-available tool set.                                            |
| Broad task operations, preference read/write, task status, schedules, filesystem, shell, web search | Task's always-available core tools and native workspace tools.                     |
| Browser/computer/login and configured Android interaction | Interaction worker tools. |
| Preference read                                                                                                        | Worker's always-available core tools.                                              |
| Service-specific actions and queries                                                                                   | Task's searchable MCP catalog. Add MCP servers through connected-service settings. |

Keep broadly useful task primitives always available; expose service-specific catalogs through discovery. Discovery activates tool definitions and code signatures for the model. Task guidance treats remembered names as search hints, resolves capabilities against current definitions, and verifies matching semantics within existing authorization. Monitoring guidance isolates independent source failures, preserves failed-source checkpoints, and reports lost coverage and recovery. These are model responsibilities; schedule execution success does not certify source coverage. Backend MCP connections load at startup/Apply, service instructions are present from the start, and business data is fetched when a tool executes. Execution style is a separate choice: available text/data tools support direct calls and code mode; native media tools use direct calls.

Pal supports MCP tools, including text and structured results. MCP Apps, prompts, and resource rendering are unsupported. A supported HTTP fetch hook removes Mastra MCP 2.6's unconditional Apps advertisement from initialization and request metadata so servers select ordinary tool responses. Native MCP clients own transport negotiation, tool validation, OAuth discovery, PKCE, exchange, and refresh. Pal adapts each loaded OAuth connection so concurrent HTTP 401 responses share one refresh transaction, preserving rotating refresh tokens. Server failures are isolated; unavailable services appear in task instructions and settings while other tools remain usable.

| Route                           | Behavior                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /mcp/servers`              | Redacted saved configuration, loaded connection status, login status, and global/per-server `applyNeeded`.                                                       |
| `POST /mcp/servers`             | Create `{name, url, enabled?, auth?}`; returns `{id}`. Names match `[a-z][a-z0-9_]{0,47}`.                                                                       |
| `PATCH /mcp/servers/:id`        | Save supplied fields; omitted fields retain their values.                                                                                                        |
| `DELETE /mcp/servers/:id`       | Delete saved configuration and credentials. Apply closes its loaded connection.                                                                                  |
| `POST /mcp/apply`               | Refresh the shared task catalog and return the status snapshot. `409` while native runs, dispatch preparation, scheduled execution, or another Apply are active. |
| `POST /mcp/servers/:id/login`   | Start settings-driven OAuth; returns `{authorizationUrl}`. Pending login lasts five minutes; a second pending login returns `409`.                               |
| `GET /mcp/oauth/callback`       | Validate pending state and issuer, exchange the code through the SDK, and persist tokens. Returns a plain browser completion message.                            |
| `DELETE /mcp/servers/:id/login` | Forget local credentials. Apply discards credentials held by loaded connections; provider consent remains.                                                       |

Authentication inputs:

```typescript
type McpAuth =
  | { type: 'none' }
  | { type: 'headers'; headers?: Record<string, string> | null }
  | { type: 'oauth'; clientId?: string; clientMetadataUrl?: string;
      clientSecret?: string | null; scope?: string };
```

OAuth requires exactly one client identity: a pre-registered `clientId` or an HTTPS client metadata document URL. Register `${PAL_PUBLIC_URL}/mcp/oauth/callback` with the provider. Pal does not perform dynamic client registration or host a public client metadata document. Provider-specific endpoints, scopes, and credentials belong in private instance configuration.

Secrets are write-only. Responses expose OAuth `hasClientSecret`, header names, and `hasLogin`, with no token/header values. Omitted `clientSecret` or `headers` retains the saved secret in the same auth mode; `clientSecret: null` and `headers: null`/`{}` clear them. Switching mode replaces the previous authentication configuration. URL/auth edits reset saved OAuth credentials. Configuration and tokens live in PostgreSQL `mcp_servers`; treat database access/backups as credential access. Pending state, PKCE verifier, and handshake discovery state are in memory and expire at restart. Credential writes are guarded against stale refreshes after edits or logout.

Saving is allowed while agents work. Apply uses one admission barrier: it rejects active native work, waits new user/task dispatch and scheduled preparation until refresh finishes, and then exposes the shared catalog to reused, new, and scheduled task runs. It does not queue Apply. Restart loads saved definitions and retries connection or discovery failures on a bounded schedule before agents start. Only the final startup discovery candidate is exposed. An applied definition can have an unhealthy connection; `applyNeeded` measures saved changes, independently of connection health. Reading settings never invokes business tools. Clients refresh settings after OAuth completion and display Apply failures; MCP status has no SSE event.

Startup and Apply log the potential full available MCP catalog cost: model, tool count, estimated catalog tokens (`characters / 4`), context limit/source, and context percentage. Actual task prompts include only discovered MCP signatures and the general runner's core/workspace signatures. `PAL_MCP_CATALOG_WARN_PERCENT` defaults to 10 and warns strictly above that percentage, including the numeric token estimate. `PAL_AGENT_CONTEXT_WINDOW_TOKENS` overrides the denominator; exact model `gpt-6.1-sol` has a 272,000-token fallback from the inspected Codex catalog. Other models report an unknown percentage until configured. Logs contain no catalog text, credentials, or tool results. The percentage is a configurable heuristic.

Requests with an `idempotencyKey` return the original result when repeated with the same payload. Reusing the key with different input returns `409`.

### Messages

```typescript
/** Get paginated chat history **/
// Meant as a snapshot. Live updates come via SSE
GET /chat/history

QUERY PARAMS
{
  "taskId": "<task-id>", // optional; omit for main chat
  "before": 150, // optional; messages with sequence exclusively less than 150
  // omit before to get latest messages
  "limit": 20,
}

RESPONSE
{
  "messages": [UserVisibleMessage],
  "before": null, // next page cursor; null means no further results
}

/** Send user message **/
POST /chat/messages

REQUEST
{
  "idempotencyKey": "<client-generated-id>",
  "destinationId": "web", // optional for the playground; iOS sends "ios"
  "taskId": "<task-id>", // optional; omit for Main
  "replyToMessageId": "<visible-message-id>", // optional; omit for an ordinary message
  // Main and task agents accept text and/or up to 100 attachment IDs.
  "text": "Some user message",
  "metadata": { "timezone": "Asia/Singapore" }, // optional client context
  "attachmentIds": []
}

RESPONSE
{
  "messageId": "<backend persisted id>"
}

/** Send a suggested reply through the same endpoint **/
POST /chat/messages

REQUEST
{
  "idempotencyKey": "<client-generated-id>",
  "destinationId": "web",
  "taskId": "<task-id>", // optional; source must be visible in this chat
  "suggestedReply": { "messageId": "<assistant-message-id>", "index": 0 }
}
```

A committed user message means Read. `message.added` exposes it over SSE before native agent acceptance; history snapshots retain the same receipt. The nullable `idempotencyKey` matches an optimistic client bubble to its persisted message. Read derives from persistence, including older user messages and messages whose agent handoff fails.

The PWA accepts ordinary composer sends after history has loaded even when its event stream is disconnected. A versioned local outbox keeps the optimistic message, destination, uploaded attachment references, optional quote and original idempotency key across reloads. Queued entries drain in creation order after the stream reconnects and authoritative history synchronizes. Each retry resubmits the original idempotency key, and the browser removes the entry only after a successful POST; backend idempotency returns the canonical result when an earlier ambiguous attempt already persisted the message. History and SSE replace the optimistic bubble independently. Automatic delivery expires after 24 hours. Expired messages stay visible for explicit retry or dismissal, and an explicit retry starts a new 24-hour window. Suggested replies still require current connected history.

Explicit replies can target user or assistant messages visible in the selected chat. The API rejects a missing or out-of-chat target with 400 before persistence and agent delivery. The normalized reply ID participates in idempotency checks. History and `message.added`/`message.updated` include the stored `replyToMessageId` and a bounded, nonrecursive target summary. SSE events carry the same canonical message to both chat views; clients show a quote only when its target belongs to the displayed chat, using the target's role, task ID, and phase. Loaded pagination does not affect this check. Clients map their own platform reply IDs to Pal message IDs.

#### Reply references absent from a client

Pal reply references identify canonical messages. A referenced message can be valid in Pal while absent from the receiving client's local history or platform transcript. For example, a Telegram-delivered answer may quote a user message submitted through iOS that was never sent to Telegram. Presence of `replyToMessageId` does not guarantee a corresponding client/platform message.

Clients must display the new message even when the referenced message is unavailable locally. Use the supplied `replyTo` summary when permitted by the existing chat-visibility rules; quote rendering does not require the original message to be cached. Clients with canonical-history access may offer optional lookup/navigation. If navigation is unavailable, render the summary without a broken jump action, or render the answer without a quote.

Provider adapters may use native reply threading only when they have a mapping from the canonical referenced ID to a message in the destination platform conversation. Without that mapping, omit native threading and deliver the answer, optionally with the supplied summary. Do not treat a Pal ID as a platform ID, fail/drop the answer, or automatically send the missing original merely to create a reply target. Preserve the canonical reference in Pal regardless of client rendering.

HTTP success follows native input acceptance and precedes the assistant response. A failed handoff returns sanitized HTTP 503 and retains the committed user message. Repeating the same key retries only a known pre-acceptance failure remembered in the current process. That retry eligibility is deliberately lost at restart. Uncertain, accepted, and other duplicate handoffs return the existing message ID without running agent work again. Main generation errors remain operational failures; Task generation errors are logged locally and reported to Main. Several inputs can produce one response; a run can publish several messages.

Main and Task may publish up to three distinct, single-line `suggestedReplies`, each at most 80 characters. Main selects them in `sendToUser`; Task selects them in structured public output. Shared texting guidance describes when suggestions help. Grouped public output puts suggestions on its final message.

A suggested-reply submission carries the source message ID and zero-based index, with empty/omitted text and no attachments or quote. In the existing message-idempotency transaction, the service locks the visible assistant source, resolves its saved text, clears its suggestions, increments its version, and creates the user message. One concurrent selection succeeds; later selections conflict. An identical idempotent retry returns the original user message and retains the normal handoff retry policy. Commit emits `message.updated` for the source and `message.added` for the user message to all clients. History retains consumption.

The PWA renders 44px reply pills beneath the latest message while it is an assistant message with available suggestions. Tapping uses the existing optimistic user-message animation, scrolling, receipts, and retry path, and preserves composer text, pending uploads, and the selected quote. Consumed options immediately become inert and fade/collapse using the shared 120ms/180ms motion timings on every connected client; Reduce Motion removes the transition. A losing client removes its optimistic attempt and refreshes canonical state. Cached or disconnected history cannot submit suggestions.

### Message destinations and external delivery

`destinations` stores opaque IDs, adapter identity, canonical/secondary role, and enabled state. Composition provisions canonical `web` and `ios` audiences and the secondary `telegram` owner inbox. First-party requests may select only enabled canonical destinations through `destinationId`; the Telegram driver supplies its own configured destination. User messages persist informational `source` plus `originDestinationId`. Assistant messages have no origin.

Main messages persist resolved `deliveryDestinationIds` and derived `notificationDestinationIds`. Every Main send appears in canonical history. Host resolution includes all enabled canonical audiences, enabled secondary origins from the current execution, and optional explicit secondary overrides. Tool `explicitDestinationIds` is omitted for ordinary routing and adds channels only when the current user instruction requests them. `notify: true` requests alerts across the included first-party and secondary audiences where supported. Reactions use the same resolution. Task logs have empty delivery and notification lists. Phase does not select destinations or alerts. API `notify` summarizes the notification list; clients inspect their own destination ID before alerting.

Native user input carries its message reference and `originDestinationId`. Main sees the small enabled-secondary-destination directory in dynamic context. Delegation accepts multiple `sourceMessageRefs` and supplies their origins; the first source retains existing text/file forwarding, and explicit attachment IDs select additional files. Stored native signals and `inspect_message` support later provenance lookup. At tool execution, the host scans the live native message list backward through the latest `executionStart`, derives enabled secondary origins, and unions explicit overrides. No idle timer or participant registry owns routing.

Scheduled executions use the Task thread’s persisted conversation. Schedule creation snapshots destination IDs derived from its current execution into native schedule attributes. A scheduled idle wake starts a new provenance boundary and supplies that audience without historical reconstruction. Task outcomes reach Main through the same signal path. Workers do not publish and only Main has `sendToUser`.

Main message publication creates delivery jobs for resolved enabled secondary destinations in the canonical publication transaction. Adapters return destination-scoped provider references for splitting and quotes. Known-safe failures before acceptance retry at most four times with bounded backoff and provider hints. Partial or ambiguous acceptance becomes uncertain and is not retried. Disabled destinations cancel pending jobs; history replay creates none.

Agent reactions persist in a single slot on their target message and emit `message.updated`. Reaction jobs reuse the delivery and notification queues with the target version and emoji snapshot. PWA and APNs reaction alerts use `reacted <emoji> to “<message preview>”`, with a plain-text preview of up to 200 Unicode characters and an ellipsis inside the closing quote when truncated. Reactions on messages without text use `reacted <emoji>`. Superseded queued reactions are cancelled; interrupted sends retain existing uncertain-delivery semantics. Adapters use native reactions when supported and mapped, otherwise send a fresh emoji-only message on each update. Telegram falls back after a known 400 rejection or missing mapping, and never after ambiguous acceptance. Native reactions have provider-owned alert behavior. Fallback messages are not added as canonical text messages or used to replace the target’s provider mapping. Web and iOS render an attached emoji bubble; users have no reaction controls.

When APNs is fully configured, the same publication transaction creates one provider-neutral `notification_intents` row for an eligible `ios` notification destination. The native adapter keeps one active iOS installation for the sole owner; registering a new installation disables the previous one, and revocation is idempotent. Late registration does not replay settled or cancelled intent. The dispatcher expires intent after 24 hours, retries known-safe APNs rejection at most four attempts with bounded backoff, marks an interrupted or ambiguous request uncertain, and disables a token only when the rejected registration generation is still current. Notification failure never rolls back the canonical message.

The APNs adapter authenticates with `PAL_APNS_TEAM_ID`, `PAL_APNS_KEY_ID`, `PAL_APNS_PRIVATE_KEY`, `PAL_APNS_TOPIC`, and `PAL_APNS_ENVIRONMENT`; all values are present together or notifications stay disabled. It sends a bounded plain-text preview, sound, background-refresh flag, and installation ID. The installation ID scopes the payload to the current app registration. Every notification tap routes to Main, including notifications for task messages. Registration endpoints are `PUT` and idempotent `DELETE /notifications/ios/installations/:id`; the fixed route binds registrations to the `ios` destination and configured topic/environment. Provider acceptance confirms APNs receipt and does not prove device presentation.

Web Push uses the same publication transaction for eligible `web` notification intent when `PAL_WEB_PUSH_PUBLIC_KEY`, `PAL_WEB_PUSH_PRIVATE_KEY`, and `PAL_WEB_PUSH_SUBJECT` are configured together. The `adapters/web-push` adapter owns browser registration, payloads, and delivery. `web_push_installations` stores independent subscriptions keyed by endpoint with server-assigned IDs and registration generations. Atomic fanout snapshots eligible active generations into `web_push_deliveries`, unique per intent/installation, and marks the intent `expanded`. Each child owns its send outcome; successful recipients are never retried because another recipient failed. New or re-enabled generations receive future publications only.

Web delivery attempts expire five minutes after publication. Each send uses provider TTL zero, so the push service discards notifications for unavailable devices. Explicit transient provider rejections retry at most four attempts with bounded backoff and Retry-After; unclassified transport errors and interrupted sends become uncertain. Invalid subscriptions are disabled only if their generation still matches. APNs retains its existing registration and expiry policies.

The web API exposes `GET /notifications/web/config`, endpoint-keyed upsert through `POST /notifications/web/installations`, and idempotent `DELETE /notifications/web/installations/:id`. Registration returns only its record ID. Allowed push endpoints cover Chrome FCM and Apple Web Push; endpoints and encryption keys stay out of diagnostics.

PWA badges count unseen `web` notification publications, including reactions, independently of delivery success or expiry. `notification_intents.sequence` orders publications; a shared transaction lock serializes publication, registration baselines, and read receipts. Each installation stores `seen_sequence`, initialized at the current publication position for a new or replaced generation. Migration initializes existing registrations at the current position. Counts remain independent across installations.

`GET /notifications/web/installations/:id/badge` returns `{ installationId, generation, count, through, revision }`. `PUT` at the same path acknowledges `{ generation, through }`; older receipts are idempotent, future positions and stale generations conflict. `through` is the latest committed web publication position; `revision` is its sum with the installation's seen position, so publication and reading each advance the revision. Push payloads carry the current badge snapshot. A bounded IndexedDB record in the service worker rejects older generations/revisions and retains disabling across worker restarts. Worker queues and a Web Lock serialize storage and OS badge writes across overlapping worker versions. Badge API failure cannot prevent notification display.

The PWA captures a badge boundary before refreshing history and acknowledges it only after Main is loaded, visible, focused, and positioned at the latest messages with no covering panel. Preferences, task views, older scroll positions, notification dismissal, and failed history reads retain unread state. Badge reads fail independently of history refresh and have a two-second deadline. Launch, reconnection, visibility recovery, and live notification publications reconcile counts. Disabling clears the local badge; other installations retain their own seen positions. iPhone badge presentation follows Home Screen installation and system notification settings.

The React PWA asks permission from an explicit Preferences action and reconciles an existing browser subscription on launch. Disabling unsubscribes locally before backend cleanup. An absent subscription requires explicit enablement; background subscription replacement is deferred, so expired subscriptions may require reopening the app and enabling again. One service-worker lifecycle owner supplies registration. Push payloads include the configured assistant name and a bounded preview, allowing display without an API fetch. Every requested push displays, including in foreground clients. Taps open Main at the latest messages and retain chat drafts; SSE and snapshots remain responsible for canonical state.

The optional Telegram driver is enabled only when `PAL_TELEGRAM_BOT_TOKEN` and `PAL_TELEGRAM_OWNER_ID` are both configured. Its first poll discards the pre-activation backlog. It accepts text, the largest photo, documents, and an optional reply in the configured owner's private DM. Secondary inputs always enter Main. Provider reply IDs map to canonical messages only within the same adapter and destination; a missing mapping produces an ordinary message. Outgoing Markdown is parsed with `marked` into visible text and native Telegram entities. Headings, lists, and tables become readable Telegram structures; raw HTML and unsupported syntax remain literal text. Rendering falls back to the original text if parsing fails or produces no visible content. Text splits at 4,000 UTF-16 units with rebased entities and intact surrogate pairs. Consecutive images form albums of up to ten photos; single images and documents use individual sends. Text of at most 1,024 UTF-16 units becomes the first attachment caption; longer text precedes the attachments. Every returned album message ID maps to the canonical message. Native reply parameters use known incoming or outgoing references in the same destination.

Telegram pre-TLS connection resets with Node’s explicit handshake-not-established signature retry through the existing delivery backoff when no part has been accepted. Other transport failures remain uncertain. Polling warnings include redacted error and cause details.

Telegram send failures log the delivery/message IDs, part position, API method, HTTP status, provider error code and description, and retry delay. Transport and adapter exceptions include their error messages and immediate cause codes. Bot tokens are redacted; request bodies are omitted.

### Chat visibility

- Main chat includes messages with `taskId: null` and records explicitly marked `mainVisible`. Migration marks historical shared Task finals; new Task logs default to false.
- Task chat includes all public messages with the matching `taskId`.
- All new Task commentary and finals remain task-only. User messages have null phase.
- Canonical messages retain one ID, sequence, attachments, and state across clients. Task reports and Main responses are separate messages.
- Reply targets use the same membership rule; task-only quotes remain hidden in Main for historical shared messages.

### Tasks

Task Agent calls `update_task` through TasksService to keep its title, goal, and description aligned with user corrections. Identity comes from the current thread. Null or omitted fields retain their values; status uses its dedicated tool. Task creation, task-record changes, and new task-scoped messages advance `lastActivityAt`; task lists sort by that activity. Each activity revision emits `task.updated`. Task Agent calls `set_task_status` through TasksService to set `in-progress`, `needs-input`, or `completed`. Final output and stream completion do not change business status. Archive changes list visibility; input and active execution continue.

```typescript
/** Get paginated tasks **/
// Meant as a snapshot. Live updates come via SSE
GET /tasks

QUERY PARAMS
{
  "after": "<cursor>", // optional; opaque cursor encoding (lastActivityAt, id)
  // sorted by (lastActivityAt, id) descending; after continues in that order
  // omit after to get latest tasks
  "archived": false, // optional; defaults to false; true lists archived tasks
  "limit": 20,
}

RESPONSE
{
  "tasks": [Task],
  "after": null, // next page cursor; null means no further results
}

/** Get detailed specific task **/
GET /tasks/details/:id

RESPONSE
{
  "task": DetailedTask,
}

/** Archive or unarchive task **/
POST /tasks/:id/archive

REQUEST
{
  "archived": true,
}
```

### Live update stream (all surfaces)

```typescript
/** Get live updates (all surfaces ie. chat, tasks etc) **/
// Sends current agent.activity on connection, then broadcasts new events.
// Entity events are published after database commit; no event replay.
GET /stream

SSE EVENTS
// Existing message updated
{
  "event": "message.updated",
  "message": UserVisibleMessage // Updated message
}
// New message added
{
  "event": "message.added",
  "message": UserVisibleMessage // New message
}
// Agent activity state
{
  "event": "agent.activity",
  "state": AgentActivityState
}
// New task added
{
  "event": "task.added",
  "task": Task // Added task
}
// Tasks data updated
{
  "event": "task.updated",
  "task": Task // Updated task
}
// Heartbeat (~ 15s)
{
  "event": "heartbeat"
}
```

### Files

```typescript
/** Upload a file **/
// One file per request; client uploads multiple files concurrently
// Streams to PAL_UPLOAD_DIR from .env; max 25 MB per file
// Accepts any file type
POST /files

REQUEST // multipart/form-data
{
  "file": <binary file>,
}

RESPONSE // 201, file is ready to attach
{
  "attachment": Attachment,
}

// 400: invalid upload
// 413: file too large

/** Get file content **/
// Streams verified supported image formats inline; other types as downloads
GET /files/:id/content

RESPONSE
// Binary file with Content-Type, Content-Length, Content-Disposition
// X-Content-Type-Options: nosniff
// 404: file not found

/** Download a file **/
// Streams with Content-Disposition: attachment
GET /files/:id/download

RESPONSE
// Binary file
// 404: file not found
```

## Data models

```typescript
/** Shared identity for persisted entities **/
interface Entity {
  id: string, // backend-generated UUID
  createdAt: string, // ISO timestamp
}

/** Entities that can change after creation **/
interface MutableEntity extends Entity {
  updatedAt: string, // ISO timestamp for the last direct content edit
  version: number, // starts at 1; increments on every client-visible revision
}

interface Attachment extends Entity {
  filename: string, // original filename; not a filesystem path
  contentType: string, // defaults to application/octet-stream
  sizeBytes: number,
}

interface UserVisibleMessage extends MutableEntity {
  sequence: number, // immutable, increasing across chat messages; history cursor
  idempotencyKey: string | null, // submission correlation; null for assistant/legacy messages
  replyToMessageId: string | null,
  replyTo: { id: string, sequence: number, role: "user" | "assistant", textPreview: string, taskId: string | null, phase: "commentary" | "final_answer" | null, mainVisible: boolean } | null,
  role: "user" | "assistant",
  source: string | null,
  originDestinationId: string | null,
  mainVisible: boolean,
  reaction: string | null, // one replaceable agent emoji
  deliveryDestinationIds: string[],
  notificationDestinationIds: string[],
  notify: boolean, // API-derived; true when notificationDestinationIds is nonempty
  metadata: { timezone?: string },
  text: string, // may be empty for attachment-only user or assistant messages
  attachments: Attachment[], // ordered; empty when absent
  suggestedReplies: string[], // available options; empty after selection
  taskId: string | null, // null for main-chat-only messages
  phase: "commentary" | "final_answer" | null, // null for user messages and unknown assistant phase
}

interface Task extends MutableEntity {
  // Tasks are sorted by (lastActivityAt, id) in descending order
  lastActivityAt: string, // latest creation, direct edit, or task-scoped message
  title: string,
  goal: string,
  status: "in-progress" | "needs-input" | "completed",
  archived: boolean,
}

interface DetailedTask extends Task {
  description: string,
}

interface TaskSchedule {
  id: string,
  taskId: string,
  prompt: string,
  cron: string,
  timezone: string,
  status: "active" | "paused",
  nextFireAt: string
}

/** Current agent activity; not a persisted entity **/
interface AgentActivityState {
  status: "idle" | "working"
}
```

## Snapshot and live update handoff

- Connect SSE before fetching snapshots; buffer updates during the fetch.
- Merge messages and tasks by entity version so older data cannot overwrite newer state.
- Filter message events into views using `taskId`, `role`, and `phase`.
- Task detail changes increment the task version and emit `task.updated`. Refetch open task details when a newer version arrives; track the fetched detail version separately from the list version.
- On reconnect, refresh displayed chats, including older cached pages, task lists, and open task details.
- Recover through fresh snapshots; no event replay cursor.
- SSE connection/event IDs are transport details. Clients do not use `Last-Event-ID` for durable replay.

### Public web search

Task receives OpenAI native `web_search` with live web access through the existing ChatGPT OAuth model. Search is available directly and excluded from `execute_typescript`. Task execution guidance requests descriptive source links in answers. Main delegates web research.

Shared model streaming buffers each text block until its provider annotations arrive. Exact raw citation-marker spans with HTTP(S) source annotations become Markdown links before Main/Task publication or Worker handoff. Existing Markdown links remain intact; unresolved markers are removed with a diagnostic count. Conversion handles raw structured JSON and Unicode offsets. Citation normalization adds no API fields or client-specific rendering. Clients receive completed messages, so this buffering does not delay their existing publication boundary.
