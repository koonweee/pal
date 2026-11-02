#!/bin/sh
set -eu
# Docker leaves the transit gateway unassigned. Advertise it only after the
# complete forwarding policy is installed in this container's network namespace.
rm -f /run/gateway-ready
nft -f /opt/pal-egress/policy.nft

tailscaled_pid=""
stop() {
  if [ -n "$tailscaled_pid" ]; then
    kill "$tailscaled_pid" 2>/dev/null || true
    wait "$tailscaled_pid" 2>/dev/null || true
  fi
}
trap stop EXIT INT TERM

if [ "${PAL_TAILSCALE_ENABLED:-false}" = "true" ]; then
  test -d /var/lib/tailscale
  mkdir -p /run/tailscale
  tailscaled \
    --socket=/run/tailscale/tailscaled.sock \
    --state=/var/lib/tailscale/tailscaled.state \
    --tun=tailscale0 &
  tailscaled_pid=$!
  for attempt in $(seq 1 100); do
    if [ -S /run/tailscale/tailscaled.sock ]; then
      break
    fi
    kill -0 "$tailscaled_pid"
    sleep 0.1
  done
  test -S /run/tailscale/tailscaled.sock
fi

prefix="$(ip -4 route show dev palexec0 scope link | awk '{print $1}')"
test -n "$prefix"
ip address add "${PAL_EXECUTION_GATEWAY}/${prefix#*/}" dev palexec0
# Refresh execution's neighbor cache when a replacement router has a new MAC.
arping -U -c 2 -I palexec0 "$PAL_EXECUTION_GATEWAY" >/dev/null
printf 'ready\n' >/run/gateway-ready

if [ -n "$tailscaled_pid" ]; then
  wait "$tailscaled_pid"
else
  exec sleep infinity
fi
