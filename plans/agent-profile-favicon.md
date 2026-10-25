# Agent profile favicon

## Status

Done

## Goal

Make the browser tab icon follow the shared agent profile image and accent-colored donut fallback.

## Current Behavior

The instance settings provider owns saved appearance, restores cached appearance, and receives settings refreshes through the existing chat stream. The profile uses the files content endpoint and falls back to an accent-colored donut.

## Milestones

### 1. Favicon synchronization

Implementation tasks:

- [x] Add a focused browser hook to the settings provider for the saved avatar and accent fallback.
- [x] Keep failed image loads on the fallback, retry on refreshed snapshots, and discard stale image callbacks.
- [x] Extend the existing appearance browser test for synchronization, reload, unavailable images, reconnect recovery, and reset.
- [x] Run focused browser coverage and frontend checks; review and commit the change.

Exit criteria:

The favicon follows saved settings across clients, survives reload, and falls back to the current accent donut when the image is absent or unavailable.

## Tests

The existing shared-appearance Playwright scenario covers favicon synchronization and fallback.

## Validation Commands

```bash
cd frontend
npm run check
npm run check:ui
npm run trim
npx playwright test test/preferences.spec.ts --grep 'shares agent appearance'
```

## Validation Results

Frontend TypeScript, UI architecture, and unused-code checks pass. The shared-appearance browser scenario passes, including favicon updates across clients, reload, unavailable-image fallback, reconnect recovery, and resets.

## Overall Exit Criteria

The focused browser scenario and frontend checks pass. Architecture documentation describes favicon ownership and behavior. Changes are committed locally.
