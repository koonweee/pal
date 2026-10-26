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
- Changes are committed and deployed to production. Physical iPhone verification remains follow-up work.

### 3. Production rollout

Implementation tasks:

- [x] Build and deploy the verified AMD64 web image from `251863e`, retaining backend release identity `69efe6a`.
- [x] Remove the retired `pal-sf-pal-web-1` and `pal-sf-pal-1` containers while preserving persistent data.
- [x] Verify consistent ingress, served lifecycle code, API/SSE, desktop connectivity, worker activation and repeated reloads.
- [x] Restore normal Stack arguments and remove temporary operator plans and probes.

Exit criteria:

- Production serves one PWA release, all six current runtime services are healthy, and every non-web container retains its identity.
- Update publication, activation and three stable reloads pass; physical iPhone behavior remains unverified locally.

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

Strict TypeScript, all 31 unit tests, all 15 production-PWA browser tests, cache-boundary assertions, UI ownership and unused-code checks pass. Regression tests reproduced the unchanged-controller notice and stalled-activation reload loop against the original build. Slow activation coverage holds the worker in activating state and verifies the running app preserves a newly entered draft. Production deployment is verified; the reported iOS black screen has not been reproduced on a physical device.

## Production acceptance

Production serves frontend `251863e` through infrastructure revision `f892b90`, with retained backend release `69efe6a` and contract 6. Two retired containers shared the current web ingress labels and split health requests evenly between releases `69efe6a` and `a56efe2`; their start times matched the scheduled backup restart. Removing those containers leaves repeated requests consistently on the current release and prevents project-wide restarts from reviving duplicate ingress. Their bind data remain intact.

All six current runtime services are healthy, every non-web container identity is retained, both Pal ResourceSyncs have no pending changes, and normal Stack arguments are restored. Live update publication/SSE, desktop HTTP/RFB, served worker activation and three stable reloads pass. The isolated browser probe intercepts API writes and disables push because macOS headless Chromium advertises a BadgeService that terminates its renderer when called; it creates no server chat records. Physical iPhone Home Screen acceptance remains outstanding. Nonsecret evidence is retained in `.local/pwa-update-release/`.
