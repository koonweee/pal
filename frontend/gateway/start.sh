#!/bin/sh
set -eu
/docker-entrypoint.d/40-execution-boundary.sh
squid -N -f /etc/squid/squid.conf &
proxy_pid=$!
nginx -g 'daemon off;' &
web_pid=$!
stop() {
  kill "$web_pid" "$proxy_pid" 2>/dev/null || true
  wait "$web_pid" "$proxy_pid" 2>/dev/null || true
}
trap stop EXIT
trap 'exit 0' INT TERM
wait -n "$web_pid" "$proxy_pid"
exit 1
