# Frontend Guidelines

## Ownership

- React owns rendered application state and interactions. Keep `App.tsx` as the shell and lifecycle coordinator; put behavior in the closest feature component, hook, or reducer.
- Keep HTTP in `src/api`, EventSource decoding in `src/events` or `src/api/events.ts`, browser integrations behind focused hooks/refs, and service-worker state in `src/pwa`.
- Server snapshots are authoritative. Browser state owns drafts, focus, open surfaces, uploads in progress, and other presentation state only.
- Do not query React-rendered controls by global ID or attach unmanaged global listeners. IDs may remain for accessibility and browser tests.

## Components and Themes

- Use plain Mantine controls and global theme defaults first. Add a Pal wrapper only when it enforces a semantic or accessibility contract that Mantine defaults cannot.
- Use `IconAction` for app-owned icon-only buttons. It owns the accessible label, tooltip, circular shape, target geometry, and generic hover/focus behavior; feature styles may own semantic color, position, and a justified larger size.
- Feature CSS owns layout and one-off presentation. Shared control chrome, focus, disabled, hover, and semantic colors belong in the theme and control foundation.
- Consume semantic theme variables. Literal colors belong only in theme, brand, or isolated third-party integration files.
- Keep light and dark schemes complete. Auto selects one of them and is not a third palette.

## Responsive and Accessible UI

- Treat viewport fit, available input capabilities, and the current pointer interaction as separate facts. Do not infer a device class such as `isMobile`.
- Read responsive media and touch capabilities only through their shared owners. Use `PointerEvent.pointerType` when behavior depends on the current interaction.
- Gate every CSS `:hover` visual with `@media (hover: hover)` so touch browsers cannot retain sticky hover state. Keep touch feedback transient and available through the shared control primitive.
- Touch-capable UI uses at least 44 px targets, at least 16 px editable text, safe-area padding, touch scrolling, and non-hover access to every action.
- Never suppress keyboard focus because a touch or coarse pointer is available. Preserve semantic names, keyboard navigation, escape/return-focus behavior, and reduced motion.
- Keep editable controls mounted across layout changes so focus, selection, IME state, and drafts survive resize and rotation.

## PWA

- Cache only the versioned static shell in the service worker. A bounded app-owned appearance and Main-history snapshot may restore presentation before synchronization. API, SSE, files, uploads, OAuth, notifications, and noVNC stay network-only and outside navigation fallback.
- One lifecycle owner manages registration, waiting workers, release discovery, activation, and retryable failures.
- A reload requires the explicit React-owned safety snapshot. Do not infer blockers from DOM state or create a general blocker registry.
- Automatic updates run only when the current tab is safe. Tabs with active work retain it and present the waiting update.

## Validation

- Add focused Vitest coverage for components and pure policies. Keep Playwright for browser-visible workflows, synchronization, responsive behavior, and production service-worker behavior.
- Do not test CSS strings, class names, token wiring, or implementation details when type/build checks or rendered behavior cover the contract.
- Reconsider extraction near 500 lines for source, 600 lines for CSS, and 800 lines for tests. These are review prompts, not gates.
- Run `npm run check`, the nearest focused tests, `npm run check:ui`, and `npm run trim` for architecture changes. Run `npm run test:pwa` for service-worker or manifest changes.
