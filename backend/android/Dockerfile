# syntax=docker/dockerfile:1
# Build APKs on AMD64: Google's Linux SDK build tools target x86-64.
FROM --platform=linux/amd64 gradle:8.11.1-jdk17@sha256:91d559b8d55f522de5bc6882f73bcedc4e2cc7b0a58e839a9fa0ed95811a988d AS helper
USER root
ENV ANDROID_HOME=/opt/android-sdk
RUN curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/android-tools.zip \
    && mkdir -p /opt/android-sdk/cmdline-tools \
    && unzip -q /tmp/android-tools.zip -d /opt/android-sdk/cmdline-tools \
    && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
    && rm /tmp/android-tools.zip \
    && yes | /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null \
    && /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager 'platforms;android-35' 'build-tools;35.0.0' >/dev/null
WORKDIR /build
COPY helper/ ./
RUN --mount=type=cache,target=/root/.gradle --mount=type=cache,id=pal-android-signing,target=/root/.android gradle --no-daemon --console=plain :bridge:assembleDebug :fixture:assembleDebug

FROM node:24.15.0-trixie-slim@sha256:291be77873bc04731968cacf82f0fcef17cee8cf200c6b6951e2bcab41560eb7
RUN apt-get update && apt-get install -y --no-install-recommends adb ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/android
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
ADD --checksum=sha256:7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0 https://github.com/Genymobile/scrcpy/releases/download/v3.3.3/scrcpy-server-v3.3.3 /opt/android/scrcpy-server
COPY start.sh health.mjs helper-client.mjs server.mjs viewer.mjs ./
COPY --from=helper /build/bridge/build/outputs/apk/debug/bridge-debug.apk ./helper.apk
COPY --from=helper /build/fixture/build/outputs/apk/debug/fixture-debug.apk ./fixture.apk
ENV HOME=/state MOBILEMCP_DISABLE_TELEMETRY=1
RUN mkdir -p /state && chmod 0700 /state
EXPOSE 3000
CMD ["sh", "/opt/android/start.sh"]
