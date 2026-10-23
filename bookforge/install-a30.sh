#!/data/data/com.termux/files/usr/bin/bash
# Instalador conservador: NAO altera o dashboard, Minecraft, Tailscale ou PM2.
set -euo pipefail

if ! command -v pkg >/dev/null 2>&1; then
  echo "Execute no Termux do Galaxy A30, nao no PC." >&2
  exit 1
fi

echo "[bookforge] Instalando dependencias de compilacao (pode demorar)."
pkg install -y git clang cmake make curl nodejs

DATA="$HOME/services/bookforge-data"
MODEL="$DATA/models/qwen2.5-1.5b-instruct-q4_k_m.gguf"
mkdir -p "$DATA/models" "$DATA/books"
chmod 700 "$DATA" "$DATA/models" "$DATA/books"

# Modelo (~1.12 GB) + build e temporarios: exigir margem de armazenamento.
FREE_KB="$(df -Pk "$HOME" | awk 'NR==2 {print $4}')"
if [ -z "$FREE_KB" ] || [ "$FREE_KB" -lt 3145728 ]; then
  echo "[bookforge] Menos de 3 GiB livres. Libere espaco antes do download." >&2
  exit 1
fi

if [ ! -d "$HOME/llama.cpp/.git" ]; then
  if [ -e "$HOME/llama.cpp" ]; then
    echo "[bookforge] ~/llama.cpp ja existe e nao e um checkout git; verifique manualmente." >&2
    exit 1
  fi
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$HOME/llama.cpp"
fi

echo "[bookforge] Compilando llama-server nativo para Android ARM64."
cmake -S "$HOME/llama.cpp" -B "$HOME/llama.cpp/build" \
  -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DLLAMA_CURL=OFF
cmake --build "$HOME/llama.cpp/build" -j 2 --target llama-server

if [ ! -s "$MODEL" ]; then
  URL="https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
  echo "[bookforge] Baixando modelo GGUF oficial Qwen2.5 1.5B Q4_K_M."
  curl --fail --location --retry 3 --continue-at - --output "$MODEL.part" "$URL"
  if [ "$(head -c 4 "$MODEL.part")" != "GGUF" ]; then
    echo "[bookforge] Arquivo baixado nao parece GGUF; mantendo .part para diagnostico." >&2
    exit 1
  fi
  mv "$MODEL.part" "$MODEL"
  chmod 600 "$MODEL"
fi

echo "[bookforge] Instalacao concluida. Nada foi iniciado no PM2."
echo "[bookforge] Proximo passo: node bookforge/bookforge.js doctor"
