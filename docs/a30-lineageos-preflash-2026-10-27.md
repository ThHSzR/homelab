# LineageOS minimalista no Galaxy A30 SM-A305GT — diagnóstico e pré-flash

**Resultado em 27/10/2026: NO-GO para flash.** O Android stock foi recuperado e reiniciou normalmente. Ainda não há uma build LineageOS com compatibilidade específica e procedimento de instalação comprovados para **SM-A305GT / bootloader B8**, nem recovery validado nesse aparelho. Nenhuma partição foi gravada nesta fase. O A10s não recebeu comandos.

## A. Recuperação e inventário do aparelho

Todos os comandos ADB desta fase usaram `-s RQ8M70A9WBP`, após confirmar `ro.product.model=SM-A305GT`. O Windows identificou `04e8:6860`; o ADB mostrou `device product:a30dtvvj model:SM_A305GT`. O Android informou `sys.boot_completed=1`. Depois de **uma reinicialização normal** por `adb -s RQ8M70A9WBP reboot`, o mesmo serial voltou como `device`, `sys.boot_completed=1`, com firmware inalterado. Isso confirma o boot stock após a segunda restauração; não equivale a teste prolongado de estabilidade.

| Verificação | Resultado |
| --- | --- |
| Fingerprint | `samsung/a30dtvvj/a30:11/RP1A.200720.012/A305GTVJU8CWE1:user/release-keys` |
| Modelo / produto / placa | `SM-A305GT` / `a30` (`a30dtvvj` no fingerprint e ADB) / `exynos7904` |
| Firmware / patch | `A305GTVJU8CWE1` / `2022-10-01` |
| Bootloader / AVB | `ro.boot.flash.locked=0`, `verifiedbootstate=orange`, `vbmeta.device_state=unlocked` |
| Kernel | Linux `4.4.177-22602103`, aarch64 |
| Wi-Fi | ligado; rota via `wlan0`; ping de `1.1.1.1`: 1/1 resposta |
| Armazenamento | `/data`: 51 GiB; 5,9 GiB usados na primeira amostra após reboot e 6,7 GiB na captura posterior, enquanto a configuração inicial avançava |
| Bateria / temperatura | 100%, USB conectado, status carregado, saúde normal, 33,5–33,7 °C nas leituras |
| RAM stock após boot | `MemTotal=3835792 kB`; `MemAvailable=1714180 kB` na amostra; 466 linhas de processos incluindo cabeçalho |
| HomeLab no aparelho | pacotes Termux, Tailscale, F-Droid e Magisk ausentes após o reset; portanto Redis, PM2 e RQ do ambiente Termux anterior não estão operacionais agora |

O backup **anterior ao reset** continua em `A:\homelab-a30-native-2026-10-27\backup`; inclui home do Termux, configuração, `usr/var`, armazenamento compartilhado, Redis/RQ e arquivos do HomeLab conforme [inventário anterior](a30-linux-nativo-2026-10-27.md). A cópia `termux-prefix-var.tar.gz` tem 355.813.483 bytes; verificações anteriores de gzip, RDB e hashes estão naquele inventário. O ZIP stock local de 4.113.037.684 bytes foi conferido novamente por SHA-256: `75db4b7cf5d8b0d43e528a2aa874611edf8c26c32c1ff24a62595bd60459d641`. Firmware `SM-A305GT/ZTO/A305GTVJU8CWE1`, revisão B8. **EFS e outras partições inacessíveis sem root não têm backup confirmado.** Não há dados atuais de Termux para copiar após o reset.

## B. Builds candidatas

| Candidata | Evidência de origem | Lacunas para este GT B8 | Decisão |
| --- | --- | --- | --- |
| LineageOS oficial | O [catálogo oficial de dispositivos](https://github.com/LineageOS/lineage_wiki/tree/main/_data/devices), commit `7ddd0afd7c4d0a599cda6a4ddb693aa394c78145`, não contém `a30`/`a305` entre 769 fichas | Não há build nem instalação oficial para este modelo | NO-GO |
| [SamarV LineageOS 18.1](https://samarv121.dev/lineageos-18.0-universal7904/) | Port do autor para A30, marcado **abandonado** | Autor exige firmware Android 10/One UI 2.0; aparelho usa Android 11 B8. Não há prova de GT B8 nem base segura para downgrade | NO-GO |
| [Eureka LineageOS 19.1](https://sourceforge.net/projects/eurekaroms/files/Samsung/A30/S/lineage/) | ZIP `lineage-19.1-20220819-UNOFFICIAL-a30.zip`, 2022 | Nenhuma evidência localizada de SM-A305GT B8, recovery e vendor exigidos | NO-GO |
| [Eureka LineageOS 20](https://sourceforge.net/projects/eurekaroms/files/Samsung/A30/T/lineage/) | ZIP `lineage-20.0-20231123-UNOFFICIAL-a30.zip`, 750 MB; [hash publicado pelo distribuidor](https://sourceforge.net/projects/eurekaroms/files/Samsung/A30/T/lineage/lineage-20.0-20231123-UNOFFICIAL-a30.zip/download): `d3c10722547b8744e426f327ffa4c3bdff9bb6a53d4f2fc9b76a65ce805bdb7c` | A [árvore Eureka para Android 13](https://github.com/eurekadevelopment/android_device_samsung_exynos7885/tree/android-13/a30), commit `13f8c7229cb800b319639db9be534796010d2214`, declara `PRODUCT_MODEL := SM-A305F`, fingerprint e blobs `A305FNXXU6CUI2`; não foi comprovado que esse commit gerou o ZIP. O assert aceita codinomes `a30,a30dd`, mas isso **não comprova** boot no GT. Sem recovery, firmware base e testes GT B8 documentados | NO-GO |
| [LineageOS 23.2 não oficial, junho/2026](https://tg.me/samsungcroms/104) | Publicação de build vanilla para “A30”, sem GApps; inclui KernelSU-Next 3.2.0 e substitui o recovery | Sem declaração SM-A305GT, fonte/hashes verificáveis da build, firmware base, recovery GT B8 ou relatório de boot neste modelo. O anúncio reconhece bootloops em testes | NO-GO |

A [árvore Eureka mais recente](https://github.com/eurekadevelopment/android_device_samsung_exynos7885), arquivada em abril/2025, também usa `SM-A305F`, fingerprint e blobs F; seu README declara o projeto encerrado. Um [relato de usuário do SM-A305GT B8](https://github.com/topjohnwu/Magisk/issues/6192) mostra que TWRP e Odin foram usados nessa variante em 2022, mas também relata problemas de `/data`; não identifica um recovery e um procedimento reproduzíveis para o firmware atual, nem comprova qualquer LineageOS no GT.

## C. Preparação sem gravação

- Branch dedicada `experiment/a30-lineageos`; histórico do experimento Linux nativo preservado.
- Fontes de código clonadas para `A:\homelab-a30-lineageos-2026-10-27\research`: wiki oficial e árvores Eureka Android 13 e 15. Backups, firmware e logs privados permanecem em `A:` e fora do Git.
- [Diagnóstico somente leitura](../tools/a30-lineageos/diagnose.ps1) exige caminho do ADB e serial, confere o modelo antes de ler propriedades, carga, RAM, armazenamento, rede e presença dos pacotes essenciais. Não escreve no aparelho.
- **Nenhuma ROM ou recovery foi baixado**: a condição de compatibilidade para selecionar uma build não foi satisfeita. Por isso não há arquivos/hashes de instalação, partições de destino ou sequência de flash aprovada. A ROM 20 possui hash publicado, mas hash só confirma identidade do download, não compatibilidade.
- O recovery stock `Apply update from ADB` não deve ser tratado como instalador de ZIP não oficial; o método de instalação precisa vir do mantenedor e ser validado para GT B8. O flash anterior via LOKE falhou duas vezes com imagens Linux, inclusive após aceitar PIT idêntico, enquanto a restauração stock BL/AP/CP/CSC terminou com código 0. Não há explicação confirmada para esse `FAIL! -1` nas imagens customizadas; não reutilizar aquele método por suposição.

### Para transformar o resultado em GO

Obter do mantenedor de uma build **exata**: declaração de suporte ao SM-A305GT com Android 11/B8, relato verificável de boot e funcionamento de USB/Wi-Fi/carga/armazenamento, firmware/vendor exigidos, recovery compatível, método de instalação e rollback, URL e SHA-256 dos artefatos. Antes de flash, inspecionar o ZIP e o recovery offline, comparar tamanhos e partições com o PIT, registrar o que será apagado e apresentar novo relatório pré-flash. O risco de EFS sem backup permanece explícito.

**RELATÓRIO PRÉ-FLASH — GALAXY A30 SM-A305GT:** recuperação stock **CONFIRMADA**; modelo e B8 **CONFIRMADOS**; ROM e compatibilidade GT B8 **NÃO CONFIRMADAS**; recovery e arquivos de instalação **NÃO SELECIONADOS**; backup lógico **DISPONÍVEL**, EFS **NÃO CONFIRMADA**; rollback stock **COMPROVADO ATÉ BOOT NORMAL**, com limpeza de dados após flash. **Decisão: NO-GO.** Nenhuma autorização de flash está sendo solicitada ou presumida.
