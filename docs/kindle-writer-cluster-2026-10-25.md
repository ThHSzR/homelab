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
