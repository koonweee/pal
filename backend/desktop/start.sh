#!/bin/bash
set -euo pipefail
if [[ "${PAL_DESKTOP_ENABLED:-false}" != true ]]; then
  exec node /opt/pal/dist/main.js
fi
mkdir -p "$XDG_RUNTIME_DIR" "$HOME/.config/xfce4/xfconf/xfce-perchannel-xml"
chmod 700 "$XDG_RUNTIME_DIR"
exec supervisord -n -c /opt/pal/desktop/supervisord.conf
