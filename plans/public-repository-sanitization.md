# Public Repository Sanitization

## Status

Done

## Goal

Make the tracked repository suitable for a public source release by removing user-specific branding and private deployment evidence while preserving Pal's reusable application behavior. Keep the repository unlicensed.

## Current Behavior

- The web app already stores the assistant name and optional avatar in instance settings, with a neutral fallback.
- The iOS client, app icons, notification fixtures, and some tests still contain a user-specific assistant identity.
- Plans and documentation contain private hostnames, signing identifiers, deployment revisions, artifact hashes, and environment-specific validation records.
- Pal relies on Tailscale as its access boundary and does not implement application authentication.

## Milestones

### 1. Remove user-specific branding

Implementation tasks:

- Replace bundled assistant artwork and static icons with neutral Pal assets.
- Use generic fixture identities and make native notification titles consume instance settings.
- Remove predecessor-brand references from current code and documentation.

Exit criteria:

- No user-specific assistant artwork or identity remains in the tracked tree.
- Web, backend, and iOS focused checks pass.

### 2. Sanitize operational metadata

Implementation tasks:

- Remove private hostnames, infrastructure names, signing-team identifiers, deployment hashes, state counts, and publication records.
- Retain concise architecture and validation statements that describe reusable behavior.
- Add a short Tailscale-only warning and ignore local Kodex artifacts.

Exit criteria:

- Repository scans find no known private deployment identifiers or user-specific signing metadata.
- Documentation remains internally consistent and contains no license grant.

## Tests

- Backend build, lint, and focused notification tests.
- Frontend type, PWA, UI-ownership, and trim checks.
- iOS project build and focused unit tests where the local toolchain permits.
- Repository scans for removed branding and private identifiers.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- --run test/notifications.spec.ts

cd ../frontend
npm run check
npm run test:pwa
npm run check:ui
npm run trim

cd ..
xcodebuild -project ios/Pal/Pal.xcodeproj -scheme "Pal Dev" -destination 'platform=iOS Simulator,name=iPhone 18 Pro' test
```

## Overall Exit Criteria

- The current tree contains neutral Pal defaults and no user-specific assistant assets.
- Public documentation contains only reusable deployment guidance plus the Tailscale-only warning.
- Private deployment evidence and signing identity are absent from the current tree.
- The repository remains unlicensed.

## Validation

- Backend build, lint, 21 focused service tests, and six affected end-to-end tests pass.
- Frontend types, ownership, trim, six affected browser tests, production PWA validation, and all nine PWA browser tests pass.
- The full Pal Dev iOS simulator scheme passes; generated icons are opaque PNGs at their declared dimensions.
- Repository scans find none of the removed branding, private deployment identifiers, signing identity, or common secret signatures in the current tree.
