#!/bin/sh
# Start the USB ADB server and authenticated Mobile MCP in this container.
set -eu
: "${MOBILEMCP_AUTH:?Mobile MCP bearer token required}"
umask 077
adb start-server
exec /opt/android/node_modules/.bin/mcp-server-mobile --listen 0.0.0.0:3000
