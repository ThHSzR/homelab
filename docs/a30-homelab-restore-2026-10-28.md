# Restauração HomeLab no A30 — 2026-10-28

Objetivo: reinstalar o ambiente HomeLab no Android stock do Galaxy A30 `SM-A305GT`, sem Kindle Writer e sem alterar o A10s.

## Estado

- ADB identifica `RQ8M70A9WBP` como `SM-A305GT`; Android terminou o boot (`sys.boot_completed=1`). Só este serial foi alvo.
- O backup em `A:\homelab-a30-native-2026-10-27\backup` contém `termux-home`, `termux-prefix`, `termux-prefix-var.tar.gz`, serviços e estado. Os projetos `kindle-writer` estão no backup, mas **não fazem parte da restauração**.
- Termux 0.118.3 arm64, Termux:API 0.53.0 e Termux:Boot 0.8.1 instalados via ADB. APKs em `A:\homelab-a30-serveros-2026-10-27\apks`.
- Backup de `termux-home` copiado para o usuário Termux, excluindo `services/kindle-writer`, `winterhold`, `winterhold-apk`, checkpoints temporários e histórico de shell. Inclui `services/homelab`, Bom Dia, Minecraft, chaves/config SSH e arquivos de estado.
- Redis, Node.js, Python e OpenSSH **ainda não foram instalados**. O `apt-cache` lista versões candidatas no repositório oficial, mas `apt-get install` responde “Unable to locate package”; investigar o índice/ambiente do Termux antes de iniciar serviços.
- Tailscale Android 1.104.2 está instalado, sem configuração confirmada após a restauração stock.

## Retomada em 28/10

- O `pkg install` foi executado dentro de uma shell Termux com `PREFIX`, `HOME` e `PATH` corretos; instalados Node.js 26.12.1, Redis 8.10.3, Python 3.14.8, OpenSSH 10.6p1, `proot-distro` e PM2.
- Dependências RQ restauradas em um venv novo para evitar incompatibilidade do `.venv` antigo.
- PM2 restaurado com `kindle-writer` removido do dump; script de boot do Kindle removido da pasta ativa. Não iniciou inferência nem worker de livros.
- `homelab-status`, watchdog, Redis e worker RQ do A30 online; `/healthz` retornou `ok` e `cluster.py status` mostrou Redis saudável e worker `homelab-a30` ocioso. Tailscale userspace autenticado (`100.65.49.34`), Serve SSH configurado para a tailnet e TCP/8022 local aceitou conexão.
- Termux:Boot foi aberto via ADB; criado `~/.termux/boot/10-sshd` para iniciar SSH no boot. PM2 salvo após remover o Kindle.
- `bom-dia` segue parado conforme `services/bom-dia/desired.json` (`offline`). Minecraft não subiu: requer OpenJDK 25 e reserva até 3 GiB; o download do JDK foi interrompido por mirror muito lento. Não alterei sua configuração. A10s não foi modificado; nenhuma fila/worker `a10s` aparece conectado ainda.
- O uso de `/sdcard/Download/homelab-restore` foi temporário para transferir o backup; cópias externas de `.ssh` e `.termux_authinfo` foram removidas. Segredos permanecem no armazenamento privado do Termux e em `A:`.

## Próximo passo

Autorizar/confirmar no Android a instalação via USB se o sistema apresentar essa solicitação; em seguida instalar Termux e os add-ons com a mesma assinatura GitHub. Restaurar os diretórios necessários ao espaço compartilhado e executar o script de restauração pelo próprio Termux, excluindo `services/kindle-writer`. Recriar configuração de SSH e autenticar Tailscale na conta do usuário. Nunca copiar credenciais privadas para Git.

Não declarar concluído até Redis, Dashboard, workers RQ, SSH e inicialização após reboot estarem recuperados. Restaurar somente componentes HomeLab confirmados no backup; não retomar Kindle Writer, inferência ou envios automáticos.
