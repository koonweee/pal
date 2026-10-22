#!/bin/bash
set -euo pipefail
mkdir -p "$XDG_RUNTIME_DIR" "$HOME/tmp" "$HOME/workspace" "$HOME/incoming" "$HOME/.config/xfce4/xfconf/xfce-perchannel-xml"
chmod 700 "$XDG_RUNTIME_DIR"
exec supervisord -n -c /opt/pal/desktop/supervisord.conf
