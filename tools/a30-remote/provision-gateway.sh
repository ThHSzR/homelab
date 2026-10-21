#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SSH_CONFIG="${A30_SSH_CONFIG:-$HOME/.local/state/a30-remote/ssh_config}"
DEST="${A30_SSH_DEST:-100.65.49.34}"
LOCAL_ADB="${A30_LOCAL_ADB:-$HOME/.local/share/a30-remote/bin/adb}"
LOCAL_SERIAL="${A30_LOCAL_SERIAL:-10.150.235.246:5555}"
ANDROID_DIR="$HOME/.android"
REMOTE_BASE='.local/share/a30-remote-gateway'
REMOTE_HOME="$REMOTE_BASE/home/.android"
REMOTE_BIN='.local/bin/a30-adb-gateway'

fail() {
    printf 'ERRO: %s\n' "$*" >&2
    exit 1
}

[[ -f "$SSH_CONFIG" ]] || fail "Configuracao SSH ausente: $SSH_CONFIG"
[[ -x "$LOCAL_ADB" ]] || fail "ADB local ausente: $LOCAL_ADB"
[[ -f "$ANDROID_DIR/adbkey" ]] || fail "Chave ADB local ausente: $ANDROID_DIR/adbkey"
[[ -f "$ANDROID_DIR/adbkey.pub" ]] || fail "Chave ADB publica ausente: $ANDROID_DIR/adbkey.pub"
[[ -x "$ROOT/a30-adb-gateway" ]] || fail 'Script do gateway sem permissao de execucao.'

state="$($LOCAL_ADB -s "$LOCAL_SERIAL" get-state 2>/dev/null || true)"
[[ "$state" == device ]] || fail "A chave local precisa estar autorizada no A30 ($LOCAL_SERIAL)."
actual="$($LOCAL_ADB -s "$LOCAL_SERIAL" shell getprop ro.serialno | tr -d '\r')"
[[ "$actual" == RQ8M70A9WBP ]] || fail 'O dispositivo ADB local nao e o A30 esperado.'

SSH=(ssh -F "$SSH_CONFIG")
"${SSH[@]}" -n -o BatchMode=yes "$DEST" true || fail 'SSH do Termux nao autorizado.'

echo 'Criando o gateway protegido no Termux...'
"${SSH[@]}" -n "$DEST" "umask 077; mkdir -p '$REMOTE_HOME' '.local/bin'; chmod 700 '$REMOTE_BASE' '$REMOTE_BASE/home' '$REMOTE_HOME' '.local/bin'"

# Os segredos seguem somente pelo stdin do SSH e nunca aparecem na linha de comando.
"${SSH[@]}" "$DEST" "umask 077; cat > '$REMOTE_HOME/adbkey'; chmod 600 '$REMOTE_HOME/adbkey'" < "$ANDROID_DIR/adbkey"
"${SSH[@]}" "$DEST" "umask 077; cat > '$REMOTE_HOME/adbkey.pub'; chmod 600 '$REMOTE_HOME/adbkey.pub'" < "$ANDROID_DIR/adbkey.pub"
if [[ -f "$ANDROID_DIR/adb_known_hosts.pb" ]]; then
    "${SSH[@]}" "$DEST" "umask 077; cat > '$REMOTE_HOME/adb_known_hosts.pb'; chmod 600 '$REMOTE_HOME/adb_known_hosts.pb'" < "$ANDROID_DIR/adb_known_hosts.pb"
fi
"${SSH[@]}" "$DEST" "umask 077; cat > '$REMOTE_BIN'; chmod 700 '$REMOTE_BIN'" < "$ROOT/a30-adb-gateway"

echo 'Iniciando e validando o servidor ADB central...'
serial="$("${SSH[@]}" -n "$DEST" "adb -P 5038 kill-server >/dev/null 2>&1 || true; '$REMOTE_BIN' stop >/dev/null 2>&1 || true; '$REMOTE_BIN' start")"
[[ -n "$serial" ]] || fail 'O gateway foi instalado, mas nao encontrou o A30.'
"${SSH[@]}" -n "$DEST" "'$REMOTE_BIN' status"

echo 'Gateway provisionado. Maquinas novas precisarao somente de SSH e Tailnet.'
