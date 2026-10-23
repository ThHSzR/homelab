# Tarefa para Codex — implantação controlada no A30

**Objetivo:** implantar e validar \`apps/kindle-fiction\` do branch \`feat/a30-kindle-fiction-mvp\` no Galaxy A30 via Termux, **sem usar CPU/GPU do desktop para inferência**. O desktop pode ser usado apenas para ADB/SSH/diagnóstico. Não há permissão para alterar serviços existentes ou enviar e-mails automaticamente.

## Contexto existente

- Projeto: \`ThHSzR/homelab\`.
- A30 Android 11, Termux, Node.js, PM2, SSH Termux na porta 8022, Tailscale e Cloudflare.
- Minecraft está **desativado** segundo o usuário. Não o inicie.
- Serviços Bom Dia, dashboard, watchdog, Tailscale e túnel não podem ser interrompidos.
- O desktop \`thiago-pc\` já tem ADB para o A30, mas o processo Codex deve confirmar a conectividade em vez de presumir acesso.
- **Não usar Docker/Ollama nem servidor remoto** nesta fase.

## Execução autorizada

1. Inspecionar \`adb devices -l\` e a sessão SSH existente; se for necessário, encaminhar \`adb forward tcp:18022 tcp:8022\` e usar chave SSH já existente. Não contornar sandbox Android.
2. Coletar diagnóstico não destrutivo: \`free -m\`, \`df -h\`, \`getprop ro.product.model\`, \`uname -m\`, \`node -v\`, \`pm2 status\`, \`termux-battery-status\`. Não publicar tokens, endereços privados ou credenciais.
3. Ler README e código da branch; corrigir problemas encontrados por revisão e testes em uma branch/PR separados, se necessário.
4. Criar worktree isolado; instalar dependências no Termux e compilar \`llama.cpp\` com \`-j2\`, sem reiniciar PM2 nem serviços.
5. Baixar GGUF Qwen2.5 1.5B Q4_K_M para \`~/models\` e conferir integridade/tamanho/espaço.
6. Criar \`config.json\` privado a partir do exemplo, executar diagnóstico e \`node --test\`.
7. Fazer benchmark curto de inferência local em loopback. Se memória/temperatura ficarem inadequadas, **parar e reportar**, sem forçar OOM.
8. Gerar um EPUB de teste (4 capítulos, ou menos se o hardware exigir), validar \`unzip -t\` e examinar conteúdo.
9. **Não ativar scheduler, não fazer \`pm2 save\`, não enviar EPUB ao Kindle e não modificar dashboard sem confirmação posterior do usuário.**
10. Relatar: RAM livre antes/durante, tamanho GGUF, tokens/s aproximados, tempo total, temperatura, caminho do EPUB, logs resumidos, falhas e mudanças efetuadas.

## Proibições

- Não alterar \`ecosystem.config.cjs\`, \`minecraft.ecosystem.config.cjs\`, serviços Bom Dia/Tailscale/Cloudflare, mundo Minecraft ou configurações SSH.
- Não apagar dados privados, estados PM2 ou locks sem verificar processos e autorização.
- Não expor \`llama-server\` fora de \`127.0.0.1\`.
- Não colocar chaves/credenciais em Git.
- Não usar o desktop para geração de texto; ele é só gateway ADB/SSH nesta fase.

## Definição de pronto

Primeiro EPUB produzido inteiramente no A30, validado localmente, sem regressões dos serviços existentes, com métricas reais e plano de próxima etapa.
