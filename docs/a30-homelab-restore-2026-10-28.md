# Restauração HomeLab no A30 — 2026-10-28

Objetivo: reinstalar o ambiente HomeLab no Android stock do Galaxy A30 `SM-A305GT`, sem Kindle Writer e sem alterar o A10s.

## Estado

- ADB identifica `RQ8M70A9WBP` como `SM-A305GT`; Android terminou o boot (`sys.boot_completed=1`). Só este serial foi alvo.
- O backup em `A:\homelab-a30-native-2026-10-27\backup` contém `termux-home`, `termux-prefix`, `termux-prefix-var.tar.gz`, serviços e estado. Os projetos `kindle-writer` estão no backup, mas **não fazem parte da restauração**.
- APKs oficiais atuais baixados em `A:\homelab-a30-serveros-2026-10-27\apks`: Termux 0.118.3 arm64, Termux:API 0.53.0 e Termux:Boot 0.8.1. SHA-256 pendente.
- O envio/instalação ADB do Termux ficou pendente sem resposta do Package Manager após transferência. Nenhum pacote Termux consta instalado. ADB segue conectado.
- Tailscale Android 1.104.2 está instalado, sem configuração confirmada após a restauração stock.

## Próximo passo

Autorizar/confirmar no Android a instalação via USB se o sistema apresentar essa solicitação; em seguida instalar Termux e os add-ons com a mesma assinatura GitHub. Restaurar os diretórios necessários ao espaço compartilhado e executar o script de restauração pelo próprio Termux, excluindo `services/kindle-writer`. Recriar configuração de SSH e autenticar Tailscale na conta do usuário. Nunca copiar credenciais privadas para Git.

Não declarar concluído até Redis, Dashboard, workers RQ, SSH e inicialização após reboot estarem recuperados. Restaurar somente componentes HomeLab confirmados no backup; não retomar Kindle Writer, inferência ou envios automáticos.
