# Validação do gateway ADB central

## Instalação direta por Bash — 21/10/2026

- `install.sh` instala a partir do clone ou dos fontes raw da `main`; não baixa
  assets nem depende de publicação de pacotes.
- Todos os scripts Bash deste diretório passaram por `bash -n` e ShellCheck
  0.11.0 sem apontamentos.
- `test-install.sh` passou em Ubuntu/WSL, com HOME temporário contendo espaços
  e dependências simuladas. Cobre instalação, reinstalação, permissões,
  preservação de chaves/logs, execução do cliente instalado em modo ajuda,
  fonte raw/ stdin, versão incompatível, falha de download, argumento inválido,
  branch inválida, destino de outra origem e links conflitantes.
- Cliente e instalador Windows foram compilados com .NET Framework tanto no
  PowerShell 7 quanto no Windows PowerShell 5.1. A descoberta de scrcpy/ADB foi
  simulada; nenhum instalador foi executado no perfil real do usuário.
- Os 81 testes Node do HomeLab passaram.
- Não foi feita nova sessão scrcpy no A30 nesta alteração. A validação real
  abaixo pertence ao gateway anterior; a execução com scrcpy/ADB fornecidos
  pelo gerenciador de pacotes ainda deve ser conferida na máquina cliente.

## Validação anterior do gateway

Validado em 21/10/2026 com Samsung Galaxy SM-A305GT, Android 11.

- O gateway foi provisionado no Termux com a identidade ADB já autorizada,
  transferida diretamente por SSH e sem inclusão no repositório ou nos pacotes.
- O servidor ADB do gateway usa o socket Unix privado
  `~/.local/share/a30-remote-gateway/adb.sock`.
- As antigas portas TCP 5037 e 5038 foram verificadas como fechadas na LAN e
  na Tailnet após a migração.
- O cliente Linux foi executado com as chaves ADB locais indisponíveis. A sessão
  real do scrcpy abriu pelo gateway, recebeu H.264, decodificou textura em
  590×1280 e encerrou limpando os encaminhamentos.
- O cliente confirmou modelo `SM-A305GT`, serial `RQ8M70A9WBP` e Android 11
  antes de abrir a tela.
- O pacote Linux foi reconstruído e teve a integridade SHA256 verificada.
- O pacote Windows foi reconstruído e inspecionado; o novo fluxo PowerShell
  ainda precisa de um teste de execução em uma máquina Windows.
- Scripts Bash passaram por análise sintática e o repositório foi verificado
  contra inclusão acidental de chaves privadas.

O acesso de uma nova máquina exige autenticação SSH no Termux e participação de
um administrador para cadastrar sua chave pública, caso login por senha esteja
desabilitado. Ele não exige USB, pareamento ADB ou confirmação na tela do A30.

Se o Android revogar a identidade ADB do gateway ou deixar de oferecer um
transporte ADB, a recuperação volta a exigir acesso local. Nenhuma promessa de
acesso após toda forma de reboot ou revogação é feita.
