# Correção dos testes e validação no Galaxy A30

Auditoria em 18/10/2026, horário de São Paulo. Base: `main` em
`389f78fa966e2a8cc970c8b22f42f53492e8a36b`. Correção: `8258fda`.

## Falhas reproduzidas e causas

Antes das alterações, `npm ci` concluiu sem vulnerabilidades reportadas pelo npm.
Dos 69 testes, 68 passaram no Windows e 67 no A30.

- `test/health-api.test.js`: ainda exigia HTTP 403 e erro de JWT nas rotas de rede
  e logs, embora a autenticação do Express já tivesse sido removida. A rota de
  rede retornava corretamente HTTP 503 enquanto aguardava sua primeira leitura.
  O teste agora verifica 503 sem leitura, 200 com o conteúdo exato da amostra,
  indicação de leitura antiga e 400 para identificador de log inválido. As APIs
  voltaram a receber `Cache-Control: no-store` no middleware comum, inclusive nos erros.
- `test/minecraft-cpu.test.js`: o cenário de procfs fictício ainda consultava o
  PM2 real. No A30, o fallback encontrava o Minecraft em execução e fornecia CPU,
  contrariando a indisponibilidade simulada. No Windows não havia esse registro.
  Os testes de procfs agora injetam explicitamente um PM2 indisponível; os testes
  específicos do fallback continuam exigindo PID, nome e script válidos.

O servidor iniciado pelo teste de integração também passou a usar HOME, PREFIX,
PM2_HOME e diretório de estado temporários, com os controles opcionais desabilitados.
Assim, sua rotina de reconciliação não alcança a intenção persistida dos serviços reais.
As verificações de EACCES, processo ambíguo, PID divergente, comandos permitidos,
salvamento por RCON e concorrência foram preservadas.

## Correções adicionais de telemetria

Cinco regressões novas cobrem os casos encontrados na auditoria:

- Ausência de métricas PM2 permanece `null`; zero só representa uma leitura real.
- Resposta térmica vazia não vira 0 °C; erro ou ausência de identificação Wi-Fi
  não aparece como conexão confirmada.
- EACCES ao listar `/proc` ou zonas térmicas não descarta RAM e outras fontes
  acessíveis. Contagem de processos indisponível permanece `null`.
- Após uma coleta de CPU/rede sem contadores, a próxima leitura estabelece uma
  nova base. Não há taxa calculada com contador antigo e intervalo incorreto.
- A UI preserva PM2 e bateria quando a fonte `system` falha, limpa dados que
  deixaram de existir e distingue CPU bloqueada da primeira amostra válida.

## Verificações executadas

| Ambiente | Procedimento | Resultado |
|---|---|---|
| Windows, Node v20.20.2 | `npm ci` e suíte completa `npm test` | 74 passaram, zero falhas |
| A30, Termux, Node v26.4.0, UID 10267 | Cópia isolada do repositório com a correção; `npm ci && npm test` | 74 passaram, zero falhas |
| A30, `~/services/homelab`, commit `8258fda` | Atualização por fast-forward e `npm ci && npm test` | 74 passaram, zero falhas, cerca de 15 s |
| Código | `git diff --check`; testes DOM com jsdom | Sem erros; nenhuma automação visual utilizada |
| Serviço atualizado | GET `/healthz`, `/api/status`, `/api/health`, `/api/network`, `/api/services`, `/api/logs/sources` | Todos HTTP 200; APIs com `no-store` |
| Validação de entrada | GET `/api/logs/unknown` | HTTP 400 |
| Arquivo servido | SHA-256 de `/app.js` comparado ao arquivo instalado | Igual |
| Minecraft real | Duas consultas do probe, sem entrar no jogo | Online, zero jogadores; CPU 19%, método `process-ticks/monotonic-time`, PID 15504 |
| Gateway público | GET sem sessão no hostname do painel | HTTP 302 para login em `cloudflareaccess.com` |

Na amostra real, modelo SM-A305GT, RAM, swap, Wi-Fi, bateria e oito registros
PM2 estavam disponíveis. CPU geral, PSI, sensores térmicos e `/proc/net/dev`
não forneceram leitura. São apresentados como indisponíveis; não houve root,
alteração de permissões Android nem tentativa de contornar o sandbox.

Cloudflare Access permanece como único login. O Express segue configurado em
`127.0.0.1`; não foi acrescentado JWT local. A sessão autenticada no gateway não
foi exercitada nesta auditoria: o redirecionamento valida a exigência do login,
e as consultas locais validam o origin.

## Aplicação e preservação do aparelho

O repositório do A30 estava limpo antes de qualquer atualização. Foram feitos
backup privado e comparação SHA-256 dos dumps PM2, arquivo privado de ambiente,
intenções persistidas e scripts de Bom Dia/Tailscale/Minecraft, além de
`server.properties`. As onze entradas monitoradas permaneceram iguais, incluindo
as que já estavam ausentes. Nenhum desses conteúdos foi enviado ao GitHub.

Backup e inventários privados ficaram em
`~/services/backups/dashboard-tests-20261018/`. A cópia isolada de validação
permanece nesse diretório; ela não foi registrada no PM2.

O commit foi publicado por push normal na `main` e aplicado com
`git pull --ff-only`. Somente `pm2 restart homelab-status` foi executado, mantendo
seu ambiente existente. O PID do dashboard mudou de 15489 para 32745.
Os demais processos mantiveram PID, estado online e contador de reinícios:
Minecraft 15504, Bom Dia 15502, Tailscale userspace 15480, watchdog 15501,
Cloudflare 15482, Playit 15487 e rotação de logs 15460.

Não houve `pm2 save`, restauração de dump, alteração do mundo, configurações do
jogo, identidade Tailscale ou segredos. O Minecraft continuou rodando; seus
arquivos de mundo podem continuar a ser atualizados normalmente pelo servidor.

A cópia local anterior em `Documents/Codex/2026-10-12/homelab-dashboard` também
estava limpa e foi atualizada por fast-forward, com instalação e suíte completa
aprovadas. A cópia antiga de 06/10, limpa e ainda no primeiro commit, foi apenas
inspecionada e preservada.

## Limites

- Bom Dia e Minecraft retornaram `available:true` no controle real. Tailscale
  userspace retornou online, mas `available:false`: já estava configurado com
  `TAILSCALE_CONTROL_ENABLED=0`. Essa opção privada e seu supervisor foram
  preservados. O código e os testes do controle continuam presentes.
- Não foram acionados start/stop dos serviços reais, envio WhatsApp, reboot,
  mudança de Wi-Fi ou teste de carga. Os fluxos de controle foram exercitados
  com processos e supervisores simulados na suíte.
- A comparação de arquivos não constitui auditoria integral do armazenamento ou
  dos segredos do aparelho. O mundo em execução não foi congelado para checksum.

Para repetir a suíte no A30:

```sh
cd ~/services/homelab
npm ci && npm test
```

Para inspecionar sem modificar os serviços:

```sh
git status --short --branch
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS http://127.0.0.1:3000/api/services
pm2 status
```
