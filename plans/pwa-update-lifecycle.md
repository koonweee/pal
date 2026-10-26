# PWA update lifecycle

## Status

Done

## Goal

Prevent repeated update notices and premature reloads on installed iOS PWAs. Keep the existing app usable when activation stalls.

## Current Behavior

- One lifecycle hook owns registration, discovery, activation and reload safety.
- The service worker precaches the static shell and leaves SSE to browser networking.
- Updates reload once the requested worker is activated and controls the page, after checking current reload safety.
- Controller identity and waiting-worker state determine update notices.
- Activation that stalls for ten seconds reports a retryable failure while the current app remains open.

## Milestones

### 1. Confirmed activation and live update state

Implementation tasks:

- [x] Compare controller identities and reconcile notices against live worker state.
- [x] Reload once after the requested worker activates and controls the page, including when controllerchange is missing.
- [x] Surface stalled activation as a retryable error and recheck safety before reloading.

Exit criteria:

- Duplicate controller notifications produce no update notice.
- A stalled activation keeps the current page usable and can be retried.
- Active work survives activation by another client or delayed activation in the current client.

### 2. Validation

Implementation tasks:

- [x] Add targeted production-PWA regressions and run frontend checks.
- [x] Document the lifecycle contract and remaining physical-device acceptance.

Exit criteria:

- Type, unit, PWA, ownership and unused-code checks pass.
- Changes are committed locally. Deployment and physical iPhone verification remain separate follow-up work.

## Tests

- Unchanged controller notifications, stalled activation and retry, a worker held in activating state with new work.
- Existing missing-controllerchange, automatic countdown, multi-tab safety and offline boundaries.

## Validation Commands

```bash
cd frontend
npm run check
npm run test:unit
npm run test:pwa
npm run check:ui
npm run trim
```

## Overall Exit Criteria

- Reloads require confirmed activation and current reload safety.
- Failed activation allows retry without losing the running app.
- Relevant automated checks pass; physical iOS behavior is explicitly unverified locally.

## Validation

Strict TypeScript, all 31 unit tests, all 15 production-PWA browser tests, cache-boundary assertions, UI ownership and unused-code checks pass. Regression tests reproduced the unchanged-controller notice and stalled-activation reload loop against the original build. Slow activation coverage holds the worker in activating state and verifies the running app preserves a newly entered draft. Deployment and physical iPhone Home Screen verification remain follow-up work; the reported iOS black screen has not been reproduced on a device.
