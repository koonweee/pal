#!/bin/sh
set -eu
# Web has one routed service network and one internal execution network.
# Derive the latter without depending on an execution container being online.
routed="$(ip -4 route show default | awk '{print $5; exit}')"
test -n "$routed"
subnets="$(ip -4 route show scope link | awk -v routed="$routed" '$3 != routed {print $1}')"
test "$(printf '%s\n' "$subnets" | wc -l)" -eq 1
test -n "$subnets"
printf 'deny %s;\n' "$subnets" > /etc/nginx/execution-deny.conf
