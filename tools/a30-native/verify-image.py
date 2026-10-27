#!/usr/bin/env python3
"""Check the Android boot header and embedded kernel/initramfs offline."""

import hashlib
import pathlib
import struct
import sys


boot_path, kernel_path, initramfs_path = map(pathlib.Path, sys.argv[1:4])
boot = boot_path.read_bytes()
assert boot[:8] == b"ANDROID!"
kernel_size, ramdisk_size, second_size = (
    struct.unpack_from("<I", boot, offset)[0] for offset in (8, 16, 24)
)
page_size, header_version = struct.unpack_from("<II", boot, 36)
assert header_version == 1 and page_size == 2048 and second_size == 0
align = lambda n: (n + page_size - 1) // page_size * page_size
kernel = boot[page_size : page_size + kernel_size]
ramdisk_start = page_size + align(kernel_size)
ramdisk = boot[ramdisk_start : ramdisk_start + ramdisk_size]
assert hashlib.sha256(kernel).digest() == hashlib.sha256(kernel_path.read_bytes()).digest()
assert hashlib.sha256(ramdisk).digest() == hashlib.sha256(initramfs_path.read_bytes()).digest()
assert ramdisk.startswith(b"\x1f\x8b")
assert len(boot) <= 36 * 1024 * 1024
print(f"OK: boot header v{header_version}, {len(boot)} bytes; kernel and gzip initramfs match exports")
