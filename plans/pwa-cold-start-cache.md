# PWA Cold-Start Cache

## Status

Done

## Goal

Restore Pal's appearance and a bounded snapshot of the latest Main conversation before network synchronization so installed-PWA cold starts retain visual continuity.

## Current Behavior

- The service worker precaches the versioned application shell and keeps dynamic routes network-only.
- Theme mode is local, while instance appearance and Main history begin from generic or empty defaults until their server snapshots arrive.
- Main opens the event stream before loading history and buffers live message events during snapshot reconciliation.

## Target Data Shape

- Store a versioned local appearance record containing agent name, avatar attachment ID, and accent color.
- Store a versioned local Main-history record containing at most the latest 30 canonical messages and a save timestamp, bounded to approximately 1 MiB of serialized browser storage.
- Treat both records as presentation snapshots. Server reads remain authoritative and every dynamic route remains network-only.

## Milestones

### 1. Appearance bootstrap

Implementation tasks:

- Validate and persist the latest authoritative instance appearance.
- Initialize the provider from the local appearance and apply saved theme information during document bootstrap.

Exit criteria:

- A cold render uses the last known agent identity, accent, and color scheme without waiting for the settings request.
- Invalid or unavailable browser storage falls back to the built-in appearance.

### 2. Main conversation bootstrap

Implementation tasks:

- Persist a size- and count-bounded canonical Main snapshot.
- Restore it with interaction disabled until the first authoritative history snapshot replaces it.
- Show a restrained connection state instead of the true-empty-conversation treatment while no history snapshot is available.

Exit criteria:

- Cached Main messages render during a held history request, cannot be used for reply or send actions, and are replaced by the server snapshot plus buffered live events.
- Corrupt and oversized cache data cannot break chat startup.

### 3. Policy and validation

Implementation tasks:

- Document the bounded presentation-cache exception to the static-shell service-worker policy.
- Add the smallest focused cache and browser synchronization coverage.

Exit criteria:

- Frontend type, unit, browser, ownership, unused-code, and production PWA checks relevant to the change pass.

## Tests

- Unit coverage validates appearance/history cache reads, corruption handling, and history trimming.
- One browser scenario holds the initial history response, observes the cached display-only snapshot, interleaves a live event, and verifies authoritative replacement.
- Existing production PWA coverage continues to prove dynamic routes remain network-only.

## Validation Commands

```bash
cd frontend
npm run check
npm run test:unit
npm test -- --grep "cached Main history"
npm run check:ui
npm run trim
npm run test:pwa
```

## Overall Exit Criteria

- Cold starts immediately retain the last authoritative appearance and bounded Main history when available.
- Cached conversation data never enables mutations or substitutes for the first server history snapshot.
- Service-worker cache boundaries and server authority remain unchanged.

## Validation Evidence

- `npm run check`, `npm run check:ui`, and `npm run trim` pass.
- All 23 focused Vitest checks pass, including cache validation, trimming, corruption, and quota handling.
- All 17 chat Playwright scenarios pass, including cached appearance/history, display-only authority, snapshot replacement, and buffered live events.
- The production build, static cache-boundary check, and all 9 PWA Playwright scenarios pass.
