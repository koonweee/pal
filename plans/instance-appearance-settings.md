# Instance appearance settings

## Status

Done

## Goal

Share the agent display name, uploaded PNG, and accent color across one Pal instance. Use the accent-colored donut when an image is absent or unavailable. A shared frontend provider supplies the name to the header and the `message <name>` composer placeholder, preserving user capitalization. Preserve the 36px avatar, 10px visual gap, and existing header actions.

## Current Behavior

- The backend stores shared agent identity and accent settings in one typed singleton.
- The global frontend provider supplies the header, composer, theme, and settings tabs; color scheme is device-local.
- FilesService retains message and avatar references and expires unreferenced uploads after 24 hours.

## Target Data Shape

A singleton `instance_settings` record has explicit agent name, nullable avatar attachment ID, accent color, and version columns. GET/PATCH `/instance-settings` expose its snapshot; `instance.settings.updated` is a refetch hint. The existing files API handles uploads/content. Avatar references participate in retention.

## Milestones

### 1. Settings and file retention

Implementation tasks:

- [x] Add the singleton schema/migration, application service/repository, and first-party endpoints/event.
- [x] Validate name, hex color, and PNG signature/dimensions/size; serialize avatar assignment against cleanup.
- [x] Retain active avatar attachments and release replaced images through normal cleanup.

Exit criteria:

Defaults, partial saves, validation, persistence, event publication, and avatar retention pass PostgreSQL-backed checks.

### 2. Shared web appearance

Implementation tasks:

- [x] Add one settings state owner and reuse chat's existing SSE connection for refetch hints/reconnect recovery.
- [x] Add name/PNG editing in an Agent tab and accent editing in Appearance, with preview, Save, and scoped Reset; keep color scheme local.
- [x] Replace the bundled default image with an optional uploaded image and donut fallback; remove the unused asset/cache addition.
- [x] Update generated API contracts and concise architecture documentation.

Exit criteria:

Two browser clients share saved settings, invalid uploads show errors, defaults/reset work, and uploaded-file failures fall back to the donut.

### 3. Validation and complexity review

Implementation tasks:

- [x] Run targeted backend/frontend tests and required contract/PWA checks.
- [x] Review state ownership, retention races, and unnecessary abstractions; remove avoidable complexity.
- [x] Commit focused changes and refresh the existing dev stack/PWA.

Exit criteria:

Checks pass, the local staged PWA serves the implementation, and unrelated workspace changes are preserved.

## Tests

- One backend E2E suite for defaults, partial saves, PNG/input validation, SSE, and retention/replacement.
- Extend the existing appearance browser test for persistence across clients, uploaded image/reset, and the donut fallback.
- Existing header, PWA, and API contract coverage.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm run test:e2e -- instance-settings.e2e-spec.ts files.e2e-spec.ts
npm run openapi:check
cd ../frontend
npm run check
npm run check:ui
npm run api:check
npm run test:pwa
npx playwright test test/preferences.spec.ts test/responsive.spec.ts
```

## Overall Exit Criteria

Shared settings survive restart, propagate to connected web clients, retain referenced uploads, and leave abandoned/replaced files eligible for cleanup. No bundled default avatar or new agent tools/guidance are introduced. The implementation uses existing upload, theme, SSE, and form/reload-safety owners.

## Validation results

Backend build/lint, generated OpenAPI, and 9 targeted settings/file/API-contract E2E cases pass against isolated PostgreSQL. Frontend strict checks, API generation checks, UI ownership checks, unused-code checks, 7 unit cases, and 7 production PWA cases pass. The 25 focused browser cases pass with isolated artifacts; final Agent-tab/reset/reconnect coverage and the six affected responsive/working-state cases pass after the UI split. Early parallel browser runs collided on trace output; isolated directories resolved the failures. One obsolete overlay selector was aligned with the existing shared backdrop class.

The development backend migration and rebuild completed. The staged PWA verifies both native and browser settings routes, current Name/Image labels, global header/composer name, separate tabs, default donut, 36px image geometry, 10px gap, and the 44px touch target at desktop and 320px touch widths. Verification uses background-only headless interaction and does not send agent messages.

## Complexity review

One typed database singleton owns saved settings; one React provider owns their frontend snapshot. The existing chat SSE connection supplies invalidation/reconnect recovery, and version comparisons prevent older responses from replacing newer settings. Agent and Appearance use the same focused form with scoped saves/resets; only the selected form is mounted. The small shared avatar renderer owns image-error fallback for the header and preview, and the existing connection state resets failed header loads on reconnect.

File assignment and cleanup share attachment locks. The existing retention query has one additional reference check; replaced images use ordinary expiry. PNG metadata validation adds no image-processing dependency. The bundled default image, its cache inclusion, and browser-owned accent persistence are removed. No generic key/value settings layer, file-pinning flag, reference registry, extra event connection, or new model controls are needed.
