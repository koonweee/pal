#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
repo_root="$(cd .. && pwd)"
backup="$repo_root/.local/migration-rehearsal-$(date +%Y%m%d-%H%M%S)"
source_compose() {
  docker compose -p pal-migration-source -f scripts/migration/compose.yaml "$@"
}
target_compose() {
  docker compose --env-file "$backup/compose.env" -p pal-migration-check -f compose.yaml -f scripts/migration/target.yaml "$@"
}
cleanup() {
  if [[ -f "$backup/compose.env" ]]; then target_compose down --volumes --remove-orphans; fi
  source_compose down --volumes --remove-orphans
  # A failed preparation intentionally retains target volumes; these names are disposable fixtures.
  docker volume rm pal-migration-check_agent_home pal-migration-check_service_data pal-migration-check_postgres_data >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
source_compose up -d --build --wait
source_id="$(source_compose ps -q legacy)"
postgres_id="$(source_compose ps -q postgres)"
source_network=pal-migration-source_source
docker run --rm --network "$source_network" -e DATABASE_URL=postgresql://pal:pal@postgres:5432/pal pal-agent-service-local node dist/database/migrate.js
docker run --rm -i --network "$source_network" -e DATABASE_URL=postgresql://pal:pal@postgres:5432/pal -e MIGRATION_PHASE=seed pal-agent-service-local node --input-type=module < scripts/migration/records.mjs
source_compose exec -T legacy sh -eu -c '
  mkdir -p /data/agent /data/uploads /data/workspace
  printf "%s" "{\"type\":\"oauth\",\"access\":\"private-model-token-for-migration\",\"refresh\":\"private-refresh-token-for-migration\",\"expires\":0}" > /data/agent/auth.json
  printf "Historical file data" > /data/uploads/11111111-1111-4111-8111-111111111111.txt
  printf "original workspace" > /data/workspace/report.txt
  printf "original home" > /data/home/notes.txt
  mkdir -p /data/home/.local/share/keyrings
  printf "keyring fixture" > /data/home/.local/share/keyrings/fixture.keyring
'
docker cp scripts/migration/session-fixture.mjs "$source_id:/data/workspace/session-fixture.mjs"
source_compose exec -T legacy sh -c 'nohup node /data/workspace/session-fixture.mjs </dev/null >/tmp/session-fixture.log 2>&1 & nohup pal-browser http://127.0.0.1:8765/ </dev/null >/tmp/chrome.log 2>&1 &'
for attempt in {1..60}; do
  if source_compose exec -T legacy curl -fs http://127.0.0.1:9222/json/version >/dev/null; then break; fi
  sleep 1
done
source_compose exec -T -e MIGRATION_PHASE=seed legacy node --input-type=module < scripts/migration/session.mjs
source_compose exec -T legacy node --input-type=module -e 'import {chromium} from "playwright-core"; const b = await chromium.connectOverCDP("http://127.0.0.1:9222", {noDefaults:true}); await (await b.newBrowserCDPSession()).send("Browser.close");'
for attempt in {1..60}; do
  if ! source_compose exec -T legacy pgrep -x chromium >/dev/null; then break; fi
  sleep 1
done
source_compose stop legacy
python3 "$repo_root/scripts/migrate-runtime.py" --legacy "$source_id" --postgres "$postgres_id" --project pal-migration-check --backup "$backup"
target_compose build execution
target_compose up -d --wait
target_compose exec -T execution sh -eu -c '
  test "$(hostname)" = pal-legacy-fixture
  test "$(/opt/user-installed/utility)" = preserved-utility
  printf "{}" | jq -e . >/dev/null
  dpkg-query -W jq >/dev/null
  test "$(cat /data/workspace/report.txt)" = "original workspace"
  test "$(cat /data/home/notes.txt)" = "original home"
  test "$(cat /home/pal/.local/share/keyrings/fixture.keyring)" = "keyring fixture"
  test ! -e /data/agent/auth.json
  test ! -e /opt/pal/backend-secret
  test ! -e /opt/pal/dist/main.js
  test ! -S /var/run/docker.sock
  test -z "${DATABASE_URL:-}"
  test -z "${FIXTURE_API_TOKEN:-}"
  echo "changed target" > /data/workspace/report.txt
  nohup node /data/workspace/session-fixture.mjs </dev/null >/tmp/session-fixture.log 2>&1 &
  nohup pal-browser http://127.0.0.1:8765/ </dev/null >/tmp/chrome.log 2>&1 &
'
for attempt in {1..60}; do
  if target_compose exec -T execution curl -fs http://127.0.0.1:9222/json/version >/dev/null; then break; fi
  sleep 1
done
target_compose exec -T execution node --input-type=module < scripts/migration/session.mjs
target_compose exec -T agent-service node --input-type=module < scripts/migration/records.mjs
target_compose exec -T agent-service node --input-type=module < scripts/migration/files.mjs
curl -fs http://127.0.0.1:14081/desktop/v2/vnc.html >/dev/null
# Rollback switches to the retained, matching legacy DB and files. Target writes stay isolated.
target_compose stop
source_compose start --wait legacy
source_compose exec -T legacy sh -eu -c '
  test "$(cat /data/workspace/report.txt)" = "original workspace"
  test "$(cat /data/home/notes.txt)" = "original home"
  test "$(/opt/user-installed/utility)" = preserved-utility
  nohup node /data/workspace/session-fixture.mjs </dev/null >/tmp/session-fixture.log 2>&1 &
  nohup pal-browser http://127.0.0.1:8765/ </dev/null >/tmp/chrome.log 2>&1 &
'
for attempt in {1..60}; do
  if source_compose exec -T legacy curl -fs http://127.0.0.1:9222/json/version >/dev/null; then break; fi
  sleep 1
done
source_compose exec -T legacy node --input-type=module < scripts/migration/session.mjs
docker run --rm -i --network "$source_network" -e DATABASE_URL=postgresql://pal:pal@postgres:5432/pal pal-agent-service-local node --input-type=module < scripts/migration/records.mjs
echo "PASS: offline migration, private credential separation, historical paths, installed packages, VNC session, and rollback"
echo "Protected rehearsal backups retained: $backup"
