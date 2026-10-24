#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for script in "$root/a30-remote" "$root/a30-adb-gateway" "$root/"*.sh; do bash -n "$script"; done
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
[[ $EUID != 0 ]] || { echo 'Execute os testes como usuario normal.' >&2; exit 1; }
export HOME="$tmp/home with spaces"
export XDG_STATE_HOME="$HOME/.local/state"
export A30_SKIP_DEPENDENCIES=1
mkdir -p "$HOME" "$tmp/bin"
export PATH="$tmp/bin:$PATH"
cat > "$tmp/bin/adb" <<'MOCK'
#!/usr/bin/env bash
echo 'Android Debug Bridge version 1.0.41'
MOCK
cat > "$tmp/bin/scrcpy" <<'MOCK'
#!/usr/bin/env bash
if [[ ${MOCK_INITIAL_OLD:-0} == 1 && ! -f "$MOCK_UPGRADED_FILE" ]]; then
    echo 'scrcpy 1.25'
    exit 0
fi
if [[ "${1:-}" == --help ]]; then
    [[ ${MOCK_MISSING_OPTIONS:-0} == 0 ]] || exit 0
    echo '--force-adb-forward --tunnel-host --tunnel-port --no-audio --max-fps --video-bit-rate --time-limit'
    exit 0
fi
echo "scrcpy ${MOCK_SCRCPY_VERSION:-3.3}"
MOCK
chmod +x "$tmp/bin/adb" "$tmp/bin/scrcpy"
expect_failure() {
    if "$@" > "$tmp/failure.log" 2>&1; then
        echo 'ERRO: comando deveria falhar.' >&2; exit 1
    fi
}
bash "$root/install.sh" --help
expect_failure bash "$root/install.sh" --invalid
bash "$root/install.sh" --check
[[ ! -d "$HOME/.local/share/a30-remote" ]]
expect_failure env MOCK_SCRCPY_VERSION=1.25 bash "$root/install.sh"
expect_failure env MOCK_MISSING_OPTIONS=1 bash "$root/install.sh"
[[ ! -d "$HOME/.local/share/a30-remote" ]]
target="$HOME/.local/share/a30-remote"
mkdir -p "$target"
echo preserve > "$target/foreign"
expect_failure bash "$root/install.sh"
[[ "$(cat "$target/foreign")" == preserve ]]
rm "$target/foreign"
bash "$root/install.sh"
[[ -x "$target/a30-remote" && -L "$HOME/.local/bin/a30-remote" ]]
[[ $(stat -c %a "$target/a30-remote") == 700 ]]
[[ $(stat -c %a "$target/known_hosts") == 600 ]]
grep -q 'Exec="' "$HOME/.local/share/applications/a30-remote.desktop"
mkdir -p "$HOME/.ssh" "$XDG_STATE_HOME/a30-remote"
printf preserved-key > "$HOME/.ssh/a30_remote_ed25519"
printf preserved-log > "$XDG_STATE_HOME/a30-remote/scrcpy.stderr.log"
bash "$root/install.sh"
[[ $(cat "$HOME/.ssh/a30_remote_ed25519") == preserved-key ]]
[[ $(cat "$XDG_STATE_HOME/a30-remote/scrcpy.stderr.log") == preserved-log ]]
"$HOME/.local/bin/a30-remote" ajuda > "$tmp/help"
grep -q 'GATEWAY ADB CENTRAL' "$tmp/help"
rm "$HOME/.local/bin/a30-remote"
echo preserve > "$HOME/.local/bin/a30-remote"
expect_failure bash "$root/install.sh"
[[ $(cat "$HOME/.local/bin/a30-remote") == preserve ]]
rm "$HOME/.local/bin/a30-remote"

# Exercise the standalone/raw and stdin paths without a network dependency.
cp "$root/install.sh" "$tmp/standalone.sh"
cat > "$tmp/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -eu
[[ ${MOCK_DOWNLOAD_FAIL:-0} == 0 ]] || exit 22
url=''
while (($#)); do
    case "$1" in
        https://*) url="$1" ;;
        -o) shift; output="$1" ;;
    esac
    shift
done
[[ "$url" == "https://raw.githubusercontent.com/ThHSzR/homelab/${A30_REF:-main}/tools/a30-remote/"* ]]
cp "$MOCK_SOURCE/${url##*/}" "$output"
MOCK
chmod +x "$tmp/bin/curl"
export MOCK_SOURCE="$root"
expect_failure env A30_REF='../invalid' bash "$tmp/standalone.sh"
before="$(sha256sum "$target/a30-remote")"
expect_failure env MOCK_DOWNLOAD_FAIL=1 bash "$tmp/standalone.sh"
[[ "$(sha256sum "$target/a30-remote")" == "$before" ]]
A30_REF=main bash "$tmp/standalone.sh"
A30_REF=main bash -s < "$root/install.sh"
# Exercise dependency installation and package-manager failures without sudo/network.
cat > "$tmp/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
exec "$@"
MOCK
cat > "$tmp/bin/apt-get" <<'MOCK'
#!/usr/bin/env bash
[[ ${MOCK_PACKAGE_FAIL:-0} == 0 ]] || exit 32
printf '%s\n' "$*" >> "$MOCK_PACKAGE_LOG"
[[ "$1" != install ]] || touch "$MOCK_UPGRADED_FILE"
MOCK
chmod +x "$tmp/bin/sudo" "$tmp/bin/apt-get"
export MOCK_UPGRADED_FILE="$tmp/upgraded" MOCK_PACKAGE_LOG="$tmp/packages.log"
env A30_SKIP_DEPENDENCIES=0 MOCK_INITIAL_OLD=1 bash "$root/install.sh"
[[ -f "$MOCK_UPGRADED_FILE" ]]
grep -q '^update$' "$MOCK_PACKAGE_LOG"
grep -q '^install -y adb scrcpy openssh-client python3 curl$' "$MOCK_PACKAGE_LOG"
rm "$MOCK_UPGRADED_FILE"
before="$(sha256sum "$target/a30-remote")"
expect_failure env A30_SKIP_DEPENDENCIES=0 MOCK_INITIAL_OLD=1 MOCK_PACKAGE_FAIL=1 bash "$root/install.sh"
[[ "$(sha256sum "$target/a30-remote")" == "$before" ]]
# Opt-in integration check against an already-pushed branch/commit.
if [[ -n "${A30_TEST_RAW_REF:-}" ]]; then
    rm "$tmp/bin/curl"
    url="https://raw.githubusercontent.com/ThHSzR/homelab/$A30_TEST_RAW_REF/tools/a30-remote/install.sh"
    curl -fL --retry 2 "$url" -o "$tmp/downloaded.sh"
    A30_REF="$A30_TEST_RAW_REF" bash "$tmp/downloaded.sh"
    wget -q -O "$tmp/downloaded-wget.sh" "$url"
    A30_REF="$A30_TEST_RAW_REF" bash "$tmp/downloaded-wget.sh"
fi
# A symlink target must be preserved, even when it has a valid marker.
mv "$target" "$HOME/previous"
ln -s "$HOME/previous" "$target"
expect_failure bash "$root/install.sh"
[[ -f "$HOME/previous/.a30-install-marker" ]]
echo 'OK: install, update, raw/stdin, permissions, preservation and failure paths.'
