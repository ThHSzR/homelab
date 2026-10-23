#!/usr/bin/env bash
set -euo pipefail
# Rodar APENAS no Termux do Galaxy A30. Não altera serviços PM2 existentes.
if [[ -z "${PREFIX:-}" || "${PREFIX:-}" != *"/com.termux/files/usr" ]]; then
  echo "Este script exige Termux (não adb shell nem Linux desktop)." >&2
  exit 1
fi
echo "Instalando dependências do llama.cpp (nenhum serviço será iniciado)."
pkg install -y git clang cmake make zip unzip curl libandroid-spawn
if ! command -v node >/dev/null 2>&1; then
  pkg install -y nodejs
fi
mkdir -p "$HOME/src" "$HOME/models"
if [[ ! -d "$HOME/src/llama.cpp/.git" ]]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$HOME/src/llama.cpp"
else
  echo "llama.cpp já existe; não atualizando sem revisão."
fi
cmake -S "$HOME/src/llama.cpp" -B "$HOME/src/llama.cpp/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_OPENMP=OFF \
  -DLLAMA_BUILD_TESTS=OFF
# Poucos jobs para evitar pressão de RAM no A30.
cmake --build "$HOME/src/llama.cpp/build" --config Release -j 2
echo "Pronto: $HOME/src/llama.cpp/build/bin/llama-server"
echo "Baixe manualmente um GGUF pequeno e confira config.json antes de gerar."
