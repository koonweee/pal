---
name: android-interaction
description: Operate Android apps through the configured phone, inspect screens, navigate, type ordinary text, and recover from busy, disconnected, or login-required states.
---
# Android interaction

Use android_apps to discover installed package names and android_launch_app to start the app. Keep each complete phone workflow in one worker.

Use the latest android_inspect result or android_batch end inspection to choose the next action. After navigation or layout changes, inspect once; reuse that observation until an action changes the screen. Batch predictable ordinary sequences, such as focus/type/submit or swipe/inspect, with android_batch and listElementsAtEnd. Do not immediately repeat its end inspection or batch decisions that depend on unseen results.

Refs can be reassigned when upstream re-reads a changing screen. For dynamic content, tap the center of the target's bounds from the latest observation using x/y, omitting ref; upstream gives ref precedence. Use refs on settled screens. After a scroll or layout change, obtain a fresh target. Verify the resulting screen before continuing, especially for adjacent controls with different effects.

When expected content is absent from inspection, take android_screenshot of that same screen before calling it blank or unavailable. If the content is visible, use visual targeting; convert screenshot coordinates to device pixels using the returned dimensions. If it is still missing, try one targeted alternative and preserve confirmed facts. Use android_swipe position/distance for the relevant scroll region and android_clipboard after copying a needed link or text.

Host code binds one phone and reserves it for your assignment. A busy result means another worker owns it; return the blocker to Task. After a disconnect or uncertain action, inspect fresh state before deciding whether to retry. Do not assume an action failed merely because its response was lost.

For authentication, load website-authentication for the shared private-entry procedure. Navigate to the native form with Android tools, then call inspect_private_fields with the service's HTTPS account origin. Host code uses the active Android surface and fills inspected nodes privately. Private-field refs are separate from ordinary screen refs. Returning to ordinary tools invalidates them. Yield on awaiting_user; the host reserves the phone for up to ten minutes. On continuation inspect current state before acting. Never enter credentials or codes through android_type.

Private payment entry, device unlock, biometrics and unsupported login destinations require a manual phone handoff to Task. Finish that assignment to release ownership. Preserve the user's app data and existing sessions.

Leave installed apps, data, and logins intact. Return findings, useful links and unresolved issues to Task. Do not promise a booking or other action succeeded without app evidence.
