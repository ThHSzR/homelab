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