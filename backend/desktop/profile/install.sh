#!/bin/bash
# Debian/Ubuntu, run as root after installing the dependencies in README.md.
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
install -d /usr/local/share/pal-desktop /usr/share/themes/Pal
cp -R "$source_dir/Pal/." /usr/share/themes/Pal/
install -m 644 "$source_dir/wallpaper.svg" "$source_dir/chromium.json" /usr/local/share/pal-desktop/
install -m 755 "$source_dir/apply.py" /usr/local/share/pal-desktop/apply.py
# Debian's Chromium reads this file; retain all distribution defaults.
python3 - <<'PYTHON'
import json
from pathlib import Path
path = Path('/etc/chromium/master_preferences')
path.parent.mkdir(parents=True, exist_ok=True)
data = json.loads(path.read_text()) if path.exists() else {}
defaults = json.loads(Path('/usr/local/share/pal-desktop/chromium.json').read_text())
data.setdefault('extensions', {}).setdefault('theme', {}).update(defaults['extensions']['theme'])
data.setdefault('browser', {}).update(defaults['browser'])
path.write_text(json.dumps(data, indent=2) + '\n')
PYTHON
# XDG autostart also applies the profile on ordinary VM logins.
install -d /etc/xdg/autostart
cat > /etc/xdg/autostart/pal-desktop.desktop <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Pal desktop defaults
Exec=/usr/local/share/pal-desktop/apply.py
OnlyShowIn=XFCE;
Terminal=false
DESKTOP

# Xfwm has no global maximize-on-open preference. Use the packaged window matcher.
install -d /usr/local/share/pal-desktop/window-rules
install -m 644 "$source_dir/window-rules/maximize.lua" /usr/local/share/pal-desktop/window-rules/
cat > /etc/xdg/autostart/pal-window-rules.desktop <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Pal window rules
Exec=devilspie2 --folder=/usr/local/share/pal-desktop/window-rules
OnlyShowIn=XFCE;
Terminal=false
DESKTOP

install -m 644 "$source_dir/picom.conf" /usr/local/share/pal-desktop/
install -m 755 "$source_dir/compositor.sh" /usr/local/share/pal-desktop/
cat > /etc/xdg/autostart/pal-compositor.desktop <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Pal rounded windows
Exec=/usr/local/share/pal-desktop/compositor.sh
OnlyShowIn=XFCE;
Terminal=false
DESKTOP
