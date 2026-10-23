# Deployment

Docker Engine 28.1 or later and Compose 2.36 or later run five services:

| Service | Responsibility |
| --- | --- |
| agent-service | NestJS, Mastra orchestration, model authentication, integration clients, API/SSE, and database access |
| execution | One persistent Debian/Xfce desktop, Chromium, shell/code execution, and agent files |
| web | PWA static assets, API/desktop gateway, and private CDP forwarding |
| egress | IPv4 routing, private destination filtering, and source NAT for execution |
| postgres | Application and Mastra schemas |

The development overlay adds Vite and isolated local database/PWA ports. Production and development use separate Compose projects and volumes. Host-side builds and tests are supported; runtime execution uses Docker.

## Storage and Execution

Both agent-service and execution mount the agent-home volume at `/home/pal`. It contains the workspace, materialized attachment copies, downloads, browser profile, installed user utilities, and temporary code-mode runners. Both containers use UID 1000. The service sets `TMPDIR=/home/pal/tmp`; secret-bearing temporary data must use service-private storage explicitly.

The service-data volume mounts only in agent-service at `/data/private`. It owns model authentication, service HOME, canonical uploads, and published file snapshots. PostgreSQL has its own volume. Execution receives neither those volumes nor the backend environment.

Mastra's Docker provider supplies command execution and process streams. ComposeSandbox attaches to exactly one running container carrying the configured `mastra.sandbox.id` label. Compose owns container creation, replacement, and deletion. Backend shutdown detaches the workspace and leaves the desktop running. Operations resolve the stable label again after container replacement; missing execution fails without a local fallback.

Agent-service alone accesses Docker's socket through a read-only filesystem bind. The socket still grants full Docker API access; agent-service is trusted host administration code. On Linux, set `PAL_DOCKER_GID` to the socket's group ID; Docker Desktop uses the default 0. Execution retains passwordless sudo inside its container, with no Docker socket or host administrative mounts.

Native filesystem operations delegate to LocalFilesystem inside execution through Docker process stdin/stdout. This isolates path resolution from service-private files, including shared-home symlink races. File tools operate within the agent home; shell commands can access the execution container's other paths. Upload manifests point to copies in `/home/pal/incoming`. Inspection-copy materialization runs one file at a time across concurrent requests. Publication reads files inside execution and stores immutable canonical copies in private service storage.

## Network Boundaries

Execution joins a dedicated transit bridge. Docker's [inhibit_ipv4 bridge option](https://docs.docker.com/engine/network/drivers/bridge/#skip-bridge-ip-address-configuration) leaves its gateway address unassigned on the host. The separate egress container connects transit to an uplink network, installs nftables policy atomically, and then claims the transit gateway address. Public IPv4 destinations accept ordinary application traffic on any port. Policy denies private, loopback, link-local, Tailnet, multicast and reserved high-address ranges. Execution and egress disable IPv6.

Egress has its own network namespace, a read-only filesystem and NET_ADMIN/NET_RAW capabilities for routing and gateway ARP announcements. It receives no agent home, service credentials or Docker socket. Execution has neither capability and cannot change the router's policy. Packaged nftables, iproute2 and arping provide the network implementation.

Before policy readiness, execution has no usable internet route. If egress stops, outbound connections stop while the desktop remains running. Docker's restart policy recovers a failed router; its gratuitous ARP announcement refreshes execution's cached gateway after replacement. Existing connections may need to reconnect when NAT state is lost. Execution and egress can restart independently.

`PAL_EXECUTION_NETWORK_PREFIX` selects the transit /24 using three IPv4 octets (default `172.30.235`). Compose derives the subnet, gateway `.1` and router `.2` from it. Dynamic clients use the upper half of the /24 so startup order cannot consume the router address. Choose a prefix that does not overlap existing Docker, LAN or routed networks. Isolated smoke tests use a separate prefix.

Web rejects gateway requests originating from the execution subnet, derived from its Compose-named palexec0 interface. Additional ingress networks do not change this boundary. Web's default route uses the service network. Agent-service and PostgreSQL are on the separate service network. The only published production port is the loopback-bound PWA gateway. CDP forwarding remains a private Docker endpoint.

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

The first upgrade from the proxy layout replaces the execution network and execution container. In development, run `./scripts/dev-local down` followed by `./scripts/dev-local up`; named volumes and browser profile persist, and running desktop applications stop. Ordinary backend rebuilds preserve execution after that migration.

A production network migration needs reviewed immutable web, execution and egress images, updated deployment Compose and health checks, and a coordinated replacement of the execution network. Validate the production architecture/kernel and a full Docker-daemon or VM reboot before accepting that release. Keep the existing paired application state and previous image/network definitions available for rollback.

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

## Password Vault

Use a dedicated hosted Bitwarden account for Pal. Obtain its personal API key from Bitwarden's account settings and configure `PAL_BITWARDEN_CLIENT_ID`, `PAL_BITWARDEN_CLIENT_SECRET` and `PAL_BITWARDEN_MASTER_PASSWORD` in the private agent-service environment (`backend/.env.development` for development). Use the default US Bitwarden service for this implementation. Account creation, API-key access and account verification happen in Bitwarden's UI; never send these values through Pal chat. The API key authenticates and the master password decrypts; both are required. Agent-service unlocks automatically after restart or lock. Missing configuration keeps Pal available with vault operations disabled.

The agent-service image pins `@bitwarden/cli` to 2026.10.0. BitwardenService starts its supported Vault Management API at `127.0.0.1:8087`; Compose does not publish this port. CLI state and temporary files live in `/data/private/bitwarden`, alongside the private uploads directory. Back up service data and the external vault according to their separate recovery needs. Execution receives no Bitwarden environment, private mount or API route. New records use HTTPS Host matching. Manage the full vault in Bitwarden; the PWA supports login collection and replacement of a matching record.

After configuring secrets, use `./scripts/dev-local rebuild` to apply them in development. A real hosted-vault round trip and account sign-in require the operator's setup and any website second factors. `npm run login:smoke` from backend inspects public Apple/Amazon login forms in isolated local Chrome; `TEST_CHROMIUM_PATH` overrides the local executable. `backend/scripts/login-execution-smoke.mjs` runs through stdin inside the development agent-service and checks two temporary worker tabs with synthetic credentials, preserving other browser tabs.
