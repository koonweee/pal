# Frontend Foundation and PWA Hardening

## Status

In Progress

## Goal

Replace the React app's imperative playground architecture with a React-owned, strict-TypeScript frontend foundation before substantial UI development. Preserve current behavior and appearance while establishing a small Mantine-based component system, semantic light/dark themes, responsive and accessibility rules, focused architecture enforcement, and a robust installable online PWA lifecycle.

Keep the implementation deliberately small. Use platform and dependency primitives, add abstractions only for a current repeated use or enforced contract, keep one owner for each state and policy, and delete superseded code, tests, dependencies, and compatibility paths as replacements land.

Web Push delivery is a separate milestone. Offline server data, queued writes, draft persistence, and background synchronization remain absent. Deployment updates use the existing SSE boundary, and users may choose automatic activation when React-owned reload safety reports no active work.

## Current Behavior

- `frontend/` is a strict-TypeScript React PWA using generated OpenAPI types, one HTTP adapter, a separate EventSource adapter, authoritative snapshot recovery, and a production-tested static-shell cache boundary.
- React feature hooks own chat, tasks, uploads, settings, dialogs, desktop state, and reload safety. The former post-render controller and adjacent DOM-owning modules are removed; focused refs and hooks own concrete browser integrations.
- Mantine supplies provider defaults and semantic primitives for the conversation-first shell and tabbed Preferences surface. Foundation and feature styles have separate owners under `src/styles`, and feature colors consume typed semantic variables.
- Shared layout hooks own input capabilities and visual-viewport CSS variables. One fluid conversation rail handles viewport fit, and coarse-pointer ergonomics retain keyboard focus behavior.
- The PWA precaches only the static shell and keeps API, SSE, files, OAuth, notification, and noVNC routes network-only. Nginx revalidates the document, service worker, and manifest and serves hashed assets as immutable.
- A waiting worker prompts for explicit activation or follows the browser-local automatic-when-safe preference. React-owned draft, upload, submission, dirty-form, and desktop state blocks reload.
- The generated contract version is exchanged through first-party fetch headers and the SSE query/event boundary. An incompatible browser cannot submit new mutations.
- The current React/PWA replacement remains pending physical-device acceptance and production cutover in [React Web App and Installable PWA](react-pwa-rewrite.md).

## Target Data Shape

No database migration is planned.

Every first-party fetch request and response carries one version header derived from `FIRST_PARTY_CONTRACT_VERSION`. EventSource supplies the version as a query because the browser API cannot set request headers. The generated frontend contract supplies the expected value; feature code does not duplicate it. A mismatch places the client in an update-required state, prevents new mutating requests, preserves in-memory user input, and offers an explicit service-worker update. Reads may continue only where they help recovery or display.

Each deployment supplies one opaque release ID to the backend and frontend build. The backend exposes the current release through a typed `frontend.updated` SSE event, including the contract version. The client compares it with its embedded release ID and asks the service-worker lifecycle owner to check for an update. Reconnection delivery makes the event recoverable; it is a hint rather than the sole update-discovery path.

Reload safety is a typed React-owned snapshot containing only current blockers: draft text, pending uploads, submission acknowledgement, desktop activity, and dirty settings or connected-service forms. It is not a plugin registry or persistence layer.

Update mode is a browser-local `ask` or `automatic-when-safe` preference, defaulting to `ask`. Automatic mode activates and reloads only when the current tab has no reload blocker. Unsafe tabs retain their in-memory work and show the pending update until they become safe or the user acts. This preference is not a backend domain setting and does not synchronize between devices.

Theme definitions satisfy one small typed semantic-token contract for the two rendered schemes. Auto mode selects light or dark; it is not a third palette. Feature code consumes semantic roles rather than literal colors or library palette indexes.

## Engineering Constraints

- Prefer plain Mantine controls with app-wide theme defaults. Add a Pal wrapper only when it enforces a semantic or accessibility contract that ordinary defaults cannot.
- A new abstraction must remove concrete duplication, enforce an invariant, or isolate an external integration. A hypothetical future consumer is insufficient.
- Do not add configuration for unimplemented themes, layouts, notification types, offline behavior, or deployment modes.
- Replace superseded internal modules outright. Do not retain adapters solely to preserve unshipped internal APIs, DOM IDs, or implementation-specific tests.
- Keep server state authoritative. React state owns drafts, focus, open surfaces, drag state, and other browser-local presentation only.
- Use one source for each theme token, breakpoint policy, input-capability fact, API shape, and service-worker lifecycle state.
- Keep validation proportional to user-visible risk. Do not test CSS strings, class names, token wiring, or abstraction internals when rendered behavior or type/build checks cover the contract.
- Avoid Storybook, React Query, a general state library, a general reload-blocker registry, automatic update countdowns, and custom install prompting unless a later requirement justifies them.

## Milestones

### 1. Contributor Contract and Focused Guardrails

Implementation tasks:

- [x] Strengthen root engineering guidance with the replacement, single-owner, concrete-consumer, configuration, and cleanup rules above without duplicating existing YAGNI, rule-of-three, primitive-first, and minimal-test guidance.
- [x] Add `frontend/AGENTS.md` with frontend ownership, component, theme, responsive, accessibility, PWA, testing, and validation rules.
- [x] Add Vitest and Testing Library for focused components, hooks, reducers, and lifecycle behavior. Retain Playwright for browser-observable integration behavior; do not mechanically rewrite working end-to-end coverage.
- [x] Add Knip-based frontend trimming for unused files, exports, and dependencies.
- [x] Add one narrow UI architecture check using the existing TypeScript dependency and simple CSS inspection. It enforces shared ownership of responsive capability reads, use of approved controls after migration, and semantic color use outside explicit theme/brand/integration files. Keep exceptions named and justified.
- [x] Document soft extraction thresholds: reconsider a source file near 500 lines, CSS file near 600 lines, and test file near 800 lines. Do not create a line-count gate.

Exit criteria:

- Frontend agents have one concise, enforceable set of architectural rules.
- Unit/component, browser, build, contract-drift, architecture, and trim commands have distinct purposes and can run independently.
- The guard does not encode visual implementation details or require speculative wrappers.

### 2. Semantic Theme and Control Foundation

Implementation tasks:

- [x] Add Mantine core/hooks and Lucide icons under one root provider.
- [x] Define the minimal typed semantic token contract for app/panel/raised surfaces, primary/secondary/muted text, action and user-message foreground/background pairs, subtle and essential borders, focus, status triplets, overlays, shadows, radii, spacing, and motion.
- [x] Supply complete light and dark definitions and one shared first-paint/bootstrap path for auto/light/dark selection, document color scheme, and browser theme color.
- [x] Configure app-wide Mantine defaults for inputs, selection controls, buttons, icon actions, menus, popovers, tooltips, dialogs, drawers, badges, tabs, alerts, loaders, and progress.
- [x] Add only immediately justified semantic primitives, beginning with an icon action that requires an accessible label and supplies consistent tooltip, fine-pointer and touch target geometry, icon, and focus behavior. Use it for toolbar, attachment, and send actions while feature styles own their semantic appearance. Add further wrappers only when real callers establish the need.
- [x] Add a development-only `/__ui` workbench rendered through the real provider. Cover normal, hover, focus, selected, disabled, loading, error, destructive, and status states in both schemes and touch/desktop target treatments.
- [x] Expand `/__ui` into a fixture-driven gallery for the real shell, navigation, task, conversation, message, composer, attachment, dialog, desktop-entry, and PWA components. Run the shell in isolated MacBook Air, iPhone 17, and iPad mini CSS viewports so its real responsive behavior applies, and scale each canvas down to the available gallery width. Keep preference and connected-service previews isolated from backend writes.
- [x] Split foundation, theme, control, shell, chat, composer, settings, attachment, desktop, and PWA styles. Feature styles own layout and feature-specific presentation rather than baseline control chrome.

Exit criteria:

- A plain supported Mantine control renders with Pal chrome and accessibility defaults without feature-specific color, radius, focus, disabled, or hover CSS.
- Feature files contain no unapproved literal UI colors or local theme selectors.
- The workbench passes representative rendered contrast and keyboard-focus checks in light and dark modes.
- The application still matches the retained playground appearance closely enough that this milestone is not a redesign.

### 3. React-Owned Application Architecture

Implementation tasks:

- [x] Organize the frontend by ownership: shell, chat/timeline, composer, tasks, attachments, preferences, connected services, desktop, PWA, theme, UI, shared layout/input, events, and API.
- [x] Keep `App.tsx` as composition and top-level lifecycle coordination. Move rendering, reducers, async orchestration, and integration effects to their owning feature modules.
- [x] Replace `PlaygroundShell.tsx`, `app/controller.ts`, `app/preferences.ts`, `app/mcp-settings.ts`, `app/thread-sidebar.ts`, `app/attachments.ts`, and `app/theme.ts` in behavior-preserving feature slices. Delete each superseded path rather than retaining a parallel controller bridge.
- [x] Keep HTTP calls inside the generated-client adapter and SSE parsing/recovery inside the event boundary. Preserve existing ordering, snapshot, retry, idempotency, and visibility behavior.
- [x] Keep direct DOM access inside small React hooks or refs for concrete browser integrations: noVNC iframe state, visual viewport, focus/selection, scrolling, file input, clipboard, and measurements.
- [x] Make composer, pending uploads, dirty forms, desktop state, and submission acknowledgement explicit React-owned state so update safety and controls do not infer behavior from DOM attributes.
- [x] Split the broad Playwright file by workflow as its owning implementation moves. Preserve one essential browser scenario per important synchronization or recovery contract.

Exit criteria:

- Production startup mounts React without importing a post-render imperative controller.
- No feature module locates its own rendered controls by global ID or installs unmanaged document/window listeners.
- Current chat, task, attachment, preference, MCP, theme, desktop, PWA, failure, and reconnect behaviors pass without a compatibility layer for the old DOM architecture.
- Superseded files, selectors, dependencies, and implementation-specific tests are removed.

### 4. Responsive and Accessibility Contract

Implementation tasks:

- [x] Add one shared viewport-fit owner for the application shell and named overlay/dialog fit policies only where their geometry differs. Do not add pane or container classification.
- [x] Add one shared input-capability owner distinguishing primary fine hover, available coarse pointer, and touch availability. Use actual `PointerEvent.pointerType` for interaction-specific behavior.
- [x] Scope touch ergonomics to capability: at least 44 px targets, at least 16 px editable text, safe-area padding, touch scrolling, and non-hover access to every action. Narrow fine-pointer layouts retain keyboard and hover behavior.
- [x] Remove capability-based suppression of keyboard focus. Preserve visible focus, semantic names, keyboard navigation, escape/return-focus behavior, and non-color state cues.
- [x] Keep the same composer textarea mounted through layout changes. Preserve focus, selection, IME composition, draft, reply target, and selected attachments.
- [x] Centralize visual-viewport handling needed by the software keyboard, composer, and desktop overlay. Preserve reduced-motion behavior.
- [x] Validate regular fine pointer, narrow fine pointer, narrow touch, wide touch, hybrid touch plus fine hover, keyboard-only navigation, and reduced motion. Treat physical iOS keyboard behavior as a device-only claim.

Exit criteria:

- Width, capability, and actual interaction type are not conflated.
- The app remains operable without hover and retains keyboard focus on hybrid devices.
- Rotation, viewport resize, and software-keyboard changes do not remount or lose active input state.
- No pane-specific responsive infrastructure exists.

### 5. Runtime Contract and SSE-Driven Update Lifecycle

Implementation tasks:

- [x] Expose `FIRST_PARTY_CONTRACT_VERSION` through the generated frontend contract and a first-party request/response header. Route it through the common fetch adapter rather than individual endpoints.
- [x] Detect a mismatch centrally, block subsequent mutations before network submission, and show a required-update state that cannot be dismissed. Preserve the current in-memory draft and other blocked work.
- [x] Generate one opaque release ID per deployment and inject it into both the frontend build and backend runtime. Add a typed `frontend.updated` event carrying the current release ID and contract version to the first-party SSE/OpenAPI contract.
- [x] Emit the current release event when an SSE stream opens so reconnecting clients recover missed deployments. Keep ordinary SSE reconnect/snapshot behavior authoritative and treat this event as an update-check hint.
- [x] Replace component-local service-worker registration with one small lifecycle module that owns support/security failures, the waiting worker, explicit activation, retryable errors, and the registration used by future push work.
- [x] Replace DOM inspection with the explicit reload-safety snapshot. Keep the blocker set concrete; do not add a registration API for hypothetical features.
- [x] Request a coalesced update check on `frontend.updated`, `pageshow`, return online, focus, and successful SSE reconnection. Do not add polling or an automatic countdown.
- [x] Add a browser-local `ask`/`automatic-when-safe` setting, defaulting to `ask`. In automatic mode, activate a waiting worker and reload when the explicit safety snapshot is clear; otherwise retain the update and show the manual action. Dismissal lasts for the current waiting release in the current tab; a required compatibility update cannot be dismissed.
- [x] Ensure one tab accepting or automatically applying an update does not force another tab with active work to reload. A clean tab in automatic mode may reload; an unsafe tab keeps its work under the old document and shows its own pending-update state.

Exit criteria:

- An old installed frontend cannot make mutations against an incompatible backend contract.
- Update discovery recovers from the deployment event, focus, reconnection, and offline recovery without polling.
- Drafts and other active in-memory work block reload. Clean clients can explicitly activate the waiting worker or opt into automatic safe activation.
- Registration and update failures remain retryable and do not strand the app.

### 6. Push-Ready Worker and Installed-App Boundary

Implementation tasks:

- [x] Move from generated Workbox output to a minimal typed `injectManifest` worker because explicit activation and the planned Web Push follow-up require worker-owned events. Implement precache, outdated-cache cleanup, `SKIP_WAITING`, and client claim only.
- [x] Preserve the static-shell-only cache boundary. API, SSE, files, OAuth, notification, upload, and noVNC routes remain network-only and outside navigation fallback.
- [x] Preserve no-cache/revalidation for the document, service worker, and manifest and immutable caching for hashed assets. Keep production cache-header assertions.
- [x] Keep the production manifest ID and origin stable. Support one explicit development build identity, `Pal Dev`, for production-style staging installs; do not add a general metadata matrix.
- [x] Validate icon dimensions and safe-zone presentation. Declare an icon maskable only after rendered cropping proves it is suitable.
- [x] Document that production device acceptance requires a stable HTTPS origin. The current local Tailnet Serve URL remains a development origin unless explicitly promoted later.
- [x] Extend production-build browser checks for initial control, waiting-worker activation, two-tab behavior, cache inventory, offline shell state, and incompatible-backend recovery.
- [ ] Run manual installed-mode acceptance on target iPhone/iPad Safari, Android Chrome, and desktop Safari/Chromium for installation metadata, safe areas, keyboard behavior, rotation, relaunch, process eviction, offline launch, online recovery, update activation, and private-origin reachability.

Exit criteria:

- The custom worker contains only behavior required by current update handling and the concrete Web Push seam; it does not implement push, badges, background sync, or offline writes.
- Development and production installs are distinguishable and do not share an origin identity.
- Automated production-build PWA checks pass, and device-only claims are recorded only after physical validation.

### 7. Cleanup and Readiness Gate

Implementation tasks:

- [x] Run full frontend behavior, PWA, contract, architecture, trim, build, and targeted backend contract checks.
- [x] Review the final dependency list, exports, tokens, primitives, configuration, and tests. Remove any item without a current caller, invariant, or acceptance criterion.
- [x] Update frontend and deployment documentation to describe the component system, React ownership, responsive contract, update compatibility, cache boundary, stable-origin requirement, and validation workflow.
- [x] Update the existing React/PWA cutover plan with completed foundation evidence and any remaining physical-device or production-cutover work.
- [x] Complete an independent browser review of the existing feature set in both themes and the responsive/input matrix before feature UI development starts.

Exit criteria:

- The frontend has no imperative application controller, duplicated visual policy, stale compatibility layer, unused dependency, or speculative configuration.
- Current behavior remains intact under the new architecture.
- Future UI changes have one intended extension point for controls, theme, responsive facts, state, API, events, and PWA lifecycle.

### 8. Preferences Primitive Correction

Implementation tasks:

- [x] Replace the retained native Preferences dialog and raw Preferences/Connections controls with Mantine modal, form, selection, action, and menu primitives while preserving existing behavior.
- [x] Remove feature-wide form-control chrome and give layout spacing one explicit owner.
- [x] Remove Preferences and Connections from the native-control architecture allowlist so raw controls cannot return unnoticed.
- [x] Scope workbench showcase styles to showcase sections so dialog previews match the application.
- [x] Add focused phone and tablet browser regressions for touch control geometry, editable text size, tab fit, and long selection labels.

Exit criteria:

- Preferences uses supported primitives without feature CSS overriding their control geometry or typography.
- Phone and tablet views have unclipped choices, at least 44 px touch controls, at least 16 px editable text, fitted navigation, and a fixed dialog header over independently scrolling content.
- The architecture check rejects raw controls in Preferences and Connections, and the workbench renders the same dialog layout as the application.

### 9. Application Primitive Consolidation

Implementation tasks:

- [x] Replace the conversation selector's native dialog with a Mantine Drawer and the attachment image preview with a Mantine Modal.
- [x] Replace task/chat selectors with Mantine NavLink and the archived filter with Mantine Checkbox.
- [x] Replace remaining raw action buttons with Mantine Button or UnstyledButton according to whether they are standard actions or content-shaped controls.
- [x] Replace the composer textarea sizing and hidden file input plumbing with Mantine Textarea autosizing and FileButton where behavior remains equivalent.
- [x] Replace the pending-upload scroller's custom overflow measurements with Mantine ScrollArea if its supported behavior communicates horizontal overflow without bespoke fades.
- [x] Replace repeated notice surfaces with Mantine Alert while preserving alert/status semantics and embedded recovery actions.
- [x] Replace the desktop sheet with a persistent Mantine Drawer if it preserves the preloaded iframe, visual-viewport fit, fullscreen, focus, touch keyboard, and clipboard behavior.
- [x] Replace locally drawn desktop control SVGs with the existing Lucide icon system.
- [x] Remove superseded control, dialog, scroller, and notice CSS and narrow the native-control architecture allowlist.
- [x] Extend focused browser coverage for overlay focus/return, navigation, composer autosizing/file selection, attachment scrolling/preview, notices, and persistent desktop behavior.

Exit criteria:

- Supported Mantine primitives own ordinary buttons, fields, selection controls, navigation controls, scrolling surfaces, alerts, modals, and drawers.
- Custom logic remains only where it enforces Pal-specific behavior or an external integration contract; retained exceptions are documented in current-state guidance or validation evidence.
- The real application and workbench preserve keyboard, touch, responsive, PWA, attachment, and noVNC behavior.
- Architecture, trim, strict TypeScript, browser, PWA, and production-build checks pass.

Validation evidence:

- Mantine owns application drawers, modals, alerts, navigation controls, selection controls, ordinary actions, textarea autosizing, file selection, and pending-upload scrolling. The architecture check rejects new raw buttons, inputs, selects, textareas, and dialogs.
- Conversation history retains its feature-owned scrolling because it includes message anchoring, older-history loading, quoted-message navigation, and follow-latest behavior beyond an ordinary scrolling surface.
- The desktop viewer uses Mantine Drawer for dialog semantics, focus, overlay, and close behavior. A desktop-specific offscreen layout override keeps the noVNC iframe mounted with nonzero dimensions while closed; visual-viewport, fullscreen, keyboard, and clipboard integration remains feature-owned.
- Strict TypeScript, generated API contract, Vitest, UI architecture, Knip, all 40 application Playwright tests, the production build, the PWA cache audit, and all 6 production-PWA Playwright tests pass.

### 10. Remaining Surface Primitive Audit

Implementation tasks:

- [x] Use Mantine scrolling and surface primitives inside the conversation drawer.
- [x] Replace remaining error and operation-feedback surfaces with Mantine Alert.
- [x] Audit remaining custom UI surfaces and retain custom ownership only where a primitive would not remove behavior or visual policy.
- [x] Validate sidebar navigation, status feedback, attachments, preferences, connected services, responsive behavior, and the production PWA.

Exit criteria:

- The conversation drawer uses supported primitives for its container, scrolling viewport, navigation controls, and selected-task surface.
- Alerts have consistent semantics and theme behavior across application features.
- Remaining custom surfaces each implement Pal-specific content, composite behavior, or an external integration rather than duplicating a dependency primitive.

Validation evidence:

- The conversation selector is a Mantine Drawer containing ScrollArea, NavLink, Checkbox, Paper, Button, and Alert primitives.
- Upload-limit errors, image-preview failures, preference results, and connected-service results use Mantine Alert with status semantics and theme colors.
- Message bubbles, attachment pills and grids, the composite composer, centered agent identity, conversation anchoring, and noVNC viewport remain custom because each owns Pal-specific structure or integration behavior that a primitive would not replace.
- Strict TypeScript, UI architecture, Knip, Vitest, 29 affected Playwright scenarios, the production build, the PWA cache audit, and all 6 production-PWA scenarios pass.

### 11. iOS Composer Keyboard Fit

Implementation tasks:

- [x] Reuse the shared visual-viewport owner for the main application shell so the conversation and composer follow the visible viewport while the software keyboard is open.
- [x] Preserve the bottom safe area at rest and suppress its stale keyboard-open value only while a focused editable has a software-keyboard viewport reduction.
- [x] Publish viewport geometry, keyboard state, and the effective bottom safe area on the document root so shell content, portaled settings forms, and the desktop drawer share one policy across viewport and input capabilities.
- [x] Add a focused browser regression for keyboard open/close geometry, safe-area restoration, and retained textarea focus.
- [x] Cover a portaled settings input and hardware-keyboard-style focus without viewport reduction.
- [x] Preserve the conversation's pinned-to-latest state when viewport changes resize its scroll container.
- [x] Preserve the composer-adjacent message through keyboard and composer-height changes when unpinned, retain top anchoring for ordinary resizes, and reconcile pinned spacing after composer border-box changes.
- [x] Keep document overscroll contained, make conversation history the sole page-level vertical scroller, retain textarea scrolling, and prevent the mounted closed desktop from painting during viewport rubber-banding.
- [x] Keep the composer focused when a touch user jumps to the latest message with the keyboard open.

Exit criteria:

- The focused composer sits at the bottom of the visual viewport with a compact gap above the software keyboard.
- Portaled settings forms and the desktop drawer consume the same root viewport geometry and effective safe area.
- Closing the keyboard restores home-indicator clearance without remounting or blurring the composer.
- A thread at the latest message remains pinned through keyboard open and close; a user reading older messages is not pulled to the end.
- Keyboard transitions retain the same composer-adjacent message and gap when unpinned and the same message-to-composer gap when pinned.
- Composer-area gestures cannot chain into the document, and a closed mounted desktop remains measurable without becoming visible during keyboard viewport movement.
- Tapping jump-to-latest while the keyboard is open scrolls to the end without dismissing the keyboard.
- Strict TypeScript, the focused responsive browser test, UI ownership checks, and unused-code checks pass.

Validation evidence:

- The visual-viewport regression covers iOS shrinking both layout and visual viewport heights, removes the stale 34 px keyboard-open safe-area inset, restores resting geometry, and retains textarea focus.
- A portaled-settings regression covers hardware-keyboard focus, software-keyboard open/close geometry, effective safe-area restoration, and retained input focus.
- The desktop regression covers keyboard focus inside the same-origin noVNC iframe, shared viewport sizing, and safe-area restoration.
- The chat regression covers a populated thread remaining at the true bottom with the jump-to-latest action hidden through keyboard open and close.
- The chat regression injects an iOS-style scroll adjustment while unpinned and a delayed composer-clearance change while pinned, then verifies the composer-edge anchor through keyboard open and close and the pinned message gap remain stable.
- Responsive and desktop regressions verify scroll containment, retained textarea scrolling, and a measurable but unpainted closed desktop while the keyboard viewport is reduced.
- A touch regression verifies jump-to-latest cancels the compatibility `mousedown`, preserves composer focus, and scrolls to the true end.
- Strict TypeScript, all 14 responsive and 6 desktop Playwright scenarios, Vitest, UI architecture, Knip, and the production frontend build pass.
- The production-style development PWA is healthy on loopback and the Tailnet development URL. A physical iPhone capture verifies a compact focused-composer gap without keyboard overlap after restarting the installed PWA.

## Tests

- Focused Vitest coverage for pure reducers/policies, component interaction, input-capability classification, reload safety, update-mode behavior, service-worker lifecycle, and API compatibility.
- Existing Playwright behavior retained and split by feature as ownership moves; do not duplicate the same contract at every layer.
- A small `/__ui` browser gate for computed light/dark contrast, visible keyboard focus, core control states, and touch target geometry.
- A responsive browser matrix covering regular fine pointer, narrow fine pointer, narrow touch, wide touch, hybrid input, keyboard-only navigation, reduced motion, and visual-viewport changes.
- Production-build PWA checks for manifest/icons, cache headers and inventory, network-only private routes, offline shell, SSE-triggered discovery, manual and automatic safe activation, blocked and two-tab safety, update retry, and runtime contract mismatch.
- Targeted backend integration coverage for the first-party contract-version header, mismatch behavior, and initial `frontend.updated` SSE event.
- Manual physical-device acceptance for installed iPhone/iPad, Android, and desktop PWA behavior. Automated emulation does not establish physical keyboard, safe-area, icon, process-eviction, or OS installation behavior.

## Validation Commands

Implementation may refine script names but must retain these capabilities.

```bash
cd frontend
npm run api:check
npm run check
npm run test:unit
npm test
npm run test:pwa
npm run check:ui
npm run trim
npm run build

cd ../backend
npm run openapi:check
npm run build
npm run lint
npm run test:e2e -- test/client-contract.e2e-spec.ts
```

## Overall Exit Criteria

- React exclusively owns application rendering and interaction state; direct browser integration is isolated behind feature hooks and refs.
- Mantine defaults plus a minimal semantic token contract provide uniform controls and complete light/dark behavior without feature-level visual policy.
- Responsive behavior distinguishes viewport fit, input capability, and actual interaction without pane abstractions.
- The installed PWA discovers updates through SSE and browser lifecycle checks, applies them manually or automatically when safe, rejects incompatible mutations, and retains a static-shell-only cache boundary.
- Production and development installation identities are deliberate, and required physical-device evidence is recorded.
- Strict TypeScript, generated OpenAPI, SSE recovery, private single-owner deployment, current features, and existing PWA behavior remain intact.
- Agent guidance and automated checks prevent architectural drift without encoding speculative abstractions or low-value tests.

## Deferred Work

- Further visual redesign and new product features beyond the conversation-first shell.
- Web Push subscription UI, VAPID configuration, backend delivery, notification display/tap routing, foreground suppression, and badges.
- Persisted drafts, attachment persistence, cross-tab draft coordination, and backend-synchronized drafts.
- Offline conversation/task data, offline composition, queued writes, Background Sync, and conflict resolution.
- Automatic update countdowns, custom install prompts, and installation onboarding.
- Additional theme catalogs, Storybook, screenshot-baseline suites, and exhaustive contact-sheet generation.
- React Query, a router, a general client-state library, and general-purpose lifecycle/plugin registries until concrete requirements justify them.
- Public access, application authentication, authorization, and multi-user behavior.

## Validation Evidence

- Strict application/test TypeScript, generated-client drift, semantic UI architecture, Knip production trim, and the production build pass.
- The workflow-owned Chromium suite passes 34 scenarios covering chat synchronization and recovery, tasks, files, unified tabbed settings, desktop, responsive and zoom-reflow behavior, the fixture-driven component gallery and named preview viewports, both themes, keyboard focus, and touch targets.
- The production-build PWA suite passes six scenarios covering static-shell-only caching, manual and automatic safe activation, two-tab safety, incompatible contracts, and retry after a transient registration failure. Manifest and icon validation also pass.
- Targeted backend OpenAPI, build, lint, contract-header, mutation-mismatch, and initial `frontend.updated` SSE checks pass. The generic iOS simulator build passes with the generated contract header.
- Light and dark desktop/mobile browser captures were reviewed without a blocking layout, focus, scrolling, or contrast regression.
- Preferences and connected services use Mantine-owned controls throughout. Phone, tablet, and desktop captures show fitted tabs and choices; focused browser coverage verifies touch sizing, editable text size, dialog fit, long labels, and a fixed header over independently scrolling content. The architecture check rejects raw controls in both feature owners.
- Playwright uses a 10-second test budget and a 5-second assertion budget. The 39-scenario frontend suite and six-scenario production PWA suite pass under those limits.
- The production-style `Pal Dev` image runs beside loopback-only hot reload at `http://localhost:14173` and is privately exposed through a generated Tailnet-only HTTPS route. Real Chrome reports the expected manifest, active service-worker control and cache, a mounted React shell, connected SSE, healthy same-origin API access, and the encrypted real noVNC session. Scoped teardown and idempotent redeployment preserve the backend, hot-reloading app, and unrelated Serve routes.
- Physical installed-mode acceptance on iPhone/iPad Safari, Android Chrome, and desktop Safari/Chromium remains required before production cutover. No device-only claim is recorded yet.
