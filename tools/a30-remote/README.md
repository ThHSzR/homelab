# A30 Remoto

Tela do Galaxy A30 por scrcpy e SSH na Tailnet, com gateway ADB central no Termux. Os scripts de instalação ficam neste diretório e acompanham a `main`. Não é necessário gerar ou baixar um pacote do HomeLab.

[Instruções](LEIA-ME.txt) · [Arquitetura e segurança](ARQUITETURA.md) · [Validação](VALIDACAO.md)

## Dependências

Linux: Bash, OpenSSH Client, Python 3, ADB e **scrcpy >= 2**, com sessão gráfica para abrir a tela. Instale pelo gerenciador da distribuição. Em Ubuntu/Debian que ofereça scrcpy >= 2:

```bash
sudo apt update
sudo apt install adb scrcpy openssh-client python3 curl
scrcpy --version
```

Se o repositório da distribuição oferecer scrcpy 1.x, atualize pelo gerenciador de pacotes antes de instalar. O instalador interrompe sem alterar a instalação quando falta uma dependência.

Windows 10/11 x64: Git Bash, OpenSSH Client, .NET Framework 4.5+ e scrcpy >= 2/ADB no PATH. Para instalar scrcpy pelo WinGet, no PowerShell:

```powershell
winget install --exact --id Genymobile.scrcpy
```

Reabra o Git Bash e confira `adb.exe version` e `scrcpy.exe --version`. Conecte a máquina à mesma Tailnet do A30.

## Instalar diretamente por Bash

Por clone, no Linux ou Git Bash do Windows:

```bash
git clone --branch main https://github.com/ThHSzR/homelab.git
cd homelab
bash tools/a30-remote/install.sh --check
bash tools/a30-remote/install.sh
```

Ou baixe o instalador raw e execute apenas se o download concluir:

```bash
curl -fL --retry 2 https://raw.githubusercontent.com/ThHSzR/homelab/main/tools/a30-remote/install.sh -o /tmp/a30-install.sh && bash /tmp/a30-install.sh
```

Com wget:

```bash
wget -O /tmp/a30-install.sh https://raw.githubusercontent.com/ThHSzR/homelab/main/tools/a30-remote/install.sh && bash /tmp/a30-install.sh
```

O script baixado busca somente os fontes deste diretório via raw. `--check` valida dependências sem instalar ou conectar. Também aceita stdin (`bash -s`); baixar primeiro permite conferir o conteúdo antes de executar. Para fixar uma revisão, substitua `main` na URL por um commit e execute com `A30_REF=<mesmo-commit> bash /tmp/a30-install.sh`.

No Linux, execute sem sudo. O cliente vai para `~/.local/share/a30-remote`, com comando em `~/.local/bin/a30-remote` e entrada no menu. Reexecute para atualizar: chaves SSH e logs são preservados. Destinos sem marcador e comandos de outra origem são recusados. Adicione `~/.local/bin` ao PATH ou use:

```bash
~/.local/bin/a30-remote configurar-ssh
~/.local/bin/a30-remote conectar
```

No Windows, o Bash compila os pequenos clientes C# localmente e instala por usuário, com atalhos no menu Iniciar/Desktop e desinstalação em Aplicativos instalados. Usa scrcpy/ADB do sistema, incluindo o servidor scrcpy da mesma distribuição instalada. Feche A30 Remoto antes de atualizar.

## Provisionamento único do gateway

O gateway já provisionado no A30 não precisa ser reinstalado para cada cliente. Para provisionar ou recuperar, use o clone em uma máquina com ADB e SSH já autorizados:

```bash
bash tools/a30-remote/provision-gateway.sh
```

Usa `adb` do PATH, dispositivo `10.150.235.246:5555` e configuração SSH `~/.local/state/a30-remote/ssh_config`. Sobrescreva com `A30_LOCAL_ADB`, `A30_LOCAL_SERIAL` e `A30_SSH_CONFIG` quando necessário. A chave ADB segue por stdin do SSH e nunca é impressa ou incluída no repositório.

O servidor ADB fica no socket Unix privado do Termux. O cliente abre túneis SSH para esse socket e para o vídeo, sem publicar o protocolo ADB na LAN/Tailnet. Cada máquina tem chave SSH própria. Se o login por senha estiver desabilitado, um administrador deve cadastrar a chave pública apresentada no `~/.ssh/authorized_keys` do Termux. Para revogar, remova somente essa chave.

Se o Android revogar o ADB ou deixar de oferecer transporte após reiniciar, será necessário acesso local para recuperar o gateway.

## Verificar e compilar opcionalmente

```bash
bash tools/a30-remote/test-install.sh
shellcheck tools/a30-remote/install.sh tools/a30-remote/test-install.sh
```

Os testes isolam HOME, simulam dependências e não acessam o A30. `VALIDACAO.md` distingue esses testes da validação real do gateway. Para gerar apenas o instalador Windows local, com dependências no PATH:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\a30-remote\build.ps1
```

O resultado fica em `tools/a30-remote/dist/`, ignorado pelo Git. O fluxo normal é `bash tools/a30-remote/install.sh`; não há etapa de publicação.
