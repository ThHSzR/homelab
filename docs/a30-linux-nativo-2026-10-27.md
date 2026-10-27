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
- A primeira imagem de boot usava initramfs Zstandard, mas esse kernel 4.4 habilita `CONFIG_RD_GZIP=y` e não possui descompressor Zstandard. Foi adicionada `deviceinfo_initfs_compression="gzip"`. A comparação com o boot stock GT também mostrou cabeçalho versão 1, página 2048 e base `0x10000000`; o port não declarava versão/base. Foram adicionados `deviceinfo_header_version="1"` e `deviceinfo_flash_offset_base="0x10000000"`. O [patch completo](../docs/patches/a30-native-pmaports.patch) registra as três alterações de `deviceinfo` e os checksums. Pacote `device-samsung-a30-6-r0.apk` final SHA-256 `5a35baee514672b67feefdca576bf717b989a3435af967499443822708552707`.
- `pmbootstrap install --split --zap --password <senha-descartável>` e `pmbootstrap export` terminaram com sucesso. A senha usada nesta montagem é **descartável e conhecida no ambiente de build**; a imagem precisará ser recriada com uma nova credencial antes de qualquer instalação. O rootfs identifica-se como **Nura edge** (`ID_LIKE=alpine`), contém `apk`, OpenRC, Dropbear/SSH no runlevel padrão, NetworkManager e `wpa_supplicant`. A chave SSH pública esperada está no `authorized_keys` da imagem; nenhum material privado foi incluído no Git.
- `gzip -t` passou no initramfs. `e2fsck -fn` passou no rootfs ext4 sem erros. O [verificador offline](../tools/a30-native/verify-image.py) confirmou cabeçalho Android v1, tamanho abaixo dos 36 MiB da partição BOOT, e igualdade SHA-256 do kernel e initramfs embutidos com os artefatos separados. `pmbootstrap bootimg_analyze` confirmou v1, página 2048, base e offset de kernel iguais aos do boot stock GT. **Isso valida formato e integridade offline, não boot no aparelho.**

| Artefato final em `A:\homelab-a30-native-2026-10-27\build\gzip-header-v1` | Tamanho | SHA-256 |
| --- | ---: | --- |
| `boot.img` | 32.831.488 bytes | `10f1e1e5b614c232579fc1acc609e7e4315cf53681c8795dabc3928eca9e1916` |
| `initramfs` | 9.288.009 bytes | `12282b1adb742f223c31d716984acd0dcdf31cbccbe6681adf339609f986f497` |
| `samsung-a30-boot.img` | 536.870.912 bytes | `759130384d84e51e840256bb5a175124095f5a2eed19ca34b6dff59d38626df2` |
| `samsung-a30-root.img` | 773.849.088 bytes | `563d791a711ee58ff07cca62f8d04752e6241e28af8eed562a75d2b9d462fcd6` |
| `vmlinuz` | 23.538.640 bytes | `2862149de60ca3b9a96efd0ed4b16643b29079848fba90f79b78fb1ae0f658d5` |

Esses arquivos são **experimentais, não aprovados para flash**. A pasta `build` conserva também as versões anteriores para rastreabilidade. O `boot.img` cabe em BOOT; o rootfs de 738 MiB cabe em SYSTEM (4,69 GiB). A imagem separada `samsung-a30-boot.img` é uma partição ext2 de `/boot`, não a partição Samsung BOOT; não deve ser confundida com `boot.img`.
- O firmware stock exato para **SM-A305GT / ZTO / A305GTVJU8CWE1** foi baixado pelo serviço FUS da Samsung, com componentes BL/AP/CP/CSC/HOME_CSC. ZIP SHA-256: `75db4b7cf5d8b0d43e528a2aa874611edf8c26c32c1ff24a62595bd60459d641`. Os cinco `.tar.md5` passaram na verificação MD5 do `samloader` e receberam SHA-256 independente. O PIT `A30_SWA_OPEN.pit` do CSC tem 37 entradas; nomes e tamanhos de `BOOT` (36 MiB), `SYSTEM` (4,69 GiB), `VBMETA` (512 KiB), `EFS` e `SEC_EFS` concordam com o mapa ADB. O PIT do **aparelho vivo** ainda não foi lido no Download Mode.
- Backup privado em `A:\homelab-a30-native-2026-10-27\backup`: home Termux (incluindo serviços, modelos, scripts, PM2, SSH, Tailscale userspace, configurações e checkpoints), `usr/etc`, arquivo `usr/var` e 37 MB de armazenamento compartilhado. O tar de `usr/var` tem 355.813.483 bytes, passou em `gzip -t` e lista 21.879 entradas, preservando links simbólicos. Os **12 modelos GGUF** foram comparados por SHA-256 e conferem. Também conferem por SHA-256 `dump.rdb`, `cluster.json`, `dump.pm2` e `homelab/package.json`. `redis-check-rdb` 8.10.2 do A30 validou o snapshot (checksum OK, 15 chaves); a cópia tem hash idêntico. A versão 7 da ferramenta no Ubuntu não entende RDB v15, portanto não foi usada como prova de corrupção. Sockets Unix serão recriados. **Backup parcial do aparelho:** sem root, as partições e dados privados de outros aplicativos Android não foram salvos. Isso limita uma restauração integral.

## Recuperação stock preparada (não executada)

Os cinco componentes stock verificados estão apenas na pasta privada de firmware em `A:`. A ferramenta de flash CLI `samloader` 2.2.0 está disponível no Windows; Heimdall 2.0.2 foi instalado no Ubuntu, mas o USB em WSL2 não foi validado. Para recuperação após um eventual experimento autorizado, entrar no **Download Mode do A30 confirmado por modelo e serial**, verificar o estado na tela, e gravar **somente** os componentes BL/AP/CP/CSC do pacote `A305GTVJU8CWE1`/ZTO com `samloader flash -b <BL.tar.md5> -a <AP.tar.md5> -c <CP.tar.md5> -s <CSC.tar.md5>`. O CSC normal restaura o layout de dados de fábrica; `HOME_CSC` só seria considerado para preservar dados se o estado do aparelho permitisse, sem garantia. Não usar `--pit`, `--erase`, `--skip-md5` ou `--skip-size-check`; não gravar `EFS`/`SEC_EFS` manualmente. Depois, configurar Android, USB e restaurar os dados privados a partir de `A:`. O procedimento **ainda não foi testado neste A30**.

## Bloqueios antes de qualquer pedido de flash

1. O kernel/port é de **SM-A305F**, e não há evidência de inicialização no **SM-A305GT**. USB, eMMC, Wi-Fi, carga e temperatura ainda não foram medidos nesse hardware sob Linux nativo. A compilação não resolve essa incerteza.
2. O caminho exato de Verified Boot/VBMETA para esse firmware Samsung não foi confirmado; não será improvisado um bypass de assinatura. O PIT lido veio do firmware, não do aparelho vivo. A recuperação stock está preparada mas ainda não foi testada neste A30.
3. A senha descartável do build não pode ser usada numa instalação real. Seria necessário gerar e revalidar uma imagem com credencial nova, com a mesma revisão e hashes apresentados ao usuário.
4. Qualquer proposta de teste por flash exigirá revisão concreta de partições, arquivos/hashes finais, riscos, backup parcial e procedimento de recuperação, seguida de **aprovação explícita**. Até lá o A30 segue com Android e o A10s permanece intocado.
