# noVNC Touch Trackpad

## Status

Done

## Goal

Make the existing embedded desktop usable as a touch trackpad so finger movement moves a separate cursor and a tap clicks at that cursor. Provide a live playground trial for phone testing with clipboard paste, keyboard, and fullscreen controls in the desktop header.

## Current Behavior

- Debian noVNC 1.6 serves the shared TigerVNC desktop through websockify.
- The playground preloads the viewer in a 4:3 bottom sheet. A versioned asset path and cache revalidation load current UI/core modules for existing browser sessions.
- The image applies the pinned upstream touch patch described in [its provenance](../backend/desktop/novnc-trackpad.README.md).

## Milestones

### 1. Container and viewer

Implementation tasks:

- [x] Port and pin upstream trackpad changes to the Debian viewer.
- [x] Apply the patch during image builds and enable it in the embedded viewer.
- [x] Preserve the settings toggle and document gestures.

Exit criteria:

- [x] Image builds with the patch and the embedded viewer connects.

### 2. Trial validation

Implementation tasks:

- [x] Run upstream RFB/gesture tests and playground checks.
- [x] Verify movement, taps, right-click, scrolling, dragging, zoom, mode toggle, and reconnect with the live desktop.
- [x] Publish the live trial for the user's phone test.
- [x] Cover a cached original module tree and load the current viewer after refresh.

Exit criteria:

- [x] Automated and live browser checks pass; the existing Tailnet URL serves the trial.

### 3. Header controls

Implementation tasks:

- [x] Add keyboard and fullscreen icon toggles beside the Desktop heading.
- [x] Reuse noVNC's synchronous keyboard control, mirror its focus state, and preserve hide intent when a header tap blurs the iframe.
- [x] Keep the header in fullscreen; use native fullscreen where supported and expand the browser viewport on Safari.
- [x] Keep the sheet within the visible viewport when the phone keyboard opens.

Exit criteria:

- [x] Touch keyboard toggles and key routing work through the live viewer.
- [x] Native and viewport fullscreen, Escape, and close preserve the mounted viewer and connection.

### 4. Clipboard paste

Implementation tasks:

- [x] Add a paste icon beside the keyboard control.
- [x] Read client clipboard text on tap and reuse the viewer's RFB clipboard and key APIs.
- [x] Use Shift+Insert for browser and terminal paste; display clipboard-access failures.
- [x] Verify Unicode paste in the live VM and permission failures without sending keys.

Exit criteria:

- [x] The header pastes clipboard text into the focused app over the existing connection.

## Tests

- Reuse upstream noVNC RFB/gesture coverage and the playground browser suite.
- Check touch gestures against the real desktop with an isolated input fixture.

## Validation Commands

```bash
cd backend
docker compose build pal
cd ../frontend-playground
npm run build
PLAYWRIGHT_CHANNEL=chrome npm test
```

Run the pinned upstream RFB/gesture tests in a temporary noVNC checkout.

## Overall Exit Criteria

- [x] The container reproducibly serves the patched viewer and ordinary mouse input works.
- [x] Browser checks verify relative movement with discrete clicks and local zoom.
- [x] The trial is available for the user's actual-device feedback.

## Deferred

- Actual iPhone Safari paste/keyboard/fullscreen usability approval belongs to the user's trial.

## Validation

- The Docker image builds and applies the patch to Debian noVNC 1.6.0. Hashes match between the tested source, running viewer, and rebuilt image. The live update preserves desktop applications and the API process.
- 643 upstream noVNC tests pass, with four upstream skips, including the short-swipe regression. The temporary 1.6 harness uses the pinned PR's locked test dependencies and its Chai `index.js` import.
- The playground build and all six browser tests pass, including clipboard transfer/access failures, populated-cache, and keyboard focus-race regressions.
- Chrome mobile emulation at 390×844 and DPR 3 over the Tailnet URL verifies actual X11 cursor movement without clicks, discrete tap clicks, right-click, scrolling, dragging/release, local pinch zoom and panning, the settings toggle, one desktop connection across sheet toggles, reconnect, and physical mouse clicks. The viewer remains 1200×900 with no browser errors.
- The trial uses the generated Tailnet-only HTTPS route. Cache recovery is confirmed; paste/keyboard/fullscreen feedback remains part of the phone trial.
- A browser preloaded with the actual original noVNC UI/core reproduces an unchecked trackpad setting and missing handler across reloads. The versioned viewer loads the patched UI/core with the setting enabled. The Tailnet viewer sends `Cache-Control: no-cache` for asset revalidation.
- Live Tailnet checks confirm header keyboard focus, key-event routing, two-tap show/hide behavior, viewport fullscreen with header controls, and one VNC connection across fullscreen and sheet toggles. Browser coverage also verifies native fullscreen exit and closing the sheet.
- Live Tailnet paste checks send multiline Chinese text and emoji into a temporary Chromium field and single-line Unicode into Xfce Terminal through the existing connection. Browser clipboard reads use generated test text; the client system clipboard is unchanged.
