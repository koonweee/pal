# Pal Web

Pal Web is a strict-TypeScript Vite app and installable, network-authoritative PWA. Every viewport uses one conversation-first shell: an on-demand conversation sidebar, configured agent identity, shared message/composer rail, and one tabbed Preferences dialog for memory, connections, appearance, and application updates.

## Development

```bash
npm install
npm run api:generate
npm run dev
```

`PAL_BACKEND_URL` defaults to `http://127.0.0.1:3000`. `PAL_DESKTOP_URL` defaults to `http://127.0.0.1:6080`.

The repository's [full-stack local workflow](../backend/README.md#full-stack-local-development) runs Vite in Compose at `http://localhost:5173` with the backend, agent, database, and noVNC desktop. Every published port is bound to Mac loopback.

Source changes hot reload. After changing frontend dependencies on the host, run `../scripts/dev-local frontend-restart` to rerun the Vite container's `npm ci` and restart its development server.

That workflow keeps Vite loopback-only and can expose the production-style PWA through Tailscale Serve. Use the documented `./scripts/dev-local serve` and `unserve` commands.

Vite hot reload is the development update mechanism. The production service worker is not enabled by ordinary Vite development; validate installation, offline behavior, and service-worker updates with `npm run test:pwa` or the production image.

Useful checks:

```bash
npm run api:check
npm run check
npm run build
npm run test:unit
npm test
npm run test:pwa
npm run check:ui
npm run trim
```

The backend owns [`openapi/first-party-v1.json`](../backend/openapi/first-party-v1.json). `npm run api:generate` converts it to `src/api/generated.ts`. `src/api/client.ts` is the only first-party HTTP adapter, and `src/api/events.ts` owns EventSource decoding and recovery signals.

Generated contract metadata supplies the browser's `X-Pal-Contract-Version` header. The backend returns its contract and release identity on responses and announces the current release through `frontend.updated` when SSE connects. A mismatched browser may keep reading recovery data but cannot submit mutations until it updates. `PAL_RELEASE_ID` identifies one full-stack deployment and must match in production backend and frontend builds.

Header and composer measure their rendered heights for conversation padding and fades. The top fade reaches full visibility 12 px below the header, including its safe-area padding. Installed mode paints its fixed top-edge surface from the initial HTML so iOS cannot snapshot the status-bar edge before React mounts. Sending preserves an already-focused composer; request completion leaves the current focus alone. Measured message rows have an 8 px gap and include room for reactions and delivery receipts. Reply controls use a 32 px target on all inputs so short bubbles determine their row height.

Snapshot/event version and visibility rules live in `src/chat/sync.ts`. React hooks own chat, task, draft, upload, settings, dialog, and update-safety state. Feature components are grouped under `chat`, `composer`, `attachments`, `tasks`, `preferences`, `connected-services`, `desktop`, `layout`, `theme`, and `pwa`. Direct browser APIs are isolated behind refs and focused hooks for scrolling, selection, file input, native dialogs, visual viewport, and the noVNC iframe.

`InstanceSettingsProvider` owns the server-backed agent name, optional uploaded image, and accent color for the application. A validated local appearance snapshot avoids generic branding before the authoritative settings read. The existing chat event connection triggers refreshes on settings changes and reconnects. Agent labels, quotes, reactions, typing announcements, the desktop frame title, and connection idle notices consume the same name snapshot. App branding and installation metadata use Pal. The composer placeholder is `message <name>` with the saved name's capitalization. The Agent tab edits the name and PNG; the Appearance tab edits the shared accent and device-local color scheme. Both save shared fields through the same settings API. Appearance offers up to five distinct colors sampled from the saved profile image as accent dots; choosing one edits the current draft. The header uses an accent-colored donut when no image is configured or the image fails to load; no default image is bundled. Uploaded content and settings API responses stay network-only in the PWA.

Mantine supplies the provider and supported controls. `src/theme/tokens.ts` is the typed light/dark semantic-token source, provider defaults establish shared control behavior, and `src/ui` contains only primitives that enforce a current contract. Feature-owned CSS lives in `src/styles`; `style.css` only declares its load order. `/__ui` is a development-only, fixture-driven component gallery covering foundation controls, feature states, dialogs, desktop entry, and PWA states without writing to the backend. Its application preview runs the real shell in isolated MacBook Air, iPhone 17, and iPad mini CSS viewports so the production responsive queries execute, then scales the canvas down to fit the available gallery width. The previews do not emulate a device browser engine, safe areas, virtual keyboards, or hardware input. Browser checks cover scrolling, representative feature states, named viewport geometry, responsive shell behavior, light/dark contrast, keyboard focus, and touch sizing. `npm run check:ui` enforces responsive-capability ownership, ref-based React integration, approved control owners, and semantic color ownership; `npm run trim` reports unused production files, exports, and dependencies.

Playwright scenarios are split by chat, tasks, attachments, preferences and connections, desktop, responsive behavior, and the UI workbench. `test/support/pal-backend.ts` is their one deterministic HTTP/SSE harness.

## PWA boundary

The service worker precaches versioned application-shell files. API, SSE, files, OAuth, desktop HTTP/WebSocket, notification, and native first-party routes use `NetworkOnly` and are excluded from navigation fallback. App-owned local storage retains a validated appearance snapshot and up to the latest 30 canonical Main messages within a serialized size bound. Cached messages are display-only until the first server history snapshot replaces them; sending, replies, tasks, files, pagination, and background synchronization remain unavailable offline.

The typed custom worker owns static-shell precaching and explicit waiting-worker activation. API, SSE, files, OAuth, notification, upload, and desktop routes remain network-only. Update checks are coalesced across deployment SSE, reconnection, focus, online, and page-show signals.

Update behavior is a browser-local preference: ask before updating, or update automatically when safe. The default is ask. Safe automatic updates show a visible three-second countdown before reloading. Reload is refused while a draft, upload, submission, dirty settings form, or desktop session is active; unsafe tabs preserve their in-memory work and retain the update prompt.

`PAL_APP_VARIANT=dev` gives a production-style staging build the `Pal Dev` name and a distinct manifest ID. Ordinary Vite development does not register the service worker.

With the isolated local stack running, `../scripts/dev-local serve` builds the production-style image on Mac loopback and exposes it through the single private HTTPS origin. Vite remains loopback-only for hot reload. Rerun `serve` after frontend changes, or use `pwa-up` to rebuild only the loopback image while an existing Serve route remains active. Successful staging rebuilds publish a live update marker so open clients immediately check for the waiting bundle.

The committed icons are the iOS artwork at validated 180×180, 192×192, and 512×512 dimensions. They are declared with `purpose: any`; the artwork extends outside the maskable safe zone and is intentionally not advertised as maskable.

Installed production acceptance requires a stable HTTPS origin. The optional local Tailnet Serve hostname is a development origin and is not a production install identity unless a future deployment decision explicitly promotes and retains it.

The production image serves the app through Nginx on port 8080 and retains the current backend and noVNC proxy paths. Deployment remains private and single-owner; the app has no application-level login.
