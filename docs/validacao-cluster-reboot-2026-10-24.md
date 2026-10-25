# Validação de reinicialização do A10s — 24/10/2026

## Primeiro teste após abrir Termux:Boot

O aplicativo passou a `stopped=false, notLaunched=false`. O reboot físico incrementou o contador de boot de 4 para 5 e alterou o identificador de boot. O Android retornou ao ADB sem nova autorização; a VPN Tailscale nativa conectou sozinha e respondeu a ping vindo do A30. O broadcast de boot chegou ao Termux:Boot, e o SSH foi iniciado automaticamente.

Tailscale userspace e cluster não iniciaram nesse primeiro teste. O log de boot mostrou `FileNotFoundError: pm2`, embora o executável estivesse no PATH. O comando instalado pelo npm usa `#!/usr/bin/env node`, que depende da adaptação de execução presente na sessão interativa. A falha foi reproduzida em SSH com ambiente limpo (`env -i`), sem iniciar aplicativos por interface.

## Correção implantada

- `pm2_runtime.py` chama explicitamente o Node do Termux e o script JavaScript do PM2; boot e tarefa de inspeção de serviços usam esse comando.
- A rotina conclui `pm2 ping` antes de interpretar a saída JSON de `jlist`, cobrindo a mensagem de primeira inicialização do daemon.
- No A10s, `95-homelab-cluster` passou a iniciar o Tailscale userspace antes do túnel e do worker. O boot 90 separado foi movido para backup fora de `~/.termux/boot`, concentrando a partida do PM2 nessa rotina.
- A variante 90 para instalação independente também passou a chamar Node diretamente. Usar 95 sozinho para o A10s que participa deste cluster.

A execução da rotina corrigida com `env -i` passou e restaurou os três processos. A tarefa de diagnóstico enfileirada durante a indisponibilidade concluiu no A10s (`f08197d5-dad1-49db-b597-e4f90ddc5cee`). Esse resultado valida a recuperação manual com ambiente mínimo; o segundo reboot físico está em andamento e ainda não deve ser considerado aprovado.

O código foi sincronizado nos dois nós. Somente o worker novo do cluster foi reiniciado no A30 para carregar a correção; a tarefa de inspeção de serviços concluiu (`d51f42d8-36a1-4452-9abd-e7e505d9018b`). Dashboard, watchdog, túneis, Tailscale e Kindle Writer mantiveram os PIDs anteriores. O A30 não foi reiniciado.

Root permanece pendente e não houve nova gravação de firmware nesta validação.
