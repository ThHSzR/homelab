#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" == --help ]]; then
    echo 'Instalador A30 Remoto Linux x86_64. Uso: bash Instalar-A30-Linux-x86_64.run [--check]'
    echo 'Instalacao por usuario, sem sudo. Requer bash, openssh-client, python3 e sessao grafica para a tela.'
    exit 0
fi
[[ "$(uname -m)" == x86_64 ]] || { echo 'Este pacote e para Linux x86_64.' >&2; exit 1; }
for tool in tar sha256sum awk mktemp; do command -v "$tool" >/dev/null || { echo "Falta dependencia: $tool" >&2; exit 1; }; done
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
line="$(awk '/^__A30_PAYLOAD_BELOW__$/ { print NR+1; exit }' "$0")"
[[ -n "$line" ]] || { echo 'Pacote incompleto.' >&2; exit 1; }
tail -n +"$line" "$0" > "$tmp/payload.tar.gz"
printf '%s  %s\n' '__PAYLOAD_SHA256__' "$tmp/payload.tar.gz" | sha256sum -c -
if [[ "${1:-}" == --check ]]; then echo 'Integridade do pacote OK.'; exit 0; fi
[[ $# == 0 ]] || { echo 'Argumento invalido. Use --help.' >&2; exit 1; }
for tool in ssh ssh-keygen python3; do command -v "$tool" >/dev/null || { echo "Instale a dependencia $tool pelo gerenciador da sua distribuicao e rode novamente." >&2; exit 1; }; done
[[ "$HOME" != *$'\n'* && "$HOME" != *'"'* && "$HOME" != *'%'* && "$HOME" != *'`'* && "$HOME" != *'$'* && "$HOME" != *'\'* ]] || { echo 'Caminho HOME nao suportado pelo atalho; use um caminho convencional.' >&2; exit 1; }
target="$HOME/.local/share/a30-remote"
bin="$HOME/.local/bin"
desktop="$HOME/.local/share/applications"
[[ ! -L "$target" ]] || { echo 'A pasta de destino e um link; preservada.' >&2; exit 1; }
if [[ -d "$target" ]] && [[ -n "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    [[ -f "$target/.a30-install-marker" && "$(cat "$target/.a30-install-marker")" == A30RemoteInstall:v1 ]] || { echo 'A pasta de destino contem arquivos de outra origem; preservados.' >&2; exit 1; }
fi
mkdir -p -- "$target" "$bin" "$desktop"
printf '%s' A30RemoteInstall:v1 > "$target/.a30-install-marker"
tar -xzf "$tmp/payload.tar.gz" -C "$target" --no-same-owner
chmod 700 "$target/a30-remote"
chmod 755 "$target/bin/adb" "$target/bin/scrcpy"
"$target/bin/adb" version
"$target/bin/scrcpy" --version || { echo 'scrcpy requer bibliotecas graficas adicionais desta distribuicao; consulte LEIA-ME.txt.' >&2; exit 1; }
if [[ -e "$bin/a30-remote" && ! -L "$bin/a30-remote" ]]; then echo 'Ja existe um arquivo ~/.local/bin/a30-remote; preservado. Use o caminho completo abaixo.'; else ln -sfn -- "$target/a30-remote" "$bin/a30-remote"; fi
cat > "$desktop/a30-remote.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=A30 Remoto
Comment=Tela do Galaxy A30 via SSH e Tailscale
Exec="$target/a30-remote"
Icon=$target/bin/scrcpy.png
Terminal=true
Categories=Utility;RemoteAccess;
DESKTOP
printf '\nInstalado. Abra A30 Remoto no menu, ou execute:\n  "%s/a30-remote"\n' "$target"
echo 'No primeiro uso, escolha Configurar SSH; a maquina deve estar na tailnet.'
echo 'Nenhuma chave privada, senha ou sessao foi trazida de outro computador.'
exit 0
__A30_PAYLOAD_BELOW__
