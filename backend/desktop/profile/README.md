# Pal desktop profile

Xfce/X11 appearance for Debian 13: coral GTK 3 and Xfwm themes, a gradient wallpaper, Papirus icons, 64 px workspace margins, and one centered Chromium/Terminal/Files launcher panel. Normal app windows maximize on opening, filling the inset area while retaining their title bar and border. Dialogs, utility windows, and fullscreen windows keep their normal behavior. Windows can still be restored and resized after opening. Picom supplies transparency, soft shadows, and matching 12 px corners on app windows, including maximized Chromium. Xfwm manages window placement with its own compositor disabled.

## Container

The Dockerfile runs `install.sh`. Before Xfce starts, `session.sh` runs the installed `apply.py` as `pal`. The profile sets defaults once and keeps later user changes across restarts. At 1200×900, the inset work area is 1072×772.

## Xfce VM

Use an Xfce 4.20 **X11** login on Debian/Ubuntu; validation uses Debian 13. Install dependencies and assets from this directory:

```bash
sudo apt-get install xfce4-session xfwm4 xfce4-panel xfdesktop4 xfce4-settings \
  xfce4-terminal thunar chromium devilspie2 picom papirus-icon-theme librsvg2-common \
  python3 procps x11-xserver-utils
sudo ../browser-install.sh
sudo ./install.sh
```

Close Chromium, then run this as the desktop user inside their Xfce session:

```bash
/usr/local/share/pal-desktop/apply.py
```

An XDG autostart entry also applies the profile at the next Xfce login. The installer uses `/usr/share/themes/Pal` and `/usr/local/share/pal-desktop`; user settings use standard home/XDG directories. Wallpaper outputs are discovered when the profile is first applied. Configure newly attached monitors through Xfce desktop settings. The dock is centered on the primary output during initialization. Launchers open in `PAL_AGENT_WORKING_DIR` when available, otherwise the user’s home.

## Preferences and backups

Application markers and original preference backups live in `${XDG_STATE_HOME:-~/.local/state}/pal-desktop/`. Backups are under `before-v1/`, relative to the user's configuration directory. The installer replaces the panel layout and theme/wallpaper settings on its first application. Other settings and browser data remain in place.

Chromium defaults are merged into Debian's `/etc/chromium/master_preferences` (its initial-preferences file). The profile enables GTK appearance and the browser's integrated tab/title bar. Existing Default and Profile directories receive those appearance settings once while Chromium is closed. If Chromium is running, migration waits for a later login or manual invocation. Custom `--user-data-dir` profiles are outside this migration.

To deliberately reapply the defaults, close Chromium, remove `desktop-v1` and `chromium-v1` from the state directory, and run `apply.py` again. To restore backed-up preferences, log out of Xfce and stop Chromium before copying the original files into their matching configuration paths; retain the markers to prevent reapplication.

The GTK theme extends GTK 3's built-in Adwaita styling. The Xfwm XPM artwork and SVG wallpaper are original assets. Papirus comes from the distribution package. GTK 4/libadwaita applications can have their own appearance rules.

## Window rules

Devilspie2 applies `window-rules/maximize.lua` when windows open, including launches from the dock, terminal, or agent. Xfwm has no global maximize-on-open preference, so this uses the distribution's window-matching utility. XDG autostart starts it with each Xfce session in both the container and VM. Disable **Pal window rules** in Xfce Session and Startup to opt out.

## Rounded windows

The **Pal rounded windows** XDG autostart entry disables Xfwm compositing and starts Picom with `picom.conf`. Its XRender backend supports TigerVNC without GPU acceleration. A 12 px radius applies to app windows; desktop, dock, and fullscreen windows are excluded. The dock retains its GTK styling. To use Xfwm compositing again, disable that autostart entry, stop Picom, and enable compositing in Window Manager Tweaks.
