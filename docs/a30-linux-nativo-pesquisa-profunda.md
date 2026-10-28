# Pesquisa: Linux nativo no Galaxy A30 SM-A305GT

Quero substituir o Android do **Samsung Galaxy A30 SM-A305GT** por um Linux nativo, mínimo, sem interface gráfica, com SSH. Não servem Termux, PRoot, chroot, GSI Android nem Linux hospedado pelo Android. O A10s SM-A107M é outro aparelho e não deve ser alterado.

## Aparelho e estado conhecido

- ADB: serial `RQ8M70A9WBP`, produto `a30dtvvj`, SoC Exynos 7904, ARM64, 4 GB de RAM, eMMC de 64 GB.
- Firmware original: `A305GTVJU8CWE1`, CSC `ZTO`, Android 11, bootloader revisão **B8**. Antes do teste, `flash.locked=0`, Verified Boot `orange`; Download Mode mostrou `OEM LOCK: OFF (U)`, `FRP LOCK: OFF`, `AP SWREV B:8 K:8 S:8`.
- Partições principais: BOOT 36 MiB, SYSTEM 4,69 GiB, VBMETA 512 KiB. PIT lido do aparelho confere com o PIT do firmware stock.
- Backup de dados acessíveis e firmware stock exato foram preservados fora do Git. Não houve backup das partições inacessíveis sem root, incluindo EFS.
- **Estado atual:** Linux não iniciou. A segunda restauração do firmware Samsung BL/AP/CP/CSC terminou com sucesso na ferramenta e reiniciou o aparelho; o boot normal ainda não foi confirmado pelo usuário.

## O que já foi tentado

O port `samsung-a30` do postmarketOS/Nura está [arquivado e sem manutenção](https://gitlab.postmarketos.org/postmarketOS/pmaports/-/tree/master/device/archived/device-samsung-a30). Seu [kernel 4.4.177](https://gitlab.postmarketos.org/postmarketOS/pmaports/-/tree/master/device/archived/linux-samsung-a30) deriva de fonte anunciada para **SM-A305F**, sem prova de compatibilidade com **SM-A305GT**. A imagem CLI foi compilada com boot image Android v1, initramfs gzip, rootfs ext4, OpenRC e SSH. Validação offline passou; nenhum boot Linux foi observado.

No primeiro flash, o Samloader 2.2.0 completou o handshake e leu o PIT, mas LOKE retornou `FAIL! -1` ao aceitar `TotalBytes`, antes de transmitir imagens. No segundo, o PIT stock byte a byte idêntico foi aceito, assim como `TotalBytes=0x50150000`, mas LOKE retornou `FAIL! -1` na primeira imagem. O log não permite afirmar se bytes dessa imagem foram gravados. Heimdall 2.0.2 e Odin4 7.3.0 também tiveram falhas de sessão USB/Download. A restauração stock posterior com Samloader terminou com código 0. Não assumir que o erro prove incompatibilidade do kernel: o bloqueio ocorreu durante o flash, antes de qualquer boot.

## O que investigar

1. Existe port **nativo** mais recente para **SM-A305GT** (não A30s, nem A305F sem adaptação comprovada)? Pesquisar postmarketOS, Alpine, mainline Linux e ports mantidos pela comunidade, com links para código, commits e relatos de boot real.
2. Qual combinação de kernel, device tree/DTBO, initramfs e formato de boot funciona no GT revisão B8? Há evidência de console, armazenamento, USB networking, Wi-Fi, carga e controle térmico?
3. Por que LOKE aceita PIT e `TotalBytes`, mas recusa a primeira imagem? Verificar protocolo, ordem de partições, exigência de TAR/MD5, assinatura, VBMETA, tamanho/formato de SYSTEM e limitações do Samloader/Odin4/Heimdall **com evidência específica**, sem sugerir comandos de flash por suposição.
4. Se não houver port pronto, qual é o menor caminho técnico verificável para portar o kernel e iniciar um shell Linux nativo neste hardware? Indicar arquivos, patches, método de build, teste de boot e recuperação stock.

Separar fatos comprovados de hipóteses e indicar fontes primárias. Há [inventário e histórico detalhados](a30-linux-nativo-2026-10-27.md) na branch `experiment/a30-native-linux` de `ThHSzR/homelab`. Não recomendar novo flash antes de confirmar recuperação e compatibilidade.
