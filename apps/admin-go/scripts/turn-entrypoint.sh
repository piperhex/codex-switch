#!/bin/sh
set -eu
umask 077
# Values are server configuration, never client input. Prevent newlines/config injection nevertheless.
case "${DESKTOP_TURN_SECRET:-}" in ''|*[!a-zA-Z0-9_./+=-]*) exit 1 ;; esac
test "${#DESKTOP_TURN_SECRET}" -ge 32
case "${DESKTOP_TURN_REALM:-}" in ''|*[!a-zA-Z0-9.-]*) exit 1 ;; esac
case "${DESKTOP_TURN_PUBLIC_IP:-}" in ''|*[!0-9.]*) exit 1 ;; esac
cat > /tmp/codex-turn.conf <<EOF
listening-port=3478
listening-ip=0.0.0.0
external-ip=${DESKTOP_TURN_PUBLIC_IP}
realm=${DESKTOP_TURN_REALM}
use-auth-secret
static-auth-secret=${DESKTOP_TURN_SECRET}
fingerprint
min-port=50000
max-port=50199
user-quota=8
total-quota=256
max-bps=4194304
max-allocate-lifetime=600
no-tls
no-tcp-relay
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
pidfile=/tmp/codex-turn.pid
log-file=stdout
simple-log
EOF
exec turnserver -c /tmp/codex-turn.conf
