#!/bin/sh
set -eu

test -f /run/gateway-ready
nft list table inet pal_gateway >/dev/null

if [ "${PAL_TAILSCALE_ENABLED:-false}" = "true" ]; then
  status="$(tailscale --socket=/run/tailscale/tailscaled.sock status --json 2>/dev/null || true)"
  test -n "$status"
  if [ -f /var/lib/tailscale/enrolled ]; then
    printf '%s' "$status" | grep -Eq '"BackendState"[[:space:]]*:[[:space:]]*"Running"'
  fi
fi
