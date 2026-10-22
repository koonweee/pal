#!/bin/sh
set -eu
# Derive the dedicated execution subnet; reject its direct gateway requests.
address="$(getent hosts execution | awk '$1 ~ /^[0-9]+[.]/ {print $1; exit}')"
test -n "$address"
interface="$(ip -4 route get "$address" | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1);exit}}')"
subnet="$(ip -4 route show dev "$interface" scope link | awk 'NR==1 {print $1}')"
test -n "$subnet"
printf 'deny %s;\n' "$subnet" > /etc/nginx/execution-deny.conf
