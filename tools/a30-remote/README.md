# A30 Remoto

Instaladores por usuário para acessar a tela do Galaxy A30 pelo SSH na tailnet. Incluem ADB e scrcpy 5.0.1. Não exigem root, não reiniciam o telefone e não alteram serviços PM2.

[Baixar a versão 1.0.0](https://github.com/ThHSzR/homelab/releases/tag/a30-remote-v1.0.0) · [Instruções completas](LEIA-ME.txt) · [Validação](VALIDACAO.md)

## Windows 10/11 x64

No PowerShell, baixe e abra o instalador:

```powershell
Invoke-WebRequest 'https://github.com/ThHSzR/homelab/releases/download/a30-remote-v1.0.0/Instalar-A30-Windows-x64.exe' -OutFile "$env:TEMP\Instalar-A30.exe"
Start-Process "$env:TEMP\Instalar-A30.exe" -Wait
```

Abra **A30 Remoto** pelo atalho no menu Iniciar ou na área de trabalho. Para desinstalar, use **Aplicativos instalados** ou o atalho de desinstalação. Requer OpenSSH Client e .NET Framework 4.5 ou superior; o instalador não tem assinatura Authenticode.

## Linux x86_64

No terminal, sem `sudo`:

```bash
curl -fL 'https://github.com/ThHSzR/homelab/releases/download/a30-remote-v1.0.0/Instalar-A30-Linux-x86_64.run' -o Instalar-A30-Linux-x86_64.run
bash Instalar-A30-Linux-x86_64.run
```

Abra **A30 Remoto** no menu de aplicativos ou execute `~/.local/bin/a30-remote`. Requer Bash, OpenSSH Client, Python 3, glibc, libudev, libcap e sessão gráfica. O instalador verifica o SHA256 do payload antes de extraí-lo. Testado no Ubuntu/WSL; não suporta ARM.

## Primeiro uso em cada computador

1. Conecte o computador à mesma tailnet do A30, com acesso a `100.65.49.34:8022`.
2. No aplicativo, escolha **Configurar SSH**. Uma chave local já autorizada será reutilizada. Caso contrário, o assistente cria uma chave nesta máquina e pede a senha SSH do Termux para cadastrar a chave pública. Se o login por senha estiver desativado, use uma sessão já autorizada para cadastrar a chave pública mostrada pelo assistente.
3. Escolha **Conectar tela**. Aceite a autorização ADB no A30 quando solicitada. Nenhuma senha, chave privada ou sessão está incluída nos pacotes.

O ADB TCP precisa estar ativo no telefone. Após reboot ou desativação, conecte USB a uma máquina autorizada e escolha **Ativar ADB TCP por USB e conectar**, ou execute `adb -s RQ8M70A9WBP tcpip 5555`.

Fechar o scrcpy encerra o túnel desta sessão e mantém o ADB TCP ativo para reconectar. **Desativar ADB TCP** fecha a porta do Android e exige reativação por USB. O Android atual escuta em todas as interfaces na porta 5555 enquanto o modo TCP está ativo: use somente redes confiáveis e desligue o modo TCP quando necessário. O túnel SSH protege o caminho utilizado; não altera o firewall do celular.

A identidade do servidor SSH é fixada pela chave pública em `known_hosts`. Confira o telefone antes de atualizar essa chave. Ela não é uma credencial de acesso.

## Conferir os arquivos

O arquivo `SHA256SUMS.txt` na Release contém os hashes dos instaladores e documentos. Os binários de terceiros foram conferidos contra os hashes publicados no [projeto oficial scrcpy](https://github.com/Genymobile/scrcpy/releases/tag/v5.0.1), e suas licenças acompanham os pacotes.

## Compilar

Em Windows x64 com PowerShell 5.1+, compilador .NET Framework e `tar`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\a30-remote\build.ps1
```

O script baixa as duas distribuições oficiais de scrcpy, confere hashes fixados, compila o cliente e o instalador Windows e gera o instalador Linux. Os resultados ficam em `tools/a30-remote/dist/`. Cache e resultados de compilação são ignorados pelo Git. Não são necessários arquivos de `C:\Tools` nem credenciais para compilar.
