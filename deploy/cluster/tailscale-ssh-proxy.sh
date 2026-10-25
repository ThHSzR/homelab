#!/data/data/com.termux/files/usr/bin/sh
set -eu
exec "$HOME/services/tailscale-userspace/cli.sh" nc "$1" "$2"
