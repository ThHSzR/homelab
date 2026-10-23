# Biblioteca IA no Galaxy A30 (Termux + PM2)

Protótipo isolado de geração de **suspense criminal original em português brasileiro**, inteiramente no A30, com modelo local GGUF, salvamento por cena, EPUB3 e entrega opcional por e-mail ao Kindle pessoal. Não usa Docker, nuvem de inferência, APIs pagas, banco de dados ou npm externo. Não publica livros no KDP.

**Estado:** código preparado em branch de desenvolvimento. **Não foi instalado nem testado no A30 por este assistente**; o acesso GitHub não equivale a SSH/ADB. Valide primeiro o piloto, sem alterar os serviços existentes.

## Arquitetura e limites

- Android 11 / Termux, Node.js existente, PM2 existente e llama.cpp compilado localmente para ARM64.
- Modelo inicial: Qwen2.5-1.5B-Instruct Q4_K_M oficial (aprox. 1,12 GB em disco, licença Apache 2.0). É um modelo **pequeno**: qualidade literária e coerência de romances longos serão limitadas.
- Contexto limitado inicialmente a 2048 tokens, dois threads de CPU e geração sequencial. É uma escolha conservadora, não um benchmark do Galaxy A30.
- Antes de iniciar, o processo exige MemAvailable de pelo menos 1700 MB (configurável após medir). RAM livre varia; Minecraft deve continuar desligado durante os testes. O modelo e o contexto consomem RAM adicional à do Node.
- O processo verifica a temperatura da bateria pelo Termux:API antes de cada cena e pausa quando chega a 42 °C. Se o sensor estiver indisponível, avisa e usa pausa de 120 s entre cenas; acompanhe a temperatura pelo dashboard. Não execute sem supervisão inicial.
- Cada etapa fica em ~/services/bookforge-data/books/ID. Se houver interrupção, o próximo comando run reutiliza cenas já salvas, sem reiniciar o livro.
- O piloto produz apenas um conto curto (2 capítulos, 1 cena cada). O agendador normal usa 8 capítulos e 2 cenas cada: ainda é uma **novela curta**, não um romance de 300 páginas. Para textos maiores, aumente BOOK_CHAPTERS, BOOK_SCENES_PER_CHAPTER e/ou BOOK_MAX_TOKENS após validar estabilidade.
- O agendador calcula a próxima geração a partir da última conclusão; não interrompe livros longos para obedecer à data.
- Envio ao Kindle vem **desligado** por padrão. Um SMTP que aceitou a mensagem não comprova que a Amazon entregou o arquivo.

## 1. Instalação isolada no A30

No Termux (local ou SSH), **não faça git pull na cópia viva** do dashboard: ela pode conter modificações locais. Faça um clone separado da branch de desenvolvimento:

~~~sh
cd ~/services
git clone --depth 1 --branch feat/a30-bookforge-local \
  https://github.com/ThHSzR/homelab.git bookforge-code
cd ~/services/bookforge-code
bash bookforge/install-a30.sh
node --test bookforge/test/*.test.js
node bookforge/bookforge.js doctor
~~~

O instalador instala clang/cmake/make/curl, compila llama-server com CPU, baixa o GGUF oficial e verifica o cabeçalho. Não inicia serviços nem altera o PM2. **Reserve pelo menos 3 GiB livres** antes do download/compilação. O build no Android pode falhar por versão do compilador ou recursos do aparelho; nesse caso, registre o erro e não force uma atualização global do Termux.

A verificação doctor deve mostrar modelExists=true, serverExists=true, arquitetura arm64 e RAM suficiente. Caso a RAM disponível seja inferior ao limite, **não reduza o limite sem medir**; uma alternativa é experimentar um GGUF Qwen2.5 0.5B mais leve, alterando BOOK_MODEL para seu caminho.

## 2. Piloto: gerar um livro pequeno sem enviar

~~~sh
mkdir -p ~/services/logs
cd ~/services/bookforge-code
pm2 start bookforge/pilot.config.cjs
pm2 logs bookforge-pilot --lines 50
~~~

O piloto é um processo PM2 de execução única, sem autorestart e sem envio. Aguarde a conclusão; no A30 pode levar bastante tempo. Consulte:

~~~sh
node bookforge/bookforge.js status
find ~/services/bookforge-data/books -name livro.epub -type f
pm2 status bookforge-pilot
~~~

Depois de validar o EPUB, limpe apenas o registro temporário do PM2:

~~~sh
pm2 delete bookforge-pilot
~~~

Não apague a pasta de dados: ela contém o histórico e os checkpoints.

## 3. Agendamento recorrente no próprio A30

Somente depois de um piloto bem-sucedido:

~~~sh
cd ~/services/bookforge-code
pm2 start bookforge/ecosystem.config.cjs
pm2 status bookforge-a30
pm2 logs bookforge-a30 --lines 40
~~~

O agendador fica leve em espera, sem manter o modelo na RAM. Por padrão agenda o **próximo** livro para 15 dias depois do primeiro início; não gera imediatamente. Para iniciar um novo livro imediatamente, pare temporariamente o daemon e rode um piloto ou o comando run manual, preferencialmente em uma sessão persistente. **Não execute run em paralelo com o daemon**; existe um lock exclusivo para impedir duplicidade.

Se o PM2 estiver correto e os demais processos do homelab continuarem intactos, execute pm2 save para incluir o novo serviço no Termux:Boot já existente. Não recarregue ecosystem.config.cjs do dashboard.

Para parar:

~~~sh
pm2 stop bookforge-a30
~~~

Se houver falha abrupta e a pasta ~/services/bookforge-data/.run-lock persistir, **confirme primeiro** que não existe worker ou llama-server em execução; só então remova o lock. Nunca remova o lock de uma execução ativa.

## 4. EPUB e Kindle

O EPUB é montado pelo módulo epub.js sem dependências. Para abrir manualmente, use o recurso [Send to Kindle](https://www.amazon.com/sendtokindle) ou transfira o arquivo para o computador. Esse é o caminho recomendado até confirmar a qualidade e a compatibilidade.

Para envio automatizado, você precisará de um remetente de e-mail autorizado nas configurações de documentos pessoais da sua conta Amazon e do endereço Send to Kindle do seu dispositivo. Configure um SMTP local no Termux; por exemplo, usando msmtp:

~~~sh
pkg install msmtp
mkdir -p ~/.config/bookforge
chmod 700 ~/.config/bookforge
# Grave a senha de aplicativo do provedor em ~/.config/bookforge/smtp-password
chmod 600 ~/.config/bookforge/smtp-password
~~~

Exemplo de ~/.msmtprc (substitua os endereços e configure sua senha de aplicativo localmente):

~~~ini
defaults
auth on
tls on
tls_starttls on
account gmail
host smtp.gmail.com
port 587
from remetente@gmail.com
user remetente@gmail.com
passwordeval "cat ~/.config/bookforge/smtp-password"
account default : gmail
~~~

Execute chmod 600 ~/.msmtprc. **Nunca publique** ~/.msmtprc, senhas, endereços Kindle ou dados de livros privados no GitHub.

Primeiro teste o envio manual de um EPUB pronto:

~~~sh
export BOOK_EMAIL_FROM="remetente@gmail.com"
export BOOK_KINDLE_TO="seu-endereco-kindle@kindle.com"
node bookforge/bookforge.js send
~~~

Se o SMTP aceitar, o sistema grava submission.json e não reenvia automaticamente. A Amazon ainda pode rejeitar, exigir confirmação ou demorar para disponibilizar o livro. Falhas de SMTP geram send-error.json e exigem inspeção antes de repetir para evitar duplicatas.

**Somente após validar o teste manual**, habilite BOOK_AUTO_SEND=1 no ambiente privado do PM2 e reinicie **apenas** bookforge-a30 com --update-env. Não adicione credenciais ao arquivo de ecossistema versionado.

## 5. Parâmetros opcionais

| Variável | Padrão | Uso |
| --- | --- | --- |
| BOOK_CHAPTERS | 8 | Quantidade de capítulos para novos livros |
| BOOK_SCENES_PER_CHAPTER | 2 | Cenas por capítulo |
| BOOK_MAX_TOKENS | 650 | Máximo de tokens por cena |
| BOOK_CONTEXT | 2048 | Janela do llama-server |
| BOOK_THREADS | 2 | Threads de CPU |
| BOOK_MIN_AVAILABLE_MB | 1700 | MemAvailable mínimo para carregar modelo |
| BOOK_MAX_BATTERY_C | 42 | Limite de temperatura da bateria |
| BOOK_COOLDOWN_SECONDS | 120 | Descanso entre cenas |
| BOOK_INTERVAL_DAYS | 15 | Intervalo após conclusão |
| BOOK_AUTO_SEND | 0 | Envio automático, 1 para habilitar |
| BOOK_MODEL | caminho padrão | GGUF alternativo |
| BOOK_LLAMA_SERVER | ~/llama.cpp/build/bin/llama-server | Binário alternativo |
| BOOK_DATA_DIR | ~/services/bookforge-data | Dados persistentes |
| BOOK_EMAIL_FROM / BOOK_KINDLE_TO | vazio | Remetente autorizado / Kindle |

Variáveis que mudam a estrutura de um livro só afetam **novos** livros. Livros incompletos mantêm a contagem de capítulos/cenas em book.json. Para diagnosticar:

~~~sh
node bookforge/bookforge.js doctor
node bookforge/bookforge.js status
pm2 logs bookforge-a30 --lines 80
~~~

## Limitações conhecidas

1. Nenhuma medição de tokens/s, pico de RAM, aquecimento ou qualidade foi feita no Galaxy A30. A instalação e a inferência nativa precisam ser validadas no aparelho.
2. A qualidade de um modelo 1.5B em português pode ser insuficiente para um romance comercial. O objetivo inicial é provar geração autônoma de contos/novelas e continuidade básica.
3. A revisão é feita por planejamento e resumos de capítulos; ainda não existe um editor crítico que reescreva todo o livro.
4. O envio SMTP é opcional e não equivale a confirmação de entrega ao Kindle.
5. O processo não interfere nos controles existentes do Minecraft, Tailscale, Bom Dia ou dashboard. Não modifica a configuração principal do PM2.

Referências: [llama.cpp](https://github.com/ggml-org/llama.cpp), [modelo Qwen2.5 1.5B GGUF](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF), [Termux](https://termux.dev/), [PM2](https://pm2.keymetrics.io/docs/usage/quick-start/), [Amazon Send to Kindle](https://www.amazon.com/sendtokindle).
