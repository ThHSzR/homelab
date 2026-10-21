# Validação dos instaladores A30 Remoto 1.0.0

Testados em 20/10/2026, com Samsung Galaxy SM-A305GT, Android 11.

- Windows 10 x64: compilação do instalador EXE e cliente .NET Framework; instalação sem administrador; atalhos do menu Iniciar e área de trabalho; registro de desinstalação por usuário; desinstalação completa do aplicativo e atalhos; reinstalação.
- Windows: diagnóstico SSH e identidade do aparelho; sessão real scrcpy por túnel SSH local com porta livre; canal de controle iniciado; H.264 decodificado em 592×1280; encerramento após seis segundos e limpeza do túnel e do transporte ADB próprios.
- Linux x86_64: integridade do instalador .run; instalação no Ubuntu/WSL, inclusive em pasta com espaços; atalho de aplicativo e execução por link em ~/.local/bin; diagnóstico SSH e ADB; sessão real scrcpy por SSH com H.264 decodificado em 590×1280; encerramento e limpeza da sessão.
- A validação Linux utilizou a autorização já existente desta máquina: chave SSH carregada apenas no agente temporário e chave ADB lida do caminho local, sem copiá-las para o instalador. Servidor ADB e agente temporários foram encerrados ao final.
- Os pacotes finais contêm apenas binários oficiais, scripts, documentos e a chave **pública** do servidor SSH. Não contêm chaves privadas, credenciais, adbkey, cookies ou sessões.
- O cadastro interativo por senha SSH e a autorização de uma chave ADB inteiramente nova exigem participação do usuário na máquina e no celular; não foram simulados como se já estivessem autorizados.
- Os binários oficiais scrcpy 5.0.1 de Windows e Linux tiveram os hashes conferidos com o manifesto oficial da release. Os hashes dos instaladores finais estão em SHA256SUMS.txt.

O teste Linux foi feito no Ubuntu/WSL deste computador; não representa teste em todas as distribuições ou arquiteturas. Ambos os pacotes são para x86_64. O instalador Windows não tem assinatura Authenticode.

Não houve reboot, flash, alteração de root, alteração de PM2 ou troca de chaves do A30. O acesso anterior foi preservado.
