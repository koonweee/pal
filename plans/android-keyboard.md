# Android keyboard policy

## Status

Done

## Goal

Suppress Android's normal onscreen keyboard during agent and PWA use. Offer an explicit PWA client-keyboard toggle for touch devices.

## Current Behavior

The sidecar owns ADB and on-demand scrcpy viewers. Pal and the PWA inject text directly. Scrcpy device messages expose no focused-input event. Desktop uses an explicit keyboard toggle.

## Milestones

### 1. Persistent hardware keyboard

- Maintain a control-only scrcpy session using Tango's HID descriptor.
- Set Android's show-onscreen-keyboard-with-hardware-keyboard policy off; reconnect after device loss and clean up on shutdown.

Exit: Android recognizes the keyboard with the PWA closed and typing still works without the Android IME.

### 2. PWA keyboard toggle

- Reuse Desktop's explicit toolbar toggle pattern and a client textarea for native touch keyboard input.
- Forward text, deletion, Enter and composition without sending duplicate characters; preserve focused input when tapping the preview.

Exit: focused tests and real-device input checks pass; development PWA refreshed. No production deployment.

## Tests

- Focused client-keyboard input, composition and deletion coverage.
- Real phone: Android IME hidden with/without viewer, PWA toggle input, paste, reconnect and viewer cleanup.

## Validation Commands

- Frontend check, UI ownership and focused unit tests.
- `./scripts/dev-local android-up` and `./scripts/dev-local pwa-up`.

## Overall Exit Criteria

The sidecar keeps Android's normal keyboard suppressed, PWA users can explicitly open their client keyboard, and limitations are documented.

## Acceptance

- Samsung recognizes `Pal keyboard` with the viewer closed. Native input-view visibility and screenshots verified before and after upstream Mobile MCP ordinary typing into the synthetic fixture.
- Chrome and Playwright WebKit pass explicit toggle focus/blur/reopen, text insertion, Backspace, and focus retention while tapping the Android preview. Android's IME remains hidden throughout.
- Removing the control-only scrcpy process recreates the hardware keyboard automatically; suppression is restored (`mIsInputViewShown=false`; Samsung may keep its IME navigation strip active). Closing viewers leaves only the intended control-only session.
- Two focused client-keyboard tests cover text/deletion/Enter and composition without duplicate insertion. Frontend TypeScript and UI ownership checks pass.
- Development sidecar and staged PWA refreshed. No production deployment.

Physical iPhone keyboard presentation remains unverified; automated WebKit checks verify the user-gesture focus path. Unicode/IME character coverage remains bounded by scrcpy text injection. The WebKit touch path preserves the click event instead of cancelling pointer-down.

Chrome acceptance passed through the Tailscale staged PWA. WebKit passed the local frontend integration; staged WebKit acceptance was blocked by the existing PWA update lifecycle/error overlay intercepting toolbar taps (including in the service-worker-disabled diagnostic context). No claim of physical iPhone or complete WebKit PWA acceptance is made.
