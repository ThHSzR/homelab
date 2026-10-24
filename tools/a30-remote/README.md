# A30 Remoto

Acesso à tela do A30 por scrcpy, com gateway ADB no Termux e transporte SSH pela Tailnet. Instalação nativa: PowerShell no Windows e Bash no Linux. Os instaladores e fontes são versionados na `main`.

## Windows: um comando no PowerShell

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm 'https://raw.githubusercontent.com/ThHSzR/homelab/main/tools/a30-remote/install.ps1' | iex"
```

Funciona no Windows PowerShell 5.1 e PowerShell 7. Instala para o usuário, cria os atalhos e abre o menu A30 Remoto. Se scrcpy/ADB faltarem, instala pelo WinGet. Reconhece os pacotes portáteis do WinGet mesmo quando o PATH da sessão ainda não foi atualizado. Salva os caminhos locais no cliente e os redescobre se o pacote for movido.

Requer Windows 10/11 x64, .NET Framework 4.5+, OpenSSH Client e WinGet (Instalador de Aplicativo da Microsoft Store). Se faltar OpenSSH Client, habilite esse recurso opcional do Windows. Conecte o Tailscale à mesma Tailnet do A30.

Feche uma instância anterior do A30 Remoto antes de atualizar. Falhas são mostradas no terminal. A instalação confere a execução do cliente em modo ajuda antes de declarar sucesso; isso não autentica a máquina no A30.

No clone:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\a30-remote\install.ps1
```

Opções: `-Check` verifica dependências sem instalar ou abrir o cliente; `-NoLaunch` instala sem abrir o menu; `-SkipDependencies` impede instalar pacotes; `-Ref <branch-ou-commit>` escolhe a revisão dos fontes raw. Ao fixar um commit na URL, use o mesmo valor em `-Ref`.

## Linux: um comando no Bash

```bash
curl -fL --retry 2 https://raw.githubusercontent.com/ThHSzR/homelab/main/tools/a30-remote/install.sh -o /tmp/a30-install.sh && bash /tmp/a30-install.sh
```

Alternativa com wget:

```bash
wget -O /tmp/a30-install.sh https://raw.githubusercontent.com/ThHSzR/homelab/main/tools/a30-remote/install.sh && bash /tmp/a30-install.sh
```

Execute como usuário normal. Se faltarem dependências, o script usa sudo com apt, dnf ou pacman para instalar ADB, scrcpy, OpenSSH e Python 3. Não usa sudo para instalar o cliente no perfil. Se o repositório da distribuição não oferecer scrcpy compatível (>= 2 e as opções de túnel/teste), o instalador interrompe com a explicação. Não adiciona repositórios externos automaticamente.

O cliente precisa de sessão gráfica para exibir a tela. A instalação cria `~/.local/bin/a30-remote` e uma entrada no menu. Use:

```bash
~/.local/bin/a30-remote configurar-ssh
~/.local/bin/a30-remote conectar
```

No clone:

```bash
bash tools/a30-remote/install.sh
```

Opções: `--check` apenas verifica dependências; `A30_SKIP_DEPENDENCIES=1` impede instalar pacotes; `A30_REF=<branch-ou-commit>` escolhe os fontes raw. O instalador também aceita stdin (`bash -s`).

## Primeiro acesso e atualização

Escolha **Configurar SSH** no menu e informe a senha do Termux diretamente ao SSH. Cada máquina cria sua própria chave; somente a chave pública é cadastrada no A30. Se o login por senha estiver desabilitado, um administrador precisa cadastrar a chave pública apresentada em `~/.ssh/authorized_keys` no Termux. A instalação não substitui essa autorização.

Depois, escolha **Conectar tela**. O gateway existente permite esse cadastro sem USB ou outra confirmação ADB na tela do A30. Tailscale e autenticação SSH continuam necessários.

Execute novamente o mesmo instalador para atualizar. Chaves e logs são preservados; destinos de outra origem são recusados. No Windows, o cliente fica em `%LOCALAPPDATA%\Programs\A30Remoto`, com desinstalação em Aplicativos instalados. No Linux, fica em `~/.local/share/a30-remote`.

## Gateway: provisionamento único ou recuperação

O gateway já instalado não precisa ser reinstalado para cada cliente. Para provisionar, use o clone em uma máquina com ADB e SSH já autorizados:

```bash
bash tools/a30-remote/provision-gateway.sh
```

Usa `adb` do PATH, dispositivo `10.150.235.246:5555` e configuração SSH `~/.local/state/a30-remote/ssh_config`. Sobrescreva com `A30_LOCAL_ADB`, `A30_LOCAL_SERIAL` e `A30_SSH_CONFIG` quando necessário. A chave ADB segue por stdin do SSH, sem impressão ou inclusão no repositório.

O ADB central fica em um socket Unix privado do Termux. Os clientes abrem túneis SSH para ADB e vídeo, sem publicar o protocolo ADB na LAN/Tailnet. Para revogar uma máquina, remova somente sua chave pública de `authorized_keys`. Se o Android revogar a identidade ADB ou não oferecer transporte após reiniciar, será necessário acesso local para recuperar o gateway.

## Testes e arquitetura

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\a30-remote\test-windows.ps1
```

```bash
bash tools/a30-remote/test-install.sh
shellcheck tools/a30-remote/a30-remote tools/a30-remote/a30-adb-gateway tools/a30-remote/*.sh
pwsh -File tools/a30-remote/test-remote.ps1
```

Os testes usam dependências simuladas e diretórios temporários; o teste Windows compila o instalador sem instalá-lo no perfil real. O workflow executa os testes em Windows e Linux. O fluxo não baixa pacotes do HomeLab: o Windows compila os pequenos componentes locais, e o Linux instala os fontes. Dependências vêm dos gerenciadores de pacotes.

[Instruções](LEIA-ME.txt) · [Arquitetura e segurança](ARQUITETURA.md) · [Validação e limites dos testes](VALIDACAO.md)
