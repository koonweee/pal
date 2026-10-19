# Frontend Playground

## Status

Done

## Goal

Provide a small browser playground for the persistent Main conversation. Load history, send text while Main is working, receive completed messages over SSE, and recover displayed history after reconnecting. The playground is a separate top-level project used before native iOS and Telegram clients are ported. It owns its package manifest, lockfile, dependencies, types, and commands; its only backend boundary is HTTP/SSE.

## Current Behavior

- The backend exposes Main text submission, paginated public history, and named SSE events.
- HTTP success acknowledges input acceptance. Assistant responses arrive independently.
- SSE has no replay. Clients connect before fetching snapshots, merge by message ID/version, and refresh displayed history after reconnecting.
- Failed handoff can leave a committed user message. A fresh submission uses a fresh idempotency key.

## Target Data Shape

Use the existing [backend contracts](../architecture/backend.md). No database or API changes.

## Milestones

### 1. Main Chat Playground

Implementation tasks:

- [x] Add a standalone TypeScript/Vite project in `frontend-playground/`, with a configurable backend proxy.
- [x] Build a responsive Main chat screen with sanitized Markdown, older history, connection/activity indicators, and a text composer.
- [x] Use public HTTP/SSE endpoints; keep follow-up submission available during agent execution.
- [x] Buffer live message events during snapshot loading, merge versions, and refresh all loaded history after reconnecting.
- [x] Expose submission/history failures and preserve the draft; do not automatically retry uncertain sends.

Exit criteria:

- [x] Browser interaction supports history, live replies, active-run follow-ups, pagination, and recovery without duplicate messages or stale updates.

### 2. Validate and Document

Implementation tasks:

- [x] Add a small browser test set for essential synchronization and failure behavior.
- [x] Validate the playground against a live backend and inspect desktop/mobile presentation.
- [x] Document startup, backend configuration, and manual testing; register this plan and keep status accurate.

Exit criteria:

- [x] Type checking/build and browser checks pass.
- [x] Live backend acceptance and independent SSE reply are verified, with validation limits recorded.

## Tests

- Browser integration with controlled HTTP/SSE: snapshot/event race, version merging, pagination, reconnect recovery of loaded history, active-run follow-up submission, and reload.
- Browser submission failure: persisted failed handoff, preserved draft, explicit resend, and a new idempotency key.
- Bounded live browser conversation against the real backend.

## Validation Commands

Run from `frontend-playground/`:

```bash
npm install
npm run check
npm run build
npm test
npm run dev
```

## Overall Exit Criteria

- [x] A browser can interact with Main through Pal's application layer, including while Main is working.
- [x] History and SSE reconcile without duplicates; reconnect refreshes previously loaded pages.
- [x] Failures are visible and do not silently resend inputs.
- [x] Setup documentation and plan status match validated behavior.

## Deferred Work

Task views, attachment submission, action selection, settings, token streaming, native-client migration, and hosted frontend deployment.

## Validation Record

2026-10-06:

- `npm run build` passed TypeScript checking and Vite production compilation.
- `PLAYWRIGHT_CHANNEL=chrome npm test`: two browser tests passed against a controlled HTTP/SSE backend through the Vite proxy. Coverage includes live events during an older snapshot, sanitized Markdown, active-run follow-ups, older pagination, updates/visibility changes during disconnection, all-loaded-page refresh, reload, and persisted failed handoff with an explicit fresh-key resend.
- The reconnect fixture exposed a page-boundary expansion; refresh preserves the previously loaded range and its older-history cursor.
- Desktop and 390px-wide layouts were inspected; the narrow layout has no horizontal page overflow.
- Live browser check `UI-LIVE-38125791` used the running Nest backend and real ChatGPT provider. A and B returned HTTP 201 in 72ms and 64ms. B was submitted with Main Working and the send control enabled. Two user messages and two assistant messages arrived over SSE; reload matched public history IDs exactly, with no duplicates or browser errors.
- Reconnect and failure coverage uses the controlled backend. The live check verifies acceptance, active-run submission, SSE publication, and reload continuity.
- Appearance uses native CSS light/dark colors and follows system changes while preserving the draft. Desktop and mobile visual checks passed; short drafts hide the scrollbar, overflowing drafts remain scrollable, and returning to a short draft hides it again. Compact headers and message spacing leave more room for conversation.
- Backend source and dependencies are unchanged. The playground owns its dependencies, lockfile, types, tooling, and configuration.
