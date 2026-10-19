# Agent Container and Native Tools

## Status

Done

## Goal

Run NestJS and Main together in a persistent Linux container, with native Mastra tools able to operate throughout that container. Keep the application configuration usable when Pal runs directly in a VM.

Start with the container image build. Deployment differences belong in repository documentation; leave agent instructions unchanged.

## Current Behavior

- [Compose](../backend/compose.yaml) runs Pal and PostgreSQL under project `pal-rewrite`, with separate persistent volumes for `/data` and the database.
- [MastraAgentRuntime](../backend/src/agent/mastra-agent-runtime.ts) creates Main in the Nest process with all native tools supported by LocalFilesystem and LocalSandbox.
- Main history and memory persist in PostgreSQL. Home, workspace, uploads, and ChatGPT authentication persist under `/data` in the container.
- [Login](../backend/src/agent/login.ts) runs independently through its compiled entry point. Database migration uses the external host checkout and Drizzle Kit.
- The frontend playground runs on the Mac and proxies HTTP/SSE to containerized Pal, recovering its connection and history after recreation.

## Deployment Contract

- One NestJS process owns Main and its local workspace. Docker or a VM supplies the execution boundary.
- Use `/opt/pal` for the packaged application and a persistent `/data` directory containing `home`, `workspace`, `agent`, and `uploads`.
- Set `HOME=/data/home`, `PAL_AGENT_WORKING_DIR=/data/workspace`, `PAL_AGENT_AUTH_PATH=/data/agent/auth.json`, and `PAL_UPLOAD_DIR=/data/uploads` in the container. Paths remain externally configurable for direct deployment.
- Run as a dedicated `pal` user with unrestricted passwordless sudo inside the container. Use normal Docker isolation, with no privileged mode, host Docker socket, or Mac home-directory mount.
- Main uses native `LocalFilesystem` with containment disabled and `LocalSandbox` with isolation disabled. Pass the process environment to command execution and disable tool approval requirements. Expose all native workspace tools supported by these configured providers, including background-process management.
- Keep existing HTTP contracts, Main identity, PostgreSQL schemas, and publication behavior. No domain data migration is expected.
- See [deployment comparison](../architecture/deployment.md) for persistence and direct-VM differences.

## Accepted Decisions

- Application updates are deployed externally. Pal owns its workspace and tools; application self-modification and self-restart workflows are deferred. This is the supported deployment workflow, with unrestricted sudo still providing technical access to the application.
- Persist `/data` across container replacement. Bake durable system dependencies into the image; other system changes may be discarded on replacement.
- Develop through image rebuild and container recreation. Container hot reload is deferred until needed.
- Use a dedicated `pal` user with unrestricted passwordless sudo inside the container.
- Keep migrations in the existing external npm workflow and use Compose `init: true`. Initialize directory ownership in the image where sufficient.
- Include Python and venv in the minimal utility set. Expose all native tools supported by the configured local filesystem and sandbox, including background processes.

## Milestones

### 1. Build the Container Image

Implementation tasks:

- [x] Add `backend/Dockerfile` with pinned Node 24 Debian build/runtime stages, locked npm installation, the compiled backend, and runtime dependencies. Validate the pinned Mastra dependencies on the local Linux architecture.
- [x] Add `backend/.dockerignore` excluding local environment files, credentials, uploads, database files, host dependencies, and build output from the build context.
- [x] Include Node/npm, Bash, Git, ripgrep, curl, CA certificates, Python with venv support, and sudo. Add other system utilities when needed; keep any build-only dependencies in the build stage.
- [x] Create persistent directories and their ownership in the image and use `USER pal` for API and login commands. Verify fresh named-volume initialization; add startup initialization only if validation demonstrates a need.
- [x] Start the compiled API directly with Node; Compose supplies the init process.
- [x] Verify compiled login can run independently of API initialization, using device login for container operation.

Exit criteria:

- [x] The runtime image builds from a clean context without credentials or prebuilt host artifacts.
- [x] A disposable container runs the compiled module imports and baseline utilities, reports the expected user/home, and can use sudo without a prompt.
- [x] Persistent directories are writable by `pal`; the image contains no local credentials or uploads.
- [x] The compiled login entry point is usable without starting Main.

### 2. Run Pal through Compose

Implementation tasks:

- [x] Extend `backend/compose.yaml` with the `pal` service and a named volume mounted at `/data`, preserving the current project name and PostgreSQL volume.
- [x] Configure PostgreSQL access through the Compose service hostname. Keep host-side development and test database URLs usable.
- [x] Set the container API listener to `0.0.0.0` and publish it on Mac loopback. Document private Tailnet ingress separately.
- [x] Configure PostgreSQL health dependency, `init: true`, restart policy, bounded log rotation, and a shutdown grace period sufficient for the existing Main cleanup.
- [x] Keep migrations externally run through the existing `npm run db:migrate` with the host-side database URL. Document the order: build, start PostgreSQL, migrate, authenticate, start Pal.
- [x] Document first-use container login, restart/rebuild commands, volume backup expectations, and the single active Main runtime assumption.
- [x] Explicitly document preservation or intentional fresh initialization of current host-side uploads and auth state; do not silently replace them or run two Main instances against the same thread.
- [x] Verify the frontend playground against the container API through its existing Vite proxy, including history, SSE, reply delivery, reload, and reconnect.
- [x] Update `.env.example` and the backend README with introduced configuration. Keep local credentials out of the image and repository.

Exit criteria:

- [x] Pal starts with the existing database, accepts a Main message through HTTP, and publishes a reply through the existing history/SSE path.
- [x] Recreating only the Pal container preserves home/workspace files, uploads, authentication, and completed conversation context.
- [x] Stopping Pal completes normal shutdown within the grace period and leaves no agent subprocess running in the stopped container.
- [x] The documented bootstrap sequence works without requiring the API to be running for login or migration.

### 3. Enable Native Mastra Tools

Implementation tasks:

- [x] Add validated absolute `PAL_AGENT_WORKING_DIR` configuration, with `./data/workspace` as the local default, and document it.
- [x] Configure one native Workspace with LocalFilesystem and LocalSandbox, sharing the working directory and using the deployment contract above.
- [x] Attach the workspace to Main and verify native initialization/cleanup ownership against the pinned Mastra version, including startup failure and shutdown paths.
- [x] Expose all native workspace tools supported by LocalFilesystem and LocalSandbox, including file operations, command execution, and background-process management. Let Mastra determine available capabilities; verify the controller mode exposes them using supported APIs. Additional providers and services are outside scope.
- [x] Preserve injected test tools and isolate integration-test workspaces in temporary directories.
- [x] Keep tool results private through the existing publication processor and preserve cancellation propagation to foreground commands.
- [x] Update current architecture/configuration documentation after behavior is implemented. Leave Main's instructions unchanged.

Exit criteria:

- [x] Through Main, native tools can write, read, edit, and list files and run a command inside the container.
- [x] A disposable fixture outside the default working directory proves file and command access are not restricted to that directory.
- [x] Background-process output/termination and foreground cancellation work through supported Mastra tools and lifecycle APIs.
- [x] A bounded real-model request performs a file operation and command inside the container and publishes its answer through Pal.

## Tests

- One container bootstrap/recreation smoke sequence covers image utilities, fresh-volume ownership, external migrations, standalone login, startup, shutdown, and persistence. Include a native background-process start/output/termination check in this sequence.
- Extend `backend/test/main-session.spec.ts` with a minimal controlled-model native-tool scenario covering tool exposure, filesystem/command execution, output privacy, and cancellation. Use disposable paths for access outside the working directory.
- Reuse existing Main lifecycle, history, and HTTP/SSE coverage. Add a focused SSE shutdown regression for the live container stop failure.
- Strengthen the existing playground reconnect test with an abrupt upstream disconnect through Vite's real proxy.
- One bounded real-model container check confirms actual tool selection and user-visible delivery, recreation, reconnect, reload, and completed-context recall. Keep fixtures isolated from normal user files.

## Validation Commands

Existing checks, from `backend/`:

```bash
npm run build
npm run lint
npm test
npm run test:e2e
```

Playground checks, from `frontend-playground/`:

```bash
npm run build
PLAYWRIGHT_CHANNEL=chrome npm test
```

Container commands, from `backend/`:

```bash
docker build --target runtime -t pal-local .
docker compose build pal
docker compose up -d --wait postgres
npm run db:migrate
docker compose run --rm pal node dist/agent/login.js --device
docker compose up -d pal
docker compose stop pal
docker compose up -d --force-recreate pal
```

Run migrations from the host checkout with its existing dependencies and host-side database URL. Document the exact smoke procedure alongside the implementation; record actual outcomes before marking milestones done. Recreate the Pal container only, preserving named volumes.

## Deferred Work

- Application self-modification/self-restart workflows and container hot reload.
- Direct VM provisioning, systemd units, and deployment to a remote host.
- Desktop/browser services, keyring integration, and legacy Supervisor stack.
- A VM/provider abstraction, remote command adapters, multiple agent containers, and automatic infrastructure provisioning.
- Automatic persistence of container system-package changes, container snapshot management, and Docker control from inside Pal.
- New agent instructions about deployment or persistence.

## Overall Exit Criteria

- [x] The container image and documented Compose sequence support login, migration, startup, and graceful shutdown.
- [x] Main operates through native Mastra tools inside its container with administrative capability and persistent agent files.
- [x] Existing API behavior and persistent history remain intact; required checks and the bounded real-model smoke pass.
- [x] Container versus direct-VM differences are documented, with no deployment-specific execution layer in application code.
- [x] The frontend playground works with containerized Pal through the documented backend URL.
- [x] Plan status and remaining work reflect observed validation results.

## Validation Evidence

- 2026-10-06: Runtime image builds on Linux ARM64 with pinned Node 24.15.0. Fresh named-volume ownership, noninteractive sudo, Python venv, baseline utilities, and native module imports pass. Build context includes only application build inputs.
- Standalone compiled device login reaches authorization instructions without starting Main. Existing local auth and upload files are copied into the Pal volume; original host files remain intact. External `npm run db:migrate` passes against the existing database.
- Backend build/lint pass; service/Main tests pass (7 tests), including the native-tool regression, and end-to-end tests pass (6 tests), including open-SSE shutdown.
- Linux native smoke passes for all 12 supported tools being available, filesystem access outside the working directory, inherited HOME, background output/kill, foreground cancellation, and shutdown cleanup.
- Native integration requires both workspace `requireApproval: false` and the documented Session state `yolo: true`; the regression verifies calls do not wait for UI approvals.
- Playground build and its controlled HTTP/SSE browser suite pass (2 tests). The reconnect scenario verifies an abrupt upstream disconnect through Vite's proxy.
- Bounded live Chrome validation passes against containerized Pal: Main uses native tools to create/read a disposable workspace file and reports Linux/user `pal`; HTTP acceptance and SSE reply/activity delivery work through the playground.
- With the browser connected, Pal stops in 201 ms with exit 143. Recreation preserves the workspace file, home/upload fixtures, and auth file (hash comparison). The playground reconnects, restores history without duplicate messages, reloads successfully, and receives Main's recall of the completed conversation. No browser JavaScript errors occur; disposable fixture files are removed.
- Open SSE responses require Nest's supported `forceCloseConnections` option for bounded shutdown. Vite closes downstream responses when the upstream aborts so the browser can reconnect. Both behaviors have focused regression coverage. Reference: [Nest keep-alive connections](https://docs.nestjs.com/faq/keep-alive-connections).
