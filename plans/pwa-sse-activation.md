# PWA activation with open SSE connections

## Status

In Progress

## Goal

Allow accepted PWA updates to activate while chat stays connected, and deploy the repair to development and production.

## Current Behavior

- The active worker forwards SSE through Workbox NetworkOnly, keeping a fetch event open and delaying replacement-worker activation.
- The three-second reload fallback can reconnect through the old worker and show the same waiting update again.
- Local reproduction fails with normal controller events; closing SSE or bypassing worker fetch handling allows activation.

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

- [ ] Commit/push reviewed code and rebuild development staging.
- [ ] Publish immutable AMD64 production backend/web images with matching release identity through the existing Komodo workflow.
- [ ] Deploy only backend/web, retaining the execution desktop, database, egress, MCP, and stored state.
- [ ] Verify live service-worker routing, API/SSE, update activation, desktop connectivity, and cleanup.

Exit criteria:

- [ ] Both environments serve the repair; production is healthy and normal deployment settings are restored.

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
- [ ] Development and production deployment verification pass.

Validation: production build, all 12 PWA browser tests, strict TypeScript, UI ownership, and unused-code checks pass.
