# syntax=docker/dockerfile:1
FROM node:24.15.0-trixie-slim@sha256:291be77873bc04731968cacf82f0fcef17cee8cf200c6b6951e2bcab41560eb7 AS build
WORKDIR /opt/pal-web
ARG PAL_RELEASE_ID=development
ENV PAL_RELEASE_ID=$PAL_RELEASE_ID
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json tsconfig.test.json vite.config.ts ./
COPY public/ public/
COPY src/ src/
RUN npm run build

FROM nginx:1.29.2-alpine@sha256:61e01287e546aac28a3f56839c136b31f590273f3b41187a36f46f6a03bbfe22
RUN apk add --no-cache iproute2
COPY gateway/execution-boundary.sh /docker-entrypoint.d/40-execution-boundary.sh
RUN chmod +x /docker-entrypoint.d/40-execution-boundary.sh
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /opt/pal-web/dist/ /usr/share/nginx/html/
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
