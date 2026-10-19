# PWA Frontend Updates

## Status

Done

## Goal

Make production-style development PWA updates immediately discoverable, give automatic updates a visible three-second countdown, and use the same compact notice layout as Kodex with Pal's semantic theme tokens.

## Current Behavior

- `scripts/dev-local pwa-up` rebuilds the `frontend-stage` image and publishes its image revision after health succeeds.
- The frontend checks its service worker after release events, focus, page show, online recovery, and every successful event-stream connection.
- Automatic updates count down for three visible seconds once Pal's explicit reload-safety snapshot is clear.
- The update notice uses a compact one-row Pal-themed layout.

## Target Data Shape

`POST /frontend-updates` accepts one opaque `revision` string and publishes the existing `frontend.updated` event with the current contract version. The revision is an update-check hint and does not replace the full-stack deployment release identity.

## Milestones

### 1. Live frontend deployment signal

Implementation tasks:

- [x] Add the minimal first-party endpoint for publishing an update marker.
- [x] Have `serve` and `pwa-up` publish the built staging image revision after health succeeds.
- [x] Cover the endpoint through the existing SSE contract test.

Exit criteria:

- An open PWA receives `frontend.updated` after a successful staging rebuild without restarting the backend.

### 2. Countdown and compact notice

Implementation tasks:

- [x] Add a visible-tab three-second countdown for safe automatic updates.
- [x] Preserve Pal's existing reload blockers and manual activation behavior.
- [x] Port Kodex's compact one-row notice structure using Pal semantic tokens.

Exit criteria:

- Automatic updates show 3, 2, and 1 before activation and restart the full countdown after becoming safe or visible.
- Manual, required, deferred, and failure states remain actionable in the compact notice.

### 3. Recover frontend-only updates missed during reconnect

Implementation tasks:

- [x] Request a service-worker update check whenever EventSource opens or reconnects.
- [x] Cover an update published while the event stream is disconnected.

Exit criteria:

- Reconnecting after a frontend replacement discovers the waiting worker even when the one-shot deployment event was missed.

## Tests

- Backend integration coverage for publishing the live update event.
- Production PWA browser coverage for the countdown and activation.
- Production PWA browser coverage for update discovery after EventSource reconnects.
- Existing reload-safety and two-tab update coverage.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm run test:e2e -- client-contract.e2e-spec.ts

cd ../frontend
npm run check
npm run test:unit
npm run test:pwa
npm run check:ui
npm run trim
```

## Overall Exit Criteria

- Frontend-only staging builds notify open clients without restarting Pal.
- Automatic updates visibly count down for three seconds and never activate while Pal reports active work.
- The notice matches Kodex's compact layout while using Pal-owned theme tokens and copy.

## Validation Evidence

- Backend build, lint, generated-contract checks, and the eight-test first-party contract suite pass.
- Frontend type checks, seven unit tests, UI ownership checks, and unused-code checks pass.
- All seven production PWA scenarios pass, including reconnect discovery, countdown, reload safety, two-tab preservation, compatibility recovery, retry, and offline boundaries.
- The UI workbench browser check verifies the update notice stays within 360 px and keeps its label and action aligned in one row.
