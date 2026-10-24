# PWA iOS Top Edge

## Status

Done

## Goal

Keep the installed iOS PWA's top safe-area edge opaque from the first document paint in light and dark appearance.

## Current Behavior

- The top-edge surface is mounted by React after the initial HTML paint.
- iOS may establish its standalone scroll-edge compositing before that surface exists.
- `frontend/index.html`, `frontend/src/PlaygroundShell.tsx`, and `frontend/src/styles/pwa.css` own the current behavior.

## Milestones

### 1. Paint the surface before React

Implementation tasks:

- Move the safe-area surface into the initial HTML shell.
- Keep Preferences background synchronization without remounting the surface.

Exit criteria:

- The standalone surface precedes the React root and remains above app content and overlays.

### 2. Validate production PWA behavior

Implementation tasks:

- Run the focused responsive regression and production PWA checks.

Exit criteria:

- Automated dark-mode iPhone/iPad checks retain an opaque top edge and the production PWA suite passes.

## Tests

- Assert the surface belongs to the initial document shell.
- Reuse the existing iPhone/iPad stacking, overlay, and light/dark regression.
- Run the production PWA suite.

## Validation Commands

```bash
cd frontend
npm run check
npx playwright test test/responsive.spec.ts --grep "opaque top edge"
npm run test:pwa
```

## Overall Exit Criteria

- The top-edge surface exists before React mounts and keeps the installed iOS status-bar edge opaque through launch and overlays.
