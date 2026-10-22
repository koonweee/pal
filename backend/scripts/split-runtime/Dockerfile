FROM node:24.15.0-trixie-slim
WORKDIR /opt/pal
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY scripts/split-runtime/check.mjs /opt/pal/check.mjs
RUN mkdir -p /home/pal/tmp /service-private && chown -R node:node /home/pal /service-private \
    && printf 'private-sentinel' > /service-private/sentinel
USER node
CMD ["sleep", "infinity"]
