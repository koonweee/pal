# Agent Service and Persistent Execution Container

## Status

In Progress

## Goal

Separate Pal's backend and agent orchestration from model-controlled execution using Mastra's Docker provider. Preserve one persistent Debian desktop, current browser capabilities, existing user state, and the PWA workflow.

## Current Behavior

- Agent orchestration runs in agent-service. Compose owns one persistent Debian execution desktop, the PWA gateway, and PostgreSQL.
- ComposeSandbox delegates execution/process streams to the pinned Mastra Docker provider, attaches by label, and leaves the container running on backend shutdown.
- Native code mode uses the shared home and matching UIDs without a custom transport.
- Browser CLI and X11 operations run inside execution. Private CDP forwarding connects the service to Chromium.
- Canonical attachments stay private; manifests materialize inspection copies in agent home and publication reads files through execution.
- The full-stack smoke suite verifies browser/desktop actions, real PWA file exchange/SSE, network isolation, restart persistence, and API availability during execution outage.
- Legacy-state migration and remaining legacy smoke-script adaptation are outstanding.

## Decisions and Scope

- Compose owns four production services: agent-service, execution, web, and postgres. Development retains Vite.
- One execution container serves Main, Tasks, and workers. No per-task containers or idle teardown.
- Agent-service owns orchestration, models, schedules, MCP clients, database access, PWA APIs, and provider credentials.
- Execution owns shell/code execution, utilities, Chromium, its profile, X11, and noVNC. Retain current browser control and sudo inside execution.
- Both services mount one agent-home volume at `/home/pal`. Workspace, materialized uploads, downloads, browser profile, and temporary code-mode files live there.
- Use `TMPDIR=/home/pal/tmp` for the agent service and the native code-mode transport. Audit other temporary-file users; secret-bearing temporary data must use private storage.
- Service HOME, application code, credentials, canonical attachments, and database storage stay outside the shared home. Do not inherit the service environment into execution.
- Compose is the supported runtime. Host-side builds/tests remain available; remove direct-host agent execution and bare-VM runtime branches.
- Preserve existing state through a backed-up, one-time migration, including execution-container modifications outside persistent volumes.
- Backend restart leaves the execution container and user-started processes running. Active agent calls may be interrupted; automatic model-run recovery is out of scope.
- Vault/login services, browser restrictions, multi-user support, cloud providers, and a custom execution server are out of scope.
- This boundary protects service-owned state from ordinary execution access. Browser-held credentials remain accessible to the trusted agent, as agreed.

## Milestones

### 1. Validate Native Docker and Shared-Home Execution

Implementation tasks:

- [x] Pin a published @mastra/docker version compatible with the installed core; inspect actual package behavior rather than relying on upstream main.
- [x] Add one focused two-container smoke harness using a stable sandbox ID and a Compose-created labeled execution container.
- [x] Verify discovery/reconnection, execution user, stdout/stderr streaming, stdin, exit codes, cancellation, and concurrent commands.
- [x] Verify native createCodeMode with shared absolute temporary paths and compatible UID/GID; retain the existing tool dispatcher, allowlist, request context, and media exclusions.
- [x] Validate node/TypeScript support, runner cleanup, rejected tool calls, timeout, and abort. Record upstream gaps before introducing any workaround.
- [x] Prove shell/code cannot read a private service sentinel file or environment variable.
- [x] Check generated RPC frames are treated as untrusted requests and service-side validation remains authoritative.

Exit criteria:

- Native code mode executes only inside execution, calls an allowed service-side tool with the originating context, and completes without a custom transport.
- Shell/process behavior and backend-private storage separation pass the focused harness.
- Any dependency limitation has a concrete minimal resolution recorded here before proceeding.

Validation:

- `npm run runtime:smoke` passes with published @mastra/docker 0.8.0 and core 1.76.0: streamed shell/stdin, failure status, timeout/abort, private file/environment isolation, parallel native code-mode RPC with task context, a forged forbidden-tool frame, runner cleanup, reconnection, and a user process surviving a replacement service process.
- Matching service/execution UID is required because native runner directories are owner-only. Docker init reaps terminated children so native termination checks complete.
- Provider 0.12.0 fails at import against core 1.76.0 despite its peer range (missing FactorySandbox). Pin 0.8.0; no core upgrade or custom transport.
- Backend build/lint and harness syntax checks pass. Existing Pal containers and data were untouched.

### 2. Split Images, Deployment, and Lifecycle

Implementation tasks:

- [x] Split backend and execution image targets. Keep desktop startup, dependencies, and agent-browser in execution; remove Nest/model credentials from its startup environment.
- [x] Add agent-service, execution, and web wiring to Compose, retaining postgres and the development Vite overlay.
- [x] Use native DockerSandbox behind a narrow lifecycle adapter: require the expected labeled container, fail clearly if absent, and disconnect without stopping/removing it on backend shutdown. Compose exclusively owns creation, replacement, and deletion.
- [x] Give Docker management access only to agent-service. No Docker socket, backend-private volume, or backend environment in execution.
- [x] Keep database/admin ingress inaccessible from execution, including alternate gateway/host/Tailnet routes. Validate actual routing; network names alone are insufficient. Use a service-private ingress credential if topology alone cannot enforce the boundary, without adding a user sign-in flow.
- [x] Retain execution internet access and private agent-service-to-execution browser/desktop access.
- [x] Update gateway routing, health/readiness, model login, migrations, logs, and dev-local commands. Backend rebuilds preserve execution; execution-image updates explicitly recreate it.
- [x] Define behavior when execution is unavailable: web/chat history remain available; execution-dependent calls fail clearly, with no local fallback.
- [x] Audit global TMPDIR consumers, shared-home file permissions, and service runtime module/config paths. Never load executable backend code or credentials from agent-controlled home.

Exit criteria:

- Backend restart reconnects to the same desktop without terminating an unrelated user-started process.
- Execution cannot read private service state, administer Docker, reach postgres, or bypass restricted admin ingress.
- PWA API/SSE, VNC, login configuration, and development commands work with the split stack.

### 3. Move Workspace, Browser, and Desktop Operations

Implementation tasks:

- [x] Replace LocalSandbox/X11Sandbox with the Docker-backed workspace and one shared-home filesystem with containment enabled.
- [x] Route arbitrary execution-container paths through shell. Native file tools operate on shared home.
- [x] Execute model-authored code and browser CLI commands inside execution; keep service tools and integration clients in agent-service.
- [x] Adapt X11Computer through native sandbox execution, preserving screenshots, mouse, keyboard, clipboard behavior, and viewer URL.
- [x] Preserve browser session pinning, task groups, worker tab ownership, screenshots, and cleanup. Avoid premature replacement with a different browser provider.
- [x] Keep CDP private; connect through an authenticated/private transport as required by the split network. Do not expose a public debugging port.
- [x] Distinguish agent-owned process cleanup from unrelated desktop/user processes, including interrupted code-mode runs.
- [x] Update shared execution/file guidance only where paths or capabilities change; retain existing model-facing tool schemas.

Exit criteria:

- Main read_file, Task/Worker shell and code mode, browser groups, native media, and computer use operate on the same persistent environment.
- Task/worker cleanup preserves unrelated browser tabs and user processes.
- No model-authored program falls back to execution inside agent-service.

Validation for milestones 2–3:

- `npm run runtime:stack:smoke` builds the split images and runs disposable containers/volumes to verify public HTTPS, blocked gateway/backend/host routes, private storage/socket isolation, browser task/worker grouping, native desktop input and media, actual upload/inspection/publication/download, PWA history/SSE/upload/download/viewer routing, restart persistence, and history during execution outage.
- `npm run runtime:smoke` exercises the production adapter, remote native filesystem/media, missing-container refusal, forbidden RPC, timeout/abort cleanup, and a deterministic concurrent-publication-read rejection.
- Backend build/lint, focused browser/discovery tests, 12 affected agent/MCP integration tests, four file HTTP tests, and frontend check/check:ui/trim pass.
- Native LocalFilesystem operations execute in the execution namespace to avoid backend symlink/path races. Docker stdin/stdout supplies the transport; there is no execution server. The adapter uses the exported Docker process manager's container-binding seam because the provider lacks an attach-only lifecycle.
- Execution internet access uses Squid in the existing web container. Proxy-aware public HTTP(S) works; software that ignores proxy settings has no direct route.
- Existing Pal containers and volumes remain untouched. Migration and legacy smoke-script work remain below.

### 4. Preserve Files and Migrate Existing State

Implementation tasks:

- [x] Keep canonical uploads and published files private. Materialize input copies in shared home before forwarding readable paths; recreate missing copies from canonical storage when needed.
- [ ] Snapshot generated files into private storage on publication. Preserve file IDs, names, limits, delivery associations, and cleanup rules. Snapshots/IDs/limits/delivery pass; managed inspection-copy expiry cleanup remains.
- [x] Harden file imports and shared-home reads against path traversal, symlinks, ancestor replacement, special files, and concurrent modification. Prefer copying through execution-side file access where host-side resolution could expose service-private paths.
- [ ] Inventory legacy absolute paths in application records, manifests, private conversation memory, browser configuration, and installed utilities. Define a one-time rewrite or execution-local compatibility mapping without mounting old service secrets into execution.
- [ ] Back up PostgreSQL and persistent volumes; stop writers for migration. Preserve the old runtime image and container writable-layer changes so user-installed packages and configuration are recoverable.
- [ ] Migrate agent home/workspace to the shared home; move provider authentication and canonical uploads to private service storage. Preserve ownership, browser encryption/keyring state, hostname-sensitive profile behavior, and installed tools.
- [ ] Verify the migrated execution image/state contains no copied backend credentials, database environment, or service authentication files.
- [ ] Retain old container/volumes and document an offline rollback that restores matching application/database/file state. Do not delete old state during acceptance.

Exit criteria:

- Existing conversations, schedules, uploads, downloads, browser sessions, home files, and user-installed utilities remain usable.
- Historical attachment inspection resolves readable copies.
- Published attachments remain unchanged after execution edits/deletes its source.
- A malicious shared-home path cannot publish/read a private service sentinel.
- Migration and rollback are rehearsed against disposable copies before changing the user's running stack.


### 5. Validate Parity and Remove Superseded Runtime Paths

Implementation tasks:

- [ ] Run the focused split-runtime harness and existing relevant browser, worker, file, MCP/code-mode, and desktop smoke checks.
- [ ] Verify PWA upload -> agent inspection -> generated deliverable -> download, plus VNC login/session persistence and backend restart.
- [ ] Remove superseded local-execution branches and duplicate configuration. Keep host builds/tests supported.
- [ ] Update architecture/backend.md, architecture/deployment.md, .env.example, scripts, and relevant plan status after validation.
- [ ] Record any tool/guidance changes in the completion report using the repository-required table.
- [ ] Commit coherent validated changes. Deployment to an existing running stack remains a separately requested action.

Exit criteria:

- Required checks pass, current architecture documentation matches implementation, and all preserved workflows work on the split stack.
- Migration backups remain available; no destructive cleanup is required for completion.

## Tests

- One two-container runtime suite: native shell/process control, parallel code-mode RPC/context, forbidden tool, timeout/abort, private sentinel isolation, and backend restart persistence.
- Focused file regressions: shared path/symlink escape, upload materialization, and stable publication after source changes.
- Reuse browser/worker/desktop smoke coverage for task ownership, media, and interaction.
- One disposable migration/rollback rehearsal covering database, historical attachments, Chrome sessions, and an installed utility outside home.
- One PWA end-to-end file exchange and desktop/reconnect acceptance flow.

## Validation Commands

Run relevant targeted tests first. Implementation adds the split-runtime and migration harness commands and records their exact names here.

```bash
cd backend
npm run build
npm run lint
npm run runtime:smoke
npm run runtime:stack:smoke
npm run files:smoke
npm run browser:smoke
npm run workers:smoke
npm run desktop:smoke
npm run mcp:smoke
```

Use targeted Vitest service/end-to-end suites for changed file contracts and runtime lifecycle. Validate Compose configuration and dev-local up/rebuild/status against the isolated test stack. Run frontend check and the relevant Playwright flow for gateway/PWA changes.

## Overall Exit Criteria

- One persistent execution container holds all agent-controlled shell, code, browser, and desktop activity.
- Agent-service retains orchestration and private credentials without exposing its filesystem/environment or administrative authority to execution.
- One shared agent-home volume supports file exchange and unmodified native code-mode staging.
- Existing state is preserved, backend restarts preserve the desktop, and migration rollback is documented and rehearsed.
- Existing tool capabilities and PWA workflows remain usable; obsolete runtime branches are removed.
- No vault/login feature or custom execution server is introduced.
