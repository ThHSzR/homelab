# Tailscale userspace no A10s ARM32

Instância separada do aplicativo Android, com nome `a10s-termux`, estado privado e sem TUN. Usa Tailscale oficial 1.104.1 ARM, Debian bookworm-slim em proot-distro e a conta correspondente ao UID real do Termux. Não copiar estado ou chaves de outra instância.

## Compatibilidade validada

O proot-distro reporta por padrão um kernel recente; o Go deste binário passa a usar syscalls time64 indisponíveis no kernel do aparelho. Os scripts reportam 4.19.127 e passam `GOMAXPROCS=1` explicitamente ao ambiente do container.

O PRoot 5.1.107.101 também substituiu netlink por respostas emuladas após detectar que escritas eram proibidas. No aparelho testado, consultas de leitura funcionam; a resposta emulada apresentou interfaces ativas como desligadas e impediu o login. A compilação isolada em `compat/proot` remove somente a sondagem de escrita da decisão de substituir o socket. O restante da emulação permanece disponível para falhas de criação/bind. O PRoot global não é substituído.

Fonte base: termux/proot, commit `b27d81a68d765f3462e807f4a14e01a03f8e89ea`. `proot-netlink-read.patch` contém a alteração completa. `build-compat.sh` reproduz a compilação com clang, make e libtalloc do Termux. Esta variante se destina ao daemon userspace; não usar como solução genérica para configurar redes no bubblewrap. Não houve alteração de SELinux nem obtenção de privilégios.

O teste no aparelho confirmou interfaces/endereços reais dentro do PRoot e comunicação com controlplane.tailscale.com. A identidade `a10s-termux` foi autenticada na mesma tailnet do A30. Ping entre as instâncias userspace, SSH autenticado via Serve e uma tarefa SHA-256 pelo novo transporte passaram. O primeiro teste de reboot encontrou Termux:Boot como nunca aberto; aguarda-se essa abertura manual e um novo teste. Os testes de conectividade acima ocorreram antes desse reboot.

## Instalação e operação

Diretório remoto: `~/services/tailscale-userspace`. Pré-requisitos: proot-distro, clang, make, libtalloc, git, Node.js e PM2. Instalar Debian com `proot-distro install --name debian --architecture arm debian:bookworm-slim`. Guardar os binários oficiais verificados como `bin/tailscale` e `bin/tailscaled`, executáveis.

O arquivo privado `passwd` deve ser uma cópia de `/etc/passwd` do container, contendo a conta do UID/GID Termux com shell `/bin/bash`. Ambos os scripts preservam esse UID; não usar root fictício para acessar a API do daemon. Criar `state/` e `logs/` com modo 700 e `passwd` com modo 600.

```sh
./build-compat.sh
chmod 700 cli.sh start.sh 90-tailscale-userspace
pm2 start ecosystem.config.cjs
./cli.sh up --hostname=a10s-termux --accept-dns=false --accept-routes=false
# Depois de autenticar na mesma tailnet:
./cli.sh serve --bg --tcp=8022 tcp://127.0.0.1:8022
./cli.sh ip -4
./cli.sh status
```

`90-tailscale-userspace` deve ser copiado para `~/.termux/boot/`, após abrir Termux:Boot uma vez. O supervisor reinicia somente este daemon quando sai ou deixa de responder localmente; falta de Internet ou login não causa reinício por si só.

A instância userspace permite conexões de saída com `./cli.sh nc HOST PORT` e publica o SSH via Serve privado. Ela não cria acesso transparente para todos os programas do Termux. O aplicativo Android continua responsável pela VPN do sistema. Uma instância pode transportar tráfego pela outra; independência de conectividade precisa de teste específico.

Estado, arquivos passwd, logs, binários, links de autenticação e credenciais ficam fora do Git. Para parar somente esta instância: `pm2 stop tailscale-userspace`; remover o boot 90 se quiser preservar a parada após reinicialização.
