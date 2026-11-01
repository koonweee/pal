#!/bin/sh
# ADB and both bridges share one private sidecar and USB identity.
set -eu
: "${MOBILEMCP_AUTH:?Mobile MCP bearer token required}"
: "${PAL_ANDROID_DEVICE_ID:?Android device serial required}"
umask 077
adb start-server
exec node /opt/android/server.mjs
