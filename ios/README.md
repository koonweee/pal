# Pal for iOS (Deprecated)

> [!WARNING]
> This native SwiftUI client is deprecated and unsupported. It is retained as reference source and is no longer maintained or distributed. Use the supported [React PWA](../frontend/README.md).

The client targets iOS 26 and later and contains Main chat, Tasks with direct task conversations, Settings, files, and notifications. The deprecated [implementation plan](../plans/native-ios.md) and [notification plan](../plans/native-notifications.md) retain prior scope and evidence.

The retained presentation includes a floating native page menu, avatar and activity glint, glass composer, message layout, optimistic send behavior, reading-position restoration, image grids, Quick Look presentation, and native Markdown rendering. Pal's transport, persistence identity, Tasks model, and notifications use Pal's contracts.

For reference builds, open `Pal/Pal.xcodeproj` in Xcode and select the `Pal` scheme. The checked-in production bundle ID is `com.example.pal`; `Pal Dev` uses `com.example.pal.dev`. Both configurations start without a default backend. Enter the root private HTTPS URL in Settings. Debug builds additionally allow HTTP loopback for disposable fixtures.

## Navigation and conversations

The app retains native `TabView` state while presenting Chat, Tasks, and Settings through the floating menu. Main and Task conversations share one chat view and composer. Each conversation owns its draft, pending submission, pagination, and reading position. Tapping a task opens its conversation; the Info button shows its current goal, description, and status. Updates, Schedules, and action buttons are outside the first release.

The client opens the SSE stream before fetching a snapshot, buffers live events while the snapshot loads, and merges messages by backend ID and version. SSE event IDs are transport details. Reconnection uses authoritative snapshots. Optimistic owner messages reconcile through `idempotencyKey`, since Pal generates canonical message IDs. Only unconfirmed submissions offer Retry; an acknowledged submission shows a non-actionable sent state until the canonical message arrives. The latest persisted owner message shows a subtle Read timestamp; it fades upward into place and omits movement when Reduce Motion is enabled.

Every native request sends the first-party contract version implemented when development stopped. The native SSE decoder ignores the web-only `frontend.updated` event.

Attachment trays, send-button states, scroll-to-bottom controls, task status badges, composer errors, and the avatar working glint use short state transitions. Single images reserve a 240-point preview area and fade in after decoding; grids retain square crops. Reduce Motion disables these custom animations. Incoming replies use a 120 ms lead-in before the existing arrival transition. Only an actual pending submission with a matching request key suppresses a duplicate entrance. The disabled send button uses a native plain button with adaptive gray foreground and fill; the enabled button uses the prominent style.

Photo sources remain protected local files until upload. Pal uploads them through `POST /files`, persists returned attachment IDs in the pending submission, then sends the frozen message payload. An uncertain submission reuses the same idempotency key and attachment IDs. Message images use the retained decoded-image and original-file caches; Quick Look receives the original server bytes.

The conversation uses a `LazyVStack` with MarkdownUI 2.4.1. Parsed Markdown is cached across row reuse, while offscreen message views can leave the hierarchy. Markdown image providers are disabled because authenticated message attachments use `ChatImage`; headings, lists, links, selection, code blocks, and horizontally scrolling tables remain native.

With 200 fixture messages, the virtualized renderer reduced measured simulator CPU from 5.46 seconds to 0.95 seconds and peak physical memory from 194.4 MB to 51.1 MB. It passes pagination anchoring, 12 exact slow drags, and rich-Markdown structure and image-isolation checks. The comparative measurements are Debug simulator evidence; physical-device Release profiling remains separate.

Earlier-history pages are merged, sorted, reconciled, and saved as one batch. This reduced the measured 25-message merge from 8.72 ms to 3.36 ms without changing the chat UX. Full experiment results are in the [conversation performance plan](../plans/ios-conversation-performance.md).

## Local state and replacement

No migration from another app is provided. Pal uses `pal.native.*` defaults and `com.example.pal.native.*` Keychain namespaces. Later Pal launches retain Pal's own drafts, pending sends, and bounded conversation cache.

## Reference build

From the repository root:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project ios/Pal/Pal.xcodeproj -scheme Pal \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .local/pal-ios CODE_SIGNING_ALLOWED=NO build
```

The imported presentation baseline and Pal contract slice build with Xcode 27.0. On 2026-10-14 the full `Pal` scheme passed 14 unit and focused UI tests on the iPhone 18 Pro simulator (`031A26CE-F844-44B7-99ED-11230B19FCF4`); the opt-in performance benchmark was skipped:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet \
  -project ios/Pal/Pal.xcodeproj -scheme Pal \
  -destination 'platform=iOS Simulator,id=031A26CE-F844-44B7-99ED-11230B19FCF4' \
  -derivedDataPath .local/pal-ios-tests test
```

Signed export, installation, and APNs results are recorded separately because simulator success cannot establish them.

Debug fixture launches use `-pal-fixture`. Additional fixture flags remain available while their retained regressions are adapted. Fixtures never call Pal or external providers.

The opt-in 200-message scrolling benchmark runs five iterations and records scrolling, hitch, CPU, and memory metrics. Set the flag in the booted simulator process environment, run the test, then remove it:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun simctl spawn \
  <device-id> launchctl setenv PAL_PERFORMANCE 1

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project ios/Pal/Pal.xcodeproj -scheme Pal \
  -destination 'platform=iOS Simulator,id=<device-id>' \
  -derivedDataPath .local/pal-ios-performance \
  -only-testing:PalUITests/PalUITests/testLongConversationScrollingPerformance test

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun simctl spawn \
  <device-id> launchctl unsetenv PAL_PERFORMANCE
```

## Accessibility and native behavior

Retained UI must support Dynamic Type, VoiceOver, system appearance, Reduce Motion, Reduce Transparency, safe areas, keyboard interaction, and 44-point controls. Prefer native SwiftUI navigation, menus, pickers, presentations, photo selection, and Quick Look. Validate relevant changes in previews and a disposable simulator; final connectivity, signing, performance, and APNs acceptance require a physical device.

## Historical notifications and distribution

The app contains native notification permission, registration, foreground suppression, background refresh, and tap handling. Pal keeps one current installation for its configured backend; changing backend creates a fresh identity without legacy revocation machinery. APNs notifications show a bounded plain-text message preview. Their custom data contains the installation ID for scope validation, and every notification tap opens Main. The canonical message remains on Pal and the app refreshes from the private backend. Its endpoints and provider worker are documented in the [notification plan](../plans/native-notifications.md). Simulator notification fixtures validate app behavior but do not establish APNs provider delivery.

Ad Hoc archives used the existing `AdHoc` and `Dev AdHoc` configurations. The commands below are retained as historical validation reference; the deprecated app is not distributed.

For production build `N`:

```sh
ios/scripts/export-adhoc.sh prod N
python3 ios/scripts/verify-adhoc.py .local/adhoc/prod-N/export/Pal.ipa N
```

The verifier defaults to bundle `com.example.pal`; `PAL_IOS_BUNDLE_ID` selects another identifier. It also requires display name `Pal`, an empty packaged backend default, production APNs in the app signature and profile, an unexpired Ad Hoc profile with registered devices, a strict code signature, and the requested build number. Distribution configuration and records stay outside the repository.

Validation covers the full simulator suite, arrival indication, delayed-image geometry, send reconciliation, and Reduce Motion. Physical-device installation, motion quality, and real APNs presentation remain device checks.
