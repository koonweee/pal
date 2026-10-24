# React PWA Parity Checklist

This is the acceptance checklist for [React Web App and Installable PWA](react-pwa-rewrite.md). The replacement keeps the playground UI; visual redesign, offline data, Web Push, and public authentication are deferred.

## Automated parity

| Capability | Observable criterion | Acceptance coverage |
| --- | --- | --- |
| Main synchronization | Snapshots, buffered SSE changes, older pages, reload, and reconnect converge without duplicates. | `reconciles snapshots, live follow-ups, older history, reconnect, and reload` |
| Read state | A persisted user message receives a Read marker before agent acceptance and the marker survives a snapshot. | `marks read on persistence before agent acceptance and restores receipts from snapshots` |
| Replies | Reply composition, older-history lookup, and chat-visibility rules preserve quotes. | `composes replies...` and `keeps task-only quotes...` |
| Send recovery | A failed send remains inline with client-only Retry and Dismiss controls; Retry reuses the submission key. | `keeps a failed submission...` |
| Tasks | Delegation, task chat, steering, shared finals, archive state, and reconnect work together. | `delegates into task chat...` |
| Read retries | Snapshot and detail failures retry with backoff; obsolete detail requests are cancelled. | `retries failed snapshots...` |
| Attachments | Mixed uploads, image grids, document pills, reload, retry, chat switching, drop/paste, concurrency, ordering, focus, and limits are preserved. | Five attachment/file Playwright scenarios |
| Desktop | The viewer preloads once, stays mounted, reconnects, supports keyboard, Unicode paste, fullscreen, responsive sizing, and focus restoration. | Six desktop Playwright scenarios |
| Preferences | Search, evidence navigation, edit conflicts, restore, history, retirement, and draft preservation work. | `manages preference evidence...` |
| Connected services | Add/edit, private secret retention, OAuth handoff/status, forget/remove, busy Apply, and connection errors are visible. | Two MCP Playwright scenarios |
| Theme and responsive navigation | Saved/system themes render before app behavior loads; narrow navigation and composer focus remain usable. | Desktop preload/theme scenario plus desktop/mobile viewport scenarios |
| Accessibility-critical controls | Dialog names, control labels, expanded/pressed state, disabled state, and focus restoration remain observable. | Role/label/focus assertions throughout the Playwright suite |

The suite runs 21 scenarios at 1280 px and targeted 390 px viewports. Focused reference captures are emitted for the playground, task chat, thread sidebar, reply, Read state, desktop sheet, and attachment layouts. The legacy baseline and the replacement suite both passed 21/21 on 2026-10-16.

## Manual and live acceptance

| Surface | Required check |
| --- | --- |
| iPhone Safari and installed PWA | Name/icon, safe areas, composer keyboard, sidebar/dialog focus, standalone relaunch, offline shell, reconnect, and update deferral |
| iPad Safari and installed PWA | Responsive split layout, virtual keyboard, desktop sheet/noVNC input, orientation changes, standalone relaunch |
| Android Chrome installed PWA | Install metadata/icon, file picker/camera input, offline shell, reconnect, and update activation |
| Desktop Safari and Chromium | Full conversation/settings flow, install behavior where supported, keyboard/focus, and desktop fullscreen |
| Private production backend | Main and Task sends, active-run steering, reload/reconnect, upload/download, preference write, connected-service read, SSE, and noVNC WebSocket |

The production playground remains the cutover source through feature parity. Both apps use first-party contract v1. Cutover switches only the web image; the prior playground image is the rollback artifact until live and device acceptance completes.
