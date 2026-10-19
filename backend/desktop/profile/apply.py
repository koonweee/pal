#!/usr/bin/env python3
"""Apply Pal's Xfce/X11 defaults once per user, inside their session D-Bus."""
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import time

ASSETS = Path('/usr/local/share/pal-desktop')
CONFIG = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config'))
STATE = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'pal-desktop'
STATE.mkdir(parents=True, exist_ok=True)
BACKUP = STATE / 'before-v1'


def run(*args, check=True):
    return subprocess.run(args, check=check, text=True, capture_output=True)


def backup(path):
    if path.exists():
        target = BACKUP / path.relative_to(CONFIG)
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.copy2(path, target)


def set_pref(channel, prop, value, kind=None):
    kind = kind or ('bool' if isinstance(value, bool) else 'int' if isinstance(value, int) else 'string')
    values = value if isinstance(value, list) else [value]
    args = ['xfconf-query', '-c', channel, '-p', prop, '-n']
    if isinstance(value, list):
        args.append('-a')
    for item in values:
        args += ['-t', kind, '-s', str(item).lower() if isinstance(item, bool) else str(item)]
    run(*args)


def apply_desktop():
    marker = STATE / 'desktop-v1'
    if marker.exists():
        return
    for channel in ['xfwm4', 'xsettings', 'xfce4-panel', 'xfce4-desktop']:
        backup(CONFIG / 'xfce4/xfconf/xfce-perchannel-xml' / (channel + '.xml'))
    panel_running = run('pgrep', '-u', str(os.getuid()), '-x', 'xfce4-panel', check=False).returncode == 0
    if panel_running:
        run('xfce4-panel', '--quit')
        for _ in range(50):
            if run('pgrep', '-u', str(os.getuid()), '-x', 'xfce4-panel', check=False).returncode != 0:
                break
            time.sleep(.1)
        else:
            raise RuntimeError('Xfce panel did not exit; retry after logging out.')
    try:
        for side in ['top', 'left', 'right', 'bottom']:
            set_pref('xfwm4', '/general/margin_' + side, 64)
        for key, value in {
            'theme': 'Pal', 'double_click_action': 'maximize',
            'borderless_maximize': False, 'titleless_maximize': False,
            'button_layout': '|HMC', 'title_font': 'Sans 10',
            'use_compositing': False, 'show_dock_shadow': False,
            'show_frame_shadow': True, 'shadow_opacity': 18,
        }.items():
            set_pref('xfwm4', '/general/' + key, value)
        for key, value in {'/Net/ThemeName': 'Pal', '/Net/IconThemeName': 'Papirus',
                           '/Gtk/FontName': 'Sans 10',
                           '/Gtk/DecorationLayout': 'menu:minimize,maximize,close'}.items():
            set_pref('xsettings', key, value)
        outputs = run('xrandr', '--query').stdout.splitlines()
        connected = [line for line in outputs if ' connected' in line]
        primary = next((line for line in connected if ' primary ' in line), connected[0])
        geometry = re.search(r'(\d+)x(\d+)\+(-?\d+)\+(-?\d+)', primary)
        if geometry is None:
            raise RuntimeError('No active X11 monitor geometry found.')
        width, height, left, top = map(int, geometry.groups())
        dock_position = f'p=0;x={left + width // 2};y={top + height - 32}'
        for prop in ['/panels', '/plugins']:
            run('xfconf-query', '-c', 'xfce4-panel', '-p', prop, '-r', '-R', check=False)
        set_pref('xfce4-panel', '/configver', 2)
        set_pref('xfce4-panel', '/panels', [1], 'int')
        set_pref('xfce4-panel', '/panels/dark-mode', False)
        for key, value in {
            'position': dock_position, 'position-locked': True,
            'size': 48, 'icon-size': 40, 'length': 1, 'length-adjust': True,
            'autohide-behavior': 0, 'enable-struts': False,
            'background-style': 0, 'enter-opacity': 100, 'leave-opacity': 100,
        }.items():
            set_pref('xfce4-panel', '/panels/panel-1/' + key, value)
        set_pref('xfce4-panel', '/panels/panel-1/plugin-ids', [1, 2, 3], 'int')
        working_dir = Path(os.environ.get('PAL_AGENT_WORKING_DIR', Path.home()))
        if not working_dir.is_dir():
            working_dir = Path.home()
        for number, (name, command, icon) in enumerate([
            ('Chromium', 'pal-browser', 'chromium'),
            ('Terminal', 'xfce4-terminal', 'utilities-terminal'),
            ('Files', 'thunar', 'folder'),
        ], 1):
            folder = CONFIG / 'xfce4/panel' / f'launcher-{number}'
            folder.mkdir(parents=True, exist_ok=True)
            launcher = folder / 'pal.desktop'
            backup(launcher)
            launcher.write_text(f'[Desktop Entry]\nType=Application\nName={name}\nExec={command}\nPath={working_dir}\nIcon={icon}\nTerminal=false\nStartupNotify=true\n')
            set_pref('xfce4-panel', f'/plugins/plugin-{number}', 'launcher')
            set_pref('xfce4-panel', f'/plugins/plugin-{number}/items', ['pal.desktop'], 'string')
        # Discover monitor names: VNC-0 in the container, actual outputs on a VM.
        monitors = [line.split()[0] for line in outputs if ' connected' in line]
        set_pref('xfce4-desktop', '/backdrop/single-workspace-mode', True)
        set_pref('xfce4-desktop', '/backdrop/single-workspace-number', 0)
        set_pref('xfce4-desktop', '/desktop-icons/style', 0)
        for monitor in monitors:
            prefix = '/backdrop/screen0/monitor' + monitor + '/workspace0/'
            set_pref('xfce4-desktop', prefix + 'last-image', str(ASSETS / 'wallpaper.svg'))
            set_pref('xfce4-desktop', prefix + 'image-style', 5)
        marker.touch()
    finally:
        if panel_running:
            subprocess.Popen(['xfce4-panel'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def apply_browser_launcher():
    # Update only the old Pal-owned launcher command; retain user customization.
    launcher = CONFIG / 'xfce4/panel/launcher-1/pal.desktop'
    if launcher.exists():
        text = launcher.read_text()
        if '\nExec=chromium\n' in text:
            launcher.write_text(text.replace('\nExec=chromium\n', '\nExec=pal-browser\n'))


def apply_chromium():
    marker = STATE / 'chromium-v1'
    if marker.exists():
        return
    # Never modify a live browser's preferences. Retry at the next login.
    if run('pgrep', '-u', str(os.getuid()), '-x', 'chromium', check=False).returncode == 0:
        print('Pal: Chromium appearance will apply at the next login with Chromium closed.')
        return
    defaults = json.loads((ASSETS / 'chromium.json').read_text())
    browser = CONFIG / 'chromium'
    for prefs in [browser / 'Default/Preferences', *sorted(browser.glob('Profile */Preferences'))]:
        if not prefs.exists():
            continue  # New profiles receive the system initial preferences.
        backup(prefs)
        data = json.loads(prefs.read_text())
        theme = data.setdefault('extensions', {}).setdefault('theme', {})
        theme.update(defaults['extensions']['theme'])
        theme['id'] = ''
        data.setdefault('browser', {}).update(defaults['browser'])
        temp = prefs.with_suffix('.pal-tmp')
        temp.write_text(json.dumps(data))
        temp.chmod(prefs.stat().st_mode & 0o777)
        temp.replace(prefs)
    marker.touch()


if __name__ == '__main__':
    apply_desktop()
    apply_chromium()
    apply_browser_launcher()
