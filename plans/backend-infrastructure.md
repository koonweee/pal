# Backend Infrastructure

## Status

Done

## Goal

Deliver Pal's backend APIs and application services with PostgreSQL persistence, local file storage, live updates, and a replaceable agent stub. Frontend clients and the future agent use the same application operations.

This is the first backend implementation milestone. The sections below divide it into reviewable implementation slices.

Deferred scope: Mastra integration, internal runtime threads, scheduled automation execution, durable agent jobs, and automatic recovery of interrupted runs.

## Current Behavior

- `backend/` implements the NestJS API with PostgreSQL/Drizzle repositories, service-owned transactions, local file streams, SSE, and an injectable runtime stub.
- `backend/compose.yaml` runs PostgreSQL in the isolated `pal-rewrite` project. `backend/.env.example` documents local configuration.
- `backend/src/application/` coordinates chat submissions and runtime output. Feature services are callable directly.
- [Backend architecture](../architecture/backend.md) defines APIs, models, visibility rules, and SSE behavior; [backend setup](../backend/README.md) documents development and validation.
- Six tests in three PostgreSQL-backed suites cover the essential flows. Manual checks verify interrupted uploads, shutdown, and app/database restart persistence.

## Target Data Shape

Implement the API models in the architecture document. Store:

- Tasks: identity, timestamps, version, title, goal, description, execution status, and archive state. Index `(created_at, id)` for descending cursor pagination.
- Messages: identity, timestamps, version, unique increasing sequence, role, text, optional task ID, main-chat visibility, and embedded action state.
- Attachments: identity, creation time, original filename, content type, byte size, and generated storage filename. Storage filenames stay internal.
- Message and task attachment links: foreign keys and positions to preserve attachment order.
- Automations: identity, timestamps, version, task ID, UTC schedule, and prompt.
- Idempotency records: operation, key, normalized request, and original response, committed with the operation's changes.

Keep runtime-thread mappings deferred. Use database constraints for references and uniqueness, and explicit response mapping for API data.

## Milestones

### 1. Development Environment and Database Foundation

Status: Done

Implementation tasks:

- Add `backend/compose.yaml` with a pinned supported PostgreSQL image, persistent named volume, local port binding, and health check.
- Add `.env.example` with `DATABASE_URL`, `PORT`, and `PAL_UPLOAD_DIR`; validate configuration at startup.
- Install Drizzle and `pg`; provide the connection pool and transaction context through a Nest database module.
- Add schema definitions, generated SQL migrations, and explicit `db:generate` and `db:migrate` scripts. Commit migrations.
- Enable request validation and graceful shutdown. Verify the production start command matches the emitted build output.
- Keep the backend README focused on actual setup and commands.

Exit criteria:

- Compose starts a healthy database and retains records across container restarts.
- Migrations apply to an empty database and a second migration run is harmless.
- Nest starts with valid configuration, rejects invalid configuration, and closes its database pool on shutdown.
- The backend builds and lints.

### 2. Application Services and Transactions

Status: Done

Implementation tasks:

- Organize `tasks/`, `automations/`, `chat/`, and `files/` as feature modules with services, repositories, and explicit API types. Create files as behavior is implemented.
- Implement task creation, updates, details, archive state, and automation configuration through application services.
- Support creating a task with an automation in one service-owned transaction shared by both repositories.
- Validate automation schedules using a documented UTC cron format. Persist configuration for later execution.
- Implement message publication, attachment association, action selection, entity version increments, and idempotency.
- Apply action selection atomically; selecting an unavailable action fails without changing the message. Retries with the original idempotency key return the original result.
- Add a small typed in-process event service. Publish entity changes after commit, including task detail updates.

Exit criteria:

- Task-plus-automation creation commits both records or neither.
- Shared services can be called directly without an HTTP request or agent runtime.
- Repeated requests produce one result; key reuse with different input returns a conflict.
- Updates increment versions and rolled-back changes emit no entity events.

### 3. File Storage and Client APIs

Status: Done

Implementation tasks:

- Implement the documented message, task, action, and file endpoints using thin controllers and validated DTOs.
- Implement main/task history filtering, ordered attachments, task visibility, archive filtering, and both pagination contracts.
- Use opaque task cursors preserving the full `(created_at, id)` ordering key. Bound page sizes and reject malformed cursors.
- Stream one uploaded file per request into `PAL_UPLOAD_DIR`; enforce 25,000,000 bytes while reading. Accept arbitrary types and generate storage filenames.
- Write temporary files, finalize them on the same filesystem, then persist attachment metadata. Clean up failed uploads and stale temporary/orphaned files.
- Stream file content and downloads; display supported raster image formats inline and serve other content as attachments.
- Remove uploads left unattached for 24 hours, coordinating cleanup with message/task attachment references.
- Preserve one message ID and action state across main and task views. Main-only messages are visible in main chat; task submissions default to task-only visibility.

Exit criteria:

- The documented endpoints return persisted data with the correct routing, ordering, filtering, and error behavior.
- Six separately uploaded files can be attached to one message and retrieved in order through history and file endpoints.
- Oversized or interrupted transfers leave no completed attachment.
- Shared task messages appear in both histories with identical identity and action state.

### 4. Live Update Stream

Status: Done

Implementation tasks:

- Implement `/stream` with the documented event payloads, initial agent activity, and approximately 15-second heartbeats.
- Connect committed entity events to SSE and release subscriptions on disconnect.
- Ensure task detail changes emit the task summary with its new version so open details can be refetched.
- Keep history and task endpoints authoritative for reconnect recovery.

Exit criteria:

- Connected clients receive initial activity, heartbeats, and committed message/task changes.
- Snapshots and events expose matching entity versions.
- Fresh snapshots recover changes missed during a disconnected session.

### 5. Agent Stub and End-to-End Flow

Status: Done

Implementation tasks:

- Define a small runtime interface and injection token; bind it to the stub implementation.
- Have an application-level coordinator persist user input, invoke the stub asynchronously, and publish its canned reply through the message service.
- Keep the runtime focused on producing output; the coordinator uses application services to persist results. Keep module dependencies acyclic.
- Track active runs, publish `working` while any run is active and `idle` when none remain, and handle run failures and shutdown.
- Return the message response after persistence without waiting for the stub reply. Dispatch work only for a newly accepted message.
- Exercise task creation, automation configuration, message publication, and actions through direct service calls in focused fixtures.

Exit criteria:

- Sending a message returns promptly, emits activity, and produces a persisted canned reply through SSE and history.
- Main and task replies retain the correct task association and visibility.
- Idempotent retries produce one stub invocation. Failures settle activity and are logged without unhandled rejections.
- Completed data survives backend restarts. Interrupted stub runs require a new user interaction.

## Tests

Use three focused PostgreSQL-backed suites, sharing fixtures:

- Service integration: task/automation atomicity, rollback without events, and atomic action selection.
- Chat/task end-to-end: visibility, composite cursor ties, archive filtering, idempotent submission, and stub/SSE lifecycle.
- File end-to-end: ordered multiple attachments, download round-trip, and size-limit cleanup.

Replace generated hello-world assertions with relevant coverage. Avoid separate controller and repository tests that repeat the same behavior. Add regression cases when actual bugs are found.

## Validation Commands

Run from `backend/` with the development and test databases configured.

```bash
docker compose up -d --wait postgres
npm run db:migrate
npm run build
npm run lint
npm test
npm run test:e2e
npm run start:dev
```

Use `npm run db:generate` when schema changes require a new migration. Integration suites use a dedicated test database. Build, lint, type-checking, all six tests, migration repeatability, schema consistency, development startup, and the manual checks pass.

## Overall Exit Criteria

- A fresh checkout can start PostgreSQL, apply migrations, and run Nest using the documented setup.
- The frontend API contract works against persisted application data and streamed files.
- Application services support future agent callers, including operations spanning entities.
- Task and main chat share published messages with consistent identity, attachment order, action state, and versions.
- SSE exposes committed updates and activity; snapshots support reconnect recovery.
- The stub exercises the complete message flow without Mastra or a durable work queue.
- Required build, lint, focused tests, and manual checks pass; plan and index statuses reflect the verified result.
