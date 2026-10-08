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
- endereço e interface Tailscale;
- serviços gerenciados pelo PM2;
- estado do SSH;
- persistência dos serviços após reinicialização;
- módulos existentes e planejados do HomeLab.

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

## Tecnologias

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

Por padrão, a central fica disponível na porta:

```text
3000
```

Dentro da tailnet, basta acessar:

```text
http://IP_TAILSCALE_DO_CELULAR:3000
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

- monitoramento proativo da rede;
- watchdog de serviços;
- monitor de conectividade;
- Wake-on-LAN;
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

O monitor procura processos Java executados com `-jar` no `/proc` do Termux. Quando encontra um candidato identificável, mostra PID, nome do arquivo `.jar`, memória residente (RAM), fração da RAM do dispositivo e uso aproximado de CPU. A CPU precisa de duas leituras para calcular uma taxa; pode passar de 100% em um processo com várias threads. Quando há mais de um processo Java e não é possível escolher um candidato com segurança, o painel não atribui consumo a um servidor específico. A consulta da porta e a seleção do processo são independentes; o painel não afirma que o processo selecionado é necessariamente o dono da porta. O HomeLab não lê nem expõe argumentos completos da linha de comando.

Para usar uma porta diferente, altere `MINECRAFT_PORT` no `env` do `homelab-watchdog` em `ecosystem.config.cjs`, rode `pm2 startOrReload ecosystem.config.cjs --update-env` e `pm2 save`. Em seguida, consulte `/api/health` e procure `services.minecraft`. Em computadores sem `/proc` acessível, o status da porta continua disponível, mas o consumo do processo não aparece. O HomeLab apenas observa o Minecraft; não inicia nem reinicia o servidor.

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
