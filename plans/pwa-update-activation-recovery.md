# PWA Update Activation Recovery

## Status

Done

## Goal

Make an accepted PWA update activate once on iPhone Home Screen installations instead of presenting the same waiting update after every relaunch.

## Current Behavior

- The worker extends the activation message event until `skipWaiting()` completes.
- The page requests activation and uses a bounded reload fallback when `controllerchange` is absent.
- Open SSE connections use browser networking; [SSE activation validation and deployment](pwa-sse-activation.md) tracks the network boundary.

## Milestones

### 1. Reliable Activation

Implementation tasks:

- Extend the service-worker message event until `skipWaiting()` completes.
- Reload after a bounded delay when activation does not produce `controllerchange`.

Exit criteria:

- Accepted updates keep the worker alive through activation and cannot leave the current page indefinitely waiting for a controller event.

### 2. Validation and Dev Deployment

Implementation tasks:

- Add a focused build assertion for the activation lifetime contract.
- Run the relevant frontend and production-PWA checks.
- Publish the validated production-style PWA to the dev Tailnet origin.

Exit criteria:

- Checks pass and the dev PWA serves the repaired worker.

## Tests

- Assert the source worker extends the `SKIP_WAITING` message event.
- Run the existing production-PWA lifecycle suite, including waiting-worker activation and multi-tab safety.

## Validation Commands

```bash
cd frontend
npm run check
npm run test:pwa
cd ..
./scripts/dev-local pwa-up
```

## Overall Exit Criteria

- An accepted waiting worker has a lifetime-safe activation request and a bounded page reload fallback.
- Existing update, reload-safety, multi-tab, compatibility, and offline behavior remains valid.
- The dev PWA is rebuilt, healthy, and announces the repaired update.

## Validation

Frontend type checks and the production build pass. All 10 production-PWA browser tests pass, including the missing-`controllerchange` regression. The dev PWA is published and healthy, and its served worker contains the lifetime-safe activation handler.
