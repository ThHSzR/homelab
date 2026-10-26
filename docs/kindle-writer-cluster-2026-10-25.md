# Integração Kindle Writer no cluster — 25/10/2026

O Kindle Writer permanece em repositório próprio. O cluster recebeu somente `tasks.kindle_check`, que executa o módulo de conferência daquele repositório pelo Python nativo do Termux. O A10s ARM32 participa com verificações determinísticas de prosa e EPUB; o A30 mantém inferência e estado dos livros. RQ/Redis não agregam RAM.

Foram concluídas três tarefas reais no A10s: prosa válida aceita, vítima morta agindo rejeitada e validação estrutural de uma amostra EPUB anterior com capa. A integração não envia e-mails ou WhatsApp nem altera o banco dos livros. Resultados são vinculados ao nó, ao conteúdo e à versão da implementação. O fluxo não aceita aprovação local silenciosa quando a fila está indisponível.

Somente os dois workers RQ foram reiniciados para carregar o adaptador. Redis e o túnel existentes não foram reiniciados nessa implantação. O A10s recebeu Git e Pillow nativos, sem substituir o venv RQ. Os arquivos anteriores do adaptador ficaram em `~/services/homelab-cluster/state/kindle-before-20261025/` nos dois aparelhos.

O coletor do painel detecta o gateway ADB já provisionado no A30 e usa `a30-adb-gateway battery`, lendo `dumpsys battery`. A conversão valida temperatura em décimos de grau, nível/escala, saúde e recusa leituras simuladas. Sem telemetria válida pelo gateway provisionado, informa indisponibilidade, sem recriar o Termux:API. Em aparelhos sem esse gateway, o backend anterior continua disponível.

Essa correção foi necessária porque o coletor chamava o Termux:API a cada 15 s durante a inferência. O painel foi atualizado por fast-forward e reiniciado intencionalmente uma vez. Cinco testes do coletor passaram no A30 e `/healthz` voltou a responder antes do probe seguinte. Os arquivos anteriores do checkout foram arquivados em `~/services/kindle-writer/backups/homelab-before-cluster-telemetry-20261025.tar`.

**Falha posterior ainda pendente de recuperação:** uma tentativa prolongada do Qwen3-4B IQ3_XXS recolheu o processo principal do Termux por pressão de memória às 12h59min54s. O supervisor de 50 ms não interrompeu a carga antes de o Android encerrar o ambiente. Os serviços do A30, inclusive Redis e o painel, desapareceram. O A10s permanece ativo, mas suas filas dependem do coordenador. ADB USB segue autorizado, sem root; foi solicitado ao proprietário executar o script de recuperação existente no Termux. A geração de livros não foi retomada e os testes de 4B foram suspensos.

O escritor recebeu uma reação direta no leitor de logs, ao primeiro reclaim, com teste de que somente o processo de inferência associado recebe o sinal. Isso não garante isolamento contra o Android. O candidato menor Qwen3.5-2B Q4_K_M ainda precisa concluir download e testes antes da promoção. A auditoria final dos serviços depende da recuperação do A30.

Validação final de código desta etapa: 80 testes Python no A10s (21,510 s) e 93 testes Node no PC. Nenhuma inferência no desktop e nenhum envio real de mensagem nesta rodada. O relatório completo e as pendências ficam no `VALIDACAO.md` do Kindle Writer. Os dois repositórios receberam pushes normais, preservando as alterações do outro trabalho do cluster.

## Recuperação confirmada

O proprietário executou o script existente e o A30 voltou a responder por SSH por volta das 13h30 de 25/10. O boot próprio restaurou Redis e o worker; o A10s foi reconectado e voltou a concluir uma conferência real. SQLite íntegro, endpoints de saúde e rede HTTP 200. As auditorias privadas `cluster-recovered.json` e `cluster-ready.json`, no Kindle Writer, registram os processos após a recuperação. A pendência de recuperação descrita acima foi resolvida, preservando o dump compartilhado.

Os testes de 4B continuam suspensos. Qwen3.5-2B Q4_K_M e SmolLM3-3B Q3_K_M foram conferidos e testados somente no A30. Responderam ao teste JSON, mas ainda precisam passar a conferência de prosa e planejamento com a amostragem corrigida. Um teste SmolLM3 foi interrompido por uma rajada de recolhimentos de cache, preservando todos os serviços; nenhum candidato foi promovido nessa etapa. O livro continua pausado até uma admissão válida. A validação atual do escritor passou em **89 testes Python no A10s**, em 21,807 s. Não houve reinício adicional do painel, envio real de mensagem ou inferência no PC.
# Verificação posterior do cluster

O escritor chegou a **106 testes Python aprovados no A10s**, em 21,305 s. Duas tarefas adicionais de conferência real no nó `a10s` aceitaram a prosa válida e rejeitaram a vítima morta agindo. A inferência permanece exclusiva do A30; o A10s recebe conferências determinísticas e validação de EPUB.

A telemetria de Wi-Fi também usava Termux:API. Em `577cb3d`, o gateway passou a consultar `cmd wifi status` e o endereço de `wlan0`. Foram aprovados 96 testes Node no PC e 12 testes de telemetria no A30. O painel foi reiniciado intencionalmente: PID 13283 → 31083, contador 0 → 1. Os demais serviços mantiveram seus processos. Bateria e Wi-Fi passaram a informar as fontes ADB esperadas.

A auditoria privada `cluster-pre-admission.json` confirmou serviços e arquivos protegidos iguais a `cluster-wifi-after-restart.json`, com HTTP 200 em `/healthz`, `/api/health` e `/api/network`. O dump PM2 compartilhado permanece preservado. Os probes de admissão do SmolLM3-3B Q3_K_M continuam; esta entrada não afirma que a geração foi retomada. SMTP automático e agendamento de novos livros continuam desativados.

## Geração retomada às 21h07 de 25/10

O A30 retomou o livro experimental `20261024-7c84a9ce` com SmolLM3-3B Q3_K_M, após smoke, planejamento e cena estruturada completos. A prosa de teste preservou os fatos impostos pelo contrato, mas apresentou clichês e linguagem artificial; não foi declarada qualidade editorial profissional. O perfil admite contexto até 3072 e usa 2048 quando suficiente, cache Q8, dois threads e micro-lote 16. Não há teto de RSS; o monitor de pressão do Android continua ativo. Modelos 4B permanecem suspensos.

Worker Kindle Writer PID 29926, sem reinícios, status `escrevendo`, primeira cena em processamento com o runtime PID 30208. O A10s executou as conferências reais de aceitação/rejeição com o código atual; **107 testes Python passaram** em 21,743 s. O backup e o arquivo do rascunho rejeitado foram concluídos antes da retomada.

A auditoria final confirmou SQLite íntegro, serviços e arquivos protegidos preservados, dump PM2 intacto e os três endpoints de saúde/rede HTTP 200. O único reinício do painel nesta etapa continua sendo o já documentado 13283 → 31083. Nenhuma inferência no desktop, mensagem de teste ou agendamento Codex criado. SMTP automático e novos livros agendados continuam desligados. Ainda não há novo capítulo ou EPUB; o andamento está no monitor existente.

## Consulta posterior: livro falhou na primeira cena

Após a retomada, o livro experimental `20261024-7c84a9ce` falhou em `chapter-01-scene-1` após três rejeições por referências a tempo nos campos livres. Nenhuma cena nova foi persistida; não há primeiro capítulo ou EPUB novo. O worker 29926 permanece online sem reinícios, mas não reprocessa automaticamente esse livro no estado `falhou`.

A análise identificou filtro excessivo para expressões relativas e também problemas reais nos rascunhos, como durações inventadas e confusão entre posto e pedágio. Os rascunhos foram preservados, sem publicação. O diagnóstico detalhado está no `VALIDACAO.md` do repositório independente Kindle Writer.

A auditoria desta consulta encontrou os endpoints de saúde/rede HTTP 200 e preservou a atualização LAN `776ff3f`, já instalada por outro trabalho. Painel PID 21756, contador 2; demais serviços protegidos com os PIDs anteriores. Nenhum serviço foi reiniciado nesta consulta. SMTP automático e novos livros agendados continuam desligados.

