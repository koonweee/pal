# Production Dev Release

## Status

In Progress

## Goal

Publish all validated dev changes to the repository and deploy the complete release through the existing production configuration, preserving application data and browser state.

## Current Behavior

- Dev includes secure browser login, native authentication skills, smaller observational-memory budgets, PWA activation recovery, and routed execution egress.
- Production uses the prior split runtime and Squid gateway. The routed network upgrade replaces execution and its network; persistent home and service data remain.
- Komodo manages production. Protected deployment metadata and Docker operations require an operator sudo step on the host.

## Milestones

### 1. Validate and publish the release

Implementation tasks:

- [x] Inspect production configuration, image/platform requirements, persistent storage, and required secret presence.
- [x] Run backend integration/end-to-end and frontend component/browser/PWA checks.
- [x] Build and publish immutable AMD64 agent-service, execution, web and egress images from the validated revision.
- [x] Push completed commits to the repository.

Exit criteria:

- Release checks pass or any unrelated limitation is explained, source is pushed, and every production image has an immutable digest.

### 2. Prepare and deploy production

Implementation tasks:

- [x] Update the Komodo-owned configuration with immutable images, current service/network definitions and matching release identity.
- [x] Preserve previous deployment definitions/images and a paired backup of stopped home, service data and PostgreSQL.
- [x] Apply explicit database migrations and migrate the execution network without deleting persistent state.
- [ ] Deploy and verify application/API/PWA, native browser/desktop/filesystem, network isolation and router recovery on production AMD64.

Exit criteria:

- Production runs the release with usable ingress, retained state and validated native workflows. Required operator setup and any acceptance outside the Pal deployment scope are reported explicitly.

## Tests

- Full backend checks against a disposable database.
- Frontend component/browser and production-PWA suites.
- Metadata-only before/after data checks plus existing native runtime smoke checks on the deployed stack.
- Verify private destination filtering and independent egress restart without replacing execution.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run
npx vitest run --config ./vitest.config.e2e.ts
cd ../frontend
npm run check:ui
npm run test:unit
npm test
npm run test:pwa
```

## Overall Exit Criteria

- All dev changes are committed and pushed.
- Production configuration and immutable images agree on the release.
- Data, browser profile and integration settings survive the upgrade; backups and rollback instructions remain available privately.
- Production health and functional checks pass, with human setup blockers reported.

## Release Validation

- Application source revision: `73bc06e`.
- Backend build/lint, 67 integration tests and 36 end-to-end tests pass against a disposable database.
- Frontend ownership checks, 27 component tests, strict production TypeScript/build checks and all 10 PWA tests pass. Both secure-entry browser cases pass.
- The full browser suite reports 59/65 passing. All six failing layout/focus cases reproduce on the published `origin/main` baseline: mobile desktop focus, two standalone safe-area cases, two workbench cases and intermittent keyboard-anchor retention. The keyboard case also fails on an isolated current-source rerun and two of three additional baseline runs. These existing failures remain outside this release's changed scope.
- AMD64 agent-service, execution, web and egress images build successfully with a shared application revision and production PWA identity.
- Production runs application release `73bc06e` through infrastructure revision `7e7504e`. Migrations and the execution-network upgrade complete with retained persistent directories. Paired backups pass integrity checks; trusted HTTPS/API/PWA/desktop WebSocket checks and vault prewarm pass. Native acceptance remains in progress.

## Published Artifacts

All application commits are pushed to `origin/main`. Four AMD64 images from `73bc06e` are published and their immutable remote manifests are verified. Agent-service, execution and web use their existing package names with tag `73bc06e`; the router uses `pal:73bc06e-egress` because the registry rejected publishing a new router package. Immutable pins and staged runtime verification assets are retained privately for the pending production cutover.

## Production acceptance

- Recovery material is retained at `/srv/backups/pal-sf-release-20261024-001032`; the earlier verified backup is also preserved. Legacy writers are stopped with restart disabled.
- All six runtime services are healthy, API/PWA release identity is `73bc06e`, and the first-party contract is 5. Native API/PWA/SSE checks pass. The desktop WebSocket returns a real RFB greeting without reading screen contents.
- Native filesystem, numeric public TCP/UDP, private/IPv6/capability boundaries, synthetic credential/OTP filling, compaction budgets, record retention and execution/Chrome survival across an egress restart pass. Hostname HTTPS/browser checks expose the inherited private Tailnet resolver; explicit public execution DNS is required before final acceptance.
- Restore the temporary unused-image-pruning pause and remove exact delivery/private-plan artifacts after acceptance. A shared host/daemon reboot remains a separate maintenance-window check.
