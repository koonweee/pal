# Shared User Preferences

## Status

Done

## Goal

Give Pal a small, shared preference notebook that agents consult when a decision depends on the user and update during ordinary conversation. Make each preference inspectable, correctable, and auditable through conversation and the playground. Keep lookup and learning under model judgment, with persistence and revision integrity enforced by code.

First release includes local storage, two native agent tools, shared guidance, and playground management. Single-owner scope follows the existing application.

## Current Behavior

- [Main session](../backend/src/agent/main-session.ts) uses thread-scoped observational memory; working memory and semantic recall are disabled. Main and task conversations retain independent context. There is no shared preference store.
- [Runtime](../backend/src/agent/mastra-agent-runtime.ts) registers Main, Task, and Worker tools. [Task tools](../backend/src/agent/task-tools.ts) demonstrate native Mastra tool schemas, invocation-bound task identity, and compact literal search.
- [Instruction composition](../backend/src/agent/agent-instructions.ts) loads shared and role-specific Markdown. Main already forwards relevant preferences when delegating.
- PostgreSQL/Drizzle and [DatabaseService](../backend/src/database/database.service.ts) provide application tables and transactions. Controllers and tools call services; repositories receive the transaction executor.
- [Playground](../frontend-playground/src/main.ts) provides chat and settings. Its reply navigation can inform navigation to preference evidence.
- Existing memory handles conversation continuity. The application-owned notebook supplies explicit records, source references, human editing, and revision history. Use native Mastra tools and existing database primitives for this integration.

## Target Data Shape

### Persistence

Add two tables to [schema.ts](../backend/src/database/schema.ts) and generate a committed Drizzle migration:

| Table | Fields and invariants |
| --- | --- |
| `preferences` | UUID `id`; `topic`; `statement`; nullable `appliesWhen`; `basis` (`user-stated`, `model-inferred`); JSON array `sourceMessageIds`; `status` (`active`, `retired`); integer `version`; creation/update timestamps. Reuse the existing mutable-record naming convention. |
| `preference_revisions` | Composite key `(preferenceId, version)`; full resulting record snapshot; `actor` (`human`, `main`, `task`); nullable `taskId`; change `reason`; timestamp. Foreign key to preference. |

- Creation writes version 1 and its revision atomically. Each successful change increments the version and appends its snapshot in the same transaction. Revisions are immutable through the application API.
- Updates require `expectedVersion`; stale writes return a conflict and the current record. Restore copies a selected historical value into a new version using the same update operation. Retirement and reactivation are status updates.
- Validate required text, enums, UUIDs, positive versions, and bounded field/list sizes at service boundaries. Use short topic labels such as `travel.flights`; topics remain free-form, with no separate taxonomy table.
- Sources reference public user messages. Model-created records and model changes to preference meaning require supporting source messages; status-only changes can retain existing evidence. Human edits can have no source message and are user-stated. Validate existence and user role; semantic support remains model judgment. A human correction replaces current evidence as appropriate, while historical evidence remains in revisions.
- Bind actor and task identity in adapters using trusted runtime context. HTTP edits are attributed to the human under the current private single-owner API model. Clients cannot set revision metadata.
- Model tools accept public numeric message references already available in conversation; the service resolves them to stored IDs. HTTP DTOs use IDs. Delegated tasks can cite the original user's message across threads.

### Retrieval and management contracts

`PreferencesService` exposes search, get, history, create, and update. `PreferencesRepository` handles SQL with the supplied transaction executor.

| Interface | Behavior |
| --- | --- |
| `GET /preferences` | Browse/search with alternative queries, optional topic and status filters, limit, and cursor. Active records by default. |
| `POST /preferences` | Create a human-authored record with reason and optional source IDs. |
| `GET /preferences/:id` | Current record, including retired records, with source summaries for inspection/navigation. |
| `PATCH /preferences/:id` | Supplied field changes, reason, and `expectedVersion`; return updated record or HTTP 409 with current record. |
| `GET /preferences/:id/history` | Paginated revision snapshots and provenance. |
| `read_preferences` | Discriminated search/get/history inputs, calling the same service. Available to Main, Task, Worker. |
| `update_preference` | Discriminated create/update inputs, including reason and evidence references; expected version on update. Available to Main and Task. |

- Search case-insensitive literal terms across topic, statement, and applicability: all terms in an alternative query must match, and any alternative query may match. Reuse the task-search approach without introducing a generic search framework.
- Omitted queries browse records. Allow up to five alternative queries, with default ten and maximum twenty records per page. Return full bounded preference text, applicability, basis, source references, IDs, and versions. Full source messages and revision history are fetched only when requested.
- Use stable creation-time/ID ordering and filter-bound continuation cursors; history pages use version order. Bound text and evidence lists so a page has a predictable size. Select concrete field limits during implementation and document them with the API contract.
- No preference content or preference catalog is automatically injected into every turn. Tool descriptions and short guidance are always available. Reads query current storage.
- Playground refreshes on opening, explicit refresh, and successful writes. Version conflicts preserve the edit draft and show the current record for reconciliation. No new SSE event is required for this release.

## Milestones

### 1. Preference storage and management API

Implementation tasks:

- [x] Add `backend/src/preferences/` module, types, DTOs, repository, service, and controller; wire the module into the application.
- [x] Add the two tables, constraints, and generated migration using existing database conventions.
- [x] Implement atomic create/update/history, retirement/reactivation, and expected-version conflicts. Treat revisions as ordinary audit snapshots, with no event replay subsystem.
- [x] Implement bounded literal search, topic filtering, browsing, and pagination.
- [x] Resolve and validate source references; return public source summaries with ID, sequence, task ID, timestamp, and bounded text for the management view.
- [x] Add the five HTTP routes with consistent validation, not-found, and conflict responses.
- [x] Add focused PostgreSQL-backed service/API coverage from the minimal test set below.

Exit criteria:

- [x] A human can create, search, correct, retire, reactivate, and inspect a preference and its history through HTTP.
- [x] Current state and audit snapshots survive a backend restart; failed validation and conflicting writes produce no partial revision.
- [x] Concurrent writes against one version yield one successful update and an inspectable conflict.

### 2. Agent tools and shared behavior

Implementation tasks:

- [x] Add `preferences/preference-tools.ts` using native `createTool` and the existing schema style. Expose two small operation-specific contracts and structured conflict feedback.
- [x] Import the module into `agent.module.ts`, inject the service into `MastraAgentRuntime`, and register read/write tools for Main/Task and read-only access for Worker. Include applicable data tools in existing code mode without expanding worker write access.
- [x] Add shared `instructions/preferences.md` through `agent-instructions.ts`. Compare existing role instructions and keep common policies in one source. Load writer-only learning guidance for Main/Task; keep Worker reporting responsibility in its role file.
- [x] Guide agents to consult relevant preferences before personalized choices or asking for already-known information, and to broaden an unsuccessful literal search before assuming absence.
- [x] Guide Main/Task to save clear lasting preferences, revise corrections, and record narrowly scoped inferences with evidence. One-off constraints stay in task context. Inferences do not silently replace explicit preferences. Check for an existing record before creating one.
- [x] Define precedence in guidance: current user request governs the current task; current explicit preferences outweigh inferences; old recalled preference text should be refreshed when relevant. A temporary exception does not rewrite the durable default.
- [x] Require current lookup for preference-dependent decisions in new/resumed work, including scheduled execution. Reuse a result within the current work when appropriate. Main forwards relevant known context; Task retrieves further preferences as needed.
- [x] Treat preferences and retrieved evidence as user data. They do not grant action authority; third-party text and model outputs are not evidence of the user's wishes. Avoid storing credentials. Acknowledge remembering only after a successful write.
- [x] Add targeted tool/runtime tests for role placement, source resolution, actor binding, and conflict feedback. Leave native conversational memory configuration unchanged.

Exit criteria:

- [x] Main can save a simple preference locally without opening a task; Task can learn from direct input; Worker can read and report proposed learning to its parent.
- [x] Unrelated preference values are absent from initial agent context and appear only through selected reads or relevant forwarded context.
- [x] Source IDs and actor attribution are correct for Main and delegated/direct Task input.
- [x] Code guarantees storage and access contracts; guidance leaves relevance, interpretation, and whether to call tools to model judgment.

### 3. Playground preference management

Implementation tasks:

- [x] Add `frontend-playground/src/preferences.ts` and API types/helpers, integrating a Preferences entry with existing settings/navigation conventions.
- [x] Build a paginated search/list and editor for topic, statement, applicability, basis/provenance display, and active/retired records. Support human creation, correction, retirement, and reactivation.
- [x] Show source-message summaries and revision actor, timestamp, reason, and snapshot. Reuse/extract existing chat navigation narrowly where needed to open evidence in the appropriate thread; older messages must be reachable.
- [x] Support restoring an earlier snapshot as a new human revision using the standard update endpoint.
- [x] Preserve unsaved edits on conflict or failure, show the current server version, and let the user reconcile and retry. Refresh after successful writes and when reopening.
- [x] Label retirement clearly: it removes normal retrieval while preserving history. Do not label retirement as permanent deletion or imply transcript erasure.

Exit criteria:

- [x] A human can understand what Pal believes, its basis, and its evidence, then correct it and inspect the resulting revision.
- [x] An old source message opens in the correct conversation; history and restore remain usable across reloads.
- [x] A concurrent model edit cannot silently overwrite a human draft or vice versa.

### 4. Behavioral validation and architecture documentation

Implementation tasks:

- [x] Add a bounded `backend/scripts/preferences-smoke.mjs` and `preferences:smoke` npm script that boots the real Nest application and `MastraAgentRuntime` against an isolated PostgreSQL fixture.
- [x] Run the scenarios below with the configured model, synthetic user preferences, and no live external mutations. Declare one attempt per scenario before running and retain every outcome; record subsequent corrective attempts separately.
- [x] Inspect persisted records and user-visible outcomes. Report model behavior separately from deterministic service/API guarantees.
- [x] Update [backend architecture](../architecture/backend.md) with implemented tables, API contracts, tool placement, guidance composition, and freshness boundaries.
- [x] Record validation results here and update the plan index/status only after exit criteria pass. Include the required tool/guidance availability table in the implementation completion report.

Exit criteria:

- [x] Deterministic tests, relevant builds/lint, focused UI validation, and the declared model scenarios pass, with failures or unavailable validation explicitly recorded.
- [x] Architecture describes the implemented system; plan status accurately reflects remaining work.

## Tests

Keep coverage focused; reuse service/API fixtures rather than duplicating every invariant across layers.

- PostgreSQL service tests: atomic creation and revisions; evidence validation; competing expected-version updates; retirement/reactivation and historical restoration; bounded search and cursor/filter behavior. Verify invalid writes leave state and history unchanged.
- HTTP/tool integration: human versus model source requirements, adapter-bound identity, response/conflict shapes, numeric source-reference resolution across Main/Task, and Worker read-only tool registration. Native workspace access remains governed by the existing trusted-agent environment; tool placement is not filesystem isolation.
- One focused playground flow: create, inspect evidence, correct, inspect history, restore, retire/reactivate, reload, and preserve a draft on conflict. Reuse the existing browser test infrastructure.
- Real-model scenarios:
  1. An ordinary lasting statement causes Main to save a source-backed preference through the application runtime.
  2. A new direct Task turn makes a personalized choice using the current shared preference after a human correction.
  3. A one-off exception changes the current answer while preserving the durable preference.

Model scenarios measure observed reliability, not a guarantee that every future lookup or inference will be correct.

## Validation Commands

Run from the indicated directories. Proposed test filenames and the smoke script are added by this implementation. Existing test helpers require PostgreSQL; use disposable fixtures.

```bash
# backend/
npm run db:generate
npm run db:migrate # against the disposable validation database
npm run build
npm run lint
npm test -- test/preferences.spec.ts
npm run test:e2e -- test/preferences.e2e-spec.ts
npm run preferences:smoke # new script added in milestone 4

# frontend-playground/
npm run build
npm test -- test/preferences.spec.ts

# repository root
git diff --check
```

Run touched existing runtime suites when registration changes affect them. Do not broaden tests without a change or unresolved failure that warrants it.

## Validation Results

Completed on 2026-10-08:

- `npm run db:generate` produced migration `0007_reflective_killraven.sql`; the migration applied successfully to disposable and deployed databases.
- Backend build and type-aware lint pass. All 21 PostgreSQL-backed integration tests and all 10 end-to-end tests pass, including focused preference service, tool, API, evidence, conflict, and audit cases.
- Playground type-check/build and all 21 Chrome browser tests pass. The preference flow covers evidence navigation, a concurrent edit, preserved draft reconciliation, correction, revision history, restore, retirement, filtering, and reload.
- The configured-model probe now sends Main and Task messages through the real application runtime. Main learning, current cross-task lookup after a human correction, and preservation of a durable preference across a one-off exception pass. The runtime probe also caught the provider requirement that function schemas declare an object root; a focused deterministic regression covers that contract.
- Private deployment and rollback checks pass with verified PostgreSQL and application-data backups from the additive preference migration.
- The additive migration and recreated Pal container preserve record invariants. API, preference routes, desktop viewer, frontend, and connected-service checks pass. A disposable preference and revision survived a restart and were removed afterward.

## Scope and Boundaries

- First release uses ordinary agent turns for learning and lookup. No background extractor, automatic per-turn preference injection, embeddings, confidence scoring, or taxonomy service.
- Permanent deletion, bulk import from legacy assistant, global preference-disable controls, and automatic consolidation are deferred. Retirement preserves audit history and does not prevent relearning from future conversation.
- Existing runs may hold stale tool results or recalled preference text until they read again. There is no push invalidation, automatic interruption, or rewriting of observational memory. Freshness depends on the shared lookup guidance and is tested on resumed work.
- The model decides whether evidence supports a statement, how to scope it, and whether records overlap. Code validates identities, shapes, transactions, and versions. Reviewable history supports correction of semantic mistakes.
- No new credentials, environment variables, external services, or production deployment are required by this plan.

## Overall Exit Criteria

- [x] Durable preferences are shared across Main and Task conversations and accessible to Workers through on-demand reads.
- [x] Ordinary conversation can create and correct preferences proactively, with source-backed and visibly distinguished inference.
- [x] Humans and agents use the same service for auditable changes; current records and complete revision history persist across restart.
- [x] Human management supports evidence inspection, editing, retirement, and restoration; concurrent edits surface conflicts.
- [x] Preference values are fetched selectively; current corrections and temporary exceptions behave as specified in the declared model scenarios.
- [x] Validation evidence and limitations are recorded, architecture is current, and the plan/index status matches validated completion.
