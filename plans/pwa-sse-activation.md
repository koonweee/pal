# PWA activation with open SSE connections

## Status

Done

## Goal

Allow accepted PWA updates to activate while chat stays connected, and deploy the repair to development and production.

## Current Behavior

- `/api/stream` and `/stream` use direct browser networking and remain outside navigation fallback.
- Other dynamic requests retain the NetworkOnly strategy; only the versioned shell is cached.
- Accepted updates activate with SSE open; the existing three-second fallback handles a missing controllerchange event.

## Milestones

### 1. Keep SSE outside worker fetch handling

Implementation tasks:

- [x] Exclude `/api/stream` and `/stream` from the worker's dynamic NetworkOnly route; retain the navigation denylist and cache boundaries.
- [x] Strengthen existing PWA coverage to verify direct SSE networking and activation before the fallback reload.
- [x] Validate the production build, PWA suite, types, ownership, and unused code.

Exit criteria:

- [x] Updates activate with an open SSE connection, including when controllerchange is suppressed; offline dynamic routes remain unavailable.

### 2. Deploy and verify

Implementation tasks:

- [x] Commit/push reviewed code and rebuild development staging.
- [x] Publish immutable AMD64 production backend/web images with matching release identity through the existing Komodo workflow.
- [x] Deploy only backend/web, retaining the execution desktop, database, egress, MCP, and stored state.
- [x] Verify live service-worker routing, API/SSE, update activation, desktop connectivity, and cleanup.

Exit criteria:

- [x] Both environments serve the repair; production is healthy and normal deployment settings are restored.

## Tests

- Extend the existing installation/cache-boundary scenario to assert controlled-page SSE bypasses the worker.
- Extend the existing missing-controllerchange scenario to require activation with SSE open before advancing the reload fallback timer.
- Run the production PWA suite and frontend checks.

## Validation Commands

```bash
cd frontend
npm run test:pwa
npm run check:ui
npm run trim
cd ..
./scripts/dev-local pwa-up
```

## Overall Exit Criteria

- [x] Open SSE connections cannot hold the new worker's activation path.
- [x] Cache boundaries, reload safety, multi-tab behavior, notifications, and offline shell behavior pass.
- [x] Development and production deployment verification pass.

Validation: production build, all 12 PWA browser tests, strict TypeScript, UI ownership, and unused-code checks pass.

Deployment validation: development staging and production release `5e02b04` serve direct browser SSE on both paths. Live worker readiness, API/SSE contract 6, desktop HTTP/RFB connectivity, and page-error checks pass. Production retains execution, PostgreSQL, egress, and Google MCP container identities. Infrastructure deployment revision is `0f14e24`; normal Stack settings and clean resource syncs are verified.
