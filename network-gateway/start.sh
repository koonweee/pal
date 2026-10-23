#!/bin/sh
set -eu
# Docker leaves the transit gateway unassigned. Advertise it only after the
# complete forwarding policy is installed in this container's network namespace.
rm -f /run/gateway-ready
nft -f /opt/pal-egress/policy.nft
prefix="$(ip -4 route show dev palexec0 scope link | awk '{print $1}')"
test -n "$prefix"
ip address add "${PAL_EXECUTION_GATEWAY}/${prefix#*/}" dev palexec0
# Refresh execution's neighbor cache when a replacement router has a new MAC.
arping -U -c 2 -I palexec0 "$PAL_EXECUTION_GATEWAY" >/dev/null
printf 'ready\n' >/run/gateway-ready
exec sleep infinity
