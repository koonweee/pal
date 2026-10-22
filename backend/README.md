# Pal Backend

NestJS backend with PostgreSQL, Drizzle, streamed local files, SSE, and persistent Mastra Main and task agents.

## Docker Compose

Docker Compose runs agent-service, the persistent execution desktop, the PWA gateway, and PostgreSQL. Node.js 24.15+ supports host builds and tests. Runtime execution uses Docker.

For a fresh installation:

~~~bash
cp .env.example .env
docker compose build agent-service execution web
docker compose up -d --wait postgres execution
docker compose run --rm --no-deps agent-service node dist/database/migrate.js
docker compose run --rm --no-deps agent-service node dist/agent/login.js --device
docker compose up -d --wait agent-service web
~~~

Open http://localhost:8080. API/SSE and noVNC share that origin. Only the gateway is published; CDP and PostgreSQL stay on private Docker networks. Keep external access on Tailscale.

Agent-service stores provider authentication and canonical attachments in service_data. agent_home mounts at /home/pal in the service and desktop. PostgreSQL uses postgres_data. Back up all three volumes together. Backend rebuilds retain the running execution container:

~~~bash
docker compose build agent-service
docker compose up -d --wait --no-deps agent-service
docker compose logs -f agent-service execution web
~~~

Execution image rebuilds replace the desktop and stop its running applications. Named volumes preserve home, browser state, and workspace. Include additional installed packages in the execution image.

## Full-stack local development

Run from the repository root:

~~~bash
./scripts/dev-local login
./scripts/dev-local up
./scripts/dev-local status
~~~

The development configuration is backend/.env.development. Vite serves http://localhost:5173 with source hot reload. The gateway serves the staged PWA on localhost:14173; PostgreSQL uses localhost:15433. Backend and desktop have no published ports. The isolated development Compose project is pal-dev-split. Export PAL_DEV_PROJECT, PAL_DEV_ENV_FILE, PAL_DEV_FRONTEND_PORT, PAL_DEV_POSTGRES_PORT, and PAL_DEV_PWA_PORT to run another isolated local stack.

~~~bash
./scripts/dev-local rebuild
./scripts/dev-local execution-rebuild
./scripts/dev-local frontend-restart
./scripts/dev-local logs
./scripts/dev-local down
~~~

Use rebuild after backend, agent-guidance, or backend dependency changes. Use execution-rebuild after desktop, system-package, browser-extension, execution helper, or shared Mastra/agent-browser dependency changes. down preserves named volumes.

To expose the staged PWA over the script-managed Tailscale HTTPS route:

~~~bash
./scripts/dev-local serve
./scripts/dev-local pwa-up
./scripts/dev-local unserve
~~~

serve retains the existing development HTTPS origin on port 8444 and configures the OAuth callback origin. pwa-up rebuilds the frontend and notifies connected clients. Use rebuild when an update includes backend/API changes.

## Configuration

.env.example documents settings. Compose supplies the private database address, private authentication/upload paths, shared /home/pal/workspace, remote browser endpoint, and execution ID. PAL_DOCKER_GID selects Docker socket access on Linux. PAL_WEB_PORT selects the loopback gateway port.

Agent-service owns model credentials and integration clients. Execution receives desktop and public HTTP(S) proxy settings. Native filesystem tools resolve paths inside execution; code mode uses the shared /home/pal/tmp with matching service/desktop UIDs.

Files are limited to 25,000,000 bytes. Upload manifests materialize copies in /home/pal/incoming; publication snapshots generated files into private canonical storage. Message associations retain delivered files. Unattached files and managed orphan copies expire after 24 hours; cleanup retries when execution is available.

## Agent Conversations

[agent-instructions.ts](src/agent/agent-instructions.ts) composes role prompts for the runtime and smoke scripts. All roles load [voice.md](src/agent/instructions/voice.md) and [files.md](src/agent/instructions/files.md) for voice, inspection, and original-file preservation. Main and Task load [texting.md](src/agent/instructions/texting.md) for public messages. Task and Worker load [execution.md](src/agent/instructions/execution.md) for workspace courtesy, interaction-method choice, and file processing. Role-specific routing, task ownership, browser lifecycle, and private worker output live in main.md, task.md, and worker.md. They load once at runtime startup; task metadata is appended dynamically for each invocation. Nest copies these Markdown assets into the build. Edit the files, rebuild, and restart the backend. Container development uses `./scripts/dev-local rebuild`.

For direct local development, run `npm run agent:login` to authenticate with ChatGPT in a browser. Use `npm run agent:login -- --device` for device login. Mastra Code owns credential storage and automatic refresh; no API key is needed. Login credentials stay in the ignored `data/agent/` directory by default. Keep this directory private and persistent across restarts.

Task agents manage recurring work and one-off reminders with `create_task_schedule`, `list_task_schedules`, `update_task_schedule`, `pause_task_schedule`, `resume_task_schedule`, and `delete_task_schedule`. TaskSchedulesService binds schedules to the current task and owner; Mastra owns persistence and dispatch. Schedules deliver automation signals to active tasks or wake idle threads with retained context. Cadence/timezone and quiet notification behavior live in task guidance. Pausing stops future ticks while current work continues. The agent keeps monitoring in-progress and pauses schedules before completing it. Schedule management is conversation-only. All schedules use cron/timezone. For one-off reminders, the agent stores the intended date/time and cancellation instructions in the prompt, skips early annual ticks, and deletes the triggering schedule when due. One-off cancellation depends on agent execution.

Main uses owner `pal-owner` and thread `pal-main`. A reusable Task Agent runs each task on `pal-task:<task UUID>` with the same owner. Observational Memory is scoped to each thread. Mastra initializes its own tables in the `mastra` PostgreSQL schema on startup. Keep this schema in database backups alongside Pal's public tables. Mastra Observational Memory uses the same authenticated model for observation and reflection, with native token thresholds and buffering.

`POST /chat/messages` accepts text and/or up to 100 attachment IDs in `attachmentIds` and optional `taskId` and `metadata: { timezone?: string }`. The API validates timezone; history and SSE retain it, and native message attributes expose it to the model. Omitted or empty metadata preserves legacy retry identity; changed timezone under the same idempotency key returns HTTP 409. Uploaded files are available to agents through private manifests with absolute local paths. Generated files are selected through structured output `files` declarations and copied into download storage at publication. Invalid output IDs or file declarations trigger one model retry with correction feedback; a repeated failure preserves the answer text with a file delivery notice. The coordinator preserves submission order through persistence and native acceptance. Once accepted, HTTP returns `{ messageId }`; Main and task agents can receive follow-ups while working. Assistant text arrives independently through history and SSE. Main publishes through sendToUser. Task commentary and finals stay in task chat; task-result signals wake Main to decide what to share. Main history includes Main messages and historical records marked mainVisible. Task messages retain their phase; Main and user messages use null.

Main answers directly when available context suffices, and delegates substantial work, task updates, or ongoing task ownership. Main acknowledges non-immediate work promptly, before tools or extended reasoning, including work without tools. After delegating, it leaves the substantive answer to the task. Its `search_tasks`, `inspect_task`, and `delegate_task` tools search all tasks, inspect candidates, and create or reuse tasks. Search accepts alternative terms across title, goal, and description, with newest-first pagination, bounded title/goal summaries, and a matching description excerpt. Inspection returns full details. Main clarifies material ambiguity between candidates. Task Agent updates its title, goal, and description through task-scoped `update_task`, and explicitly sets status through `set_task_status`; a final answer does not imply completion. Archive only hides a task from the active list. The global activity indicator means some part of the agent is working.

A handoff error returns HTTP 503 and keeps the user message. Reusing the same idempotency key returns its existing ID without resubmitting. To resend, use a new key. Generation failures publish a brief notice asynchronously. Restart restores stored context and memory; interrupted work requires a new message. Task result publication and Main signal persistence are separate writes; a crash between them can leave Main unaware of a visible result.

## Agent Environment

Task Agent and its workers receive native Mastra workspace tools through the execution filesystem and Docker sandbox, including file operations, grep/AST editing, commands, and background-process management. With desktop support enabled, X11Computer supplies screenshot, mouse, keyboard, and display information through Mastra's native computer tools. Pillow captures PNGs; xdotool supplies input. Unicode typing uses a 50 ms key delay to allow X11 keymap updates to reach applications. Main's toolset contains lookup, delegation, `inspect_message`, and native read-only `read_file` for quick text/image/PDF inspection. Task agents share the workspace and desktop with each other and the user, guided to be mindful of concurrent activity. The controller's separate question, planning, task, and delegation UI tools are disabled.

Task agents also receive `browser`, `browser_group`, and `browser_screenshot` when desktop support is enabled. One shared Chromium profile keeps logins available to all tasks and the human. Each task has a pinned agent-browser session and a visible named group. Task agents can run up to three native workers concurrently, one level deep. Workers have separate pinned sessions within the parent group, return private findings, and release their member tabs and daemons when they finish. The installed `pal-browser` launcher loads the extension for both desktop and runtime use. Group close and completion/archive cleanup remove current task-group members; idle groups close after 30 minutes without browser activity while the task has no active run. A sweep runs every minute. Moving tabs out preserves them; ungrouped tabs and human-created groups are excluded. Guidance prefers service tools, direct APIs, browser, then computer use.

File tools are contained within /home/pal and resolve paths inside execution. Shell and code tools use execution's environment and can access its other paths. Workspace approvals allow execution. The desktop runs as pal with passwordless sudo; /home/pal/workspace is the default working directory.

HOME=/home/pal keeps execution-owned tools and configuration persistent. Python and venv, Node/npm, Bash, Git, ripgrep, curl, certificates, and sudo are included. Durable system dependencies belong in the image; other system changes are lost when the container is replaced. See [deployment architecture](../architecture/deployment.md).

## Try the Chat

With the backend running, watch SSE in another terminal:

```bash
curl -N http://localhost:8080/api/stream
```

Send a message, then repeat with a new key and follow-up text while Main is working:

```bash
curl -sS http://localhost:8080/api/chat/messages \
  -H 'Content-Type: application/json' \
  -d '{"idempotencyKey":"manual-1","text":"Remember project identifier PAL-119. Help me outline its migration checklist.","attachmentIds":[]}'

curl -sS http://localhost:8080/api/chat/messages \
  -H 'Content-Type: application/json' \
  -d '{"idempotencyKey":"manual-2","text":"Correction: use PAL-120. Keep the checklist to three items.","attachmentIds":[]}'

curl -sS http://localhost:8080/api/chat/history
```

Expect `agent.activity` and committed `message.added` events, including assistant responses. Responses can combine several inputs. Stop and restart the backend, then send a new message with a fresh key asking for the current identifier and unfinished work. Main should remember PAL-120 and the checklist. Use fresh keys when repeating this walkthrough.

## Database

Schema definitions live in `src/database/schema.ts`; SQL migrations and snapshots live in `migrations/`.

```bash
npm run db:generate
npm run db:migrate
```

Services own transactions and pass their transaction context into repositories. Events are published after commit.

## Validation

Create the dedicated test database once:

```bash
docker compose --project-name pal-dev-split exec postgres psql -U pal -d postgres -c 'CREATE DATABASE pal_test'
```

```bash
export TEST_DATABASE_URL=postgresql://pal:pal@localhost:15433/pal_test
npm run build
npm run lint
npm test
npm run test:e2e
```

Automated suites cover service transactions, native Main delivery/memory/lifecycle, task delegation/steering/result sharing/restart recall, native scheduled execution and management, timezone metadata, chat/task APIs with SSE, and file transfers. Tests use controlled models, apply migrations, and reset application tables in the test database. Native agent fixtures use temporary schemas. Test commands build the app first so Nest's emitted decorator metadata matches production.

The isolated runtime suites build disposable Compose projects and retain the existing running stack:

~~~bash
npm run runtime:smoke
npm run runtime:stack:smoke
npm run browser:smoke
npm run workers:smoke
npm run desktop:smoke
npm run files:smoke
npm run mcp:smoke
~~~

The stack suite includes PWA upload/download/SSE, browser groups/popups/worker cleanup, desktop input, private-network isolation, backend restart, and execution outage.

Optional model checks require PAL_SMOKE_AUTH_PATH pointing to a private login file. The harness copies it into disposable service-private storage:

~~~bash
PAL_SMOKE_AUTH_PATH=/private/path/auth.json npm run files:smoke -- --agent
PAL_SMOKE_AUTH_PATH=/private/path/auth.json npm run mcp:smoke -- --agent
PAL_SMOKE_AUTH_PATH=/private/path/auth.json npm run browser:smoke -- --agent
PAL_SMOKE_AUTH_PATH=/private/path/auth.json npm run workers:smoke -- --agent
PAL_SMOKE_AUTH_PATH=/private/path/auth.json npm run desktop:smoke -- --agent
~~~

To run bounded memory validation with your real ChatGPT login:

```bash
npm run agent:smoke
```

This uses `TEST_DATABASE_URL` and a temporary schema. It checks Main and task recall after restart and forced native observation/reflection, verifies memory output stays private, and verifies real task final phase metadata and Main result context. Production memory thresholds are unchanged. The scenario has a 300-second deadline; its schema is removed on normal completion or failure.

## Structure

- `chat/`, `tasks/`, `files/`: feature services, repositories, and API data types.
- `application/`: chat submission coordination, HTTP chat routes, and SSE.
- `agent/`: Main session, Task Agent, delegation/status tools, ChatGPT provider/login, text publication, and aggregate activity.
- `database/`: connection pool, transaction support, and schema.
- `events/`: typed in-process broadcasts.
- `config/`: environment and request validation.

Contracts: [backend architecture](../architecture/backend.md). Implementation scope: [core task agents plan](../plans/core-task-agents.md).

A bounded schedule-guidance probe runs with `npm run build && node scripts/task-schedule-smoke.mjs`. It uses the configured model with synthetic price and schedule tools, verifying an unchanged check stays silent and ongoing, a price change produces a final, and a stop request pauses the schedule before completion. It creates no production tasks or schedules.

A bounded routing probe runs with `npm run build && node scripts/task-routing-smoke.mjs`. It uses the configured model, Main instructions, and synthetic task tools to check direct answers from known facts, acknowledgment-only delegation, completed-task reuse, new-task creation, and clarification between competing matches. It reads no personal task records and creates no production tasks.

Parallel tool calls are enabled. The ChatGPT adapter forwards completed tool calls without partial argument events to avoid Mastra 1.74 synthesizing empty arguments for Codex calls with no deltas. Text still streams. `PAL_ROUTING_TRACE=1 node scripts/task-routing-smoke.mjs clarify` traces synthetic tool-call chunks for diagnosis.
