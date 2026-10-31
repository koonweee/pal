# Task Execution and Interaction Worker

## Status

Done

## Goal

Deploy a Sol-medium Task with local execution, web search and MCP, plus a Terra-medium interaction worker for browser, computer and website login. Workers receive explicit assignments with zero inherited history and return private findings.

## Current Behavior

- Main routes work to persistent Task threads. Task owns orchestration, files, services, public updates, task metadata and schedules.
- The native child role is interaction only, with browser/computer/login tools and code mode. It has no shell/files/web-search/MCP tools or child agents.
- Existing native cancellation, three-worker cap, trusted browser identities, tab ownership and cleanup remain the lifecycle owners. Role tool placement uses the shared execution environment and is not a security sandbox.
- Production runs Sol-medium Main/Task and a Terra-medium interaction worker with the verified role-specific tool and skill boundaries. Benchmark semantic review remains tracked separately.

## Milestones

### 1. Runtime and guidance

- [x] Split native Task/interaction workspaces and model settings.
- [x] Keep MCP discovery on Task and share code-mode construction with the interaction role.
- [x] Remove inherited delegation history, move authentication guidance/skills to interaction and make assignments explicit.
- [x] Preserve secure-entry tabs across user input and fresh assignments; cancel pending entry on failed or interrupted workers.
- [x] Update the existing native regression and browser smoke checks, keeping one owner for shared policies.

Exit: build/lint and focused native checks verify actual tools/models, no inherited history, MCP execution on Task, native media, no recursion and cleanup/cancellation.

### 2. Dev validation

- [x] Rebuild through `./scripts/dev-local rebuild` while preserving execution/profile state.
- [x] Verify running inventories and bounded real-model MCP/file-to-browser/computer handoffs and cleanup.

Exit: dev health and role/handoff checks pass with retained desktop state.

### 3. Production deployment

- [x] Publish/stage the validated Terra-medium release through existing Komodo configuration with rollback metadata.
- [x] Update agent-service and matching web release identity while retaining execution/profile/data.
- [x] Finish the host-only native role/record audit; production health and scoped read-only HTTP acceptance pass.

Exit: production runs the validated release with healthy services and verified boundaries. Komodo uses the configured native operator. Host-only preflight and deployed-role inspection use the owner’s read-only sudo verifier.

## Tests

Extend native worker tests for separate model routing and zero inherited history; verify role workspace inventories and authentication skill placement. Reuse Task MCP/code-mode and lifecycle coverage. Run bounded deployed handoff checks before production.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/task-workers.spec.ts test/agent-skills.spec.ts test/task-tool-discovery.spec.ts test/main-session.spec.ts test/task-agents.spec.ts test/agent-activity-runtime.spec.ts
cd ..
./scripts/dev-local rebuild
```

## Overall Exit Criteria

- Task owns MCP/local execution and delegates UI/authentication to Terra medium without inherited history.
- Checks, dev and production deployment are verified; current architecture and release evidence are recorded.
- Data, browser sessions/profile, cancellation and cleanup behavior are preserved.

## Validation

- Backend build/lint and boundaries pass; 73 integration tests and 41 end-to-end tests pass on disposable databases, including secure-entry continuation and submission/cleanup ordering.
- Dev runs the role split. Native inspection verifies Sol-medium Task, Terra-medium interaction, role-specific tools/processors/skills, zero inherited messages and no active runs/pending entry. The interaction inventory includes browser, computer, `login_inspect` and `secure_fill`; the execution container remains retained.
- Disposable real-service MCP/code-mode and Task PDF/image/publication/restart checks pass. Native browser/media/ownership/cancellation checks and two real screenshot/form Task fixtures pass. Two/three concurrent Luna interaction branches, private synthesis, Main responsiveness and browser restart/suspension checks pass after updating the fixture to the current native sendToUser tool.
- The wrapper's host PWA navigation timed out before agent checks; no frontend source changes are part of this release.
- Production release `eb9afb1` is healthy through GitOps revision `9df4c1f`. Live inspection verifies Sol-medium Main/Task, Terra-medium interaction, zero inherited messages, private worker results and the expected Task/interaction tool, processor and skill inventories.
- HTTPS/PWA identity, contract 7, SSE, desktop HTTP/RFB routing, real execution browser credential/OTP filling, migrations and Bitwarden prewarm pass. The unchanged execution image, profile, service data and PostgreSQL bind mounts were retained.
- Rollback configuration and a verified 2.0 GB paired state archive are retained at `/srv/backups/pal-sf-release-20261031-155100` with SHA-256 `b63efd1290640f2986506897210f3f814fabdcd12921281e3cdf2193bd4d9783`.
