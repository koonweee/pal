#!/bin/bash
set -euo pipefail
for attempt in {1..150}; do
  if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'; then
    exec node /opt/pal/dist/main.js
  fi
  sleep 0.2
done
echo "Desktop did not become ready within 30 seconds" >&2
exit 1
