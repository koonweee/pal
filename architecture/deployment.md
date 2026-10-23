# Deployment

Docker Compose 2.36 or later runs four services:

| Service | Responsibility |
| --- | --- |
| agent-service | NestJS, Mastra orchestration, model authentication, integration clients, API/SSE, and database access |
| execution | One persistent Debian/Xfce desktop, Chromium, shell/code execution, and agent files |
| web | PWA static assets, API/desktop gateway, private CDP forwarding, and Squid egress proxy |
| postgres | Application and Mastra schemas |

The development overlay adds Vite and isolated local database/PWA ports. Production and development use separate Compose projects and volumes. Host-side builds and tests are supported; runtime execution uses Docker.

## Storage and Execution

Both agent-service and execution mount the agent-home volume at `/home/pal`. It contains the workspace, materialized attachment copies, downloads, browser profile, installed user utilities, and temporary code-mode runners. Both containers use UID 1000. The service sets `TMPDIR=/home/pal/tmp`; secret-bearing temporary data must use service-private storage explicitly.

The service-data volume mounts only in agent-service at `/data/private`. It owns model authentication, service HOME, canonical uploads, and published file snapshots. PostgreSQL has its own volume. Execution receives neither those volumes nor the backend environment.

Mastra's Docker provider supplies command execution and process streams. ComposeSandbox attaches to exactly one running container carrying the configured `mastra.sandbox.id` label. Compose owns container creation, replacement, and deletion. Backend shutdown detaches the workspace and leaves the desktop running. Operations resolve the stable label again after container replacement; missing execution fails without a local fallback.

Agent-service alone accesses Docker's socket through a read-only filesystem bind. The socket still grants full Docker API access; agent-service is trusted host administration code. On Linux, set `PAL_DOCKER_GID` to the socket's group ID; Docker Desktop uses the default 0. Execution retains passwordless sudo inside its container, with no Docker socket or host administrative mounts.

Native filesystem operations delegate to LocalFilesystem inside execution through Docker process stdin/stdout. This isolates path resolution from service-private files, including shared-home symlink races. File tools operate within the agent home; shell commands can access the execution container's other paths. Upload manifests point to copies in `/home/pal/incoming`. Inspection-copy materialization runs one file at a time across concurrent requests. Publication reads files inside execution and stores immutable canonical copies in private service storage.

## Network Boundaries

Execution joins an internal Docker network. Its configured HTTP(S) proxy runs in web, permits public web destinations, and denies private, loopback, link-local, and Tailnet destination addresses. Chromium uses this proxy; command tools receive proxy environment variables. Software that ignores proxy configuration has no direct internet route.

Web rejects gateway requests originating from the execution subnet, derived from its Compose-named palexec0 interface. Additional ingress networks do not change this boundary. Agent-service and PostgreSQL are on the separate service network. The only published production port is the loopback-bound PWA gateway. The CDP-forwarding listener and egress proxy are private Docker endpoints.

The gateway clears its previous Squid PID file at startup and terminates if either Squid or Nginx exits. Compose restarts the gateway. Squid drains connections for one second during shutdown, within the container stop timeout.

Pal remains Tailscale-only. Do not expose its gateway to the public internet.

## Development and Updates

Use `./scripts/dev-local` from the repository root:

- `up` builds and starts the isolated split stack.
- `rebuild` refreshes backend code while retaining the running execution container.
- `execution-rebuild` replaces the execution image/container and restarts its clients. Browser profile and home files persist; running desktop applications stop.
- `frontend-restart` refreshes Vite after frontend dependency changes.
- `pwa-up` rebuilds the production-style PWA and announces an available update.
- `serve` and `unserve` manage the scoped private Tailscale Serve route.
- `status`, `logs`, and `down` inspect or stop the stack.

Database migrations remain explicit deployment steps, run from agent-service before the application starts. Production supplies a shared opaque `PAL_RELEASE_ID` to backend and frontend builds. The development web build uses the `Pal Dev` installation identity.

The gateway forwards API/SSE to agent-service and versioned desktop HTTP/WebSocket paths to execution. Nginx refreshes upstream Docker DNS when containers are replaced. Its 25 MiB request-body limit admits Pal's 25,000,000-byte uploads. The PWA service worker caches the static shell; API, files, OAuth, notifications, and noVNC remain network-only.

## Persistence and Desktop

Restarting a container retains its writable filesystem. Replacing it retains named-volume contents. Back up agent home, service data, and PostgreSQL application/Mastra schemas together. User-installed packages outside home require an image or filesystem backup before execution-image replacement.

TigerVNC supplies a shared 1200×900 X11 display. Supervisor owns D-Bus, Xfce, noVNC, and the CDP bridge. Docker init reaps orphaned processes. The desktop profile installs the coral Xfce/GTK assets and floating launcher; home preserves later user customization.

Chromium uses `/home/pal/.config/chromium` by default and the stable `pal` hostname. The bundled launcher loads the task-groups extension and retains Chromium's sandbox through the repository's seccomp profile. Raw CDP listens on execution loopback; private forwarding connects BrowserService through web. Chromium starts on demand. Browser/group cleanup preserves unrelated tabs. Cookies and profile state persist; browser restart begins fresh runtime groups.

Managed incoming copies are reconciled against canonical attachment names on startup and hourly. Missing execution defers that reconciliation without blocking the API.

## Web Push

Configure `PAL_WEB_PUSH_PUBLIC_KEY`, `PAL_WEB_PUSH_PRIVATE_KEY`, and `PAL_WEB_PUSH_SUBJECT` together in the runtime environment. Generate a pair once with `npx web-push generate-vapid-keys` from `backend/`; retain it across restarts and releases. The subject is a `mailto:` contact or HTTPS URL. The private key stays in local environment/secret storage. Local development may use a dedicated pair in `backend/.env.development`.

Apply migrations before starting the updated backend. Rebuild the local stack with `./scripts/dev-local rebuild`; notification changes include backend/API work. Refresh the staged React artifact after the backend is ready using the existing staging workflow. Each deployment supplies a stable VAPID pair through private configuration.

Browser permission and subscriptions belong to the stable HTTPS application origin and service-worker registration. iPhone users install the PWA on the Home Screen before enabling notifications. Desktop Chrome also supports subscribing from a browser tab. Each browser/PWA subscription is independent of native APNs registration.

The backend needs outbound HTTPS to FCM and Apple Web Push services. Browser push services deliver payloads without an inbound public Pal endpoint. Display uses the payload directly; registration and fetching chat after a tap require Tailnet access. Provider TTL zero discards notifications for unreachable devices; Pal's own transient retry queue expires after five minutes. Provider acceptance does not prove OS presentation. Physical-device acceptance is tracked in the [PWA notification plan](../plans/pwa-notifications.md).
