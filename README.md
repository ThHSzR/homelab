# TH HomeLab

Central de monitoramento pessoal criada para transformar um smartphone Android antigo em um pequeno servidor doméstico acessível remotamente.

O projeto roda em **Termux** no Android, utiliza **Node.js + Express** para expor uma interface web e uma API local, **PM2** para manter os serviços ativos e **Tailscale** para acesso privado ao dispositivo sem abertura de portas no roteador.

## Visão geral

O TH HomeLab foi pensado como base para automações, monitoramento e pequenos serviços pessoais executados 24/7 em hardware reaproveitado.

Atualmente a central acompanha informações como:

- uptime do dispositivo e da aplicação;
- uso de memória;
- uso de armazenamento;
- estado da bateria via Termux:API;
- mudanças no carregador e duração das quedas de energia;
- endereço e interface Tailscale;
- serviços gerenciados pelo PM2;
- estado do SSH;
- persistência dos serviços após reinicialização;
- módulos existentes e planejados do HomeLab.
- alertas dentro do painel, histórico de disponibilidade e verificações dos túneis publicados.
- geração local de livros: etapas, capítulos, inferência, logs e EPUBs do Kindle Writer.

A interface visual segue a mesma identidade do meu portfólio, com tema escuro, detalhes em azul e componentes responsivos.

## Arquitetura

```text
Notebook / Desktop
       |
       | Tailscale
       v
   Galaxy A30
   Android 11
       |
     Termux
       |
       +-- OpenSSH :8022
       +-- Node.js / Express :3000
       +-- PM2
       +-- Termux:Boot
       +-- Termux:API
       |
       +-- TH HomeLab
```

## Monitor de livros com IA

O menu **Livros com IA** acompanha o [Kindle Writer](https://github.com/ThHSzR/kindle-writer), instalado separadamente em `~/services/kindle-writer`. Exibe o livro atual e o histórico, planos/cenas/capítulos salvos, tentativa e erro atual, worker PM2, modelo, contexto, threads, RSS da inferência e métricas da última chamada. O percentual representa checkpoints, sem estimar o tempo restante.

Abra **Logs ao vivo → Acompanhar geração** para alternar entre eventos/erros e saída parcial do modelo. Os dados do painel atualizam a cada 15 segundos; o log aberto, a cada 5 segundos. Abas ocultas suspendem as consultas e **Pausar log** suspende apenas o acompanhamento. A geração continua no telefone. O download de amostra/livro aparece quando o EPUB existir.

A integração usa apenas leitura de arquivos e a coleta PM2 já existente. Não inicia inferência, não cria outro worker, não altera a fila e não envia mensagens. A configuração privada é lida somente para extrair o nome do modelo e limites numéricos/indicadores de envio; credenciais, destinatários, prompts, banco e caminhos privados não são retornados. Logs têm limite de 16 KiB/120 linhas e redação de segredos conhecidos. Downloads aceitam somente nomes EPUB previstos, dentro de `books/`, com rejeição de links simbólicos.

Rotas de leitura, sob a mesma proteção de acesso do dashboard:

```text
GET /api/kindle-writer/status
GET /api/kindle-writer/status?book=ID
GET /api/kindle-writer/logs?channel=events
GET /api/kindle-writer/logs?channel=generation&book=ID
GET /api/kindle-writer/books/ID-amostra.epub
GET /api/kindle-writer/books/ID.epub
```

Se o aplicativo ainda não estiver instalado, o painel informa isso sem prejudicar os outros módulos. `KINDLE_WRITER_DIR` permite configurar outra pasta local. Pausa, retomada, criação de livros e SMTP continuam no CLI do repositório Kindle Writer. Revisão automática não garante consistência literária; o EPUB experimental precisa de leitura humana.

## Tecnologias

O acesso remoto à tela do Galaxy A30 tem [instaladores para Windows e Linux](tools/a30-remote/README.md), com ADB + scrcpy pelo SSH na tailnet.

- Android
- Termux
- Node.js
- Express
- JavaScript
- HTML
- CSS
- PM2
- OpenSSH
- Tailscale
- Termux:API
- Termux:Boot

## Estrutura do projeto

```text
homelab/
├── lib/
├── public/
│   ├── app.js
│   ├── index.html
│   └── style.css
├── test/
├── ecosystem.config.cjs
├── modules.json
├── package.json
├── package-lock.json
└── server.js
```

## Instalação no Termux

### 1. Dependências básicas

```bash
pkg update && pkg upgrade -y
pkg install git nodejs openssh termux-api -y
npm install -g pm2
```

### 2. Clonar o repositório

```bash
mkdir -p ~/services
cd ~/services
git clone https://github.com/ThHSzR/homelab.git
cd homelab
```

### 3. Instalar dependências

```bash
npm install
```

### 4. Iniciar com PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### 5. Verificar

```bash
pm2 status
pm2 logs homelab-status
```

Por padrão, a central escuta apenas na porta local:

```text
127.0.0.1:3000
```

Para abrir o dashboard remotamente, acesse o hostname protegido pelo Cloudflare Access:

```text
https://homelab.thsouza.eng.br
```

## SSH remoto

O SSH é fornecido pelo OpenSSH do Termux e utiliza, por padrão, a porta `8022`.

Exemplo:

```bash
ssh -p 8022 usuario@IP_TAILSCALE
```

No computador cliente, pode ser configurado um alias em `~/.ssh/config`:

```sshconfig
Host homelab
    HostName IP_TAILSCALE_DO_CELULAR
    User USUARIO_TERMUX
    Port 8022
    IdentityFile ~/.ssh/id_ed25519
```

Depois disso:

```bash
ssh homelab
```

## Inicialização automática

Com o Termux:Boot instalado, o HomeLab pode iniciar automaticamente junto com o Android.

Exemplo de script em:

```text
~/.termux/boot/start-services
```

```bash
#!/data/data/com.termux/files/usr/bin/sh

termux-wake-lock
sshd
sleep 10
pm2 resurrect
```

Depois:

```bash
chmod +x ~/.termux/boot/start-services
pm2 save
```

## Atualização

Para atualizar o servidor com a versão mais recente da `main`:

```bash
ssh homelab
cd ~/services/homelab
git pull
npm install
pm2 restart homelab-status
```

Quando não houver alteração de dependências, normalmente basta:

```bash
cd ~/services/homelab
git pull
pm2 restart homelab-status
```

## Endpoints

### Status da aplicação

```text
GET /healthz
```

### Dados do HomeLab

```text
GET /api/status
```

### Módulos

```text
GET /api/modules
```

## Observação sobre Termux:API

A leitura da bateria usa `termux-battery-status`. Em alguns dispositivos Android, principalmente quando o Termux:API precisa ser acordado em segundo plano, a resposta pode levar alguns segundos.

O coletor utiliza um timeout específico de **10 segundos** para essa consulta. Isso evita encerrar o processo cliente cedo demais e reduz ocorrências de mensagens do `ResultReturner` como `java.io.IOException: Connection refused`, que podem acontecer quando o app Termux:API tenta devolver o resultado depois que o socket local do chamador já foi encerrado.

Caso a API não responda dentro desse prazo, o dashboard continua funcionando normalmente e informa temporariamente que a leitura da bateria está indisponível. Uma nova coleta é feita no ciclo seguinte.

Para testar a API diretamente:

```bash
termux-battery-status
termux-toast "teste da API"
```

## Objetivo do projeto

O objetivo é evoluir esse dispositivo para uma central pessoal de infraestrutura e automação, capaz de hospedar serviços leves e integrar diferentes projetos em um único ambiente.

Entre as próximas possibilidades estão:

- watchdog de serviços;
- monitor de conectividade;
- integrações de Wake-on-LAN com widgets e assistentes;
- MQTT e automações IoT;
- monitor de energia;
- integração com outros dispositivos da rede;
- Cloudflare Tunnel para publicação controlada de serviços web;
- novos módulos e métricas no dashboard.

## Segurança

O acesso administrativo é feito preferencialmente pela rede privada do Tailscale, evitando exposição direta da porta SSH à Internet.

Também é recomendado utilizar autenticação por chave SSH e manter a autenticação por senha desabilitada após a configuração inicial.

---

Desenvolvido por [Thiago Henrique Souza Rodrigues](https://github.com/ThHSzR).
## Serviços (Watchdog)

O processo independente `homelab-watchdog` faz uma rodada a cada 30 segundos, sem sobreposição e sem dependências novas:

- Dashboard: HTTP `127.0.0.1:3000/healthz` (acompanha `PORT`).
- SSH: conexão TCP local na porta 8022; não testa autenticação.
- Bom-dia: `sv status $PREFIX/var/service/bom-dia`; indisponibilidade de runit aparece como sem leitura.
- Internet: HTTPS para `https://connectivitycheck.gstatic.com/generate_204`, com timeout de 4 segundos. Uma falha indica indisponibilidade desse destino, não prova que toda a internet caiu. Há uma requisição externa por rodada.
- Tailscale (app Android): detecção da interface VPN ativa com IP `100.64.0.0/10` via `ip -j addr`; online significa interface local presente, não que os peers estão alcançáveis. Falha na consulta aparece como **Sem leitura**, não como offline.

`GET /api/health` retorna estado, duração da verificação em `latencyMs`, `checkedAt`, `lastSeen`, `changedAt`, falhas consecutivas, histórico e orçamento de recuperação. Retorna 503 até existir estado legível; `stale: true` indica mais de 90 segundos sem leitura. O dashboard reúne os cartões de serviço em uma única seção **Serviços** e mostra as últimas 20 verificações.

O monitor grava `~/services/state/watchdog.json` por substituição atômica e reescreve `watchdog.jsonl` com as últimas 120 rodadas (cerca de uma hora). O histórico é limitado por amostras, não um registro permanente. A latência do runit mede a consulta ao supervisor, não a execução da automação. `WATCHDOG_STATE_DIR` permite usar um diretório alternativo, inclusive nos testes locais. Execute apenas uma instância gravadora nesse diretório.

### Atualizar no Termux

Depois de obter esta branch ou sua versão integrada:

```sh
cd ~/services/homelab
npm ci
pm2 startOrReload ecosystem.config.cjs
pm2 save
pm2 status
pm2 logs homelab-watchdog --lines 30
curl http://127.0.0.1:3000/api/health
```

O `pm2 save` inclui o watchdog na restauração existente pelo Termux:Boot (`pm2 resurrect`); não é necessário mudar o script de boot. Também é possível executar `node watchdog.js` fora do PM2 para diagnóstico, parando antes a instância gerenciada.

### Recuperação opcional do bom-dia

Por padrão o watchdog somente monitora e recomenda verificar o bom-dia. Dashboard e SSH continuam sob seus gerenciadores atuais; o watchdog não os reinicia.

Para habilitar a recuperação do bom-dia, defina `WATCHDOG_RECOVER_BOM_DIA: '1'` no `env` do **homelab-watchdog** em `ecosystem.config.cjs` e recarregue o PM2. A única ação permitida é `sv up` no caminho fixo do bom-dia, sem shell ou comando recebido pela API. Exige três falhas consecutivas, estado `down:` com `normally up`, ausência do arquivo `down` e uma nova confirmação imediatamente antes do comando. Serviços parados intencionalmente ou com estado desconhecido não são recuperados.

Há cooldown de 10 minutos e limite total de três tentativas, persistidos antes da ação. Sucesso não zera esse orçamento; reiniciar o monitor também não. Falha ao gravar impede a ação. Estado corrompido bloqueia recuperação e o bloqueio fica persistido. O resultado de `sv up` apenas confirma o comando; a disponibilidade é validada na rodada seguinte.

Após corrigir a causa, para rearmar manualmente: pare `homelab-watchdog`, faça uma cópia de `watchdog.json`, remova somente esse arquivo e inicie o watchdog novamente. Isso também reinicia o histórico em memória. Não apague estado para contornar falhas recorrentes. Para desativar, defina `WATCHDOG_RECOVER_BOM_DIA: '0'` no mesmo `env` e execute `pm2 startOrReload ecosystem.config.cjs --update-env`, seguido de `pm2 save`. Confira `recovery.enabled` na API.

### Testes

```sh
npm test
```

Os testes cobrem transições, histórico limitado, last-seen, probes HTTP/TCP, API 503/fresh/stale, cooldown, limite persistido, parada manual, estado corrompido, falha de gravação e ciclos sobrepostos. Usam serviços locais e diretórios temporários; não chamam recuperação real no Termux.

## Minecraft no dashboard

A seção Minecraft e o cartão no Health consultam o servidor Java Edition local na porta `25565` a cada 30 segundos. O monitor envia uma consulta do protocolo de status do Minecraft, sem entrar no jogo e sem autenticação. Quando recebe uma resposta válida, mostra versão e jogadores. Uma porta aberta sem resposta válida aparece como **possível**, pois alguns servidores desativam o status ou usam outro protocolo.

O monitor procura processos Java executados com `-jar` no `/proc` do Termux. Quando encontra um candidato identificável, mostra PID, nome do arquivo `.jar`, memória residente (RAM), fração da RAM do dispositivo e uso aproximado de CPU. A CPU usa delta de utime+stime de `/proc/PID/stat`, frequência obtida por `getconf CLK_TCK` e tempo monotônico entre duas amostras; 100% equivale a um núcleo e várias threads podem ultrapassar 100%. Android no A30 nega `/proc/stat` e `/proc/uptime` (EACCES); a medição não depende desses arquivos nem de `os.cpus()`. Cada monitor mantém sua própria probe entre rodadas de 30 s. PID ou starttime alterados zeram a base; falhas de permissão, frequência, seleção ambígua ou contador inválido têm motivo explícito na API e no painel. A frequência não é presumida. Quando há mais de um processo Java e não é possível escolher um candidato com segurança, o painel não atribui consumo a um servidor específico. A consulta da porta e a seleção do processo são independentes; o painel não afirma que o processo selecionado é necessariamente o dono da porta. O HomeLab não lê nem expõe argumentos completos da linha de comando.

Para usar uma porta diferente, altere `MINECRAFT_PORT` no `env` do `homelab-watchdog` em `ecosystem.config.cjs`, rode `pm2 startOrReload ecosystem.config.cjs --update-env` e `pm2 save`. Em seguida, consulte `/api/health` e procure `services.minecraft`. Em computadores sem `/proc` acessível, o status da porta continua disponível, mas o consumo do processo não aparece. O monitor apenas observa o Minecraft; o controle opcional é descrito em Interruptores em Serviços.

## Alertas no dashboard

A seção **Atenção agora** combina as leituras já existentes do dispositivo e do watchdog, sem instalar dependências ou executar ações. Ela destaca bateria em 20% ou menos enquanto descarrega, temperatura da bateria a partir de 42 °C, armazenamento a partir de 85% e um processo Java candidato ao Minecraft usando pelo menos 35% da RAM do aparelho. Os avisos levam à seção correspondente. Se uma fonte estiver indisponível ou desatualizada, o painel indica leituras parciais e evita declarar que está tudo bem. Os limites são indicadores operacionais, não diagnósticos do hardware.

O ícone de bloco de grama na seção Minecraft é a imagem fornecida pelo usuário, salva localmente no projeto; o painel continua funcionando sem recursos externos de imagem. Os testes da lógica de alertas verificam limites, ausência de alertas por serviços offline e dados desatualizados.

## SSH no navegador via Cloudflare Access

O dashboard inclui o link **SSH Web**, para `https://homelabssh.thsouza.eng.br`. O terminal foi configurado com Cloudflare Access e uma rota SSH publicada no Cloudflare Tunnel existente. O frontend não executa comandos remotos nem fornece autenticação SSH própria.

1. No Zero Trust / **Networking > Tunnels**, editar o túnel já existente, adicionar uma rota de aplicação publicada para `homelabssh.thsouza.eng.br` com serviço **SSH** em `localhost:8022`. Não abrir a porta 8022 no roteador.
2. Em **Access controls > Applications**, criar uma aplicação self-hosted com hostname público `homelabssh.thsouza.eng.br`, com política **Allow** limitada à identidade de administração e MFA/passkey; **não** criar regra Bypass nem Service Auth.
3. Na aplicação Access, ativar **Allow access through browser-based RDP, SSH, or VNC sessions** e selecionar **SSH**.
4. Validar no Termux com `ss -lnt | grep 8022` e `whoami`; o SSH do Android/Termux roda na porta `8022`, não `22`.
5. Visitar `https://homelabssh.thsouza.eng.br` e conferir o login. No Termux, o usuário SSH é gerado pelo Android (neste aparelho, `u0_a267`); preservar o método de autenticação SSH já testado no navegador.

**Segurança:** não habilitar senha SSH globalmente ou substituir a autenticação por chave existente sem avaliar o impacto; manter Tailscale + SSH atual como acesso administrativo de recuperação. A autenticação pelo Access não significa, por si só, que o servidor SSH aceite a identidade apresentada.

Documentação oficial:
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/ssh/ssh-browser-rendering/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/browser-rendering/

## Terminal SSH em janela independente

O botão **SSH ↗**, fixado no canto inferior direito do dashboard, abre `https://homelabssh.thsouza.eng.br/` em uma **janela nativa redimensionável do navegador**, centralizada na área disponível da tela (até 980 × 680 pixels). É possível ajustar o tamanho pelos controles da janela. Alguns navegadores, especialmente em dispositivos móveis, podem abrir uma aba em vez de janela pop-up; esse comportamento depende das preferências do navegador.

O clique aciona `window.open` diretamente para respeitar as restrições de pop-ups. O link de HTML continua funcionando em nova aba quando JavaScript não está disponível ou ao usar Ctrl/Cmd+clique. Caso o navegador bloqueie pop-ups, use o link **SSH Web** no menu ou autorize pop-ups para o dashboard.

A incorporação anterior via `iframe` foi removida porque a interface SSH do Cloudflare Access não aceita ser renderizada no iframe do dashboard. A exceção `frame-src` no CSP também foi removida. Não há nova API de execução remota no Express.

**Nenhuma nova rota é necessária:** permanece a rota Cloudflare Tunnel já existente, `homelabssh.thsouza.eng.br` → serviço SSH do Termux na porta `8022`. O Cloudflare Access continua responsável por exigir a autenticação e aplicar suas políticas.


## Interruptores em Serviços

As chaves de **Bom Dia** e **Minecraft** ficam ao lado do nome em seus cartões de Serviços. Ao lado do Minecraft há um único cartão Tailscale, com Android (somente monitoramento) e Termux / PM2 (chave da instância userspace), cada um com sua linha de histórico online/offline. O círculo se desloca entre desligado e ligado conforme a leitura real da API, sem antecipar sucesso. Operações mostram Ligando/Desligando, bloqueiam novos cliques e exibem erros. O controle continua visível mesmo com o watchdog indisponível.

### Gerenciadores confirmados e limites

Em consulta SSH ao A30 em 13/10/2026, Bom Dia foi confirmado no PM2 como `bom-dia`, launcher `~/services/bom-dia/start.sh`, código em `~/bom-dia`. O processo Node é único. O runit legado mantém o serviço cadastrado, mas tem marcador `down` e um guard `MANAGED_BY_PM2` que impede iniciar outro bot. Dashboard e watchdog usam PM2 por padrão; uma instalação que ainda usa runit deve definir `BOM_DIA_MANAGER=runit` explicitamente.

Em modo runit, Bom Dia usa exclusivamente `sv -w 15 up/down` nesse caminho fixo, sem shell. Parar grava primeiro o arquivo runit `down`; iniciar remove esse arquivo. A intenção de parada persiste no reboot. A cada 15 segundos, o dashboard reconcilia um serviço ainda em execução com esse marcador, inclusive após falha entre persistência e comando. Iniciar depende da supervisão normal do runit; não há loop adicional de auto-start no dashboard. Online significa processo supervisionado em execução, não sucesso funcional da automação.

Dashboard e recuperação do watchdog compartilham o diretório de lock `.homelab-control-lock` dentro do serviço. A recuperação confirma novamente a ausência de `down` dentro do lock. Após uma falha abrupta, o lock não é removido automaticamente: pare dashboard e watchdog, confirme que não existe operação em execução, inspecione o estado e só então remova o diretório vazio com `rmdir "$PREFIX/var/service/bom-dia/.homelab-control-lock"`. Rode somente uma instância do dashboard e mantenha ambos os processos na mesma versão.

**Minecraft:** a [conversa de configuração](https://chatgpt.com/share/6ac94643-66ec-83e8-a902-422293b81392) registra Java diretamente no Termux, com `~/minecraft/start.sh` usando `exec`, e o processo PM2 `minecraft`. A consulta SSH em 15/10/2026 confirmou Java diretamente no Termux, sem Debian/proot. Após uma tentativa de habilitar o toggle nesse dia, o A30 foi restaurado à configuração anterior: `server-ip=` vazio, RCON desligado, PM2 com `autorestart:true` e `MINECRAFT_CONTROL_ENABLED='0'`. O servidor voltou a responder na porta 25565; o controle do Minecraft no painel permanece indisponível. Os passos abaixo descrevem uma configuração opcional futura e **não devem ser aplicados ao A30 sem confirmar o destino do túnel Playit e testar uma conexão externa**.

### Cloudflare Access e atualização no Android

1. Proteja **todo o hostname do dashboard**, inclusive `/api/services`, com aplicação Cloudflare Access self-hosted e política Allow dos administradores, sem Bypass. A autenticação ocorre nesse acesso ao site. O Express escuta somente em `127.0.0.1`: configure a origem do Cloudflare Tunnel como `http://127.0.0.1:3000`. O próprio Express não exige outro login nem valida JWT. Acessos diretos pelo localhost não passam pelo Cloudflare Access; não exponha a porta 3000 na LAN, tailnet ou Internet.
2. No Termux, atualize e instale as dependências (Node 22 ou superior):

```bash
cd ~/services/homelab
git pull --ff-only origin main
npm ci
npm test
pm2 status bom-dia
```

3. Confira o gerenciador usado pelo Bom Dia. No A30 ele foi confirmado como PM2 e já é o padrão:

```js
BOM_DIA_MANAGER: 'pm2'
```

Não existe mais configuração `CONTROL_ORIGIN`, `ACCESS_AUD` ou `ACCESS_TEAM_DOMAIN` para o Express. A autenticação acontece na Cloudflare. POST recebe JSON `{action:'start'|'stop'}` com até 1 KB, apenas para serviços predefinidos; não recebe comandos, caminhos ou senhas.

4. Recarregue **dashboard e watchdog** e persista o PM2:

```bash
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
pm2 status
```

5. Abra o dashboard pelo hostname protegido, autentique-se com o e-mail autorizado e teste Bom Dia. Confirme a parada com `pm2 status bom-dia` (ou `sv status "$PREFIX/var/service/bom-dia"` no modo runit), aguarde mais de uma rodada do watchdog e confira que continua parado. Reinicie Android para validar persistência. Em uma nova instalação, Minecraft fica bloqueado até configurar seu controle seguro abaixo.

Testes cobrem persistência/reconciliação da parada, falhas do supervisor, bloqueio compartilhado e allowlist. A interface também é testada com serviços simulados: círculo desloca 26 px e cliques ficam bloqueados durante a operação. Isso não substitui a validação no aparelho.


### Minecraft: configuração opcional do controle pelo PM2

Em modo PM2, Bom Dia valida um único registro `bom-dia` e o caminho de `start.sh`, grava `~/services/bom-dia/desired.json`, executa start/stop apenas no ID confirmado e salva a lista PM2. O launcher privado já instalado consulta esse estado antes de iniciar o bot; `pm2 start bom-dia` sozinho não substitui a intenção offline. O watchdog em modo PM2 apenas monitora, sem recuperação runit. O modo runit preserva o arquivo `down`.

Minecraft não é iniciado como um segundo Java avulso: o dashboard inicia o registro PM2 existente de `~/minecraft/start.sh`. A configuração de referência fica em `minecraft.ecosystem.config.cjs`, separada da configuração do dashboard para uma atualização da central não reiniciar o mundo.

**Preparação única, com o servidor já encerrado normalmente:**

- Se ele está aberto diretamente com `./start.sh`, digite `save-all flush` e depois `stop` no console e aguarde o término do Java.
- Se ele já está no PM2 antigo com reinício automático e sem RCON, não use `pm2 restart/delete/stop` como atalho para esta migração. Primeiro confirme o estado e um canal de console para encerrá-lo normalmente. A configuração antiga tem timeout de 30 s e pode forçar a finalização antes de concluir um salvamento demorado. O dashboard recusa essa configuração; a migração de um processo em execução exige confirmar os dados reais do aparelho.
- Faça uma cópia dos diretórios do mundo antes da primeira migração e mantenha o `start.sh` existente com `exec`. A implementação não altera mundos, JAR, EULA ou parâmetros de RAM.

Com o servidor offline, edite `~/minecraft/server.properties`, preservando as demais propriedades e evitando chaves duplicadas:

```properties
server-ip=127.0.0.1
enable-rcon=true
rcon.port=25575
rcon.password=COLOQUE_AQUI_64_CARACTERES_HEXADECIMAIS
```

Gere uma senha local com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` e use a saída no arquivo, sem enviá-la ao chat ou ao GitHub. Execute `chmod 600 ~/minecraft/server.properties`. O backend lê a senha diretamente desse arquivo: ela não vai para API, logs nem argumentos de processo.

A ligação em 127.0.0.1 restringe também a porta do jogo ao aparelho: Playit deve encaminhar o túnel existente para `127.0.0.1:25565`. Acesso LAN direto deixará de funcionar. Não publique 25575 no Playit, Cloudflare ou roteador. Confira no aparelho `ss -ltn`: RCON deve escutar em 127.0.0.1:25575. Referência de propriedades: [PaperMC](https://docs.papermc.io/paper/reference/server-properties/).

Somente após confirmar que o registro antigo está parado e não há Java avulso para esse servidor, aplique:

```bash
cd ~/services/homelab
pm2 startOrReload minecraft.ecosystem.config.cjs
pm2 save
```

Confira no PM2: processo único `minecraft`, script `~/minecraft/start.sh`, cwd `~/minecraft`, interpretador `$PREFIX/bin/bash`, modo fork e `autorestart:false`, sem watch, cron ou reinício por memória. Desativar auto-restart evita que o PM2 religue após o comando Minecraft `stop`; o controle valida isso antes de qualquer ação. Referência: [opções do PM2](https://pm2.keymetrics.io/docs/usage/application-declaration/).

Adicione `MINECRAFT_CONTROL_ENABLED: '1'` ao env de **homelab-status** após concluir a preparação segura e recarregue apenas o ecossistema do dashboard:

```bash
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

**Fluxo do toggle:** POST retorna 202 e o navegador acompanha o estado pela API. Ligar inicia somente o ID PM2 validado, salva a lista PM2 e aguarda resposta do protocolo Minecraft por até 120 s. Desligar persiste a intenção offline em `~/minecraft/.homelab-desired.json`, autentica RCON exclusivamente em 127.0.0.1, envia apenas `save-all flush`, exige confirmação `Saved the game` e então envia `stop`. Aguarda o PID original sair naturalmente (até 120 s). Somente com o processo encerrado e a porta do jogo offline marca o registro PM2 como stopped e executa `pm2 save`. Não existe fallback para sinais/kill; falhas ficam no painel. Plugins que alterem a resposta de salvamento podem impedir a operação, preservando o processo.

Se o PM2 apresentar `waiting restart` depois da saída natural do Java, o controle confirma que o PID e a porta do jogo estão offline antes de cancelar esse estado pendente com `pm2 stop` e persistir a lista. A reconciliação da intenção offline faz a mesma verificação após reinício do dashboard.

Um lock exclusivo no diretório Minecraft impede comandos concorrentes; após interrupção abrupta deve ser inspecionado com ambos os processos de controle parados, seguindo o procedimento de lock do Bom Dia. Ao reiniciar a central, uma intenção offline é reconciliada pelo mesmo fluxo seguro se PM2 ressuscitou o servidor. Não há auto-start adicional nem recovery Minecraft. Falha ao salvar o estado PM2 é reportada; a intenção offline continua presente para reconciliação. Não execute comandos externos de restart ou altere o registro PM2 enquanto o dashboard estiver controlando esse servidor.

Valide uma parada no Android acompanhando `pm2 logs minecraft --lines 50 --nostream`: confirme salvamento, término do Java e estado stopped; depois teste ligar e reboot. Testes locais simulam PM2/PID e usam um servidor TCP RCON de teste. Eles não comprovam que o Android foi configurado nem oferecem garantia contra falha de armazenamento, plugins defeituosos ou encerramento do Java pelo Android.

### Implantação desta atualização sem perder a migração local

Em inspeção SSH anterior no A30, uma medição isolada de CPU retornou 20,1% no PID Java 27995, mas a interface ainda pode mostrar CPU indisponível se a leitura pelo procfs falhar ou a versão nova não estiver instalada. Agora o watchdog tenta também a métrica do registro PM2 `minecraft` quando a leitura direta de CPU não produz valor; só aceita um registro online de `~/minecraft/start.sh` e o mesmo PID, quando identificado. A atualização atual não foi implantada nem validada no Android.

No A30 existem alterações locais da migração Bom Dia em seis arquivos. Antes do pull, preserve-as; não aplique o stash automaticamente sobre a implementação integrada:

```sh
cd ~/services/homelab
git status --short
git stash push --include-untracked -m 'bom-dia-local-antes-dashboard' -- ecosystem.config.cjs lib/collectors.js lib/service-control.js lib/watchdog.js lib/bom-dia-pm2.js test/bom-dia-pm2.test.js
git pull --ff-only origin main
npm ci
npm test
```

Se houver alterações adicionais, preserve-as e revise antes do pull. O stash mantém uma cópia recuperável dos arquivos anteriores; não o apague antes de comparar. Código/dados e `desired.json` privados do bot, supervisor Tailscale e mundos ficam fora do repositório e não são substituídos pelo pull.

Se já existe `~/services/homelab-control.env`, mantenha-o fora do Git e com permissão 600. O dashboard só precisa destas opções de controle, de acordo com o estado real dos serviços:

```sh
export BOM_DIA_MANAGER='pm2'
export MINECRAFT_CONTROL_ENABLED='0'
export TAILSCALE_CONTROL_ENABLED='0'
```

Cloudflare Access continua protegendo o hostname completo. O backend **não** pede JWT, AUD, validação de identidade, header administrativo ou login adicionais; `GET /api/services`, `/api/network` e `/api/logs` respondem normalmente depois que a requisição alcança o Express. Não existe mais `lib/access.js`.

**Limite da arquitetura:** o Cloudflare Access protege apenas as requisições que atravessam a borda Cloudflare; `curl http://127.0.0.1:3000/api/services` pelo próprio Termux alcança o Express diretamente. Isso é intencional neste laboratório. Mantenha `HOST=127.0.0.1`, o túnel apontado para `http://127.0.0.1:3000` e nunca publique a porta de controle diretamente na LAN ou na Internet.

```sh
cd ~/services/homelab
[ ! -f "$HOME/services/homelab-control.env" ] || . "$HOME/services/homelab-control.env"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
pm2 logs homelab-status --lines 30 --nostream
```

Para testar, autentique-se em `https://homelab.thsouza.eng.br` e confira os cards Serviços, Rede, Logs e Telemetria. O site deve solicitar login pelo Cloudflare Access quando a sessão expirar; o Express não adiciona outra autenticação.

Após preparar Minecraft com o servidor encerrado normalmente conforme a seção anterior, altere somente `MINECRAFT_CONTROL_ENABLED='1'` no arquivo privado e reaplique o ecossistema do dashboard. A chave pede confirmação antes de salvar e desconectar jogadores. Não mude a configuração do Minecraft em execução para contornar a validação.

### Tailscale Android e Termux / PM2

O lado Android mede exclusivamente a interface VPN do aplicativo. Não há método autorizado de controle Android, portanto não há chave desse lado. O lado Termux consulta o registro único `tailscale-userspace`, que no A30 executa `~/services/tailscale-userspace/supervisor.cjs` pelo Node do Termux. Esse supervisor inicia um daemon userspace em Debian/proot e verifica seu socket privado. Ele não é `homelab-watchdog` nem o aplicativo Android. A API local informa `Running`, `NeedsLogin` ou indisponibilidade; PM2 online sozinho não prova conectividade da tailnet.

Para habilitar a chave sem ressuscitar uma parada intencional, instale a versão com trava `desired.json` e `stop_exit_codes:[0]`. Faça isto no **terminal local do Termux ou por SSH LAN**, pois reiniciar/parar essa instância corta SSH userspace. Preserve start.sh, cli.sh, estado, identidade e Serve existentes; não registre outro daemon:

```sh
cd ~/services/homelab
base="$HOME/services/tailscale-userspace"
cp "$base/supervisor.cjs" "$base/supervisor.cjs.before-dashboard"
```

Crie `$base/desired.json` com `{"desired":"online"}` se a instância deve continuar ligada, ou `{"desired":"offline"}` para manter parada. Se esse arquivo já existir, preserve e revise seu estado. Instale só o supervisor, sem copiar segredos:

```sh
chmod 600 "$base/desired.json"
cp deploy/tailscale-supervisor.cjs "$base/supervisor.cjs"
chmod 600 "$base/supervisor.cjs"
pm2 startOrReload tailscale.ecosystem.config.cjs --update-env
pm2 save
```

O launcher sai antes de criar filhos quando o estado está offline, ausente ou inválido. PM2 não reinicia saída 0. Após SIGINT/SIGTERM, o supervisor encerra apenas seu grupo de daemon e sai em 2,5 s; PM2 tem timeout de 4 s. Recuperação por falha da API só ocorre dentro do supervisor ativo e respeita intenção offline. A central valida o contrato do supervisor, o ID, script, interpretador e configuração antes de controlar; grava intenção atomicamente, executa start/stop nesse ID, salva PM2 e reconcilia apenas paradas. Nenhuma operação liga a VPN Android ou reinicia watchdog.

Defina `TAILSCALE_CONTROL_ENABLED='1'` no arquivo privado e reaplique o ecossistema do dashboard. Teste a chave pelo hostname protegido e confira no Termux `pm2 status tailscale-userspace`, o estado de `desired.json` e `/api/health` após duas rodadas. Offline deve sobreviver à restauração/reboot. O painel pede confirmação da perda de conexões SSH antes de desligar userspace. Rollback do código, se necessário, exige restaurar o supervisor e sua configuração PM2 anterior pela LAN; preserve intenção offline durante o rollback.

### Limites e validação

POST aceita apenas `bom-dia`, `minecraft`, `tailscale-userspace` e start/stop em JSON de até 1 KB. O Cloudflare Access é a única autenticação do painel; o Express permanece no loopback e não libera CORS. Não há rate limit nem verificação de identidade no Express. Um bloqueio global da API serializa operações e cada gerenciador mantém seu lock exclusivo em disco, inclusive contra recuperação. O estado desejado é gravado antes de comandos e os limites de cada subprocesso são explícitos. Não execute operadores externos de PM2 enquanto uma operação estiver em andamento.

Logs `[control]` registram serviço, ação e resultado, sem token, senha ou corpo do pedido. Minecraft retorna 202; resultado final e erros vêm de GET. Os demais gerenciadores retornam após confirmar PM2, com timeout de rede de 65 s no navegador. Um timeout não equivale a cancelamento: confira estado antes de repetir. Em caso de crash com lock residual, pare os controladores, confirme que não existe operação em curso e arquive o lock para inspeção; nunca o remova para disputar uma ação ativa.

`npm test` cobre UI/DOM, confirmação, transições, falha do watchdog, allowlists de serviço e ação, concorrência, PM2/RCON, persistência, CPU sob restrições Android e parsing de telemetria. Os testes usam processos simulados e serviços de teste locais, não ligam/desligam serviços reais. Ciclos reais de start/stop/reboot no Android permanecem pendentes.

## Rede, dispositivos, portas, tráfego e logs

O `homelab-watchdog` também coleta dados de rede a cada 60 segundos e grava `~/services/state/network.json` atomicamente. A API `GET /api/network` entrega a leitura e até 120 amostras de histórico (cerca de duas horas); uma amostra com mais de três minutos aparece como desatualizada. O monitor consulta a interface Wi-Fi privada, encontra o gateway pela rota efetiva, mede ping de três pacotes para gateway e `1.1.1.1`, resolve um nome DNS e verifica HTTPS. Esses resultados são independentes: falha do ping pode indicar bloqueio de ICMP, e uma resposta de um destino não prova disponibilidade de toda a Internet.

A descoberta percorre no máximo 64 endereços por rodada, com até oito pings simultâneos, apenas na rede Wi-Fi privada `/24` do aparelho. Assim, uma `/24` inteira leva aproximadamente quatro rodadas; o painel distingue uma resposta atual de um dispositivo visto antes. A tabela mostra IP, nome reverso quando o DNS responde e MAC quando o Android fornece o vizinho em `ip neigh`. Um vizinho em cache, sozinho, não é marcado online. Em redes maiores que `/24`, a descoberta ativa fica pausada e as demais medições continuam. Não há rota para solicitar uma varredura ou alvo arbitrário pelo navegador.

O fabricante do MAC só aparece se houver um arquivo local opcional `~/services/network-oui.json`, fora do Git, com prefixos hexadecimais de seis dígitos em maiúsculas, por exemplo `{ "AABBCC": "Fabricante" }`. Sem essa tabela, o painel mostra `—`; nenhum MAC é enviado a um serviço externo para identificação.

As portas verificadas são uma lista fixa: SSH Termux `8022`, dashboard `3000`, Minecraft `25565`, HTTPS do dashboard público `443`, gateway `22/80/443` quando identificado e a API interna `/healthz`. A abertura TCP não confirma o protocolo de Minecraft nem autenticação SSH; as verificações existentes do watchdog complementam esse resultado.

O tráfego vem dos contadores `ip -j -s link show` das interfaces Wi-Fi, móveis e VPN visíveis. O painel mostra bytes acumulados e taxa recebida/enviada calculada entre amostras, descartando deltas negativos após reinício do contador. **Esses números incluem tráfego LAN e Internet.** No Android sem root, `/proc/net/dev` e a consulta de sockets por processo estão bloqueados neste A30; não é possível atribuir bytes com exatidão ao Minecraft, Playit ou Cloudflare. O painel informa essa limitação, em vez de inventar consumo por serviço.

`GET /api/logs/sources`, `/api/logs/all` e `/api/logs/:service` leem apenas registros PM2 conhecidos: dashboard, watchdog, Bom Dia, Minecraft, Playit, Cloudflare Tunnel e Tailscale Termux. O modo **Todos os serviços** agrupa as últimas linhas por serviço, sem alegar ordem cronológica entre arquivos. Cada arquivo é validado dentro de `~/.pm2/logs` ou `~/services/logs`, limitado a 64 KB/160 linhas; a visão conjunta limita ainda mais cada fonte. Sequências ANSI e padrões comuns de token/senha são ocultados. Como logs livres podem conter dados não padronizados, mantenha Cloudflare Access protegendo o hostname inteiro. As rotas de leitura exigem conexão local do túnel, não aceitam caminho de arquivo e não têm CORS liberado.

### Histórico, verificações públicas e retenção de logs

O watchdog mantém até 30 dias de contadores diários online, offline e sem leitura, além das 500 transições mais recentes. O painel mostra sete dias, com a cobertura observada: uma coleta recém-instalada não aparece como 100% de sete dias. Uma pausa do monitor maior que 90 s é contabilizada como sem leitura. O arquivo `~/services/state/watchdog.json` é atualizado atomicamente. O histórico de alimentação fica em `~/services/state/power.json`, com até 200 mudanças e duração das interrupções observadas pelo Termux:API. Ele não mede quedas ocorridas enquanto o Android estava desligado.

Playit e Cloudflare Tunnel são verificados como processos PM2 separados. A URL HTTPS pública e o endereço público do Minecraft têm probes adicionais; eles são executados **no próprio A30**, portanto não provam alcance a partir de outra rede. Para habilitar a verificação do Minecraft, configure `PLAYIT_PUBLIC_HOST` com o endereço usado pelos jogadores e, se a porta não vier de registro DNS SRV, `PLAYIT_PUBLIC_PORT`. Sem esses dados, o resultado é “sem confirmação”. Para a URL protegida pelo Access, crie um service token com política **Service Auth** na aplicação do dashboard e configure `CF_ACCESS_PROBE_ID` e `CF_ACCESS_PROBE_SECRET` no arquivo privado. O probe só usa o token para `/healthz`; não grava o segredo no snapshot. Sem ele, o estado público fica “sem confirmação”. [Service tokens do Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

Os alertas são somente no dashboard: distinguem falha de três leituras seguidas, estado desconhecido, parada intencional, leitura antiga, falta de energia, bateria quente/baixa, armazenamento e memória do Minecraft. Não há envio externo. A interface pausa consultas regulares quando a aba fica oculta e retoma ao voltar; listas PM2 consultadas quase ao mesmo tempo compartilham uma leitura por dois segundos.

Para limitar o uso de armazenamento pelos logs PM2 no A30, execute uma vez `bash deploy/setup-log-rotation.sh` como o usuário Termux que executa o PM2. O script instala `pm2-logrotate` se necessário e configura 5 MB por arquivo, cinco arquivos rotacionados por fonte, compressão e rotação diária. Confira `pm2 conf` e o espaço livre depois da instalação. O módulo também consome memória, então acompanhe o uso no A30. [Configuração do pm2-logrotate](https://github.com/keymetrics/pm2-logrotate).

TPS/MSPT não é exibido nesta versão: o protocolo de status Minecraft não informa essas métricas. A disponibilidade do controle por RCON é independente e pode ser consultada em `/api/services`. Antes de integrar TPS/MSPT, é preciso escolher uma fonte confiável compatível com a versão/servidor em uso, confirmar o destino do Playit e testar sem alterar o mundo em produção.

Para atualizar o A30, confirme antes que `git status --short` está vazio. Depois:

```sh
cd ~/services/homelab
git pull --ff-only origin main
npm ci
npm test
[ ! -f "$HOME/services/homelab-control.env" ] || . "$HOME/services/homelab-control.env"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

Espere a primeira rodada do watchdog e confira `curl http://127.0.0.1:3000/api/network`. As interfaces e permissões podem mudar após reboot ou troca de Wi-Fi; ausência de dado aparece como indisponível. O monitor não modifica configuração de roteador, dispositivos ou serviços.

## Telemetria do dispositivo e interface simplificada

A página inicial separa o resumo dos serviços, Minecraft/Tailscale, Rede e **Telemetria do sistema**. Os diagnósticos mais extensos ficam em painéis expansíveis (Rede avançada e Diagnósticos) para reduzir a poluição visual, sem perder dispositivos, portas, tráfego, logs, histórico e módulos.

O objeto `system` de `GET /api/status` tenta coletar a cada 15 segundos, sem root:

- **CPU geral e por núcleo** a partir de duas amostras de `/proc/stat`, incluindo frequência por núcleo de `/sys/devices/system/cpu/*/cpufreq/scaling_cur_freq` quando legível.
- **RAM disponível, cache, buffers, ativa/inativa, slab, dirty e swap**, por `/proc/meminfo`. A visão geral considera `MemAvailable` quando disponível, em vez de chamar toda a memória em cache de ocupada.
- **Pressão PSI** (`/proc/pressure/{cpu,memory,io}`) com médias de dez segundos, quando o kernel Android fornece a informação.
- **Sensores térmicos** de `/sys/class/thermal/thermal_zone*`, até 32 zonas acessíveis, com temperaturas e tipos originais.
- **Interfaces de rede**, bytes acumulados, pacotes, erros, descartes e taxas por segundo a partir de `/proc/net/dev`. A primeira amostra não calcula taxas.
- **Wi-Fi do Termux:API** (SSID, sinal RSSI, velocidade e frequência quando disponíveis), com consulta a cada dois minutos para poupar bateria. Termux:API e permissão de localização podem ser necessários.
- **Modelo, fabricante, versão Android, SDK, nome do dispositivo**, `getprop` com cache de uma hora, além de kernel, arquitetura, versão Node e quantidade de processos visíveis em `/proc`.

Todas essas fontes estão sujeitas ao sandbox do Android e às permissões do fabricante. `null`, ausência de sensor e mensagem de indisponibilidade significam **sem leitura**, não zero, desligado ou CPU ociosa. A primeira amostra de CPU/fluxo não exibe porcentagem ou taxa inventada. Os coletores têm cache, limites de sensores e sondagens curtas para manter o Galaxy A30 utilizável com o Minecraft de 3 GB.

Auditoria, causas das falhas de teste, correções e validação real no Termux: [relatório de 18/10/2026](docs/validacao-2026-10-18.md).


## Wake-on-LAN do desktop (thiago-pc)

O cartão **Desktop · Wake-on-LAN** na página inicial envia um Magic Packet a partir do Galaxy A30 (Termux), diretamente à LAN do desktop. Não é necessário abrir uma porta UDP no roteador, adicionar outro processo PM2 ou instalar uma dependência Node. O Express permanece em 127.0.0.1, atrás do Cloudflare Access já existente.

### Pré-requisitos

1. Desktop com placa **Ethernet cabeada** conectada à mesma LAN/VLAN do Wi-Fi do Galaxy A30, sem isolamento de clientes/bloqueio de broadcasts. O Tailscale não transporta o broadcast ao PC; é o A30 que o envia na LAN.
2. Na BIOS/UEFI, habilite **Wake on LAN / Power On by PCI-E**; no Windows, habilite **Wake on Magic Packet** na placa Ethernet. Para ligar após desligamento, verifique compatibilidade do hardware, as opções de energia da NIC e Inicialização Rápida.
3. Encontre a MAC da placa **Ethernet física** no Windows, e opcionalmente reserve o IP do desktop no DHCP. Não use a MAC Tailscale.
4. No A30, confira a interface Wi-Fi, normalmente wlan0, com o comando abaixo. O broadcast é calculado a partir do IPv4 local e máscara.

No Windows (PowerShell):

    Get-NetAdapter | Select-Object Name, Status, MacAddress

No Termux:

    ip -br -4 addr
    cd ~/services/homelab
    export WOL_DESKTOP_MAC="MAC-ETHERNET-REAL-DO-PC"
    export WOL_DESKTOP_IP="IPV4-REAL-DO-PC"
    export WOL_INTERFACE="wlan0"
    # Opcional: export WOL_PORT="9"
    pm2 startOrReload ecosystem.config.cjs --update-env
    pm2 save

Substitua os exemplos por valores reais antes de executar. **WOL_DESKTOP_MAC** é obrigatório. **WOL_DESKTOP_IP** é opcional e usado apenas para consultar o estado via ping; ICMP bloqueado resulta em estado não confirmado. **WOL_INTERFACE** padrão: wlan0. **WOL_PORT** padrão: UDP 9. **WOL_BROADCAST** opcional, quando informado, deve ser igual ao broadcast calculado para a interface selecionada. O botão fica desabilitado até que MAC e interface LAN estejam válidos.

Os valores são repassados pelo ecosystem.config.cjs para o processo homelab-status e persistidos por pm2 save, não são gravados no GitHub. Não faça commit de credenciais nem de informações privadas.

### Endpoints e interpretação

| Rota | Resposta |
| --- | --- |
| GET /api/devices/desktop/status | ready, reason, interface e estado (online, unverified ou unknown) |
| POST /api/devices/desktop/wake | HTTP 202 após enviar o pacote UDP broadcast |
| POST repetido em menos de 10 segundos | HTTP 429; envio concorrente: HTTP 409 |

As rotas usam exclusivamente o alvo fixado nas variáveis do servidor, sem aceitar MAC/IP do solicitante. A autenticação permanece na camada **Cloudflare Access**, como o restante do dashboard. Não publique esse endpoint fora do Access.

**HTTP 202 significa Magic Packet enviado, não desktop ligado.** Apenas ping respondido apresenta **Ligado · ping confirmado**. Falha no ping significa **Não foi possível confirmar**; não garante que o desktop esteja desligado. Sem IP configurado o estado permanece desconhecido.

### Teste rápido

    curl -s http://127.0.0.1:3000/api/devices/desktop/status
    curl -i -X POST http://127.0.0.1:3000/api/devices/desktop/wake
    npm test

Teste tanto em suspensão quanto depois de desligamento, pois o comportamento depende do hardware/firmware e alimentação da NIC.

### Atalho Android, IFTTT e Alexa

O cartão funciona remotamente no dashboard protegido pelo Access. É possível criar um atalho Android para o dashboard ou usar HTTP Shortcuts com um POST autenticado. IFTTT Webhooks exigiria integração separada e autenticação específica para serviço (sem expor chaves no frontend); não foi habilitado automaticamente. A Alexa e a skill RemoteRelay também são integrações opcionais futuras.
