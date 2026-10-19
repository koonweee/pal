# Pal Backend

NestJS backend with PostgreSQL, Drizzle, streamed local files, SSE, and persistent Mastra Main and task agents.

## Container Development

Requires Node.js 24.15+ on the host for migrations and Docker Compose. NestJS, Main, task agents, and an Xfce/X11 desktop run together in the `pal` container; PostgreSQL runs in its existing service.

```bash
npm install
cp .env.example .env
docker compose build pal
docker compose up -d --wait postgres
npm run db:migrate
docker compose run --rm pal node dist/agent/login.js --device
docker compose up -d pal
```

Complete the device login before starting Pal. Login runs independently of the API and saves credentials in `/data/agent/auth.json`. The existing `DATABASE_URL` in `.env` addresses PostgreSQL from the host; Compose supplies the internal database address to Pal.

PostgreSQL listens on localhost:5433. Pal listens on localhost:3000. The noVNC HTTP/WebSocket service listens on localhost:6080. Both published ports bind to host loopback; raw VNC stays inside the container. The Compose project is `pal-rewrite`; `postgres_data` holds database state and `pal_data` holds `/data`. Run the frontend playground separately on the Mac; its default proxy to localhost:3000 works with this container.

Rebuild and recreate Pal after application changes:

```bash
docker compose build pal
docker compose up -d --force-recreate pal
docker compose logs -f pal
```

Stop with `docker compose stop pal`. Compose provides child reaping, a restart policy, and a 40-second shutdown grace period. Named volumes remain when containers are replaced. Back up `/data` and PostgreSQL together.

### Move Existing Local Data

Stop the Mac backend before starting the container so one agent runtime uses the stored conversations. Preserve the existing PostgreSQL volume. If `data/` already holds local auth or uploads, copy its contents into the fresh Pal volume before startup, and skip device login when existing authentication is valid:

```bash
tar --no-xattrs -C data -cf - . | docker compose run --rm --no-deps -T pal tar -xf - -C /data
```

Keep the original local data until the container has been verified. Application migrations remain an explicit host command; container startup initializes Mastra's own schema through its supported lifecycle. The production runtime includes migration SQL and supports `npm run db:migrate:prod`; deployment runs it as a one-shot service before starting the API.

### Direct Local Development

For Nest hot reload on the Mac, start PostgreSQL, migrate, authenticate with `npm run agent:login`, and run `npm run start:dev`. Stop the Pal container first. `.env` supplies host paths and the host database URL. Native tools run on the Mac with the server's OS permissions.

## Full-stack Local Development

The repository can run an isolated local stack consisting of PostgreSQL, the locally built backend and agent runtime, Xfce/noVNC, and the React Vite server. Vite serves `http://localhost:5173` with hot reload and proxies the API, SSE, and noVNC WebSocket over the same loopback origin.

Requirements are Docker Compose and Node.js 24+.

First-time setup uses a distinct Compose project and volumes:

```bash
./scripts/dev-local up
```

The command creates an ignored `backend/.env.development`, builds the local backend image, starts PostgreSQL, and applies migrations. If the isolated agent volume has no ChatGPT session, it stops with one login command:

```bash
./scripts/dev-local login
./scripts/dev-local up
```

Device login stores the resulting ChatGPT credential only in the `pal-dev` data volume. It can use the same ChatGPT account as production; it does not need an OpenAI API key. Do not copy a production auth file into the development volume.

The successful `up` command prints `http://localhost:5173`. Vite source changes hot reload automatically. Backend, agent-guidance, desktop, or system-package changes require a local image rebuild:

```bash
./scripts/dev-local rebuild
```

After changing frontend dependencies, restart only Vite. Its container reruns `npm ci` against the current lockfile, then the command waits for the development URL:

```bash
./scripts/dev-local frontend-restart
```

Lifecycle and inspection commands are:

```bash
./scripts/dev-local status
./scripts/dev-local logs
./scripts/dev-local config
./scripts/dev-local down
```

`down` preserves the development database, workspace, browser profile, uploads, and agent login. Vite, the backend, noVNC, and PostgreSQL bind only to host loopback on ports `5173`, `13000`, `16080`, and `15433`; their private Compose ports remain unchanged, and raw VNC is never published.

### Tailnet PWA Access

With Tailscale connected on the Mac, build and expose the production-style `Pal Dev` PWA to devices on the same tailnet:

```bash
./scripts/dev-local serve
```

The command builds the Nginx PWA gateway on `http://localhost:14173`, configures Tailscale Serve on HTTPS port `8444`, and recreates the app services with that Tailnet URL as the backend public and OAuth origin. Vite remains available only at `http://localhost:5173` for Mac-local hot reload. `./scripts/dev-local status` prints the local development, local PWA, and Tailnet PWA URLs.

Rerun `serve` after frontend changes to rebuild the exposed PWA. `pwa-up` rebuilds only the loopback PWA while retaining an existing Serve route, then signals open clients to check for the new bundle. Serve configuration persists across container restarts and `./scripts/dev-local down`. Disable only the Pal route and restore the localhost public origin with:

```bash
./scripts/dev-local unserve
```

The lifecycle command preserves unrelated Serve routes and refuses to replace a conflicting port. Set `PAL_DEV_SERVE_PORT` when first enabling the route to choose another HTTPS port. No additional application credential is required beyond the normal Tailscale login and the development ChatGPT login. MCP providers using pre-registered redirects must allow the Tailnet URL with `/mcp/oauth/callback` while Serve is enabled.

### Development Credentials and Integrations

- ChatGPT agent authentication is required once per development data volume through `./scripts/dev-local login`.
- Telegram and APNs variables are absent from `backend/.env.development` by default. This prevents the development agent from polling the production bot or delivering production notifications. Add only dedicated development credentials when those paths are explicitly under test.
- MCP server definitions, secrets, OAuth tokens, preferences, conversations, and schedules live in the isolated development database. Configure them again through the development web app as needed.
- MCP providers that require a pre-registered redirect must allow `http://localhost:5173/mcp/oauth/callback`. Dynamic-client providers need no separate static credential unless they reject that callback.

The development endpoint uses real model calls and grants its agent administrative access inside the local container. Treat prompts, connected services, and files as real even though its data is isolated from production.

## Desktop

Task agents and the user share one Xfce desktop at 1200×900 with a US keyboard layout. TigerVNC supplies the virtual display; the frontend playground embeds noVNC for manual input and viewing. Human input does not pause task agents. Noto Core, CJK, and emoji fonts cover web content, including Chinese, Japanese, and Korean. The image applies a [pinned noVNC touch patch](desktop/novnc-trackpad.README.md) for relative cursor movement and local pinch zoom.

The [portable desktop profile](desktop/profile/README.md) supplies coral GTK/Xfwm styling, a gradient wallpaper, 64 px workspace margins, and a compact three-app dock. App windows open maximized inside the margins. Picom gives app windows matching rounded corners, including Chromium. Appearance defaults apply once per user; subsequent customization persists. Chromium starts with GTK appearance.

Chromium runs with its namespace and Seccomp-BPF sandboxes enabled. Compose uses the [desktop seccomp profile](desktop/seccomp.README.md), which adds Chromium’s required namespace syscalls to Moby’s default profile.

Supervisor manages the session D-Bus, desktop, viewer, and API. The API waits up to 30 seconds for a window manager before starting. Desktop services restart independently; a later desktop outage leaves chat and shell running while computer tools return errors. Logs go to the container output. Inspect or restart the desktop with:

```bash
docker compose exec pal supervisorctl -c /opt/pal/desktop/supervisord.conf status
docker compose exec pal supervisorctl -c /opt/pal/desktop/supervisord.conf restart desktop
```

Profiles, cookies, preferences, and saved files live under persistent `/data/home`. Compose keeps the hostname `pal` stable so Chromium can recognize stale profile locks after recreation. Running apps and unsaved documents are lost on restart. A fresh desktop session starts on boot; package installation belongs in the image.

Compose enables native Mastra computer tools through `PAL_DESKTOP_ENABLED=true`. Direct Mac development defaults to disabled. A direct Linux deployment needs the same X11 utilities and a running display/session environment.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL. |
| `TEST_DATABASE_URL` | Dedicated test database URL; its name must end in `_test`. |
| `PORT` | HTTP port, default 3000. |
| `HOST` | Listen address, default `127.0.0.1`. Set to the host's Tailnet address for Tailnet access. |
| `PAL_UPLOAD_DIR` | Upload directory; relative paths resolve from the working directory. |
| `PAL_AGENT_MODEL` | Main, Task Agent, observer, and reflector model; default `gpt-6.1-sol`. |
| `PAL_AGENT_THINKING_EFFORT` | Main, Task Agent, observer, and reflector reasoning effort; default `medium`. |
| `PAL_AGENT_AUTH_PATH` | Private ChatGPT credential file; default `./data/agent/auth.json`. |
| `PAL_AGENT_WORKING_DIR` | Default filesystem/command working directory; default `./data/workspace`, resolved to an absolute path. |
| `PAL_DESKTOP_ENABLED` | Enable native X11 computer tools; `false` by default, `true` in Compose. |
| `PAL_BROWSER_PORT` | Loopback Chromium debugging port; default `9222`. |
| `PAL_BROWSER_PROFILE` | Optional absolute shared profile path; default `$HOME/.config/chromium` (honors `XDG_CONFIG_HOME`). |
| `PAL_BROWSER_EXECUTABLE` | Optional launcher binary override; default `chromium`. |
| `DISPLAY` | Required X11 display when desktop tools are enabled; image default `:1`. |
| `PAL_DESKTOP_PORT` | Compose host port for the viewer, default 6080. |
| `PAL_DESKTOP_VIEWER_URL` | Optional HTTP(S) viewer URL returned by screen-info tools; use an address reachable from your browser. |

Compose sets `HOST=0.0.0.0` inside the container and publishes on host loopback at `PORT` (default 3000). It supplies `/data/uploads`, `/data/agent/auth.json`, and `/data/workspace` for the three path settings. Other model settings come from `.env`.

Uploads and generated attachments are limited to 25,000,000 bytes per file. Chat accepts files with optional text. Agents receive private absolute paths and use native workspace reading for text and supported images/PDFs (25,000,000-byte inline-media limit shared with uploads); other formats use available execution tools. New stored filenames retain extensions. Agents declare generated files as `{ path, filename, contentType }` in the structured output `files` array. The backend copies them into managed storage when publishing; `attachmentIds` resends existing files. Main and Task inspect relevant attachments by default before making content claims. Exceptions cover explicit no-read requests, copy/resend actions, already-inspected unchanged files, and unrelated attachments. Main delegates substantial inspection; tasks can use workers. `inspect_message` reopens earlier file references. Received and delivered files are retained through message associations. Files imported during an unsuccessful publication expire after 24 hours when unattached. Task details contain no attachment list. Public metadata contains no filesystem paths. Temporary and orphaned files and unattached uploads expire after 24 hours. Cleanup runs on startup and hourly. Keep the upload directory on persistent storage and back it up with the database.

## Agent Conversations

[agent-instructions.ts](src/agent/agent-instructions.ts) composes role prompts for the runtime and smoke scripts. All roles load [voice.md](src/agent/instructions/voice.md) and [files.md](src/agent/instructions/files.md) for voice, inspection, and original-file preservation. Main and Task load [texting.md](src/agent/instructions/texting.md) for public messages. Task and Worker load [execution.md](src/agent/instructions/execution.md) for workspace courtesy, interaction-method choice, and file processing. Role-specific routing, task ownership, browser lifecycle, and private worker output live in main.md, task.md, and worker.md. They load once at runtime startup; task metadata is appended dynamically for each invocation. Nest copies these Markdown assets into the build. Edit the files, rebuild, and restart the backend. Container development uses `docker compose build pal` followed by `docker compose up -d --force-recreate pal`.


For direct local development, run `npm run agent:login` to authenticate with ChatGPT in a browser. Use `npm run agent:login -- --device` for device login. Mastra Code owns credential storage and automatic refresh; no API key is needed. Login credentials stay in the ignored `data/agent/` directory by default. Keep this directory private and persistent across restarts.

Task agents manage recurring work and one-off reminders with `create_task_schedule`, `list_task_schedules`, `update_task_schedule`, `pause_task_schedule`, `resume_task_schedule`, and `delete_task_schedule`. TaskSchedulesService binds schedules to the current task and owner; Mastra owns persistence and dispatch. Schedules deliver automation signals to active tasks or wake idle threads with retained context. Cadence/timezone and quiet notification behavior live in task guidance. Pausing stops future ticks while current work continues. The agent keeps monitoring in-progress and pauses schedules before completing it. Schedule management is conversation-only. All schedules use cron/timezone. For one-off reminders, the agent stores the intended date/time and cancellation instructions in the prompt, skips early annual ticks, and deletes the triggering schedule when due. One-off cancellation depends on agent execution.

Main uses owner `pal-owner` and thread `pal-main`. A reusable Task Agent runs each task on `pal-task:<task UUID>` with the same owner. Observational Memory is scoped to each thread. Mastra initializes its own tables in the `mastra` PostgreSQL schema on startup. Keep this schema in database backups alongside Pal's public tables. Mastra Observational Memory uses the same authenticated model for observation and reflection, with native token thresholds and buffering.

`POST /chat/messages` accepts text and/or up to 100 attachment IDs in `attachmentIds` and optional `taskId` and `metadata: { timezone?: string }`. The API validates timezone; history and SSE retain it, and native message attributes expose it to the model. Omitted or empty metadata preserves legacy retry identity; changed timezone under the same idempotency key returns HTTP 409. Uploaded files are available to agents through private manifests with absolute local paths. Generated files are selected through structured output `files` declarations and copied into download storage at publication. Invalid output IDs or file declarations trigger one model retry with correction feedback; a repeated failure preserves the answer text with a file delivery notice. The coordinator preserves submission order through persistence and native acceptance. Once accepted, HTTP returns `{ messageId }`; Main and task agents can receive follow-ups while working. Assistant text arrives independently through history and SSE. Main commentary and finals appear in Main; task commentary stays in task chat and task finals appear once in both chats. Finals also enter Main's private context without waking it when idle. Messages persist nullable `phase`; Main visibility derives from role, task ID, and phase. User messages and unknown assistant phases use null.

Main answers directly when available context suffices, and delegates substantial work, task updates, or ongoing task ownership. Main acknowledges non-immediate work promptly, before tools or extended reasoning, including work without tools. After delegating, it leaves the substantive answer to the task. Its `search_tasks`, `inspect_task`, and `delegate_task` tools search all tasks, inspect candidates, and create or reuse tasks. Search accepts alternative terms across title, goal, and description, with newest-first pagination, bounded title/goal summaries, and a matching description excerpt. Inspection returns full details. Main clarifies material ambiguity between candidates. Task Agent updates its title, goal, and description through task-scoped `update_task`, and explicitly sets status through `set_task_status`; a final answer does not imply completion. Archive only hides a task from the active list. The global activity indicator means some part of the agent is working.

A handoff error returns HTTP 503 and keeps the user message. Reusing the same idempotency key returns its existing ID without resubmitting. To resend, use a new key. Generation failures publish a brief notice asynchronously. Restart restores stored context and memory; interrupted work requires a new message. Task result publication and Main signal persistence are separate writes; a crash between them can leave Main unaware of a visible result.

## Agent Environment

Task Agent and its workers receive all native Mastra workspace tools supported by LocalFilesystem and LocalSandbox, including file operations, grep/AST editing, commands, and background-process management. With desktop support enabled, X11Sandbox extends LocalSandbox with screenshot, mouse, keyboard, and display information through Mastra's native computer tools. Pillow captures PNGs; xdotool supplies input. Unicode typing uses a 50 ms key delay to allow X11 keymap updates to reach applications. Main's toolset contains lookup, delegation, `inspect_message`, and native read-only `read_file` for quick text/image/PDF inspection. Task agents share the workspace and desktop with each other and the user, guided to be mindful of concurrent activity. The controller's separate question, planning, task, and delegation UI tools are disabled.

Task agents also receive `browser`, `browser_group`, and `browser_screenshot` when desktop support is enabled. One shared Chromium profile keeps logins available to all tasks and the human. Each task has a pinned agent-browser session and a visible named group. Task agents can run up to three native workers concurrently, one level deep. Workers have separate pinned sessions within the parent group, return private findings, and release their member tabs and daemons when they finish. The installed `pal-browser` launcher loads the extension for both desktop and runtime use. Group close and completion/archive cleanup remove current task-group members; idle groups close after 30 minutes without browser activity while the task has no active run. A sweep runs every minute. Moving tabs out preserves them; ungrouped tabs and human-created groups are excluded. Guidance prefers service tools, direct APIs, browser, then computer use.

Filesystem containment and command isolation are disabled. Tools run with the process environment and workspace approvals allow execution. The container runs as `pal` with unrestricted passwordless sudo. `/data/workspace` is the default working directory; tools can access other container paths.

`HOME=/data/home` keeps user tools and configuration persistent. Python and venv, Node/npm, Bash, Git, ripgrep, curl, certificates, and sudo are included. Durable system dependencies belong in the image; other system changes are lost when the container is replaced. See [deployment architecture](../architecture/deployment.md).

## Try the Chat

With the backend running, watch SSE in another terminal:

```bash
curl -N http://127.0.0.1:3000/stream
```

Send a message, then repeat with a new key and follow-up text while Main is working:

```bash
curl -sS http://127.0.0.1:3000/chat/messages \
  -H 'Content-Type: application/json' \
  -d '{"idempotencyKey":"manual-1","text":"Remember project identifier PAL-119. Help me outline its migration checklist.","attachmentIds":[]}'

curl -sS http://127.0.0.1:3000/chat/messages \
  -H 'Content-Type: application/json' \
  -d '{"idempotencyKey":"manual-2","text":"Correction: use PAL-120. Keep the checklist to three items.","attachmentIds":[]}'

curl -sS http://127.0.0.1:3000/chat/history
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
docker compose exec postgres psql -U pal -d postgres -c 'CREATE DATABASE pal_test'
```

```bash
npm run build
npm run lint
npm test
npm run test:e2e
```

Automated suites cover service transactions, native Main delivery/memory/lifecycle, task delegation/steering/result sharing/restart recall, native scheduled execution and management, timezone metadata, chat/task APIs with SSE, and file transfers. Tests use controlled models, apply migrations, and reset application tables in the test database. Native agent fixtures use temporary schemas. Test commands build the app first so Nest's emitted decorator metadata matches production.

With the desktop container running, validate actual screenshot/input behavior against a disposable local Chromium page:

```bash
npm run desktop:smoke
npm run desktop:smoke -- --agent
```

The second command also uses the configured ChatGPT login and a temporary schema in `pal_test` to verify that the model reads a random code from a screenshot and submits it with computer tools. It uses a temporary browser profile and has a 180-second deadline. These checks interact with the shared desktop; run them when it is idle.

To run bounded memory validation with your real ChatGPT login:

```bash
npm run agent:smoke
```

This uses `TEST_DATABASE_URL` and a temporary schema. It checks Main and task recall after restart and forced native observation/reflection, verifies memory output stays private, and verifies real task final phase metadata and Main result context. Production memory thresholds are unchanged. The scenario has a 300-second deadline; its schema is removed on normal completion or failure.

For production builds:

```bash
npm run build
npm run start:prod
```

To validate files with the configured model:

```bash
npm run files:smoke
```

This creates a disposable test database and local HTTP server. It checks user uploads, native worker document/image reading, generated downloads, and reopening earlier files after restart. It uses the configured ChatGPT login and has a 300-second deadline. Use a disposable PostgreSQL instance via `TEST_DATABASE_URL` when isolating validation from other work.

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

Validate browser control in the running desktop container with a disposable profile:

```bash
npm run browser:smoke
npm run browser:smoke -- --agent
```

The fixture covers concurrent pinned task sessions, shared login state, groups/popups, screenshot media, cleanup, API reconnect, worker suspension, and browser restart. `--agent` adds concurrent native task threads using the configured model for screenshot/form submissions. The fixture uses port 9235, reports sampled process RSS, and writes `/tmp/pal-browser-groups.png` inside the container for desktop inspection. It shares the display, so run it when the desktop is idle.

Validate worker fan-out with `npm run workers:smoke` against the running Compose VM. It uses real models and disposable local F1 ticket, event, and dinner fixtures, including Main responsiveness and worker cleanup. Its requests explicitly ask for parallel workers within one task; worker selection remains model-driven.
