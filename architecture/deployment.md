# Deployment

Compose runs NestJS, Mastra, and an Xfce/X11 desktop together in the `pal` container and PostgreSQL in a separate service. Direct host development uses the same local providers. The [agent container plan](../plans/agent-container.md) and [desktop plan](../plans/x11-desktop.md) track validation; direct VM provisioning is deferred.

The local development overlay adds a Vite container with the React source mounted for hot reload. An optional profile builds the Nginx production gateway with the `Pal Dev` identity for installation and service-worker testing beside Vite. Both web endpoints and every supporting published port bind only to Mac loopback; API, SSE, and noVNC traffic remain inside the private Compose network behind each same-origin gateway. The `pal-dev` Compose project and its environment, database, agent home, and browser state are separate from production. Telegram and APNs delivery are disabled unless dedicated development credentials are explicitly configured.

Optional Tailnet access uses Tailscale Serve as a private HTTPS reverse proxy to the loopback production-style PWA gateway. The lifecycle script owns one scoped HTTPS endpoint, preserves other Serve configuration, and switches the development backend public URL and OAuth callbacks to that generated Tailnet origin. Vite remains loopback-only for hot reload. Serve configuration is independent of the Compose lifecycle and remains active until explicitly disabled.

Installed production PWA acceptance requires a stable HTTPS origin whose identity survives releases. The local Tailnet Serve URL is a development origin and is not a production installation origin unless it is explicitly promoted and retained as part of deployment.

## Shared Runtime Design

NestJS and Mastra run together in one process. Native local filesystem and command tools operate on the environment hosting that process. Deployment supplies the machine boundary and administrative permissions.

The layout uses `/opt/pal` for the application and persistent `/data` directories for the agent's home, workspace, authentication, and uploads. Paths and the PostgreSQL connection are supplied through environment configuration. The application needs no container/VM switch or execution adapter.

## Container and Direct VM

| Concern | Container deployment | Direct VM deployment |
| --- | --- | --- |
| Application installation | Build Pal into an image. | Clone Pal, install locked dependencies, and build. |
| System utilities | Install baseline utilities in the Dockerfile. | Install utilities during VM provisioning. |
| Agent execution | Local tools execute inside the container. | The same local tools execute inside the VM. |
| Administrative access | Dedicated user with passwordless sudo inside the container, subject to Docker capabilities. | Dedicated user with passwordless sudo in the VM. |
| Process lifecycle | Supervisor manages D-Bus, desktop, viewer, and API; Compose supplies restart policy and `init: true`. | A systemd service. |
| Persistent agent files | Named volume mounted at `/data`. | Persistent disk mounted or available at `/data`. |
| PostgreSQL | Existing separate Compose service and database volume. | Reachable PostgreSQL instance configured by URL. |
| API/viewer ingress | HTTP and noVNC ports publish on Mac loopback; raw VNC stays internal. | Bind to an appropriate private interface or use private ingress. |

Application migrations remain an explicit deployment step. Local development uses `npm run db:migrate` from the host; production runs `npm run db:migrate:prod` from the pinned runtime image before starting the API.

Production serves the built React PWA through a small same-origin gateway. The gateway routes browser `/api` requests, native root API requests, SSE, and the versioned `/desktop` HTTP/WebSocket paths to the private runtime services. Its 25 MiB request-body limit admits multipart uploads up to the backend's 25,000,000-byte per-file limit. Only the gateway joins the ingress network.

Each production rollout supplies one opaque `PAL_RELEASE_ID` to the backend runtime and React frontend build. The browser compares that release through HTTP headers and the initial `frontend.updated` SSE event, then checks its service-worker registration. A production-style staging build also supplies `PAL_APP_VARIANT=dev`, giving it `Pal Dev` installation metadata and a distinct manifest ID.

The web manifest uses validated 192 px and 512 px versions of the iOS artwork plus a 180 px Apple touch icon. The artwork is declared as a general icon rather than maskable because it does not fit the maskable safe zone.

`frontend/` builds the production React/PWA gateway with the same private exposure boundary. Its service worker caches only the static application shell. API, SSE, file, OAuth, notification, and noVNC routes are network-only, and Nginx serves the worker, manifest, and document with revalidation while hashed assets are immutable. Prior immutable backend and gateway images are retained for compatible rollbacks.

> [!WARNING]
> Pal is Tailscale-only. Do not expose it to the public internet.

## Application Updates

The development workflow builds the image and recreates the Pal container while preserving `/data`. Application updates are deployed externally. Pal owns its workspace and tools and runs as a dedicated user with unrestricted passwordless sudo inside the container. That administrative capability includes technical access to application files; externally managed updates describe the supported workflow.

## Persistence

Restarting the same container retains its writable filesystem. Replacing a container retains named-volume data, while system modifications outside those volumes are discarded. Keep user-installed tools and configuration under `/data/home`; put reproducible baseline system dependencies in the image. See [Docker storage](https://docs.docker.com/engine/storage/).

VM disk changes, including installed system packages, survive ordinary reboots when the disk is persistent. Replacing a VM requires retaining or restoring its disks and provisioning the new machine.

Back up `/data` together with PostgreSQL application and Mastra schemas. Authentication files belong in private persistent storage. These deployment details stay in repository documentation; they do not add agent instructions.

## Moving to a VM

Provision Node and baseline utilities, install/build Pal, restore its persistent directories, configure PostgreSQL and paths, and start NestJS under systemd. Stop the previous agent runtime before starting its replacement against the same stored conversations. Mastra continues using the same local providers.

## Desktop

TigerVNC provides a single 1200×900 X11 display shared by task agents and the user. noVNC/websockify exposes the viewer, embedded through the web gateway's HTTP/WebSocket proxy. All applications run as `pal` with shared display and session D-Bus settings.

The [desktop appearance profile](../backend/desktop/profile/README.md) installs matching coral GTK/Xfwm assets, Papirus icons, and Chromium GTK defaults. Per-user initialization configures 64 px workspace margins and one floating launcher panel. XDG autostart runs Devilspie2 to maximize newly opened normal app windows and Picom for shared rounded corners and compositing; Xfwm owns window management with its compositor disabled. Versioned markers preserve later customization; original preferences are backed up in the user’s XDG state directory. The same installer supports Debian-based Xfce/X11 VMs.

Compose applies a [Moby-based seccomp profile](../backend/desktop/seccomp.README.md) allowing the namespace syscalls required by Chromium. The browser retains its namespace and Seccomp-BPF sandboxes; container capabilities remain at their existing defaults.

The API starts after the window manager is ready. Supervisor restarts the desktop independently after failure; computer operations fail during the outage while chat and shell remain available. Graceful container shutdown stops Main and task runs before the desktop and D-Bus.

Browser profiles, desktop preferences, and saved files persist under `/data/home`. Compose keeps a stable `pal` hostname so Chromium can recover stale profile locks after recreation. Session sockets are ephemeral. Reboot starts a fresh desktop without restoring running applications. Direct Mac development disables the X11 capability.

## Shared Chromium

`pal-browser` resolves to `backend/desktop/browser.sh`. Both the desktop Chromium launcher and BrowserService use it to load the bundled task-groups extension and enable loopback CDP on `PAL_BROWSER_PORT` (default 9222). The shared profile defaults to `${XDG_CONFIG_HOME:-$HOME/.config}/chromium`, under persistent `/data/home` in Compose. `PAL_BROWSER_PROFILE` selects an absolute alternative path; `PAL_BROWSER_EXECUTABLE` selects the Chromium binary. Chromium starts on demand and retains its sandbox. The debugging port stays internal.

The image runs `desktop/browser-install.sh` to install the launcher and desktop entry. For an Xfce VM, keep the installed Pal checkout at a stable path, install/build its locked dependencies, then run `sudo backend/desktop/browser-install.sh` alongside the desktop profile installer. Start the desktop and API as the same user with the same home, display, browser configuration, and session D-Bus. Use the Chromium desktop entry or `pal-browser` so the extension and profile agree.

Cookies and login state persist across browser/container restarts. Running browser sessions and task groups start fresh after restart; API reconnect recovers groups in the running browser. Group cleanup leaves unrelated tabs and user-created groups available.

## Web Push

Configure `PAL_WEB_PUSH_PUBLIC_KEY`, `PAL_WEB_PUSH_PRIVATE_KEY`, and `PAL_WEB_PUSH_SUBJECT` together in the runtime environment. Generate a pair once with `npx web-push generate-vapid-keys` from `backend/`; retain it across restarts and releases. The subject is a `mailto:` contact or HTTPS URL. The private key stays in local environment/secret storage. Local development may use a dedicated pair in `backend/.env.development`.

Apply migrations before starting the updated backend. Rebuild the local stack with `./scripts/dev-local rebuild`; notification changes include backend/API work. Refresh the staged React artifact after the backend is ready using the existing staging workflow. Each deployment supplies a stable VAPID pair through private configuration.

Browser permission and subscriptions belong to the stable HTTPS application origin and service-worker registration. iPhone users install the PWA on the Home Screen before enabling notifications. Desktop Chrome also supports subscribing from a browser tab. Each browser/PWA subscription is independent of native APNs registration.

The backend needs outbound HTTPS to FCM and Apple Web Push services. Browser push services deliver payloads without an inbound public Pal endpoint. Display uses the payload directly; registration and fetching chat after a tap require Tailnet access. Provider TTL zero discards notifications for unreachable devices; Pal's own transient retry queue expires after five minutes. Provider acceptance does not prove OS presentation. Physical-device acceptance is tracked in the [PWA notification plan](../plans/pwa-notifications.md).
