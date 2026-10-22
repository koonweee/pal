#!/bin/sh
set -eu
# Compose names the execution interface independently of service/ingress networks.
subnets="$(ip -4 route show dev palexec0 scope link | awk '{print $1}')"
test "$(printf '%s\n' "$subnets" | wc -l)" -eq 1
test -n "$subnets"
printf 'deny %s;\n' "$subnets" > /etc/nginx/execution-deny.conf
