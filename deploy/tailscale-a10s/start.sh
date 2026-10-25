#!/data/data/com.termux/files/usr/bin/bash
set -eu
umask 077
base="$HOME/services/tailscale-userspace"
export PATH="$base/compat:$PATH"
exec proot-distro login debian --user "$(id -u):$(id -g)" --kernel 4.19.127 \
  --env GOMAXPROCS=1 \
  --bind "$base/passwd:/etc/passwd" --bind "$base:/opt/tailscale-a10s" -- \
  /opt/tailscale-a10s/bin/tailscaled --tun=userspace-networking \
  --statedir=/opt/tailscale-a10s/state \
  --state=/opt/tailscale-a10s/state/tailscaled.state \
  --socket=/opt/tailscale-a10s/state/tailscaled.sock --port=0
