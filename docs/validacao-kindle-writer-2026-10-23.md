# Monitor do Kindle Writer — 23/10/2026

Integração autorizada pelo proprietário durante a geração do primeiro livro. Aplicação e dados continuam no repositório independente `ThHSzR/kindle-writer`, em `~/services/kindle-writer`. Este repositório contém o leitor e o painel de monitoramento.

## O que foi entregue

- Menu **Livros com IA**, em `/#kindle-writer`.
- Livro atual e seleção do histórico; etapa, tentativas, erros, planos, cenas e capítulos salvos.
- Progresso por checkpoints, sem previsão de tempo baseada nesse percentual.
- Worker PM2 pela coleta existente; inferência confirmada pelo PID, executável e prompt do livro, evitando confundir PID reaproveitado.
- RSS atual e pico, contexto, threads, limites de memória, modelo, tokens/s e temperatura da bateria da última chamada.
- Eventos/erros e saída parcial da IA, atualizados enquanto o log estiver aberto; botão para pausar o acompanhamento.
- Download de EPUB completo ou amostra quando o arquivo estiver disponível.
- Indicadores de agendamento e envio automático, ambos desativados na instalação atual.

O leitor aceita apenas arquivos e nomes previstos, rejeita links simbólicos, limita logs e remove padrões de segredos. Não retorna configuração SMTP, destinatários, prompts ou banco. APIs seguem `Cache-Control: no-store` e a proteção de acesso existente do dashboard. Uma consulta pública sem autenticação à nova API retornou HTTP 302 para autenticação.

## Verificações executadas

1. **90 testes Node aprovados no PC**, incluindo 9 testes novos de monitor/API/interface.
2. **90 testes aprovados no próprio A30**, em cópia isolada do código antes de substituir o dashboard. A suíte usou banco/estado temporários e transporte simulado nos testes de controle.
3. Testes da interface por DOM em jsdom: progresso, pausa, falhas, instalação ausente, texto sem execução de HTML, URLs locais de download e invalidação de leituras antigas. Não houve automação visual de navegador ou desktop.
4. Após instalação, HTTP 200 em `/healthz`, `/api/health`, `/api/network`, `/api/kindle-writer/status`, nos dois canais de logs, no HTML e nos novos JS/CSS.
5. APIs devolveram `no-store`; canal arbitrário e pedido de `config.json` foram recusados com HTTP 400; EPUB inexistente respondeu 404.
6. Downloads e recusa de symlinks foram exercitados com arquivos de teste pela API. O primeiro EPUB real ainda estava pendente ao registrar este relatório.

## Implantação e recursos

Backup do código anterior em `~/services/kindle-writer/backups/homelab-before-kindle-monitor-*.tar`; evidências privadas em `~/services/kindle-writer/evidence/`. Código aplicado por Git e reinício apenas de `homelab-status`.

A auditoria antes/depois confirmou somente a mudança esperada do dashboard: PID 15610 → 6696 e reinícios 0 → 1. Kindle Writer, watchdog, Tailscale, Cloudflare, Playit e rotação de logs preservaram PIDs e contadores. Minecraft e Bom Dia continuaram parados. O SHA-256 do dump PM2 compartilhado continuou idêntico; não foi usado `pm2 save`.

Na verificação após implantação, o A30 tinha aproximadamente **1758 MiB de MemAvailable** e bateria a **30,7 °C**. A última chamada de planejamento completou em 258,99 s, com pico de 995,26 MiB e geração de 2,51 tokens/s. O monitor observou a chamada seguinte em CPU, com contexto 2048 e duas threads. Os oito planos estavam persistidos e a primeira cena do capítulo 1 estava em execução.

## Acesso e recuperação

Abra `https://homelab.thsouza.eng.br/#kindle-writer`, autentique-se e selecione **Acompanhar geração** para ver o log. Fechar a página ou pausar o acompanhamento não interfere no worker.

Para consultar pelo terminal:

```sh
curl -fsS http://127.0.0.1:3000/api/kindle-writer/status
tail -n 80 -F ~/services/kindle-writer/logs/writer.log
```

Uma atualização do monitor exige apenas atualizar este repositório e reiniciar `homelab-status`; o motor e seus checkpoints permanecem independentes. O EPUB experimental será disponibilizado para leitura humana quando houver capítulo completo; a revisão automática não garante qualidade narrativa.
