#!/data/data/com.termux/files/usr/bin/bash
# Build an isolated PRoot for the ARM32 userspace daemon, never replace pkg proot.
set -eu
umask 077
base="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
source_dir="$base/source-proot"
revision=b27d81a68d765f3462e807f4a14e01a03f8e89ea
if [ -e "$source_dir" ]; then
  echo 'source-proot already exists; inspect it before rebuilding.' >&2
  exit 1
fi
git clone https://github.com/termux/proot.git "$source_dir"
git -C "$source_dir" checkout --detach "$revision"
git -C "$source_dir" apply --check "$base/proot-netlink-read.patch"
git -C "$source_dir" apply "$base/proot-netlink-read.patch"
nice -n 10 make -C "$source_dir/src" -j2 CC=clang STRIP=llvm-strip \
  OBJCOPY=llvm-objcopy OBJDUMP=llvm-objdump
mkdir -p "$base/compat"
cp "$source_dir/src/proot" "$base/compat/proot.new"
chmod 700 "$base/compat/proot.new"
mv "$base/compat/proot.new" "$base/compat/proot"
sha256sum "$base/compat/proot"
