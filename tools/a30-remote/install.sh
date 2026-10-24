#!/usr/bin/env bash
# Works from a checkout, a downloaded file, or bash -s via stdin.
set -Eeuo pipefail
fail() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }
trap 'printf "Instalacao interrompida (linha %s).\n" "$LINENO" >&2' ERR
if [[ "${1:-}" == --help ]]; then
    echo 'Uso: bash install.sh [--check]. Instala por usuario; nunca use sudo.'
    echo 'Linux: instala dependencias por apt/dnf/pacman quando faltarem (sudo).'
    echo 'Windows: use install.ps1 no PowerShell nativo.'
    echo 'A30_REF seleciona a branch/tag/commit dos fontes raw (padrao main).'
    exit 0
fi
[[ $# == 0 || ( $# == 1 && "$1" == --check ) ]] || fail 'Argumento invalido. Use --help.'
check="${1:-}"
[[ "$(uname -s)" == Linux ]] || fail 'No Windows use install.ps1 no PowerShell nativo.'
[[ $EUID != 0 ]] || fail 'Execute como usuario normal, sem sudo.'
missing=0
for tool in ssh ssh-keygen python3 adb scrcpy install readlink; do command -v "$tool" >/dev/null || missing=1; done
if command -v scrcpy >/dev/null; then
    probe="$(scrcpy --help 2>/dev/null || true)"
    [[ "$probe" == *--time-limit* && "$probe" == *--video-bit-rate* && "$probe" == *--tunnel-port* ]] || missing=1
fi
if [[ $missing == 1 && -z "$check" && "${A30_SKIP_DEPENDENCIES:-0}" != 1 ]]; then
    command -v sudo >/dev/null || fail 'Falta sudo. Instale adb, scrcpy, OpenSSH e Python 3 pelo gerenciador da distribuicao.'
    echo 'Instalando dependencias pelo gerenciador da distribuicao...'
    if command -v apt-get >/dev/null; then
        sudo apt-get update
        sudo apt-get install -y adb scrcpy openssh-client python3 curl
    elif command -v dnf >/dev/null; then
        sudo dnf install -y android-tools scrcpy openssh-clients python3 curl
    elif command -v pacman >/dev/null; then
        sudo pacman -S --needed --noconfirm android-tools scrcpy openssh python curl
    else
        fail 'Gerenciador nao reconhecido. Instale adb, scrcpy, OpenSSH e Python 3 e execute novamente.'
    fi
fi
for tool in ssh ssh-keygen; do command -v "$tool" >/dev/null || fail "Instale $tool e tente novamente."; done
for tool in python3 adb scrcpy install readlink; do command -v "$tool" >/dev/null || fail "Instale $tool pelo gerenciador da distribuicao e tente novamente."; done
adb version >/dev/null
scrcpy_cmd=scrcpy
version="$("$scrcpy_cmd" --version)"
[[ "$version" =~ scrcpy[[:space:]]+([0-9]+) ]] || fail 'Versao de scrcpy nao reconhecida.'
(( BASH_REMATCH[1] >= 2 )) || fail 'scrcpy >= 2 e necessario para as opcoes do cliente.'
help="$("$scrcpy_cmd" --help)"
for option in --force-adb-forward --tunnel-host --tunnel-port --no-audio --max-fps --video-bit-rate --time-limit; do
    [[ "$help" == *"$option"* ]] || fail "Atualize scrcpy: esta versao nao oferece $option."
done
[[ "$check" != --check ]] || { echo 'Dependencias locais OK; nenhuma instalacao ou conexao realizada.'; exit 0; }

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
root=''
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    candidate="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
    [[ ! -f "$candidate/a30-remote" ]] || root="$candidate"
fi
files=(a30-remote known_hosts LEIA-ME.txt)
if [[ -z "$root" ]]; then
    ref="${A30_REF:-main}"
    [[ "$ref" =~ ^[A-Za-z0-9._/-]+$ && "$ref" != *..* ]] || fail 'A30_REF invalida.'
    root="$tmp/source"
    mkdir -p -- "$root"
    for file in "${files[@]}"; do
        url="https://raw.githubusercontent.com/ThHSzR/homelab/$ref/tools/a30-remote/$file"
        if command -v curl >/dev/null; then
            curl --fail --show-error --silent --location --retry 2 --connect-timeout 15 --max-time 120 "$url" -o "$root/$file"
        elif command -v wget >/dev/null; then
            wget --quiet --timeout=120 --tries=3 -O "$root/$file" "$url"
        else
            fail 'Instale curl ou wget para baixar os fontes.'
        fi
        [[ -s "$root/$file" ]] || fail "Fonte vazio: $file"
    done
fi
[[ "$HOME" != *$'\n'* && "$HOME" != *'"'* && "$HOME" != *'%'* && "$HOME" != *'`'* && "$HOME" != *'$'* && "$HOME" != *\\* ]] || fail 'HOME nao suportado pelo atalho.'
target="$HOME/.local/share/a30-remote"
bin="$HOME/.local/bin"
desktop="$HOME/.local/share/applications"
[[ ! -L "$target" ]] || fail 'Destino e um link; preservado.'
if [[ -d "$target" && -n "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    [[ -f "$target/.a30-install-marker" && "$(cat "$target/.a30-install-marker")" == A30RemoteInstall:v1 ]] || fail 'Destino contem arquivos de outra origem; preservados.'
fi
[[ ! -e "$bin/a30-remote" && ! -L "$bin/a30-remote" ]] || {
    [[ -L "$bin/a30-remote" && "$(readlink -- "$bin/a30-remote")" == "$target/a30-remote" ]] || fail 'Comando a30-remote existente pertence a outra instalacao; preservado.'
}
# Stage and validate all sources before changing the installed client.
for file in "${files[@]}"; do [[ -s "$root/$file" ]] || fail "Fonte ausente: $file"; done
bash -n "$root/a30-remote"
install -d -m 700 -- "$target"
mkdir -p -- "$bin" "$desktop"
install -m 700 -- "$root/a30-remote" "$target/a30-remote"
install -m 600 -- "$root/known_hosts" "$root/LEIA-ME.txt" "$target/"
printf '%s' A30RemoteInstall:v1 > "$target/.a30-install-marker"
ln -sfn -- "$target/a30-remote" "$bin/a30-remote"
cat > "$desktop/a30-remote.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=A30 Remoto
Comment=Tela do Galaxy A30 via SSH e Tailscale
Exec="$target/a30-remote"
Icon=phone
Terminal=true
Categories=Utility;RemoteAccess;
DESKTOP
chmod 600 "$desktop/a30-remote.desktop"
printf 'Instalado. Execute "%s/a30-remote" configurar-ssh e depois conectar.\n' "$bin"
