# Arquitetura e segurança

## Por que existe um gateway central

Na versão anterior, cada computador encaminhava `adbd:5555` para um servidor
ADB local. Como a autenticação pertence ao servidor ADB, uma máquina nova
precisava aprovar sua própria chave na tela do Android. Isso impedia o acesso
realmente remoto.

Agora o servidor ADB roda no Termux em um socket Unix privado, usando uma
identidade provisionada e autorizada uma única vez. Os clientes encaminham uma
porta TCP local para esse socket somente por um túnel SSH autenticado.

```text
scrcpy/adb no computador
  | SSH pela Tailnet
  +-- porta local -> socket Unix privado do ADB no Termux
  +-- porta local -> fluxo temporário do scrcpy
                              |
                     Galaxy A30 (adbd)
```

## Conexões por sessão

O cliente escolhe três portas efêmeras:

- uma porta local para acessar o socket Unix do ADB no Termux;
- uma porta no Termux usada pelo `adb forward` do scrcpy;
- uma porta local encaminhada à porta de vídeo no Termux.

O scrcpy recebe `ADB_SERVER_SOCKET` apontando para a primeira porta, `--port`
com a porta remota e `--tunnel-port` com a porta local. Assim, vídeo e controle
funcionam sem publicar o protocolo do servidor ADB na Tailnet ou na LAN.

## Limites de confiança

- O servidor ADB usa socket Unix com acesso restrito ao usuário do Termux.
- Todo acesso externo passa por SSH com verificação estrita da chave do host.
- Cada cliente possui uma chave SSH individual e revogável.
- A identidade ADB do gateway nunca entra nos builds, logs ou Git.
- Revogar um cliente consiste em remover sua linha de `authorized_keys`.

O Android continua sendo a autoridade final. Se a depuração ADB for desligada,
ou se todas as autorizações forem revogadas, será necessária recuperação
presencial para provisionar o gateway novamente.
