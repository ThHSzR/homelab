# Base do cluster A30 + A10s

Estado em 24/10/2026: cluster de dois nós operacional. A30 coordena as filas e executa um worker; A10s executa outro worker ARM32. Ambos concluíram tarefas reais de diagnóstico e SHA-256. Root do A10s não foi concluído: as imagens modificadas foram rejeitadas e o aparelho voltou ao firmware original funcional.

No A30, o diretório é `~/services/homelab-cluster`:

```sh
cd ~/services/homelab-cluster
.venv/bin/python cluster.py status
.venv/bin/python cluster.py submit health --node a30 --wait 20
.venv/bin/python cluster.py submit hash --node general --argument exemplo --wait 20
.venv/bin/python cluster.py submit services --node a30 --wait 20
.venv/bin/python cluster.py result ID
```

As filas `a30` e `a10s` direcionam o trabalho ao aparelho correspondente. `general` é compartilhada. Cada worker executa uma tarefa por vez, em processo filho, com prioridade nice +10 e timeout de 30 segundos para os jobs atualmente expostos. Os resultados ficam por um dia e falhas por sete dias. O serializador é JSON; não há API HTTP pública nem necessidade de expor Redis na LAN.

`health` coleta arquitetura, memória disponível e disco. `hash` calcula SHA-256 de até 64 KiB de texto. `services` retorna somente nomes, estados, PIDs e memória dos processos PM2. `probe` aceita apenas serviços que o proprietário registrar no mapa `services` do arquivo privado `cluster.json`. Funções novas devem ser adicionadas explicitamente em `tasks.py` e no mapa `TASKS` de `cluster.py`, nos dois nós.

O Redis mantém os jobs em AOF com sincronização a cada segundo. Há possibilidade de perda do último segundo em desligamento abrupto. É um único coordenador; se o A30 estiver indisponível, não haverá distribuição de novas tarefas. O limite de memória de 64 MiB usa `noeviction`: ao atingir o limite, novas gravações falham em vez de expulsar jobs silenciosamente. Não há garantia de execução exatamente uma vez; tarefas futuras que tenham efeitos externos precisam tratar retomadas e duplicidade.

As credenciais ficam em `cluster.json` e `redis.conf`, ambos modo 600. Não copiar esses arquivos para repositórios ou logs. O A10s acessa o Redis por túnel SSH ao A30, com identidade própria, host key fixada e chave autorizada somente para encaminhar a porta do broker. O transporte atual tem `master.transport: "tailscale"` e usa o CLI userspace local como ProxyCommand. As duas identidades userspace foram autenticadas e validadas; a VPN Android também está configurada.

`boot.py` inicia somente os processos deste componente e é chamado por `95-homelab-cluster`, no Termux:Boot. Não executar `pm2 save` sobre o dump compartilhado. A inicialização foi testada manualmente; um reboot real ainda não foi validado.

Para interromper apenas a base nova no A30:

```sh
pm2 stop homelab-cluster-worker homelab-cluster-redis
```

Para iniciar novamente:

```sh
cd ~/services/homelab-cluster
.venv/bin/python boot.py
```

Esta base não compartilha memória entre os aparelhos e não altera o Kindle Writer existente. Distribuir geração de IA exigirá uma integração específica com seu estado e seus checkpoints. Os jobs atuais fornecem uma base para tarefas gerais e inspeção de serviços.

Documentação dos componentes: https://python-rq.org/docs/ e https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/.
