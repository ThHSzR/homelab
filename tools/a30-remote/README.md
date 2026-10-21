# A30 Remoto

Cliente para acessar a tela do Galaxy A30 pelo SSH na Tailnet, usando scrcpy e
um gateway ADB central no Termux. Depois do provisionamento único, cada novo
computador precisa somente de acesso à Tailnet e de uma chave SSH autorizada:
não é necessário estar com o telefone em mãos, usar USB ou aceitar outra
solicitação ADB no Android.

> A Release `a30-remote-v1.0.0` usa o fluxo antigo, que autorizava o ADB em cada
> computador. A correção do gateway central está na `main`; gere novos
> instaladores a partir dela até a publicação da próxima Release.

[Instruções completas](LEIA-ME.txt) · [Arquitetura e segurança](ARQUITETURA.md) · [Validação](VALIDACAO.md)

## Arquitetura

```text
scrcpy/adb no computador
  | SSH criptografado pela Tailnet
  +-- porta ADB local -> socket Unix privado no Termux
  +-- porta de vídeo local -> Termux -> socket scrcpy no Android
                                      |
                             Galaxy A30 (adbd)
```

A identidade ADB autorizada e o servidor ADB ficam somente no Termux. Cada
computador tem uma chave SSH própria e revogável. O protocolo do servidor ADB
não é publicado em uma porta TCP da LAN ou da Tailnet.

## Provisionamento único do gateway

Execute uma vez, em um computador que já tenha ADB autorizado no A30 e SSH
autorizado no Termux:

```bash
chmod +x tools/a30-remote/a30-adb-gateway tools/a30-remote/provision-gateway.sh
tools/a30-remote/provision-gateway.sh
```

Por padrão, o script usa:

- ADB em `~/.local/share/a30-remote/bin/adb`;
- dispositivo em `10.150.235.246:5555`;
- SSH configurado em `~/.local/state/a30-remote/ssh_config`.

Os caminhos podem ser alterados com `A30_LOCAL_ADB`, `A30_LOCAL_SERIAL` e
`A30_SSH_CONFIG`. A chave ADB é enviada diretamente ao Termux pelo stdin do
SSH; ela não é impressa nem gravada no repositório.

## Nova máquina

1. Conecte a máquina à mesma Tailnet do A30.
2. Instale o pacote A30 Remoto.
3. Execute `a30-remote configurar-ssh` e informe a senha SSH do Termux.
4. Execute `a30-remote conectar`.

Se a autenticação SSH por senha estiver desabilitada, uma sessão administrativa
já autorizada precisa adicionar a chave pública apresentada pelo cliente ao
`~/.ssh/authorized_keys` do Termux. Isso não requer acesso físico ao telefone.

## Windows 10/11 x64

Abra **A30 Remoto** pelo atalho do instalador. Requer OpenSSH Client e .NET
Framework 4.5 ou superior; o instalador não tem assinatura Authenticode.

## Linux x86_64

Instale sem `sudo`:

```bash
bash Instalar-A30-Linux-x86_64.run
```

Depois abra **A30 Remoto** no menu ou execute `~/.local/bin/a30-remote`.
Requer Bash, OpenSSH Client, Python 3, glibc, libudev, libcap e sessão gráfica.

## Compilar

Em Windows x64 com PowerShell 5.1+, compilador .NET Framework e `tar`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\a30-remote\build.ps1
```

O script baixa as distribuições oficiais do scrcpy 5.0.1, confere hashes
fixados, compila o cliente e o instalador Windows e gera o instalador Linux.
Os resultados ficam em `tools/a30-remote/dist/` e são ignorados pelo Git.

## Recuperação e revogação

Para revogar um computador, remova somente sua chave pública do
`~/.ssh/authorized_keys` no Termux. Se a depuração ADB for desligada, a
autorização Android for revogada ou o telefone deixar de oferecer um transporte
ADB após reiniciar, será necessário provisionar novamente com acesso local.
