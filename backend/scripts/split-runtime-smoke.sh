#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
npm run build
project=pal-split-runtime-smoke
compose_file=scripts/split-runtime/compose.yaml
cleanup() {
  docker compose -p "$project" -f "$compose_file" down --volumes --remove-orphans
}
trap cleanup EXIT INT TERM
docker compose -p "$project" -f "$compose_file" build execution
docker compose -p "$project" -f "$compose_file" up -d execution
docker compose -p "$project" -f "$compose_file" run --rm --no-deps service
docker compose -p "$project" -f "$compose_file" run --rm --no-deps -e SMOKE_PHASE=restart service
