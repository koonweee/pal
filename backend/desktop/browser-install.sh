#!/bin/bash
# Run as root from the installed Pal checkout/image.
set -euo pipefail
app_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
ln -sf "$app_dir/desktop/browser.sh" /usr/local/bin/pal-browser
install -d /usr/local/share/applications
cat > /usr/local/share/applications/chromium.desktop <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Chromium
Exec=pal-browser %U
Icon=chromium
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupNotify=true
DESKTOP
