#!/usr/bin/env bash
set -euo pipefail

package="$HOME/.local/var/pmbootstrap/cache_git/pmaports/device/archived/device-samsung-a30"
if ! grep -q '^deviceinfo_initfs_compression="gzip"$' "$package/deviceinfo"; then
  sed -i '/^deviceinfo_flash_method=/a deviceinfo_initfs_compression="gzip"' "$package/deviceinfo"
fi
if ! grep -q '^deviceinfo_header_version="1"$' "$package/deviceinfo"; then
  sed -i '/^deviceinfo_generate_bootimg=/a deviceinfo_header_version="1"' "$package/deviceinfo"
fi
if ! grep -q '^deviceinfo_flash_offset_base="0x10000000"$' "$package/deviceinfo"; then
  sed -i '/^deviceinfo_flash_pagesize=/a deviceinfo_flash_offset_base="0x10000000"' "$package/deviceinfo"
fi
if ! grep -q '^deviceinfo_flash_heimdall_partition_vbmeta="vbmeta"$' "$package/deviceinfo"; then
  sed -i '/^deviceinfo_flash_heimdall_partition_rootfs=/a deviceinfo_flash_heimdall_partition_vbmeta="vbmeta"' "$package/deviceinfo"
fi

"$HOME/a30-native/pmbootstrap/pmbootstrap.py" checksum device-samsung-a30
"$HOME/a30-native/pmbootstrap/pmbootstrap.py" build device-samsung-a30 --force
