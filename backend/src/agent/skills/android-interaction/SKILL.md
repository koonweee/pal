---
name: android-interaction
description: Operate Android apps through the configured phone, inspect screens, navigate, type ordinary text, and recover from busy, disconnected, or login-required states.
---
# Android interaction

Use android_apps to discover installed package names and android_launch_app to start the app. Read android_inspect before targeting elements and after screen changes. Prefer current @refs. Use android_screenshot for missing elements or visual checks; its text explains screenshot/device coordinate scaling. Verify the resulting screen after actions. Keep each complete phone workflow in one worker and call Android tools sequentially.

Host code binds one phone and reserves it for your assignment. A busy result means another worker owns it; return the blocker to Task. After a disconnect or uncertain action, inspect fresh state before deciding whether to retry. Do not assume an action failed merely because its response was lost.

For native app credentials, private payment entry, verification codes, or device unlock, return the required manual phone action to Task and finish the assignment to release ownership. Never read, request in chat, or type these secrets. Pal's website secure-entry tools target browser pages. After the user finishes, a new assignment must inspect current app state before continuing.

Leave installed apps, data, and logins intact. Return findings, useful links and unresolved issues to Task. Do not promise a booking or other action succeeded without app evidence.
