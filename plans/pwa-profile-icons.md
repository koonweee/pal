# PWA profile icons

## Status

In Progress

## Goal

Use the saved profile PNG directly for PWA installation icons, preserving its bytes and transparency, and deploy to development for iPhone acceptance.

## Current Behavior

The browser favicon follows saved appearance. The PWA installation uses bundled PNGs selected by frontend build identity.

## Milestones

### 1. Dynamic installation metadata

- [x] Serve a network-only manifest with the saved attachment URL and actual PNG dimensions; retain stable Pal/Pal Dev installation identity.
- [x] Resolve Apple touch icons to that attachment; preserve bundled fallback icons for absent or unavailable uploads.
- [x] Replace static metadata generation and gateway routes with the backend-owned metadata; cover reset and unchanged image bytes.

Exit criteria: manifest and Apple icon use the original uploaded PNG without resizing, padding, or compositing.

### 2. Validation and development rollout

- [x] Run focused backend/frontend checks and production PWA coverage.
- [ ] Commit the implementation and rebuild development backend and PWA, preserving the execution desktop.
- [ ] Verify live dev metadata and original image bytes. iPhone Home Screen light/dark acceptance remains with the user.

Exit criteria: development serves the implementation and retains Pal Dev identity; production deployment remains outside this rollout.

## Tests

Extend settings E2E coverage for manifest identity, PNG dimensions, direct image bytes, Apple redirect, reset and missing files. Extend the PWA cache-boundary scenario for dynamic metadata.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm run test:e2e -- instance-settings.e2e-spec.ts
cd ../frontend
npm run check
npm run check:ui
npm run trim
npm run test:pwa
```

## Overall Exit Criteria

Focused checks pass, development uses the current uploaded image unchanged, and the user can install it on iPhone for appearance testing.

## Validation results

Backend build, type-aware lint and adapter boundaries pass. All four focused settings E2E cases pass against isolated PostgreSQL, including direct image bytes, dimensions, Apple redirects, fallback, reset and Pal Dev identity. Frontend TypeScript, UI ownership and unused-code checks pass. The shared-appearance browser scenario and all 10 production PWA cases pass, including network-only installation metadata.
