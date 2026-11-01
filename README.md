# Vitin7 Finance 3.0.1

Painel financeiro pessoal preto e dourado: salário semanal, vales e descontos, dívidas com pagamentos parciais, metas, receitas e despesas, calendário, relatórios, planejamento de quitação e backup. Backend **Node.js + SQLite nativo** (sem dependências para instalar), frontend e API na **mesma origem**.

> **Sem tela de login (decisão mantida).** Leia a seção [Privacidade](#privacidade-e-acesso) antes de usar dados reais em um endereço público.

## Rodar no seu computador

Requer Node.js 22.13 ou mais novo (a Square Cloud usa Node 24 em `VERSION=recommended`).

```bash
node server.js            # http://localhost:3000, banco em ./data/vitin7.sqlite
npm run check             # verificação de sintaxe
npm test                  # 26 testes automatizados
```

Não existe `npm install`: nenhuma biblioteca externa é usada.

## Painel preso em "Conectando…" / "Carregando seu painel…"

A versão 3.0.1 corrige e diagnostica esse problema. O que mudou e como investigar:

* **Cache antigo (causa mais provável).** `app.js`/`style.css` agora são pedidos com uma versão automática (`?v=<hash>`) gerada a cada deploy, e o `index.html` nunca fica em cache (inclusive no CDN da hospedagem). Antes, JavaScript de uma versão anterior podia rodar com o HTML novo e travar a tela sem mostrar erro.
* **Guardião de inicialização (`public/boot.js`).** Se o `app.js` não executar em 4 s, ele é pedido de novo com URL única; se o painel ainda não iniciar em 12 s, a tela mostra o motivo (arquivo bloqueado, erro de JavaScript ou servidor sem resposta) com botões *Recarregar* e *Testar servidor*.
* **Chamadas à API com limite de tempo.** Leituras têm timeout de 20 s e até 3 tentativas; se a hospedagem devolver uma página que não é JSON, o aviso aparece na hora. Se o servidor cair, o painel tenta de novo sozinho a cada 6 s. Escritas nunca são repetidas (não duplicam lançamentos).
* **Servidor.** Respostas JSON com `Content-Length`, `keepAliveTimeout` de 65 s (o padrão de 5 s do Node fechava conexões que o proxy da hospedagem ainda reaproveitava) e teste real de escrita do modo WAL do SQLite, com volta automática ao modo padrão se o disco não suportar.
* `app.js` é isolado em uma função e não executa duas vezes, então nenhum botão dispara em dobro.

Se ainda travar: abra `/api/health` (deve responder `{"status":"ok",...}`), olhe os logs da Square Cloud e, no navegador, `F12 → Console`.

## Publicar: GitHub → Square Cloud

**Antes de qualquer deploy**: abra o painel atual → *Ajustes → Baixar backup* e guarde o arquivo `.json`. Não consegui confirmar na documentação da Square Cloud se um novo deploy preserva a pasta `/application/data`; o backup é o seu seguro.

1. Crie um repositório no GitHub e envie **o conteúdo desta pasta na raiz** (`server.js` e `squarecloud.app` precisam ficar na raiz). O `.gitignore` já impede o envio de banco, backups e `.env`.
2. Na Square Cloud, crie/edite a aplicação como site Node.js. Sites exigem **plano pago** e **mínimo de 512 MB** (já definido). O `squarecloud.app` contém:
   ```
   DISPLAY_NAME=Vitin7 Finance
   MAIN=server.js
   MEMORY=512
   VERSION=recommended
   SUBDOMAIN=vitin7-finance
   AUTORESTART=true
   ```
   Se o subdomínio estiver ocupado, troque `SUBDOMAIN`. O endereço será `https://<subdominio>.squareweb.app`.
3. Em *Deploy*, conecte o GitHub (integração por webhook ou GitHub App, conforme a documentação deles). Cada push atualiza o app.
4. Variáveis de ambiente: **nenhuma é obrigatória**. Dentro de `/application` o app assume produção, porta 80, host `0.0.0.0` e banco em `/application/data/vitin7.sqlite`. Veja `.env.example` para as opcionais (`ACCESS_KEY`, `DB_PATH`…).
5. Abra `/api/health`. Deve responder `{"status":"ok","database":"connected","schema":3,...}`.
6. Confira nos logs da aplicação as linhas `SQLite: /application/data/vitin7.sqlite` e, se havia banco antigo, `Migração v2→v3 concluída`.

### Se já existe um banco da versão 2.0

Ao iniciar, o app detecta o banco antigo (valores em `REAL`) e: (1) cria um snapshot em `data/backups/pre-migracao-v3-*.sqlite`; (2) converte tudo para centavos inteiros; (3) **mantém as tabelas antigas** renomeadas como `legacy_*`. O banco nunca é apagado nem recriado. Ajustes semanais antigos viram semanas (segunda a domingo). Também é possível restaurar um backup `.json` da versão 2.0 em *Ajustes → Restaurar backup*.

### Dívidas iniciais (R$ 530)

João R$ 50, Augusto R$ 150, Stênio R$ 50, Mercado Pago R$ 80, Nubank R$ 200 são cadastrados **somente se a tabela de dívidas estiver vazia**, e uma única vez. Se já houver dívidas, nada é inserido nem alterado; a página *Dívidas → Conferir cadastro inicial* compara o que está cadastrado com a referência e deixa você adicionar o que faltar.

## Privacidade e acesso

Sem login, **qualquer pessoa com o link pode ver, alterar, baixar o backup e restaurar dados**. Opções, da mais simples à mais forte:

1. **`ACCESS_KEY` (incluída)**: defina a variável `ACCESS_KEY` no painel da Square Cloud. O navegador passa a pedir uma senha única (janela nativa, não é uma tela do app) antes de abrir qualquer página ou API. A janela é do próprio navegador (não testei em todos os celulares). Vazia = acesso aberto. Use com HTTPS (a Square Cloud já serve em HTTPS).
2. **Proteção na frente do domínio**: não encontrei na documentação da Square Cloud nenhum recurso nativo de senha/IP para sites. A documentação descreve domínio próprio (plano Standard ou superior) com DNS pela Cloudflare; nesse cenário a Cloudflare pode proteger o endereço (por exemplo, com Cloudflare Access). **Não testei essa combinação.**
3. Não use dados reais enquanto nenhuma proteção estiver ativa.

O servidor só entrega os 5 arquivos da pasta `public/`. Banco, backups, `.env` e código-fonte não têm URL (há teste automatizado para isso). Escritas na API exigem o cabeçalho `X-Requested-With: vitin7` e recusam requisições de outros sites.

## Como os valores são calculados

* Tudo em **centavos inteiros** no SQLite (sem erro de ponto flutuante).
* **Semana**: `líquido = salário-base + extras − (faltas + feriados não pagos) × diária − descontos`; `falta receber = líquido − vales − recebimentos`. Exemplo: 600 − 100 (feriado) − 6 (Coca-Cola) = 494; o vale de 100 já recebido deixa **R$ 394 a receber**.
* O **vale** entra no saldo uma vez, na data em que foi recebido, e depois só abate o que falta; nunca é despesa. O salário recebido entra uma vez como receita “Salário”.
* Cada semana tem período próprio (sem sobreposição), base e diária próprias: mexer em uma não altera outra. Mudar o salário base em *Ajustes* afeta só semanas novas.
* **Dívidas**: pago = soma dos pagamentos; pagamento acima do saldo é recusado. Pagar gera, por padrão, uma saída “Dívidas” no saldo (desmarque para não lançar). Estornar remove ambos.
* **Metas**: percentual = guardado ÷ valor desejado. Depósitos viram saída “Metas” no saldo; retiradas devolvem.
* Dashboard e relatórios: *Gastos* **não** incluem pagamentos de dívidas nem depósitos em metas (aparecem em linhas próprias), para não contar duas vezes.
* **Planejamento**: dívidas vencidas → vencendo em 7 dias → maior juros/mês → prioridade → vencimento → menor saldo. O valor sugerido é uma % (padrão 40%) do que falta receber; 10% vão para economia e o resto fica para despesas pessoais. Nada é pago automaticamente.

## Backup

* *Ajustes → Baixar backup*: JSON completo (guarde fora do servidor).
* *Restaurar backup*: aceita backups 3.0 e 2.0, salva um snapshot do estado atual antes e desfaz tudo se o arquivo estiver inconsistente.
* Automático: um snapshot por dia e um antes de cada migração/restauração em `data/backups/` (15 mais recentes). Ficam no mesmo disco do banco, então **não substituem** o backup JSON.

## API (resumo)

Escritas (`POST/PUT/DELETE`) exigem o cabeçalho `X-Requested-With: vitin7` e corpo JSON. Valores aceitam `"20"`, `"20,50"` ou `"20.50"` (reais); as respostas usam centavos (`*_cents`).

`GET /api/health` · `GET /api/data` · `GET /api/reports?period=month|week&month=YYYY-MM` · `GET /api/plan?available=` · `GET /api/backup` · `POST /api/restore` · `PUT /api/settings`
`/api/debts[/:id]` · `POST /api/debts/:id/payments` · `DELETE /api/payments/:id`
`/api/goals[/:id]` · `POST /api/goals/:id/moves` · `DELETE /api/goal-moves/:id`
`/api/transactions[/:id]` · `/api/events[/:id]` · `/api/notes[/:id]`
`/api/weeks[/:id]` · `POST /api/weeks/:id/items` · `PUT|DELETE /api/week-items/:id` · `POST /api/weeks/:id/receipts` · `DELETE /api/week-receipts/:id` · `PUT /api/workdays/:data`

## Estrutura

```
server.js            servidor HTTP, arquivos estáticos, segurança
src/config.js        variáveis de ambiente e detecção da Square Cloud
src/db.js            schema, migração 2.0→3.0, snapshots, seed, backup/restauração
src/api.js           regras de negócio e rotas
public/              index.html, style.css, app.js, favicon.svg, manifest
tests/app.test.js    testes automatizados
squarecloud.app      configuração do deploy (site Node.js)
```

## Limitações conhecidas

* Notificações do navegador só aparecem com o app aberto e com permissão explícita (sem push em segundo plano).
* Sem multiusuário, sem integração bancária. Não é software de contabilidade.
* `node:sqlite` ainda é marcado como experimental pelo Node (aparece um aviso no log); a API usada é estável nas versões 22.13+ e 24.
