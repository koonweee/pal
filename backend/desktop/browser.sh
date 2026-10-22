#!/bin/bash
# Shared by the desktop launcher and Pal's browser service.
set -euo pipefail
script="$(readlink -f -- "$0")"
app_dir="$(cd -- "$(dirname -- "$script")/.." && pwd)"
profile="${PAL_BROWSER_PROFILE:-${XDG_CONFIG_HOME:-$HOME/.config}/chromium}"
mkdir -p "$profile"
exec "${PAL_BROWSER_EXECUTABLE:-chromium}" \
  --user-data-dir="$profile" \
  --proxy-server="http://web:3128" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="${PAL_BROWSER_PORT:-9222}" \
  --load-extension="$app_dir/browser-extension" \
  --no-first-run --no-default-browser-check \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  --disable-session-crashed-bubble "$@"
