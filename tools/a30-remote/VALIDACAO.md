# Validação do gateway ADB central

## Cadastro SSH e vídeo Windows corrigidos — 21/10/2026

- Reproduzido com credencial fornecida diretamente pelo usuário: o SSH aceitava
  a senha, mas o PowerShell removia aspas do comando remoto de cadastro,
  fazendo o grep interpretar partes da chave como arquivos. A mesma falha
  removia as aspas do endereço na reserva de porta por Python.
- Os scripts remotos completos agora seguem codificados em base64, preservando
  as aspas durante o transporte pelos argumentos nativos do Windows. A senha
  não faz parte desses scripts: foi informada somente ao prompt do SSH.
- Cadastro real concluído; nova autenticação por chave passou sem senha. Foi
  confirmada exatamente uma ocorrência da chave pública no authorized_keys.
- Diagnóstico confirmou SM-A305GT, Android 11, serial esperado e socket Unix
  privado do gateway. O teste real scrcpy 4.1 abriu vídeo em 590x1280, confirmou
  Texture, encerrou após seis segundos e limpou o túnel.
- Regressões: teste Windows confere que o executável nativo recebe os comandos
  completos; teste Linux executa os comandos gerados, confere cadastro
  idempotente de chave com comentário contendo espaços, modo 600 e reserva de
  porta loopback. A limpeza ADB não interrompe o fechamento do túnel quando um
  encaminhamento já não existe.

## Correção Windows nativo — 21/10/2026

- Reproduzido na máquina Windows: o cliente instalado falhava em
  `Get-Command adb.exe`, embora scrcpy 4.1 e ADB já estivessem instalados no
  diretório de pacotes do WinGet. O PATH da sessão não continha esses binários.
- `install.ps1` foi executado no Windows PowerShell 5.1 e reinstalou o cliente
  no perfil real. O cliente instalado passou pelo modo ajuda, com a chave SSH
  existente preservada. O instalador agora localiza pacotes WinGet e salva os
  caminhos das ferramentas para o cliente.
- Um launcher antigo aberto impediu a primeira atualização. Confirmado que
  não havia sessão scrcpy ativa, a instância ociosa foi fechada e a atualização
  passou. O instalador agora mostra esse bloqueio antes de compilar.
- `test-windows.ps1` cobre análise sintática, resolução sem PATH, versão
  incompatível, criação idempotente de chave SSH no PS 5.1 com caminho contendo
  espaços, recusa SSH sem erro terminante de stderr, modo Check e compilação
  com payload incorporado. Não instala o fixture no perfil real.
- O diagnóstico local executou scrcpy/ADB e chegou ao SSH do A30, mas a
  autenticação desta máquina foi recusada. Não foi confirmada nova sessão de
  vídeo. O primeiro acesso exige Configurar SSH e credencial autorizada.
- O Bash Linux agora instala dependências por apt/dnf/pacman quando faltam;
  seus testes continuam isolados e não instalam pacotes reais.

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
