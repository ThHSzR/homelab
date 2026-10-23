# Biblioteca IA — MVP no Galaxy A30 (Termux)

> **Estado:** código preparado no GitHub; **não instalado nem validado no A30**.
> Nenhuma configuração do dashboard, Minecraft, Bom Dia, Tailscale, Cloudflare ou PM2 existente foi alterada.
> Primeira entrega: **EPUB local para revisão**. Envio automático ao Kindle ainda não implementado.

## Arquitetura

- Galaxy A30 (Android 11, Termux, ARM64), sem Docker e sem desktop.
- \`llama.cpp\` compilado no próprio Termux, usando \`llama-server\` ligado **somente a 127.0.0.1** durante a geração.
- Modelo GGUF pequeno, inicialmente **Qwen2.5 1.5B Instruct Q4_K_M** (~1,1 GB em disco; RAM real precisa ser medida).
- Node.js nativo (já existente no homelab) sem dependências npm adicionais.
- Livro dividido em plano, capítulos, resumos de continuidade e EPUB 3.
- Progresso em \`data/current.json\` e capítulos salvos individualmente; uma falha comum permite retomar a partir da etapa salva.
- Um lock local impede gerações simultâneas; após SIGKILL/reboot durante geração, **investigue processos antes de remover** \`data/generation.lock\`.
- Agendador opcional via PM2, **desligado por padrão**.
- Nenhuma API paga, chave Amazon, SMTP ou envio externo nesta etapa.

**Limitações:** um modelo 1.5B tem capacidade literária limitada; quatro capítulos curtos formam uma novela de teste, não um romance longo. Não há benchmark real de RAM, desempenho ou estabilidade térmica no A30. O Android pode encerrar processos em segundo plano. O programa não faz controle térmico automático: acompanhe a temperatura e suspenda os testes se aquecer demais.

## Pré-requisitos

No Termux: Node.js 22+, Git, CMake, compilador C/C++, zip/unzip e espaço livre para o modelo + build + livros. Faça backup do estado PM2 antes de mexer em qualquer serviço. Não rode a instalação enquanto houver outros trabalhos críticos no A30.

### 1. Obter o código sem trocar a branch do dashboard em produção

No Termux:

\`\`\`sh
cd ~/services/homelab
git fetch origin feat/a30-kindle-fiction-mvp
git worktree add --detach ~/services/homelab-kindle FETCH_HEAD
cd ~/services/homelab-kindle/apps/kindle-fiction
\`\`\`

O \`worktree\` evita alterar os arquivos da instalação ativa em \`~/services/homelab\`.

### 2. Compilar o llama.cpp no próprio A30

\`\`\`sh
cd ~/services/homelab-kindle/apps/kindle-fiction
bash scripts/install-termux.sh
pkg install -y unzip curl
\`\`\`

A compilação pode levar bastante tempo. A documentação oficial do llama.cpp confirma o build via Termux:
https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md

### 3. Baixar o modelo GGUF (sem usar o PC)

\`\`\`sh
mkdir -p ~/models
curl --fail --location --retry 3 \
  'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf' \
  --output ~/models/qwen2.5-1.5b-instruct-q4_k_m.gguf
\`\`\`

Confira tamanho e integridade do arquivo antes de gerar. Se a URL mudar, obtenha o GGUF Q4_K_M no repositório oficial:
https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF

### 4. Diagnosticar antes de carregar o modelo

\`\`\`sh
cp config.example.json config.json
node src/diagnose.mjs
node --test test/*.test.mjs
free -m
df -h "$HOME"
termux-battery-status
\`\`\`

O diagnóstico **não inicia a IA**. Se \`MemAvailable\` estiver abaixo de \`minAvailableMB\` (1100 MiB por padrão), a geração não começa. Esse limite não garante que o Android não mate o processo; ajuste somente depois de medir.

### 5. Gerar manualmente o primeiro EPUB

\`\`\`sh
node src/generate.mjs
\`\`\`

Saída esperada:

\`\`\`text
data/
  current.json
  books/<id>/
    plan.md
    chapters/01.md ... 04.md
    summaries/01.txt ... 04.txt
    livro.epub
\`\`\`

Se o processo falhar de forma normal, rode o mesmo comando para retomar. **Não apague capítulos nem estado** para forçar repetição. Se o Android matar o processo, verifique \`ps\`, \`ss -ltn\` e o arquivo de lock antes de tentar novamente.

A geração pode demorar horas. Comece com 4 capítulos e 750 tokens por capítulo. Para um teste menor, mude \`chapters\` e \`tokensPerChapter\` **antes** de iniciar o primeiro livro.

### 6. Agendar com PM2 (somente após teste manual aprovado)

Edite o arquivo privado \`config.json\`:

\`\`\`json
"schedule": {
  "enabled": true,
  "intervalDays": 15,
  "retryHours": 6
}
\`\`\`

Depois:

\`\`\`sh
pm2 start pm2.config.cjs
pm2 logs kindle-fiction-scheduler
\`\`\`

O scheduler persiste a próxima tentativa em \`data/scheduler.json\`, tenta retomar livros incompletos e não inicia dois workers simultaneamente. **Não execute \`pm2 save\` automaticamente**: primeiro confira \`pm2 status\` e preserve o estado dos demais serviços do homelab. O scheduler começa desabilitado e só gera quando \`enabled=true\`.

Para parar:

\`\`\`sh
pm2 stop kindle-fiction-scheduler
\`\`\`

## Kindle

Neste MVP, a entrega é **somente o arquivo EPUB local**. Após revisar o conteúdo, faça o envio manual pelo serviço oficial https://www.amazon.com/sendtokindle. O fluxo de e-mail/SMTP, com remetente autorizado, endereço Kindle e credenciais privadas, pode ser adicionado em etapa posterior, com confirmação e prevenção de duplicidade. **Não publique no KDP**: o objetivo é leitura pessoal.

## PC + ADB para Codex (sem acessar diretórios privados do Android)

\`adb shell\` usa o usuário \`shell\` do Android e **não equivale ao usuário Termux**. Não use \`adb root\`, não tente alterar permissões do sandbox e não exponha SSH publicamente.

Se o SSH do Termux já estiver ativo na porta 8022 e houver autenticação por chave configurada:

\`\`\`sh
adb devices -l
adb forward tcp:18022 tcp:8022
ssh -p 18022 USUARIO_TERMUX@127.0.0.1
\`\`\`

A partir dessa sessão SSH, o Codex pode executar os comandos do Termux normalmente. Preserve as chaves e políticas existentes. Se a sessão SSH não funcionar, não mude a autenticação automaticamente: use o canal administrativo Tailscale já existente.

## Critérios para passar à fase 2

1. \`node src/diagnose.mjs\` confirma modelo e executável.
2. Teste \`node --test\` passa.
3. \`llama-server\` sobe somente em loopback e gera texto em pt-BR.
4. Pelo menos um EPUB abre no Kindle após envio manual.
5. RAM, temperatura, bateria e PM2 permanecem estáveis.
6. Após interrupção controlada, o gerador retoma sem duplicar capítulos.
7. Só então considerar envio automático, dashboard e modelos maiores.

**Referências:** [llama.cpp no Termux](https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md), [modelo Qwen2.5 GGUF](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF), [TH HomeLab](https://github.com/ThHSzR/homelab).
