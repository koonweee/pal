# syntax=docker/dockerfile:1
FROM node:24.15.0-trixie-slim@sha256:291be77873bc04731968cacf82f0fcef17cee8cf200c6b6951e2bcab41560eb7
RUN apt-get update && apt-get install -y --no-install-recommends adb ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/android
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY start.sh health.mjs ./
ENV HOME=/state MOBILEMCP_DISABLE_TELEMETRY=1
RUN mkdir -p /state && chmod 0700 /state
EXPOSE 3000
CMD ["sh", "/opt/android/start.sh"]
