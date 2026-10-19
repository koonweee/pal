# Pal Desktop Appearance

## Status

Done

## Goal

Provide a coral Xfce desktop with 64 px workspace margins, one compact launcher dock, coordinated Chromium appearance, and a reusable Linux installer.

## Current Behavior

- Xfce 4.20 runs on TigerVNC at 1200×900 with a persistent home.
- `backend/desktop/start.sh` starts supervision; `session.sh` applies the profile and initializes Xfce.
- The appearance profile owns its assets and applies user defaults once, preserving later customization.

## Milestones

### 1. Package and Integrate the Profile

Implementation tasks:

- [x] Bundle original wallpaper and matching GTK/Xfwm styling; use packaged icons.
- [x] Provide system installation and idempotent user application, with backups of changed preferences.
- [x] Configure 64 px margins, title-bar maximize, compositing, and one bottom launcher panel.
- [x] Seed Chromium GTK appearance and migrate existing profiles while Chromium is closed.
- [x] Integrate container startup and document installation on an Xfce/X11 VM.

Exit criteria:

- [x] A fresh profile initializes successfully and repeated application preserves customization.
- [x] Existing profiles are backed up and updated without changing unrelated settings.

### 2. Validate the Desktop

Implementation tasks:

- [x] Build the desktop image and inspect the resulting desktop.
- [x] Check window geometry, double-click maximize, all launchers, Chromium appearance, and restart persistence.
- [x] Update documentation and plan status with actual validation.

Exit criteria:

- [x] The visible desktop has one coral dock and coordinated apps with 64 px reserved on every side.
- [x] Container startup succeeds and the profile is reusable with standard home/XDG paths.

### 3. Fill Newly Opened App Windows and Match Rounded Corners

Implementation tasks:

- [x] Install a Devilspie2 normal-window maximize rule through the portable profile's XDG autostart.
- [x] Package Picom with XRender and a shared 12 px corner radius; retain Xfwm for window management.
- [x] Validate automatic inset maximize, restoration, dialog exclusion, and session restart.

Exit criteria:

- [x] New app windows fill the inset area from any launch path; dialogs and fullscreen retain their normal behavior.
- [x] Container and VM installation include the rule and compositor dependencies.
- [x] Maximized Chromium and GTK apps have matching rounded corners without screenshot/input regressions.

## Tests

- One live desktop smoke check covers inset geometry, launchers, fresh/existing profile application, and idempotency.
- Inspect screenshots for theme, wallpaper, transparency, and browser rendering.

## Validation Commands

```bash
bash -n backend/desktop/*.sh backend/desktop/profile/install.sh
cd backend
docker compose build pal
npm run desktop:smoke
```

## Overall Exit Criteria

- [x] All appearance requirements work in the container.
- [x] Installation and persistence are documented for the container and a Debian-based Xfce/X11 VM.
- [x] Existing application changes and persistent user data remain intact.

## Validation Results

- Debian 13 / Linux ARM64 image builds; shell syntax and Python parsing pass.
- Fresh desktop and persistent-home application pass. Original preferences are backed up; repeat application preserves an intentional margin customization and unrelated browser settings.
- Double-click maximize produces a 1072×772 outer window at (64, 64). Chromium respects the same bounds with its integrated frame.
- All three dock launchers work; screenshots confirm coral styling, wallpaper, Papirus icons, transparency, and a floating dock.
- Existing desktop smoke suite passes screenshots, all computer input methods, Unicode, chords, and display-outage behavior with compositing enabled.
- Profile settings survive desktop restart; API, D-Bus, desktop, and viewer remain operational.
- VM installation is documented for Xfce 4.20 on X11; a separate VM has not been provisioned.

- Picom 12.5 (XRender) and Devilspie2 0.42 run through XDG autostart. Exactly one of each returns after a desktop restart; Xfwm compositing is disabled.
- A disposable X11 check validates automatic maximize to the inset area, dialog/fullscreen exclusions, and manual restore after opening.
- Chromium and Thunar screenshots confirm matching 12 px corners while maximized. The existing desktop smoke suite passes with Picom and window rules enabled.

- Chromium-only GTK decoration overrides replace inherited Adwaita frame borders with a 1 px coral resize edge and remove the top highlight. Restored-window screenshots, mouse-edge resizing, and title-bar maximize pass; other app selectors are unchanged.
