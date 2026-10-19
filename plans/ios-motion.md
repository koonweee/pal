# iOS Motion Refinements

## Status

Done

## Goal

Smooth conversation and task state changes and publish a verified production iOS build.

## Current Behavior

Chat uses native controls, virtualized messages, scoped state transitions, and retained reading positions. Single-image previews reserve their height during loading. Reply presentation uses a 120 ms lead-in.

## Milestones

### 1. Motion and continuity

- [x] Animate attachment tray, send controls, scroll-to-bottom control, task badges, error strip, and working glint.
- [x] Reserve single-image preview geometry and fade loaded images.
- [x] Reduce reply lead-in to 120 ms without an additional entry delay.
- [x] Respect Reduce Motion and preserve native interactions.

Exit criteria:

- [x] Build and existing chat, task, pagination, and reading-position regressions pass.
- [x] Inspect representative simulator states including Reduce Motion.

### 2. Publication

- [x] Export and verify a new production Ad Hoc build.
- [x] Verify the signed package through the private distribution workflow.
- [x] Commit the implementation and validation record.

Exit criteria:

- [x] The verified build is available through the private distribution channel.

## Tests

Reuse the existing iOS suite and add one delayed-image regression for stable preview geometry. Inspect media and composer states in the simulator. Physical-device motion quality remains a device check.

## Validation Commands

Use the Xcode test command and Ad Hoc export/verification commands in `ios/README.md`.

## Overall Exit Criteria

- [x] Scoped transitions pass simulator checks and preserve conversation anchoring.
- [x] The verified production build is distributed and changes are committed.

## Validation Evidence

- The existing iPhone 18 Pro simulator suite passed 14 tests; the opt-in performance benchmark was skipped.
- The added delayed-image geometry regression passed. Main send/reconciliation also passed with the simulator Reduce Motion setting enabled; its original setting was restored afterward.
- Delayed-image screenshots confirmed stable visible message bounds before and after decoding. Attachment and recovery previews are available in `ChatPreviews.swift`.
- The signed package passed strict signing, bundle identity, provisioning, and production APNs verification.
- Motion feel and installation on a physical device remain device validation; simulator checks do not establish those results.

## Follow-up: send contrast and assistant arrival

- [x] Use a native plain button with adaptive gray foreground and fill for the disabled send control.
- [x] Require an actual pending send before matching an incoming message to it.
- [x] Validate the missing-request-key regression, chat flows, and simulator appearance.
- [x] Distribute and verify the corrected production build; commit the fixes.

Follow-up validation: the full simulator suite passed with the opt-in benchmark skipped. The extended send-flow UI test separately verified the arrival indicator before the reply. Dark/light simulator inspection confirmed the adaptive disabled-button treatment. Signed-package production APNs checks pass. Production lead-in remains 120 ms; only the explicit observation fixture uses five seconds.
