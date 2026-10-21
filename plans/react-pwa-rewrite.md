# React Web App and Installable PWA

## Status

In Progress

## Goal

Replace the framework-free frontend playground with a React web application that preserves the playground's current appearance, interactions, and complete feature set. Make the replacement an installable, responsive online PWA for iOS/iPadOS Safari, Android Chrome, and desktop Safari/Chromium. Keep Pal's existing private single-owner deployment boundary.

Establish an OpenAPI-defined first-party HTTP contract and generated TypeScript client before migrating features. Develop the new app beside `frontend-playground/`, switch production only after parity is validated, then remove the old frontend.

This plan does not redesign the UI. Its purpose is to create a maintainable React foundation for later UI iteration without combining replatforming and visual-product decisions.

## Current Behavior

- `frontend-playground/` is a strict-TypeScript Vite application using direct DOM APIs, local copies of backend response types, one shared `fetch` wrapper, direct SSE parsing, and hand-written CSS.
- The playground supports Main and Task conversations, snapshot-plus-SSE reconciliation, active-run follow-ups, pagination, optimistic sends, Read receipts, replies, per-chat drafts and pending files, uploads and attachment viewing, archive management, preferences, connected-service setup, themes, responsive navigation, and the persistent noVNC desktop viewer.
- The browser's `request<T>()` and SSE handlers assert parsed JSON as locally declared types. Backend request DTOs are runtime-validated, but no generated client or runtime relationship prevents frontend/backend response drift.
- NestJS exposes a first-party HTTP/SSE contract. `PalEvent` is the backend's discriminated event union, snapshots remain authoritative after stream gaps, and `FIRST_PARTY_CONTRACT_VERSION` identifies breaking wire changes.
- The production image builds static assets and serves them through Nginx. The same origin proxies browser `/api` requests, native root API requests, SSE, file traffic, and noVNC HTTP/WebSocket traffic.
- The deployment is private and single-owner. Application authentication and public-internet exposure are outside this plan.
- The native iOS application supplies Pal's production name and icon assets. Its APNs notifications remain available while the PWA replacement experiment runs.

## Target Data Shape

No database migration or persistence-model change is planned.

The backend owns a generated OpenAPI document for first-party contract version 1. It describes the HTTP operations and schemas used by the web application:

- chat history and message submission;
- task listing, details, and archive updates;
- multipart file upload and binary content/download responses;
- preference listing, detail, history, creation, and updates;
- connected-service listing, save/update/removal, login lifecycle, and Apply;
- shared success and application-error response shapes.

Adapter response DTOs describe public wire shapes without adding OpenAPI dependencies to application/core types. Stable operation IDs make generated client changes reviewable. Generation is deterministic, and a repository check fails when the committed OpenAPI artifact or generated TypeScript types are stale.

The web app uses generated OpenAPI path/types through one small client adapter that owns the `/api` base path, timeout and abort behavior, error normalization, JSON requests, and multipart uploads. Feature code does not call first-party HTTP endpoints directly.

SSE remains a dedicated transport because generated OpenAPI clients do not implement its lifecycle. Its payload types come from schemas corresponding to the backend `PalEvent` variants. The adapter parses input as `unknown`, accepts the known event/envelope combinations, and triggers authoritative snapshot recovery after malformed data or a connection gap. It does not invent event replay.

The service worker stores only versioned static application-shell assets. `/api`, `/stream`, `/desktop`, file responses, OAuth callbacks, and native root API routes are never cached by the service worker. A bounded app-owned appearance and latest-Main snapshot restores presentation before synchronization. Cached messages remain read-only; queued writes and background synchronization are not persisted for offline use.

## Milestones

### 1. Behavioral Baseline

Implementation tasks:

- [x] Inventory every currently supported playground flow and turn it into a parity checklist covering chat, Tasks, replies, attachments, desktop, preferences, connected services, theme, responsive behavior, failures, reconnection, and accessibility-critical controls.
- [x] Record the current deterministic Playwright results and focused desktop/mobile visual references. Prefer behavioral assertions and a small manual reference set over broad screenshot snapshots.
- [x] Identify the existing browser tests that become replacement-app acceptance tests. Keep one authoritative behavioral scenario for each important synchronization or recovery rule.
- [x] Define the supported validation matrix: automated Chromium viewports plus manual Safari on iPhone/iPad in browser and installed standalone modes, Android Chrome installed mode, and desktop Safari/Chromium.
- [x] Record cutover and rollback boundaries: both frontends use the same backend contract, production continues serving the playground through milestone 4, and the prior web image remains the rollback artifact during cutover.

Exit criteria:

- [x] The existing playground build and Playwright suite pass unchanged or with test-harness-only changes.
- [x] Every current playground capability has an observable parity criterion and an assigned automated or manual validation method.
- [x] The plan distinguishes required parity from deferred redesign, offline data, Web Push, and public authentication.

### 2. OpenAPI Contract Foundation

Implementation tasks:

- [x] Add Nest's supported OpenAPI document generation for first-party HTTP routes without publishing an unauthenticated Swagger UI in production.
- [x] Add adapter-owned request/response/error schema annotations for the operations required by the replacement web app. Keep application services and repositories free of protocol documentation dependencies.
- [x] Give operations stable IDs and describe query/path parameters, multipart upload, empty responses, binary responses, and relevant non-2xx application errors accurately.
- [x] Generate and commit the version-1 OpenAPI artifact deterministically. Add generation and drift-check commands suitable for local development and CI.
- [x] Add the replacement frontend's generated TypeScript schema and a small typed fetch client. Preserve current timeout, abort, and error-message behavior; do not add a general data-fetching/state library.
- [x] Define generated component schemas for all `PalEvent` variants and implement the small EventSource adapter separately from the HTTP client.
- [x] Add focused contract checks against the real Nest application for representative chat, task, file, preference, MCP, error, and SSE responses. Retain existing backend end-to-end coverage instead of duplicating every endpoint case.
- [x] Document how backend contract changes regenerate the artifact/client and how breaking changes relate to `FIRST_PARTY_CONTRACT_VERSION`.

Exit criteria:

- [x] The OpenAPI artifact represents every HTTP call needed for full playground parity, and the generated client compiles without hand-written response types or endpoint-path assertions.
- [x] Backend request validation and representative response/SSE contract checks pass against the generated specification.
- [x] Regeneration is deterministic and the drift check fails after an ungenerated contract change.
- [x] The existing playground and iOS clients continue to work without wire-contract changes.

### 3. React and PWA Shell

Implementation tasks:

- [x] Create `frontend/` as a standalone Vite, React, and strict-TypeScript project with its own lockfile, build, formatting, and Playwright configuration. Keep `frontend-playground/` runnable beside it.
- [x] Recreate the existing document shell, theme behavior, responsive layout, dialogs/sheets, focus foundations, and CSS class contract in React. Reuse the current CSS and visual assets where practical; do not redesign the interface.
- [x] Keep server synchronization in a framework-independent store/reducer boundary and rendering in React components. Begin without a router or third-party client-state library because the current product has one application surface and bespoke snapshot/SSE semantics.
- [x] Connect the shell through the generated HTTP client and typed EventSource adapter. Make connection/offline state explicit without caching server data.
- [x] Add a web app manifest using the production iOS app name and icon. Derive and commit the required web icon sizes from `ios/Pal/Pal/Assets.xcassets/AppIcon.appiconset/AppIcon.png`, include the Apple touch icon, and validate installed icon cropping before declaring any asset maskable.
- [x] Add a Workbox-backed service worker through the Vite PWA integration. Precache only hashed application-shell assets and explicitly exclude every dynamic/private route listed in the target data shape.
- [x] Add a non-destructive update flow. A waiting version may prompt for refresh but must not force a reload during a draft, upload, submission, or active desktop session.
- [x] Add a production Nginx/Docker path for the parallel app with the existing proxy, upload-size, SSE, WebSocket, and cache-revalidation behavior.

Exit criteria:

- [x] The new app builds independently, renders the playground UI shell at desktop and mobile sizes, and uses generated types for HTTP plus the typed SSE boundary.
- [x] Browser installability checks pass with the Pal name and iOS production icon.
- [x] A production service worker serves the shell after an offline reload while API, SSE, files, OAuth, and desktop requests remain network-only and visibly unavailable.
- [x] The playground remains the production frontend and can run simultaneously with the new app against one backend.

### 4. Full Feature Migration

Implementation tasks:

- [x] Migrate Main/Task selection, task details and archive filters, per-chat drafts, and task-list pagination while preserving the current responsive sidebar behavior.
- [x] Migrate snapshot-before/with-live-event buffering, version merging, loaded-page refresh, retry backoff/cancellation, activity display, visibility refresh, and reconnect recovery into the synchronization boundary.
- [x] Migrate message rendering, sanitized Markdown, optimistic reconciliation by idempotency key, Read timestamps, replies, older-message navigation, scroll anchoring, latest-message following, and explicit uncertain-send recovery.
- [x] Migrate file selection, drag/drop and paste, three-upload concurrency, retry/removal, per-chat pending state, file-only sends, image grids, downloads, and image preview behavior.
- [x] Migrate the noVNC desktop sheet, preload/persistent mounting, shared connection, touch keyboard, Unicode paste, fullscreen behavior, versioned viewer path, and reconnect state without remounting the iframe during ordinary UI changes.
- [x] Migrate preferences, including search/status filters, source-message navigation, history, conflict handling, restore, retirement, and draft preservation.
- [x] Migrate connected-service list/edit/login/forget/remove/Apply behavior, including write-only secret handling, OAuth handoff/status, busy Apply, and visible connection failures.
- [x] Preserve system/light/dark themes, reduced-motion handling, safe areas, keyboard interaction, coarse-pointer behavior, semantic labels, focus restoration, and current narrow-screen layout.
- [x] Port the existing Playwright scenarios as each vertical slice lands. Add focused store-level tests only where a synchronization invariant is materially clearer than an end-to-end test.

Exit criteria:

- [x] Every milestone-1 parity item works in the React app, including error and reconnection cases.
- [x] The replacement Playwright suite covers the existing essential behaviors with no duplicate legacy/new suites required after cutover.
- [x] No feature module declares local copies of backend response shapes or calls first-party HTTP endpoints outside the generated client adapter.
- [x] Desktop/mobile visual inspection finds no intentional redesign and no blocking regression in layout, focus, scrolling, or touch interaction.

### 5. Parity Validation and Cutover

Implementation tasks:

- [x] Run the backend contract checks, replacement frontend checks, and complete browser acceptance suite from clean installs/builds.
- [x] Validate the production image against a live private Pal backend: Main and Task conversation, active-run steering, reload/reconnect, uploads, preferences, connected-service reads, and the real noVNC WebSocket path.
- [ ] Install and inspect the PWA on the target platform matrix. Confirm metadata/icon presentation, safe areas, keyboard behavior, standalone relaunch, online recovery, the offline-state message, and update activation.
- [ ] Build and publish the replacement web image, switch the private deployment to it, verify API/SSE/desktop health, and retain the prior playground image as the immediate rollback target.
- [ ] After cutover acceptance, remove `frontend-playground/`, make `frontend/` the documented web project, and remove obsolete duplicated client types, tests, build configuration, and deployment references.
- [x] Update the root README, frontend README, backend architecture, and deployment documentation to describe the implemented React/PWA stack, generated-contract workflow, cache boundary, and private exposure model.
- [ ] Mark plan tasks complete only after their exit criteria are validated and record exact automated, manual-device, live-runtime, image, and rollback evidence.

Exit criteria:

- [ ] Production serves the React PWA with full former-playground feature parity and unchanged first-party wire behavior.
- [ ] The app is installable and usable online across the agreed platform matrix; offline mode exposes only the cached shell and a clear disconnected state.
- [x] No service-worker cache retains chat, task, preference, MCP, attachment, OAuth, SSE, or noVNC responses.
- [ ] The old frontend source is removed, documentation reflects the new current state, and the previous production image provides a tested rollback path.

## Tests

- Backend OpenAPI generation/drift check and representative actual-response validation for chat, tasks, files, preferences, MCP, errors, and SSE envelopes.
- One focused synchronization test set for snapshot/event races, stale versions, reconnection, loaded-history recovery, optimistic reconciliation, and uncertain sends.
- Existing Playwright user flows, migrated rather than duplicated: preferences, MCP/OAuth, chat/history/replies, Tasks/archive, desktop lifecycle/input, uploads, focus preservation, and file limits.
- PWA production-build checks for manifest metadata/icons, service-worker registration/update, offline shell loading, and network-only dynamic routes.
- Manual device checks for installed iPhone/iPad Safari, Android Chrome, and desktop Safari/Chromium. Real-device evidence is required for standalone safe areas, virtual keyboard/noVNC interaction, icons, and relaunch behavior.
- One bounded live private-backend smoke covering HTTP, SSE, upload, and desktop WebSocket routing after deployment.

## Validation Commands

Commands introduced by implementation may use different names, but must provide these capabilities.

```bash
cd backend
npm run openapi:generate
npm run openapi:check
npm run build
npm run lint
npm test
npm run test:e2e

cd ../frontend
npm install
npm run api:generate
npm run api:check
npm run check
npm run build
npm test

# Retained through milestone 4 only.
cd ../frontend-playground
npm run build
npm test
```

Use targeted tests while migrating each vertical slice. Run the full backend and replacement-frontend sets before cutover. Validate service-worker behavior from a production build over HTTPS or localhost, not from ordinary Vite development behavior alone.

## Overall Exit Criteria

- The React PWA replaces the playground with complete behavioral parity and the conversation-first web shell, while retaining strict TypeScript and the existing backend/deployment architecture.
- Backend-authored OpenAPI and generated TypeScript types/client form the sole HTTP contract boundary for the web app; SSE has one explicit typed adapter and authoritative snapshot recovery.
- The production iOS name/icon identify the installed PWA, and installability/standalone behavior pass on the target platform matrix.
- Static shell caching retains no server response. The bounded app-owned Main snapshot is visibly non-authoritative until synchronization. Offline writes and background synchronization are absent.
- Existing HTTP/SSE/noVNC behavior, private single-owner access, and the native iOS client remain compatible throughout migration and cutover.
- Relevant automated checks, device checks, live private-backend smoke tests, documentation, deployment evidence, and rollback evidence are complete.

## Deferred Work

- Further visual feature work beyond the conversation-first shell remains deferred.
- Web Push, notification permission/subscription management, background delivery, and notification tap routing. Native APNs remains available during the PWA experiment.
- Full offline conversation/task storage, offline composition, queued writes, background synchronization, and conflict resolution.
- Public access, application authentication, authorization, multi-user tenancy, and public-internet threat modeling.
- Generated Swift client/model adoption and removal of the iOS client's handwritten contract types.
- Deep-link routing, assistant action-selection UI, a general client-state/query library, and a published external SDK until product requirements justify them.

## Validation Evidence

- Legacy baseline: `frontend-playground` build and 21/21 Playwright scenarios passed before migration.
- Backend: lint and boundary checks passed; 45/45 integration tests, 24/24 end-to-end tests, and 2/2 representative OpenAPI response/SSE checks passed. Deterministic OpenAPI drift validation passed.
- Replacement: strict app/test TypeScript, generated-client drift validation, production build, and 34/34 workflow-owned Playwright scenarios pass. Desktop/mobile references show the shared conversation rail and unified settings surface without a blocking regression.
- PWA: manifest name/icon dimensions, generated cache boundary, production service worker, offline shell reload, and offline `NetworkOnly` API behavior passed in Chromium.
- PWA safety: a focused unit check covers draft, upload, submission, and desktop-session update deferral. A real waiting-worker test verifies the prompt, draft preservation, explicit activation, and reload. Cold offline launch displays an explicit Offline state. Runtime Cache Storage inspection and offline fetches cover API, SSE, files, OAuth, desktop, notifications, and native first-party paths.
- Images: clean `npm ci` container builds passed for the backend build stage and the React/Nginx image; `nginx -t` passed for the web image.
- Local production gateway: the built Nginx image passed browser and direct smokes against a real isolated Nest process for HTTP, SSE, multipart upload/content/download, preferences, MCP reads, cache headers, and a versioned desktop HTTP/WebSocket stub. This does not replace the private live-runtime/noVNC acceptance gate.
- The private release workflow produces a pinned Linux amd64 image and verifies its manifest and attestation before deployment.
- Live private runtime: the exact published image passed HTTP, SSE, reload/reconnect, offline/online recovery, Main/Task snapshot navigation, preferences and connected-service reads, multipart upload/content/download, service-worker control, manifest metadata, responsive desktop/phone Chromium layouts, and the real noVNC HTTP/WebSocket/RFB path. The embedded viewer reached `noVNC_connected`. One labeled Main-to-Task smoke delegated, accepted active-run steering, produced the steered final, completed, and was archived; it requested no external destination. The unreferenced upload remains subject to the backend's orphan cleanup policy.
- Rollback preflight verifies the retained image, running service identity, deployment health, and synchronization state.
- Remaining acceptance requires physical installation and inspection on the target platform matrix. Production cutover, post-deploy rollback verification, and legacy removal wait for that evidence.
- Foundation hardening replaces the post-render DOM controller with feature-owned React state, adds Mantine semantic tokens, feature-owned styles, browser accessibility gates, and guardrails, distinguishes viewport/input capabilities, and enforces runtime contract compatibility plus SSE-driven safe service-worker updates. The production PWA suite covers static-shell caching, manual and automatic safe updates, two-tab safety, incompatible contracts, and retryable registration failure.
