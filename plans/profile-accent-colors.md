# Profile image accent choices

## Status

Done

## Goal

Offer up to five distinct colors from the saved profile PNG as dots below the accent selector. Selecting a dot edits the existing appearance draft; Save appearance persists it.

## Current Behavior

InstanceSettingsForm reads the shared profile image ID and owns the accent draft. IconAction owns accessible icon-only controls and touch targets. Uploaded PNGs are same-origin, immutable files.

## Milestones

### 1. Derive and display choices

Implementation tasks:

- [x] Sample the image at up to 32 × 32 pixels, ignore transparent pixels, and choose up to five distinct common colors.
- [x] Render accessible dots using existing controls and the appearance draft callback.
- [x] Hide choices for missing/unavailable images and discard stale image results.

Exit criteria:

The choices are image-derived, contain no visible text, and preserve the existing Save flow without backend changes or new dependencies.

### 2. Verify and publish the dev preview

Implementation tasks:

- [x] Cover palette behavior and a touch browser selection/save/reset flow.
- [x] Run relevant frontend checks, review complexity, commit, and update the existing staged PWA.

Exit criteria:

Checks pass and the dev PWA serves the change.

## Tests

- Focused palette tests for transparency, similar colors, ranking, and the five-color limit.
- One browser case for image-derived dots, touch targets, draft selection/save, and missing images.

## Validation Commands

```bash
cd frontend
npm run check
npm run check:ui
npm run test:unit
npx playwright test test/preferences.spec.ts
```

## Overall Exit Criteria

A bounded Canvas sample supplies at most five choices. The shared settings provider remains the owner of saved appearance. Image failures produce no suggestions. No palette persistence, additional event stream, image-processing dependency, or model controls are introduced.

## Validation and Complexity Review

Frontend type checks, UI ownership checks, unused-code checks, all nine unit tests, all three preferences browser cases, and the attachment lightbox regression pass. The staged PWA build passes; a background browser confirms five text-free choices, 44 px touch targets, and draft selection in the compiled UI. A normal service-worker-enabled PWA loads successfully.

Sampling is bounded to 32 × 32 pixels. Palette extraction is a pure helper; rendering reuses IconAction and ColorSwatch. The existing settings provider owns saved appearance. Three content-URL consumers share the existing API module helper. No dependencies, backend changes, palette persistence, or additional synchronization are required.
