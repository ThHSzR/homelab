# Validação do gateway ADB central

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
