#!/bin/bash
set -euo pipefail
# Supervisor stops this entire process group. Restart it when either child exits.
Xtigervnc "$DISPLAY" -geometry 1200x900 -depth 24 -SecurityTypes None \
  -localhost -AlwaysShared -AcceptSetDesktopSize=0 -nolisten tcp -ac &
x_pid=$!
trap 'kill "$x_pid" ${session_pid:-} 2>/dev/null || true; wait || true' EXIT
for attempt in {1..100}; do
  if xdpyinfo >/dev/null 2>&1 && dbus-send --session --type=method_call --print-reply \
    --dest=org.freedesktop.DBus / org.freedesktop.DBus.ListNames >/dev/null 2>&1; then
    break
  fi
  kill -0 "$x_pid"
  sleep 0.1
done
xdpyinfo >/dev/null
setxkbmap us
xset s off
xset -dpms 2>/dev/null || true
xfconf-query -c xfce4-session -p /general/SaveOnExit -n -t bool -s false
/usr/local/share/pal-desktop/apply.py
xfce4-session &
session_pid=$!
wait -n "$x_pid" "$session_pid"
exit 1
