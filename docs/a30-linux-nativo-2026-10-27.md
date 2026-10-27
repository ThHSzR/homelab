# Galaxy A30: investigação de Linux nativo (2026-10-27)

## Estado da operação

**Sem flash.** O A30 continua no Android. O port `samsung-a30` do postmarketOS/Nura está arquivado por falta de manutenção. A fonte do kernel indicada pelo port foi publicada para SM-A305F, enquanto o aparelho identificado é SM-A305GT. Essa diferença de variante e a inicialização real no GT ainda não foram validadas. Não há base técnica para tratar a imagem como pronta para instalar.

O A10s (SM-A107M, serial R9QNB0AE3RB) não foi modificado nesta operação.

## Inventário obtido com ADB

Todos os comandos ADB foram direcionados explicitamente ao serial **RQ8M70A9WBP**. `adb version`: 1.0.41 / 37.0.1-15733141. `adb devices -l` mostrou dois aparelhos: SM-A305GT (`a30`, `a30dtvvj`) e SM-A107M (`a10s`, `a10sub`).

| Campo | Valor do A30 |
| --- | --- |
| Modelo / produto / placa | SM-A305GT / `a30dtvvj` / `exynos7904` |
| Firmware / bootloader / baseband | `A305GTVJU8CWE1` |
| CSC | `ZTO` |
| Android / patch | 11 / 2022-10-01 |
| Kernel atual | `4.4.177-22602103`, aarch64 |
| CPU | 6 × Cortex-A53 (`0xd03`), 2 × Cortex-A73 (`0xd09`) |
| RAM | 3.66 GiB (`MemTotal: 3835796 kB`) |
| Bootloader | `ro.boot.flash.locked=0`; `ro.boot.verifiedbootstate=orange`; `sys.oem_unlock_allowed=1` |
| Root | `su` ausente; ADB é UID 2000; partições de boot só legíveis pelo root |
| Bateria | 100%, USB conectado, 29,5 °C no momento da leitura |
| Armazenamento | eMMC 61.071.360 KiB; `/data` 51 GiB, 32 GiB usados, 20 GiB livres |

Há 32 partições `mmcblk0p1` a `p32`, sem esquema A/B observado. Mapeamento relevante: `boot=p15` (36 MiB), `recovery=p16` (53 MiB), `dtb=p17` (8 MiB), `dtbo=p18` (8 MiB), `vbmeta=p22` (512 KiB), `system=p25` (4,69 GiB), `vendor=p26` (568 MiB), `product=p27` (400 MiB), `userdata=p32` (51,9 GiB). `efs=p3` e `sec_efs=p4` **não devem ser sobrescritas**. A recuperação atual não foi identificada com segurança; Android está em modo normal.

## Fontes e compatibilidade

- [Port oficial arquivado no pmaports](https://gitlab.postmarketos.org/postmarketOS/pmaports/-/tree/master/device/archived/device-samsung-a30), commit `1eb4dce28ef2d0ecc8651914bcb4972083eefb0f` inspecionado via Git. `deviceinfo` define `aarch64`, `heimdall-bootimg`, partição `boot` para kernel e `system` para rootfs; não lista variantes SM-A305GT. O APKBUILD assinala `Archived: unmaintained`.
- [Pacote do kernel](https://gitlab.postmarketos.org/postmarketOS/pmaports/-/tree/master/device/archived/linux-samsung-a30): versão 4.4.177, commit fonte `5eeafe2bfcb93847b403fd92bd92f9d0a9f6341d`, compilação com GCC 6 exigida pelo port. A [fonte do mantenedor](https://gitlab.com/faveoled/linux-samsung-a30) declara origem **SM-A305F / A305FDDU6CVD2**. A equivalência com SM-A305GT / A305GTVJU8CWE1 não foi comprovada.
- [Categorias oficiais](https://docs.postmarketos.org/pmaports/main/packaging/device-categorization.html): ports arquivados não recebem pacotes binários nem constam da seleção normal do `pmbootstrap`; podem não inicializar ou estar sem manutenção.
- O port possui um `initfs-hook.sh` para gadget USB RNDIS e pacote de firmware Wi-Fi. Isso é intenção de implementação, **não validação** de USB, Wi-Fi, carga, temperatura ou armazenamento no GT.
- A configuração do kernel habilita ext4, initramfs, USB ConfigFS/RNDIS, driver SCSC Wi-Fi, bateria Samsung, carregador S2MU106 e térmica Exynos. É uma verificação estática: nenhuma dessas funções foi testada com Linux no SM-A305GT.
- O `dtbo.img` do firmware stock GT contém três overlays `A30 SWA OPEN 00/01/02`. O Android informa `ro.boot.dtbo_idx=2` e revisão de placa `3`; **infere-se** a seleção do terceiro overlay. A fonte do port contém `exynos7904-a30_swa_open_02.dts` com o mesmo identificador de compatibilidade. Isso reduz uma incerteza de árvore de dispositivo, mas não valida equivalência de hardware ou boot.
- A análise offline do `boot.img` stock por `pmbootstrap bootimg_analyze` retornou cabeçalho v1, base `0x10000000`, página 2048 e offset de kernel `0x00008000`. O `deviceinfo` do port não explicita a base nem a versão do cabeçalho. O boot image gerado deve ser comparado antes de qualquer flash.
- Há um [relato de travamento no carregamento do postmarketOS no A30](https://gitlab.com/postmarketOS/pmaports/-/issues/2699). A variante do aparelho do relato não está estabelecida. Não é evidência de funcionamento nem prova de falha neste SM-A305GT.

## Compilação e validação offline

- Ubuntu 24.04 em WSL2; `pmbootstrap` 3.12.1, `pmaports` commit acima, Heimdall 2.0.2, `qemu-user-static` e dependências de compilação instaladas.
- Configuração de imagem: canal `edge`, `samsung-a30` arquivado selecionado manualmente, `console`, OpenRC, SSH, ferramentas de rede, sem ambiente gráfico. OpenRC foi escolhido porque o instalador avisou que systemd atual exige kernel >=5.4, mas o port usa 4.4.
- A primeira tentativa de compilar o kernel parou com HTTP 403 no arquivo tar do GitLab. O mesmo commit `5eeafe2bfcb93847b403fd92bd92f9d0a9f6341d` foi clonado por Git e empacotado localmente com `git archive --format=tar --prefix=linux-samsung-a30-<commit>/ HEAD | gzip -1 -n`. SHA-512 do tar local: `e475f94a2e8aae7ae80860cc474112dddce9ca2851ac79f60af941624d08b0b0f2e4dc463197c97875e83c428ee25833daa33bf6596f5303f91f2dccd9985649`. O código fonte permaneceu no commit declarado; a mudança no APKBUILD foi o checksum do empacotamento local. O kernel compilou; APK SHA-256 `a2817cc44178ef997e02faacab917ee7fe067ceb8b790996f2c4b03efe0e6271`.
- A primeira imagem de boot usava initramfs Zstandard, mas esse kernel 4.4 habilita `CONFIG_RD_GZIP=y` e não possui descompressor Zstandard. Foi adicionada `deviceinfo_initfs_compression="gzip"`. A comparação com o boot stock GT também mostrou cabeçalho versão 1, página 2048 e base `0x10000000`; o port não declarava versão/base. Foram adicionados `deviceinfo_header_version="1"`, `deviceinfo_flash_offset_base="0x10000000"` e o nome PIT `deviceinfo_flash_heimdall_partition_vbmeta="vbmeta"`. O [patch completo](../docs/patches/a30-native-pmaports.patch) registra as alterações e checksums. Pacote `device-samsung-a30-6-r0.apk` SHA-256 `5a63d88e4e5e3ebaf88fec8c32c76d4ac6990aa9b7d899fa829d7a7ecfd9b5f9`.
- O build final usa `pmbootstrap install --single-partition --zap` para produzir um ext4 simples gravável em SYSTEM; `--split` gerava um disco com duas partições e não é o formato do flasher Heimdall deste port. O rootfs identifica-se como **Nura edge** (`ID_LIKE=alpine`), contém `apk`, OpenRC, Dropbear/SSH, NetworkManager e `wpa_supplicant`. A chave SSH pública esperada está em `authorized_keys`. A senha aleatória de teste e o backup ficam somente em `A:`; a senha não foi publicada no Git.
- O VBMETA de teste foi gerado com o `avbtool` oficial do AOSP e a mesma operação usada pelo flasher do pmbootstrap: `make_vbmeta_image --flags 2 --padding_size 2048`. `info_image` confirma flags `2` (verificação AVB desativada), 2048 bytes, sem descritores e algoritmo `NONE`. O bootloader está desbloqueado (`flash.locked=0`, Verified Boot `orange`), mas a aceitação dessa imagem pelo firmware Samsung GT só será confirmada no teste.
- `gzip -t` e `e2fsck -fn` passaram. O [verificador offline](../tools/a30-native/verify-image.py) confirmou cabeçalho Android v1, tamanho abaixo dos 36 MiB da partição BOOT, e igualdade SHA-256 do kernel/initramfs embutidos com os artefatos separados. `pmbootstrap bootimg_analyze` confirmou versão, página 2048, base e offset do kernel iguais aos do boot stock GT. Essas verificações não provam que o kernel inicializa no GT.

| Artefato para o teste em `A:\homelab-a30-native-2026-10-27\build\ready-to-test` | Tamanho | SHA-256 |
| --- | ---: | --- |
| `boot.img` (partição BOOT) | 32.831.488 bytes | `d0f9d2d53100a16e3388e63ce66c668f0c4a2f4559749dcdf7a5be0e7326e2c1` |
| `samsung-a30.img` (ext4, partição SYSTEM) | 1.310.720.000 bytes | `5d1618e30bd19d155fdec2ef6650dabf6b41fc96778a6d51d0c5a747db612b94` |
| `vbmeta.img` (verificação AVB desativada) | 2.048 bytes | `77459d53a17237e5e1ef7aef51e3c09773b4a6138b9b1922ca0fbeb5223960af` |
| `initramfs` | 9.287.855 bytes | `3b636279504bcd10db40394942a25dd361ff922f7b7f418eb6a6f77f7c2ee82f` |
| `vmlinuz` | 23.538.640 bytes | `2862149de60ca3b9a96efd0ed4b16643b29079848fba90f79b78fb1ae0f658d5` |

Gravação planejada via `samloader` no Download Mode: `VBMETA=vbmeta.img`, `SYSTEM=samsung-a30.img`, `BOOT=boot.img`. Não alterar PIT, `EFS` ou `SEC_EFS`. O teste pode deixar o telefone sem inicializar; o firmware original exato está disponível para recuperação, que reinstala Android e pode apagar dados. O backup é parcial, como detalhado acima.
- O firmware stock exato para **SM-A305GT / ZTO / A305GTVJU8CWE1** foi baixado pelo serviço FUS da Samsung, com componentes BL/AP/CP/CSC/HOME_CSC. ZIP SHA-256: `75db4b7cf5d8b0d43e528a2aa874611edf8c26c32c1ff24a62595bd60459d641`. Os cinco `.tar.md5` passaram na verificação MD5 do `samloader` e receberam SHA-256 independente. O PIT `A30_SWA_OPEN.pit` do CSC tem 37 entradas; nomes e tamanhos de `BOOT` (36 MiB), `SYSTEM` (4,69 GiB), `VBMETA` (512 KiB), `EFS` e `SEC_EFS` concordam com o mapa ADB. O PIT do **aparelho vivo** ainda não foi lido no Download Mode.
- O `vbmeta.img` stock GT (SHA-256 `bb10cccd4dc7b6f3495d3121db024e0f985f32d8c0086af2e7b36efd1246f8ce`) tem `Flags: 0`, descritor de hash para **BOOT** e hashtree para **SYSTEM**. O flasher padrão do pmbootstrap gera VBMETA com flag 2 para desativar verificação, e esse artefato foi preparado offline. Sua aceitação pelo bootloader ainda é experimental.
- Em Download Mode, `samloader detect --json` identificou **SM-A305GT** (serial Download `CCU0051564ED356`); o ADB continuou listando apenas o A10s `R9QNB0AE3RB`. O PIT vivo foi lido sem gravação para `evidence/live-pit-a30.pit`. As 37 entradas e cada tupla nome/início/tamanho coincidem com `A30_SWA_OPEN.pit` do firmware, incluindo BOOT (partition ID 15, 73.728 blocos), VBMETA (ID 22, 1.024 blocos) e SYSTEM (ID 25, 9.830.400 blocos). A operação ainda não gravou partições.
- Backup privado em `A:\homelab-a30-native-2026-10-27\backup`: home Termux (incluindo serviços, modelos, scripts, PM2, SSH, Tailscale userspace, configurações e checkpoints), `usr/etc`, arquivo `usr/var` e 37 MB de armazenamento compartilhado. O tar de `usr/var` tem 355.813.483 bytes, passou em `gzip -t` e lista 21.879 entradas, preservando links simbólicos. Os **12 modelos GGUF** foram comparados por SHA-256 e conferem. Também conferem por SHA-256 `dump.rdb`, `cluster.json`, `dump.pm2` e `homelab/package.json`. `redis-check-rdb` 8.10.2 do A30 validou o snapshot (checksum OK, 15 chaves); a cópia tem hash idêntico. A versão 7 da ferramenta no Ubuntu não entende RDB v15, portanto não foi usada como prova de corrupção. Sockets Unix serão recriados. **Backup parcial do aparelho:** sem root, as partições e dados privados de outros aplicativos Android não foram salvos. Isso limita uma restauração integral.

## Recuperação stock preparada (não executada)

Os cinco componentes stock verificados estão apenas na pasta privada de firmware em `A:`. A ferramenta de flash CLI `samloader` 2.2.0 está disponível no Windows; Heimdall 2.0.2 foi instalado no Ubuntu, mas o USB em WSL2 não foi validado. Para recuperação após um eventual experimento autorizado, entrar no **Download Mode do A30 confirmado por modelo e serial**, verificar o estado na tela, e gravar **somente** os componentes BL/AP/CP/CSC do pacote `A305GTVJU8CWE1`/ZTO com `samloader flash -b <BL.tar.md5> -a <AP.tar.md5> -c <CP.tar.md5> -s <CSC.tar.md5>`. O CSC normal restaura o layout de dados de fábrica; `HOME_CSC` só seria considerado para preservar dados se o estado do aparelho permitisse, sem garantia. Não usar `--pit`, `--erase`, `--skip-md5` ou `--skip-size-check`; não gravar `EFS`/`SEC_EFS` manualmente. Depois, configurar Android, USB e restaurar os dados privados a partir de `A:`. O procedimento **ainda não foi testado neste A30**.

## Estado antes do teste no aparelho

O alvo foi reconfirmado por ADB como `SM-A305GT`, serial `RQ8M70A9WBP`, Android 11, `flash.locked=0`, estado `orange`. Após reiniciar fisicamente e reativar ADB, uma nova sessão identificou SM-A305GT no Samloader e leu `evidence/live-pit-a30-retry.pit` (SHA-256 `33b3ad83745e984c921a60484f9158654eac5ecb27c34c96f32d6bbd624cae56`); suas 37 entradas coincidem com o PIT stock. O Samloader deixou de detectar o telefone depois de fechar essa sessão PIT (`--no-reboot`), então é necessário entrar novamente em Download Mode sem repetir a leitura do PIT e iniciar o flash logo após uma detecção positiva. `usbipd-win` 5.3.0 vinculou o BUSID `1-9` / VID:PID `04e8:685d` ao WSL; o A10s é BUSID `1-10` / `04e8:6860` e não foi vinculado. Heimdall 2.0.2 e Odin4 7.3.0 detectam USB, mas os handshakes expiram; nenhum escreveu. Nenhuma partição foi gravada. A10s continua fora da operação.

## Tentativa de gravação em 27/10/2026

Após nova entrada manual em Download Mode, `samloader detect --usb-backend vcom` identificou `SM-A305GT`, serial Download `CCU0051564ED356`. Os três hashes da tabela acima foram conferidos novamente em `A:`. O comando `samloader --verbose flash --usb-backend vcom -p VBMETA vbmeta.img -p SYSTEM samsung-a30.img -p BOOT boot.img` completou o handshake `ODIN`/`LOKE`, iniciou a sessão, recebeu o PIT e **falhou antes do primeiro comando de transmissão**. A mensagem foi `LOKE returned general failure (FAIL!) [code: -1]` ao enviar `Session TotalBytes=0x50150000` (1.343.553.536 bytes, soma das três imagens). O PIT indica SYSTEM com 4,69 GiB, portanto a imagem de 1,31 GB cabe na partição. O [código do Samloader 2.2.0](https://github.com/topjohnwu/samloader-rs/tree/2.2.0/odin/src) mostra que `TotalBytes` informa o tamanho total para o indicador de progresso, e `-1` é erro genérico do LOKE, sem causa específica. Depois da falha, `samloader detect` voltou a apresentar modelo vazio. Nenhuma partição foi gravada. O motivo do `FAIL` exige diagnóstico da tela Download e/ou outra sessão limpa com ferramenta compatível.

Na tela Download, o usuário confirmou `FRP LOCK: OFF`, `OEM LOCK: OFF (U)`, `SECURE DOWNLOAD: ENABLED`, `WARRANTY VOID: 1` e revisão `AP SWREV B:8 K:8 S:8`, sem mensagem vermelha. Após nova entrada manual, Samloader confirmou novamente SM-A305GT antes de conectar somente BUSID `1-9` ao WSL. O Odin4 7.3.0 abriu `/dev/bus/usb/001/004` como root e completou o handshake inicial, mas a consulta do tipo de dispositivo expirou repetidamente e `begin session` falhou. Log privado: `A:\homelab-a30-native-2026-10-27\evidence\odin4-a30-attempt-root-2026-10-27.log`. Não houve leitura do PIT nem envio de imagens nessa tentativa. **Estado: Linux nativo não instalado; nenhuma partição escrita.** O bloqueio é a sessão de flash, com causa ainda não estabelecida. O port SM-A305F também permanece sem boot comprovado no SM-A305GT.
