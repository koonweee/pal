#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export PAL_EXECUTION_IMAGE=pal-execution-local
compose() {
  docker compose --project-name pal-split-stack-smoke -f compose.yaml -f scripts/split-stack/compose.yaml "$@"
}
cleanup() { compose down --volumes --remove-orphans; }
trap cleanup EXIT INT TERM
compose build agent-service execution web
compose up -d --wait postgres execution
compose run --rm --no-deps agent-service node dist/database/migrate.js
compose up -d --wait agent-service web
compose exec -T execution sh -eu -c '
  node --input-type=module -e "const response = await fetch(\"https://example.com\"); if (!response.ok) process.exit(1);"
  test "$(curl --max-time 20 -s -o /dev/null -w "%{http_code}" https://example.com)" = 200
  test "$(curl --max-time 5 --noproxy "*" -s -o /dev/null -w "%{http_code}" http://web:8080/api/health)" = 403
  test "$(curl --max-time 5 -s -o /dev/null -w "%{http_code}" http://agent-service:3000/health)" = 403
  test "$(curl --max-time 5 -s -o /dev/null -w "%{http_code}" http://100.64.0.1/)" = 403
  if curl --max-time 3 --noproxy "*" -fs http://host.docker.internal:14080/api/health >/dev/null 2>&1; then exit 1; fi
  test ! -S /var/run/docker.sock
  test ! -d /data/private
  echo "PASS: public HTTPS and private network/filesystem isolation"
'
compose exec -T agent-service node --input-type=module < scripts/split-stack/check.mjs
compose exec -T agent-service node --input-type=module < scripts/split-stack/files.mjs
node scripts/split-stack/pwa.mjs
compose exec -T execution sh -c 'sleep 120 </dev/null >/dev/null 2>&1 & echo $! > /home/pal/tmp/user-process.pid; pgrep -o chromium > /home/pal/tmp/chrome-process.pid'
compose restart agent-service
compose exec -T execution sh -eu -c '
  kill -0 $(cat /home/pal/tmp/user-process.pid)
  test "$(pgrep -o chromium)" = "$(cat /home/pal/tmp/chrome-process.pid)"
  echo "PASS: desktop and user process survive backend restart"
'
compose stop execution
curl --fail --silent --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:14080/api/health >/dev/null
curl --fail --silent http://127.0.0.1:14080/api/chat/history >/dev/null
echo "PASS: API and chat history remain available during execution outage"
