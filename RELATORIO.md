# Relatório — Vitin7 Finance 2.0 → 3.0

## 1. O que descobri no projeto enviado

**Importante:** rodei o projeto original no navegador (Chromium) e, localmente, adicionar dívida e pagar R$ 20 funcionaram. Ou seja, **não consegui reproduzir os botões quebrados em ambiente local**; o defeito que você viu é de ambiente. A causa mais provável, e a que corrigi, está no primeiro item.

| # | Problema encontrado | Gravidade | Correção |
|---|---|---|---|
| 1 | Toda escrita (POST/PUT/DELETE) era recusada se o `Origin` não fosse idêntico ao `Host`. Atrás do proxy da hospedagem isso pode falhar: o painel abre e lista (GET) mas **nenhum botão salva** | Provável causa do sintoma | Proteção CSRF independente do `Host` (`Sec-Fetch-Site` + cabeçalho `X-Requested-With`). Teste automatizado cobre Host/Origin diferentes |
| 2 | `.env` nunca era lido. Sem `NODE_ENV=production` no painel, o app escutava na porta 3000 (Square Cloud exige 80) e gravava o banco em caminho relativo, fora do volume persistente | Alta | `src/config.js` detecta `/application`, assume porta 80, host `0.0.0.0` e `/application/data/vitin7.sqlite`; lê `.env` se existir |
| 3 | Dinheiro em `REAL` (ponto flutuante) | Alta | Centavos inteiros (`*_cents`), validação estrita, migração automática |
| 4 | Vale tratado como desconto comum, sem data de pagamento, dias trabalhados, status, valor recebido/restante, nem entrada no caixa | Alta | Módulo de semana novo (seção 3). Exemplo do R$ 394 coberto por teste |
| 5 | Dívidas iniciais (R$ 530) nunca eram cadastradas | Média | Seed seguro (só em tabela vazia, uma vez) + painel de conferência |
| 6 | Faltavam dashboard completo, planejamento, relatório semanal, estorno de pagamento, retirada de meta, eventos concluídos, notificações | Média | Implementados |
| 7 | Arquivos estáticos com `max-age=300`: após deploy o navegador podia ficar 5 min com JS antigo | Baixa | `no-cache` + ETag |
| 8 | Sem proteção contra duplo clique/duplicação; pagamentos não podiam ser desfeitos | Média | Recusa de registro idêntico em 3 s; estorno que desfaz também o lançamento de caixa |
| 9 | Pasta do banco sem permissão derrubava o app sem explicação | Baixa | Erro claro nos logs, sem apagar nada |

Bugs que **meu próprio código** teve e os testes pegaram (corrigidos): ouvintes do modal se acumulavam entre diálogos (erros JS); erros de validação vindos do banco viravam HTTP 500 em vez de 400.

## 2. Decisões que você deve conhecer

* **Express não foi usado.** Mantive o servidor nativo do Node: o ambiente de testes não tinha acesso à internet para instalar/validar pacotes, e assim o deploy não tem `npm install` nem módulos nativos para compilar. Continua sendo um backend web Node.js servindo API e frontend na mesma origem, escutando `0.0.0.0:80`.
* **Sem login mantido.** Adicionei `ACCESS_KEY` opcional (desligada por padrão) como senha única do navegador. Não encontrei recurso nativo de restrição de acesso na Square Cloud. Detalhes no README.
* O banco antigo **não é apagado**: migração com snapshot prévio e tabelas `legacy_*` mantidas.

## 3. Testes executados (nesta sessão)

**Automatizados (`npm test`): 25/25** — inicialização e criação do SQLite; health; arquivos sensíveis não expostos (11 caminhos, incluindo `..%2F`); CSRF; `ACCESS_KEY`; seed de R$ 530 sem duplicar; seed ignorado com dívidas existentes; pagamento parcial R$ 20 de R$ 50 → R$ 30; recusa de excesso/negativo/zero/texto; edição, estorno e exclusão; centavos sem erro de float; meta R$ 300 de R$ 2.000 = 15%; retirada acima do guardado; **semana R$ 394** (vale sem virar despesa, caixa final R$ 494 sem duplicar); recebimento parcial; semanas independentes e sobreposição bloqueada; relatórios por mês e semana; planejamento (ordem, soma ≤ orçamento, < 100% do salário); backup/restauração com snapshot e rollback; **migração de um banco 2.0 simulado** (valores, histórico, tabelas legacy, semanas convertidas, não migra duas vezes); restauração de JSON 2.0; reinício sem perda.

**Navegador real (Chromium), 31/31:** cada fluxo clicado pela interface — dívidas (criar/editar/excluir/pagar/bloqueio de excesso/histórico), metas e depósito (15%), receitas e despesas (criar/editar), semana de exemplo (R$ 394,00 na tela), recebimento (sugere R$ 394,00; entradas “Salário” e “Vale” aparecem uma vez), calendário (criar/editar), anotações, ajustes, planejamento, relatórios, **recarregar a página (F5) mantém tudo**, download de backup e restauração por arquivo.

**Celular (390 px, toque):** 0 px de rolagem lateral nas 10 páginas, menu inferior e “Mais”, formulário de pagamento com cálculo ao vivo, sem erros JS.

**Reinício real do processo** (encerrar e subir de novo): dívidas, pagamentos, semana, meta e saldos idênticos; dívidas iniciais não duplicadas.

## 4. O que NÃO foi verificado

* **Deploy real na Square Cloud.** Configuração baseada na documentação (porta 80, host `0.0.0.0`, `MEMORY` ≥ 512, `VERSION=recommended` = Node 24.x), mas não publiquei.
* **Node 24.** Testei em Node 22.22.2. O SQLite nativo existe sem flags em ambos, mas não rodei a suíte em 24.
* **Persistência de `/application/data` entre deploys** na Square Cloud: não confirmei na documentação. Baixe o backup JSON antes de cada deploy.
* **Notificações do navegador:** o código só pede permissão com clique seu e avisa com o app aberto; não testei a permissão em navegador real nem em celular.
* **`ACCESS_KEY`** testado por requisições HTTP, não em navegador de celular. **Cloudflare Access** não testado.
* Migração testada com banco **simulado** da 2.0 criado a partir do schema do seu código; não vi seu banco real.
* Meu teste de proxy simula `Host`/`Origin` diferentes por cabeçalhos; não reproduz a infraestrutura real da hospedagem.


---

# Atualização 3.0.1 — painel preso em "Conectando…"

**Sintoma:** HTML novo na tela, barra lateral vazia, "Conectando…" e "Carregando seu painel…" para sempre.
**Diagnóstico:** o projeto roda corretamente em ambiente local (26 testes, 10 páginas em desktop e celular, sem erros de JavaScript). O defeito só aparece na hospedagem, e o padrão (HTML v3 + nada montado) indica JavaScript antigo/em cache ou requisição pendente sem tempo-limite. Não consegui acessar a Square Cloud, então **não confirmei qual dessas foi a causa real**; por isso a correção cobre todas e, se algo falhar, a tela agora mostra o motivo.

| Correção | Arquivo |
|---|---|
| URLs versionadas por hash a cada deploy + `index.html` sem cache (também no CDN) | `server.js`, `public/index.html` |
| Guardião de inicialização com recarga de emergência e mensagem de erro visível | `public/boot.js` (novo) |
| Timeout 20 s, até 3 tentativas em leituras, validação de resposta não-JSON, nova tentativa automática | `public/app.js` |
| `app.js` isolado em IIFE e idempotente (sem colisão de globais, sem ouvintes duplicados) | `public/app.js` |
| `Content-Length` nas respostas JSON, keep-alive compatível com proxy, `/favicon.ico` | `server.js` |
| Sonda real de escrita no modo WAL com fallback | `src/db.js` |
| Logs de erros não tratados | `server.js` |

**Não alterado:** regras de negócio, cálculos, schema do banco, migração, rotas, backup/restauração e todos os dados.
