# Continuação da validação — 25/10/2026

O segundo reboot do A10s, contador 5 para 6, restaurou automaticamente SSH, Tailscale Android, Tailscale userspace, túnel e worker. Os três processos PM2 retornaram sem reinícios internos. SSH autenticado pelo Serve userspace passou, e a tarefa de inspeção de serviços concluiu (`9de9e38e-6742-4a40-9aa1-e88866c6915b`). O aparelho permaneceu nessa sessão de boot por mais de 12 horas até a continuação da auditoria.

## Retirada de tarefas durante queda de conexão

Uma tarefa enviada logo após o reboot ficou com estado queued, mas sem ID na fila e sem início de execução registrado. A inspeção do RQ 2.12.0 mostrou que o consumo de várias filas usa BLPOP, enquanto uma fila usa LMOVE com reserva intermediária. O comportamento observado é compatível com entrega ao consumidor antigo antes de o túnel detectar a desconexão; não foi feita captura de pacotes para provar esse instante.

Foi implantado `ReservedQueue`, que consulta cada fila usando o caminho LMOVE do RQ, e `ReservedWorker`, que confirma a reserva na transação de preparação da execução. A manutenção existente do RQ torna reservas abandonadas visíveis como falhas. A prioridade das filas e a execução de um job por worker foram preservadas. O status agora expõe também a contagem reserved.

Testes em filas descartáveis nos dois aparelhos confirmaram reserva preservada após reconectar, marcação de reserva abandonada como falha, reenfileiramento explícito e execução nas duas filas, além da remoção da reserva na preparação da execução. O teste envelhece apenas o timestamp da própria reserva descartável para exercitar a manutenção sem esperar o prazo real. Não há repetição automática de tarefas com efeitos externos.

A tarefa órfã era somente um SHA-256 de teste. Após conferir a função e a ausência de início de execução, foi reenfileirada e concluiu (`8ce19d0b-83f1-499a-97a1-2867d266b3bc`). Novos hashes também concluíram no A10s (`1dc40c23-3f52-44ea-9ff9-405f8e9327f0`) e no A30 (`70c943e5-427d-4430-8b0f-f573bd55ce99`), com filas vazias e sem reservas ou falhas pendentes.

## Teste final planejado

`quiesce.py` encerrou o worker do A10s antes de fechar seu túnel. A tarefa `f43ec991-12d3-470c-98b8-19b10a8ce96f` foi enfileirada com o worker parado; o Redis confirmou waiting=1, reserved=0, started=0.

O terceiro reboot passou: contador 6 para 7 e novo identificador de boot. SSH, VPN Android, Tailscale userspace, túnel e worker retornaram pela rotina de boot. Nenhum comando remoto de partida foi executado após esse reboot. A tarefa pendente concluiu automaticamente no A10s, retornando SHA-256 `a2f882b57cf045388dd15d909fedb0fd967194b3c87f2fcb0b94ce3a4fc5bff6`. O SSH autenticado pelo Serve userspace também passou.

Na conferência final, os três processos do A10s estavam online com restart_time=0. Os dois workers estavam presentes e idle. Todas as filas estavam com waiting=0, reserved=0, started=0 e failed=0. A comparação dos PIDs e estados confirmou que os serviços anteriores do A30 permaneceram iguais ao início da auditoria; somente o worker deste cluster foi reiniciado para carregar as correções.

A partida do Termux depende da entrega do broadcast do Android e levou alguns minutos no aparelho testado. Esta validação cobre a configuração atual e reboot planejado; não estabelece execução exatamente uma vez nem testa troca de Wi-Fi ou perda abrupta de energia. Reservas abandonadas exigem conferir a falha antes de reenfileirar uma tarefa com possíveis efeitos externos.

O A30 não foi reiniciado. Somente o worker do cluster recebeu as atualizações; root do A10s continua pendente e nenhuma imagem de firmware foi gravada nesta etapa.
