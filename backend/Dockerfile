# syntax=docker/dockerfile:1
FROM node:24.15.0-trixie-slim@sha256:291be77873bc04731968cacf82f0fcef17cee8cf200c6b6951e2bcab41560eb7 AS base

FROM base AS build
WORKDIR /opt/pal
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ src/
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git python3 python3-venv ripgrep sudo \
    xfce4-session xfwm4 xfce4-panel xfdesktop4 xfce4-settings xfce4-terminal thunar devilspie2 picom papirus-icon-theme librsvg2-common \
    dbus-x11 tigervnc-standalone-server novnc websockify supervisor xdotool x11-utils x11-xserver-utils x11-xkb-utils \
    chromium chromium-sandbox fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji python3-pil \
    && rm -rf /var/lib/apt/lists/* \
    && groupmod -n pal node \
    && usermod -l pal -d /data/home node \
    && printf 'pal ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/pal \
    && chmod 0440 /etc/sudoers.d/pal \
    && mkdir -p /data/home /data/workspace /data/agent /data/uploads \
    && chown -R pal:pal /data
WORKDIR /opt/pal
ENV NODE_ENV=production HOME=/data/home \
    PAL_AGENT_WORKING_DIR=/data/workspace \
    PAL_AGENT_AUTH_PATH=/data/agent/auth.json \
    PAL_UPLOAD_DIR=/data/uploads HOST=0.0.0.0 PORT=3000
COPY --from=build /opt/pal/package.json /opt/pal/package-lock.json ./
COPY --from=build /opt/pal/node_modules/ node_modules/
COPY --from=build /opt/pal/dist/ dist/
COPY migrations/ migrations/
COPY desktop/ desktop/
COPY browser-extension/ browser-extension/
RUN git apply --unsafe-paths --directory=/usr/share/novnc desktop/novnc-trackpad.patch \
    && desktop/profile/install.sh \
    && desktop/browser-install.sh
ENV DISPLAY=:1 XDG_RUNTIME_DIR=/tmp/pal-runtime \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/pal-runtime/bus \
    XDG_CURRENT_DESKTOP=XFCE XDG_SESSION_TYPE=x11 LANG=C.UTF-8
USER pal
EXPOSE 3000 6080
CMD ["/opt/pal/desktop/start.sh"]
