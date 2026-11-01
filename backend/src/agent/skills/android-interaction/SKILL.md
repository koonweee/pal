---
name: android-interaction
description: Operate Android apps through the configured phone, inspect screens, navigate, type ordinary text, and recover from busy, disconnected, or login-required states.
---
# Android interaction

Use android_apps to discover installed package names and android_launch_app to start the app. Read android_inspect before targeting elements and after screen changes. Prefer current @refs. Use android_screenshot for missing elements or visual checks; its text explains screenshot/device coordinate scaling. Verify the resulting screen after actions. Keep each complete phone workflow in one worker and call Android tools sequentially.

Host code binds one phone and reserves it for your assignment. A busy result means another worker owns it; return the blocker to Task. After a disconnect or uncertain action, inspect fresh state before deciding whether to retry. Do not assume an action failed merely because its response was lost.

For authentication, load website-authentication for the shared account/private-entry procedure. Navigate to the native form, then use login_inspect with target android and its opaque refs for secure_fill or secure_entry_request. Host code validates the configured app identity and fills native nodes privately. Navigation invalidates refs. Yield on awaiting_user; the host reserves the phone for up to ten minutes. On continuation inspect current state before acting. Never enter credentials/codes through android_type.

Private payment entry, device unlock, biometrics and unsupported login destinations require a manual phone handoff to Task. Finish that assignment to release ownership. Preserve the user's app data and existing sessions.

Leave installed apps, data, and logins intact. Return findings, useful links and unresolved issues to Task. Do not promise a booking or other action succeeded without app evidence.
