#!/bin/bash
set -euo pipefail
# Only one compositor can own an X11 screen.
xfconf-query -c xfwm4 -p /general/use_compositing -n -t bool -s false
exec picom --config /usr/local/share/pal-desktop/picom.conf
