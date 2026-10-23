#!/bin/sh
# Run the gateway; either child exiting terminates the container for Compose recovery.
set -eu
/docker-entrypoint.d/40-execution-boundary.sh
# Container restarts retain /run; a previous Squid PID may belong to another process.
rm -f /run/squid.pid
proxy_pid=
web_pid=
stop() {
  trap - EXIT INT TERM QUIT CHLD
  if [ -n "$web_pid" ]; then kill "$web_pid" 2>/dev/null || true; fi
  if [ -n "$proxy_pid" ]; then kill "$proxy_pid" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap stop EXIT
trap 'exit 0' INT TERM QUIT
# Install before spawning: wait -n can miss a child that exits before wait starts.
trap 'exit 1' CHLD
squid -N -f /etc/squid/squid.conf &
proxy_pid=$!
nginx -g 'daemon off;' &
web_pid=$!
wait
exit 1
