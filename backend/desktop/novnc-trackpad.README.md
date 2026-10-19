# noVNC touch trackpad

`novnc-trackpad.patch` ports [noVNC PR #2065](https://github.com/novnc/noVNC/pull/2065) at `f634c6b37e944d82fc377259e1b5e22672a65877` onto Debian noVNC 1.6.0. The Docker build applies it to `/usr/share/novnc`; websockify serves the patched files. noVNC remains under MPL-2.0.

The patch provides relative touch movement, tap to click, two-finger right click/scroll, selection dragging, and local pinch zoom/pan. The playground enables `trackpad_mode=true`. Users can change **Trackpad mode (touch)** in the viewer settings. Physical mouse input keeps its existing behavior.

The port includes the upstream touch/gesture changes and iOS native-zoom suppression. The UI additions use the 1.6 settings layout. Remote display sizing and clipboard controls keep their 1.6 behavior. The port suppresses a tap after a short swipe: the raw-touch movement threshold is smaller than the gesture handler’s drag threshold. `novnc-trackpad.tests.patch` contains the upstream trackpad tests plus a regression for that case against the 1.6 checkout.

To update, review a specific upstream revision, port the touch changes against the installed Debian viewer, and regenerate the patch. The build must fail if it no longer applies. Run upstream RFB/gesture tests and live browser checks for movement without clicks, taps at the cursor, scroll, drag, pinch zoom, settings toggles, and reconnect. Confirm touch behavior on an actual phone.

## Test port

Apply `novnc-trackpad.patch` and `novnc-trackpad.tests.patch` to a clean upstream `v1.6.0` checkout. Use the pinned PR revision's locked test dependencies. The 1.6 test harness imports `chai/chai.js`; change that temporary import to `chai/index.js` for these dependencies. Run `TEST_BROWSER_NAME=ChromeHeadless npm test` with `CHROME_BIN` pointing to Chrome. The test patch includes the upstream trackpad cases and the short-swipe regression.
