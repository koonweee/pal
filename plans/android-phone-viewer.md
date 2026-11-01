# Android phone viewer

## Status

Done

## Goal

An interactive live phone drawer in the development PWA, beside Desktop.

## Current Behavior

Desktop uses a Mantine drawer and noVNC. The Android sidecar owns ADB for the configured USB phone.

## Milestones

### 1. Stream and drawer

- Use Tango with pinned stock scrcpy 3.3.3; forward media and control over an authenticated sidecar WebSocket through Pal.
- Reuse drawer styles, header actions and update safety. Support touch, navigation, keyboard, reconnect and fullscreen.
- Open starts streaming; close releases resources. No control ownership UI.

Exit: builds and focused checks pass; unavailable phone leaves the rest of Pal usable.

### 2. Development acceptance

- Rebuild the dev sidecar/backend/PWA.
- Verify real phone video, tap, swipe, text, navigation, close/reopen and responsive layout.
- Preserve logged-in accounts; no production deployment.

Exit: staged PWA tested and evidence recorded here.

## Tests

- Focused viewer transport lifecycle/error coverage and frontend control/cleanup checks.
- Live phone acceptance through the staged gateway.

## Validation Commands

- Backend build and lint; frontend check and focused tests.
- `./scripts/dev-local android-up`, `./scripts/dev-local rebuild`.

## Overall Exit Criteria

The dev PWA streams and controls the configured phone, closes cleanly and reports unavailable connections. Browser support limitations are recorded.

## Acceptance evidence

Verified on 2026-11-01 against the Mac-connected Samsung phone:

- Chrome and Playwright WebKit 26.6 rendered real video. Chrome acceptance also passed through `https://jtkwmini.tail445f8.ts.net:8444`.
- Synthetic fixture: touchscreen tap and hardware-keyboard text confirmed from device UI; long press visibly selected text. Drag opened the notification shade. Home, Back, fullscreen, reconnect and reopen passed.
- Touch-toolbar Paste reads the client clipboard and injects text into the focused fixture field; empty clipboard and permission-denied feedback verified. Android clipboard synchronization remains disabled.
- Closing the drawer releases its viewer scrcpy process. A separate control-only session maintains the hardware keyboard; see [Android keyboard policy](android-keyboard.md). An injected unavailable WebSocket showed retry status and allowed opening Desktop.
- Portrait layout at 390×844 keeps the header, screen and navigation inside the drawer. The inherited desktop body height was corrected after screenshot review.
- Backend build/lint and focused gateway test passed. Frontend TypeScript, UI ownership and reload-safety test passed; staged production frontend build passed.

Limits: no physical iPhone/Safari PWA acceptance yet; WebKit coverage is automated on macOS. Hardware text uses scrcpy's ordinary text injection (Unicode/IME coverage is limited); the phone's onscreen keyboard is usable by touch. Audio and ownership arbitration are outside this version. Orientation follows the phone without changing its rotation settings.

Development only; no production deployment. Test fixture and temporary smoke artifacts are removed after acceptance. Existing account sessions are preserved.
