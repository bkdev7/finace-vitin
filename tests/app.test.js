'use strict';
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../server.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v7-test-'));
const dbFile = (n) => path.join(tmpRoot, n, 'vitin7.sqlite');
const opened = [];
async function start(name, opts = {}) {
  const app = createApp({ dbPath: dbFile(name), seed: opts.seed ?? false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const root = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (url, method = 'GET', body, headers = {}) => {
    const r = await fetch(root + url, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'vitin7', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; const t = await r.text(); try { data = JSON.parse(t); } catch { data = t; }
    return { status: r.status, data, res: r };
  };
  const stop = () => new Promise((r) => app.server.close(() => { try { app.db.close(); } catch { /* já fechado */ } r(); }));
  opened.push(stop);
  return { ...app, root, call, stop };
}
after(async () => { for (const stop of opened) await stop(); fs.rmSync(tmpRoot, { recursive: true, force: true }); });

describe('inicialização e segurança', () => {
  test('cria pasta/tabelas, responde health e serve o painel sem login', async () => {
    const a = await start('init');
    assert.ok(fs.existsSync(dbFile('init')));
    const h = await a.call('/api/health');
    assert.equal(h.status, 200); assert.equal(h.data.database, 'connected'); assert.equal(h.data.schema, 3);
    const page = await fetch(a.root + '/'); assert.equal(page.status, 200); assert.match(await page.text(), /Vitin7 Finance/);
    await a.stop();
  });
  test('não expõe banco, backups, código-fonte nem .env', async () => {
    const a = await start('sec');
    for (const p of ['/vitin7.sqlite', '/data/vitin7.sqlite', '/backups/', '/server.js', '/src/db.js', '/.env', '/package.json', '/..%2Fserver.js', '/%2e%2e/server.js', '/public/../server.js']) {
      const r = await fetch(a.root + p); assert.ok([404, 400].includes(r.status), `${p} -> ${r.status}`);
      assert.doesNotMatch(await r.text(), /DatabaseSync|SQLite format/);
    }
    assert.equal((await fetch(a.root + '/app.js')).status, 200);
    await a.stop();
  });
  test('index versionado (anti-cache), sem cache e arquivos auxiliares servidos', async () => {
    const a = await start('build');
    const page = await fetch(a.root + '/'); const html = await page.text();
    assert.doesNotMatch(html, /__V__/, 'token de versão substituído');
    assert.match(html, /\/app\.js\?v=[0-9a-f]{10}/); assert.match(html, /\/style\.css\?v=[0-9a-f]{10}/); assert.match(html, /\/boot\.js\?v=[0-9a-f]{10}/);
    assert.match(page.headers.get('cache-control'), /no-store/);
    for (const p of ['/app.js?v=abc', '/boot.js', '/style.css?v=abc', '/favicon.ico', '/index.html']) assert.equal((await fetch(a.root + p)).status, 200, p);
    const h = await a.call('/api/health'); assert.ok(h.res.headers.get('content-length'), 'JSON com Content-Length');
    await a.stop();
  });
  test('rejeita origem externa em escrita e rotas/métodos inexistentes', async () => {
    const a = await start('origin');
    assert.equal((await a.call('/api/notes', 'POST', { title: 'x' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await a.call('/api/notes', 'POST', { title: 'x' }, { 'sec-fetch-site': 'same-site' })).status, 403);
    assert.equal((await a.call('/api/notes', 'POST', { title: 'x' }, { 'x-requested-with': '' })).status, 403, 'sem o cabeçalho customizado');
    // Host diferente (proxy da hospedagem) NÃO pode bloquear o salvamento
    assert.equal((await a.call('/api/notes', 'POST', { title: 'via proxy' }, { host: 'meu-app.squareweb.app', origin: 'https://meu-app.squareweb.app', 'sec-fetch-site': 'same-origin' })).status, 201);
    assert.equal((await a.call('/api/nada')).status, 404);
    assert.equal((await a.call('/api/debts', 'DELETE')).status, 405);
    await a.stop();
  });
  test('ACCESS_KEY opcional protege com senha do navegador (health continua aberto)', async () => {
    process.env.ACCESS_KEY = 'segredo123';
    delete require.cache[require.resolve('../src/config')]; delete require.cache[require.resolve('../server.js')];
    const { createApp: create2 } = require('../server.js');
    const app = create2({ dbPath: dbFile('auth'), seed: false });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    const root = 'http://127.0.0.1:' + app.server.address().port;
    assert.equal((await fetch(root + '/api/data')).status, 401);
    assert.equal((await fetch(root + '/')).status, 401);
    const bad = 'Basic ' + Buffer.from('v:errada').toString('base64'), good = 'Basic ' + Buffer.from('v:segredo123').toString('base64');
    assert.equal((await fetch(root + '/api/data', { headers: { authorization: bad } })).status, 401);
    assert.equal((await fetch(root + '/api/data', { headers: { authorization: good } })).status, 200);
    assert.equal((await fetch(root + '/api/health')).status, 200);
    await new Promise((r) => app.server.close(r)); app.db.close();
    delete process.env.ACCESS_KEY;
    delete require.cache[require.resolve('../src/config')]; delete require.cache[require.resolve('../server.js')];
  });
});

describe('dívidas', () => {
  test('cadastro inicial: insere R$ 530 uma única vez e não duplica ao reiniciar', async () => {
    let a = await start('seed', { seed: true });
    let d = (await a.call('/api/data')).data;
    assert.deepEqual(d.debts.map(x => [x.name, x.total_cents]), [['João', 5000], ['Augusto', 15000], ['Stênio', 5000], ['Mercado Pago', 8000], ['Nubank', 20000]]);
    assert.equal(d.dashboard.debts_pending_cents, 53000);
    await a.stop();
    a = await start('seed', { seed: true });
    d = (await a.call('/api/data')).data; assert.equal(d.debts.length, 5);
    await a.stop();
  });
  test('banco com dívidas existentes: nada é inserido nem alterado', async () => {
    let a = await start('seed2', { seed: false });
    await a.call('/api/debts', 'POST', { name: 'João', total: '77,70' });
    await a.stop();
    a = await start('seed2', { seed: true });
    const d = (await a.call('/api/data')).data;
    assert.equal(d.debts.length, 1); assert.equal(d.debts[0].total_cents, 7770);
    await a.stop();
  });
  test('pagamento parcial R$ 20 de R$ 50 deixa R$ 30; bloqueia excesso, valores inválidos e quitado', async () => {
    const a = await start('debts');
    const id = (await a.call('/api/debts', 'POST', { name: 'João', total: '50', due_date: '2026-11-30' })).data.id;
    assert.equal((await a.call(`/api/debts/${id}/payments`, 'POST', { amount: '20', date: '2026-11-01' })).status, 201);
    let d = (await a.call('/api/data')).data.debts[0];
    assert.equal(d.paid_cents, 2000); assert.equal(d.remaining_cents, 3000); assert.equal(d.percent, 40);
    assert.equal((await a.call(`/api/debts/${id}/payments`, 'POST', { amount: '30,01' })).status, 400);
    for (const bad of ['-5', '0', 'abc', '', '1.234', null, 1e21]) assert.equal((await a.call(`/api/debts/${id}/payments`, 'POST', { amount: bad })).status, 400, 'valor ' + bad);
    assert.equal((await a.call(`/api/debts/${id}/payments`, 'POST', { amount: '30', date: '2026-11-02' })).status, 201);
    d = (await a.call('/api/data')).data.debts[0]; assert.equal(d.status, 'quitada');
    assert.equal((await a.call(`/api/debts/${id}/payments`, 'POST', { amount: '1', date: '2026-11-03' })).status, 409);
    await a.stop();
  });
  test('editar, impedir total menor que o pago, estornar e excluir', async () => {
    const a = await start('debts2');
    const id = (await a.call('/api/debts', 'POST', { name: 'Augusto', total: '150' })).data.id;
    const pid = (await a.call(`/api/debts/${id}/payments`, 'POST', { amount: '100', date: '2026-11-01' })).data.id;
    assert.equal((await a.call(`/api/debts/${id}`, 'PUT', { name: 'Augusto', total: '90' })).status, 400);
    assert.equal((await a.call(`/api/debts/${id}`, 'PUT', { name: 'Augusto S.', total: '160', due_date: '2026-12-01', priority: 1, interest: '2,5', description: 'empréstimo' })).status, 200);
    let d = (await a.call('/api/data')).data; assert.equal(d.debts[0].total_cents, 16000); assert.equal(d.debts[0].interest_bp, 250);
    assert.equal(d.dashboard.balance_cents, -10000); // pagamento gerou saída no caixa
    assert.equal((await a.call('/api/payments/' + pid, 'DELETE')).status, 200);
    d = (await a.call('/api/data')).data; assert.equal(d.debts[0].paid_cents, 0); assert.equal(d.dashboard.balance_cents, 0);
    assert.equal((await a.call('/api/debts/' + id, 'DELETE')).status, 200);
    assert.equal((await a.call('/api/debts/' + id, 'DELETE')).status, 404);
    await a.stop();
  });
  test('duplo clique: registro idêntico em poucos segundos é recusado', async () => {
    const a = await start('dup');
    const id = (await a.call('/api/debts', 'POST', { name: 'X', total: '100' })).data.id;
    assert.equal((await a.call(`/api/debts/${id}/payments`, 'POST', { amount: '10', date: '2026-11-01' })).status, 201);
    assert.equal((await a.call(`/api/debts/${id}/payments`, 'POST', { amount: '10', date: '2026-11-01' })).status, 409);
    assert.equal((await a.call('/api/debts', 'POST', { name: 'X', total: '100' })).status, 409);
    await a.stop();
  });
  test('valores são guardados em centavos inteiros sem erro de ponto flutuante', async () => {
    const a = await start('cents');
    await a.call('/api/debts', 'POST', { name: 'Float', total: '0,30' });
    await a.call('/api/transactions', 'POST', { kind: 'entrada', description: 'a', amount: '0.1', date: '2026-11-01' });
    await a.call('/api/transactions', 'POST', { kind: 'entrada', description: 'b', amount: '0.2', date: '2026-11-01' });
    const d = (await a.call('/api/data')).data;
    assert.equal(d.debts[0].total_cents, 30); assert.equal(d.dashboard.balance_cents, 30);
    assert.equal(a.db.prepare("SELECT typeof(total_cents) t FROM debts").get().t, 'integer');
    await a.stop();
  });
});

describe('metas', () => {
  test('R$ 300 de R$ 2.000 = 15%; retirada limitada ao guardado; histórico e exclusão', async () => {
    const a = await start('goals');
    const g = (await a.call('/api/goals', 'POST', { name: 'Moto', target: '2000', deadline: '2027-03-01' })).data.id;
    assert.equal((await a.call(`/api/goals/${g}/moves`, 'POST', { kind: 'deposito', amount: '300', date: '2026-11-01' })).status, 201);
    let d = (await a.call('/api/data')).data;
    assert.equal(d.goals[0].percent, 15); assert.equal(d.goals[0].saved_cents, 30000); assert.equal(d.dashboard.saved_total_cents, 30000);
    assert.equal((await a.call(`/api/goals/${g}/moves`, 'POST', { kind: 'retirada', amount: '300,01' })).status, 400);
    const r = await a.call(`/api/goals/${g}/moves`, 'POST', { kind: 'retirada', amount: '100', date: '2026-11-02' });
    d = (await a.call('/api/data')).data; assert.equal(d.goals[0].percent, 10);
    assert.equal(d.goal_moves.length, 2);
    // depósito dependente de retirada não pode ser apagado
    const dep = d.goal_moves.find(m => m.kind === 'deposito');
    assert.equal((await a.call('/api/goal-moves/' + dep.id, 'DELETE')).status, 409, 'depósito sustenta uma retirada');
    const ret = d.goal_moves.find(m => m.kind === 'retirada');
    assert.equal((await a.call('/api/goal-moves/' + ret.id, 'DELETE')).status, 200);
    assert.equal((await a.call('/api/goal-moves/' + dep.id, 'DELETE')).status, 200);
    assert.equal((await a.call('/api/data')).data.goals[0].saved_cents, 0);
    await a.stop(); void r;
  });
  test('depósito e retirada refletem no caixa sem contar como gasto/receita', async () => {
    const a = await start('goals2');
    const g = (await a.call('/api/goals', 'POST', { name: 'Reserva', target: '1000' })).data.id;
    await a.call('/api/transactions', 'POST', { kind: 'entrada', description: 'Salário', amount: '500', date: '2026-11-01' });
    await a.call(`/api/goals/${g}/moves`, 'POST', { kind: 'deposito', amount: '200', date: '2026-11-02' });
    const d = (await a.call('/api/data')).data.dashboard;
    assert.equal(d.balance_cents, 30000); assert.equal(d.month_spent_cents, 0); assert.equal(d.month_saved_cents, 20000);
    assert.equal((await a.call('/api/goals/' + g, 'DELETE')).status, 200);
    assert.equal((await a.call('/api/data')).data.dashboard.balance_cents, 50000);
    await a.stop();
  });
});

describe('semana de pagamento', () => {
  async function exemplo(a) {
    const w = (await a.call('/api/weeks', 'POST', { pay_date: '2026-11-07', period_start: '2026-11-02', period_end: '2026-11-07' })).data.id;
    await a.call('/api/workdays/2026-11-02', 'PUT', { status: 'feriado' });
    await a.call(`/api/weeks/${w}/items`, 'POST', { kind: 'vale', description: 'Vale terça', amount: '100', date: '2026-11-03' });
    await a.call(`/api/weeks/${w}/items`, 'POST', { kind: 'desconto', description: 'Coca-Cola', amount: '6', date: '2026-11-04' });
    return w;
  }
  test('exemplo do usuário: 600 − 100 − 100 (vale) − 6 = R$ 394 a receber', async () => {
    const a = await start('week');
    const w = await exemplo(a);
    const s = (await a.call('/api/data')).data.weeks[0];
    assert.equal(s.base_cents, 60000); assert.equal(s.absence_cents, 10000); assert.equal(s.gross_cents, 50000);
    assert.equal(s.descontos_cents, 600); assert.equal(s.net_cents, 49400); assert.equal(s.vales_cents, 10000);
    assert.equal(s.remaining_cents, 39400); assert.equal(s.status, 'parcial');
    // vale entra no caixa uma vez (adiantamento), sem virar despesa
    let dash = (await a.call('/api/data')).data.dashboard;
    assert.equal(dash.balance_cents, 10000); assert.equal(dash.month_spent_cents, 0);
    // receber o restante
    assert.equal((await a.call(`/api/weeks/${w}/receipts`, 'POST', { date: '2026-11-07' })).status, 201);
    const s2 = (await a.call('/api/data')).data; assert.equal(s2.weeks[0].remaining_cents, 0); assert.equal(s2.weeks[0].status, 'recebido');
    assert.equal(s2.dashboard.balance_cents, 49400); assert.equal(s2.dashboard.month_income_cents, 49400); assert.equal(s2.dashboard.month_spent_cents, 0);
    assert.equal((await a.call(`/api/weeks/${w}/receipts`, 'POST', { amount: '1', date: '2026-11-08' })).status, 400, 'semana já recebida não aceita novo recebimento');
    await a.stop();
  });
  test('recebimento parcial, bloqueio acima do restante, exclusão devolve o saldo', async () => {
    const a = await start('week2');
    const w = await exemplo(a);
    assert.equal((await a.call(`/api/weeks/${w}/receipts`, 'POST', { amount: '394,01', date: '2026-11-07' })).status, 400);
    const r = (await a.call(`/api/weeks/${w}/receipts`, 'POST', { amount: '200', date: '2026-11-07' })).data.id;
    assert.equal((await a.call('/api/data')).data.weeks[0].remaining_cents, 19400);
    assert.equal((await a.call('/api/week-receipts/' + r, 'DELETE')).status, 200);
    const d = (await a.call('/api/data')).data; assert.equal(d.weeks[0].remaining_cents, 39400); assert.equal(d.dashboard.balance_cents, 10000);
    await a.stop();
  });
  test('uma semana não altera outra; períodos sobrepostos e datas repetidas são bloqueados', async () => {
    const a = await start('week3');
    await exemplo(a);
    const w2 = (await a.call('/api/weeks', 'POST', { pay_date: '2026-11-14', period_start: '2026-11-09', period_end: '2026-11-14' })).data.id;
    const s = (await a.call('/api/data')).data.weeks;
    assert.equal(s.find(x => x.id === w2).net_cents, 60000); assert.equal(s.find(x => x.pay_date === '2026-11-07').net_cents, 49400);
    assert.equal((await a.call('/api/weeks', 'POST', { pay_date: '2026-11-08', period_start: '2026-11-06', period_end: '2026-11-08' })).status, 409);
    assert.equal((await a.call('/api/weeks', 'POST', { pay_date: '2026-11-14', period_start: '2026-11-20', period_end: '2026-11-21' })).status, 409);
    // mudar o salário base não altera semanas já criadas
    await a.call('/api/settings', 'PUT', { weekly_base: '700' });
    assert.equal((await a.call('/api/data')).data.weeks.find(x => x.id === w2).base_cents, 60000);
    await a.stop();
  });
  test('excluir semana remove vales/recebimentos e os lançamentos de caixa ligados', async () => {
    const a = await start('week4');
    const w = await exemplo(a);
    await a.call(`/api/weeks/${w}/receipts`, 'POST', { amount: '50', date: '2026-11-07' });
    assert.equal((await a.call('/api/weeks/' + w, 'DELETE')).status, 200);
    const d = (await a.call('/api/data')).data; assert.equal(d.weeks.length, 0); assert.equal(d.dashboard.balance_cents, 0); assert.equal(d.transactions.length, 0);
    await a.stop();
  });
  test('vale sem lançar no caixa; editar vale ressincroniza; status de dia inválido é recusado', async () => {
    const a = await start('week5');
    const w = (await a.call('/api/weeks', 'POST', { pay_date: '2026-11-07', period_start: '2026-11-02', period_end: '2026-11-07' })).data.id;
    const i = (await a.call(`/api/weeks/${w}/items`, 'POST', { kind: 'vale', description: 'v', amount: '100', date: '2026-11-03', register_cash: false })).data.id;
    assert.equal((await a.call('/api/data')).data.dashboard.balance_cents, 0);
    await a.call('/api/week-items/' + i, 'PUT', { kind: 'vale', description: 'v', amount: '80', date: '2026-11-03', register_cash: true });
    assert.equal((await a.call('/api/data')).data.dashboard.balance_cents, 8000);
    assert.equal((await a.call('/api/workdays/2026-11-02', 'PUT', { status: 'xyz' })).status, 400);
    assert.equal((await a.call('/api/workdays/2026-02-31', 'PUT', { status: 'falta' })).status, 400);
    await a.stop();
  });
});

describe('movimentações, calendário, notas, configurações, relatórios, plano', () => {
  test('CRUD de movimentações; automáticas não podem ser editadas à mão', async () => {
    const a = await start('tx');
    const t = (await a.call('/api/transactions', 'POST', { kind: 'saida', category: 'Alimentação', description: 'Mercado', amount: '25,90', date: '2026-11-01' })).data.id;
    assert.equal((await a.call('/api/transactions/' + t, 'PUT', { kind: 'saida', category: 'Alimentação', description: 'Mercado', amount: '30', date: '2026-11-01' })).status, 200);
    for (const bad of [{ kind: 'x', description: 'a', amount: '1', date: '2026-11-01' }, { kind: 'saida', description: 'a', amount: '-1', date: '2026-11-01' }, { kind: 'saida', description: 'a', amount: '1', date: '2026-02-31' }, { kind: 'saida', description: '', amount: '1', date: '2026-11-01' }]) assert.equal((await a.call('/api/transactions', 'POST', bad)).status, 400);
    const id = (await a.call('/api/debts', 'POST', { name: 'D', total: '10' })).data.id;
    await a.call(`/api/debts/${id}/payments`, 'POST', { amount: '5', date: '2026-11-01' });
    const auto = (await a.call('/api/data')).data.transactions.find(x => x.source === 'debt_payment');
    assert.equal((await a.call('/api/transactions/' + auto.id, 'DELETE')).status, 409);
    assert.equal((await a.call('/api/transactions/' + t, 'DELETE')).status, 200);
    await a.stop();
  });
  test('eventos: criar, editar, concluir, excluir; notas; configurações', async () => {
    const a = await start('misc');
    const e = (await a.call('/api/events', 'POST', { title: 'Pagar luz', date: '2026-11-20', type: 'conta', amount: '80' })).data.id;
    assert.equal((await a.call('/api/events/' + e, 'PUT', { title: 'Pagar luz', date: '2026-11-21', type: 'conta', amount: '85', done: true })).status, 200);
    let ev = (await a.call('/api/data')).data.events[0]; assert.equal(ev.amount_cents, 8500); assert.equal(ev.done, 1);
    assert.equal((await a.call('/api/events', 'POST', { title: 't', date: '2026-11-01', type: 'random' })).status, 400);
    assert.equal((await a.call('/api/events/' + e, 'DELETE')).status, 200);
    const n = (await a.call('/api/notes', 'POST', { title: 'Plano', body: 'Quitar Nubank' })).data.id;
    assert.equal((await a.call('/api/notes/' + n, 'PUT', { title: 'Plano 2', body: 'x' })).status, 200);
    assert.equal((await a.call('/api/notes/' + n, 'DELETE')).status, 200);
    assert.equal((await a.call('/api/settings', 'PUT', { weekly_base: '650', daily_rate: '110', debt_pct: 50, save_pct: 20, alert_days: 5 })).status, 200);
    const s = (await a.call('/api/data')).data.settings; assert.equal(s.weekly_base_cents, 65000); assert.equal(s.daily_rate_cents, 11000); assert.equal(s.debt_pct, 50);
    assert.equal((await a.call('/api/settings', 'PUT', { debt_pct: 80, save_pct: 30 })).status, 400);
    assert.equal((await a.call('/api/settings', 'PUT', { weekly_base: '-1' })).status, 400);
    await a.stop();
  });
  test('relatórios por mês/semana e planejamento sem comprometer 100% do salário', async () => {
    const a = await start('rep');
    const today = (await a.call('/api/data')).data.today, m = today.slice(0, 7);
    await a.call('/api/transactions', 'POST', { kind: 'entrada', description: 'Bico', amount: '300', date: today });
    await a.call('/api/transactions', 'POST', { kind: 'saida', category: 'Lazer', description: 'Cinema', amount: '40', date: today });
    const d1 = (await a.call('/api/debts', 'POST', { name: 'Vencida', total: '100', due_date: '2020-01-01' })).data.id;
    await a.call('/api/debts', 'POST', { name: 'Com juros', total: '300', interest: '10', due_date: '2099-01-01' });
    await a.call('/api/debts', 'POST', { name: 'Pequena', total: '20' });
    await a.call(`/api/debts/${d1}/payments`, 'POST', { amount: '30', date: today });
    const rm = (await a.call(`/api/reports?period=month&month=${m}`)).data;
    assert.equal(rm.selected.income_cents, 30000); assert.equal(rm.selected.spent_cents, 4000); assert.equal(rm.selected.debt_paid_cents, 3000);
    assert.deepEqual(rm.categories, [{ name: 'Lazer', cents: 4000 }]);
    const rw = (await a.call('/api/reports?period=week')).data; assert.equal(rw.rows.length, 8);
    assert.equal(rw.rows.reduce((x, r) => x + r.income_cents, 0), 30000);
    const p = (await a.call('/api/plan')).data;
    assert.equal(p.items[0].name, 'Vencida'); assert.equal(p.items[1].name, 'Com juros'); assert.equal(p.items[2].name, 'Pequena');
    assert.equal(p.budget_cents, 24000); // 40% de 600
    assert.ok(p.budget_cents < p.basis_cents);
    assert.equal(p.items.reduce((x, i) => x + i.suggested_cents, 0), p.budget_cents);
    assert.ok(p.items.every(i => i.suggested_cents <= i.remaining_cents));
    const p2 = (await a.call('/api/plan?available=50')).data; assert.equal(p2.budget_cents, 5000); assert.equal(p2.items[0].suggested_cents, 5000);
    assert.equal((await a.call('/api/plan?available=abc')).status, 400);
    await a.stop();
  });
});

describe('backup, restauração, migração e persistência', () => {
  test('backup/restauração completos, com snapshot prévio e rollback se o arquivo for inválido', async () => {
    const a = await start('bk');
    const id = (await a.call('/api/debts', 'POST', { name: 'João', total: '50' })).data.id;
    await a.call(`/api/debts/${id}/payments`, 'POST', { amount: '20', date: '2026-11-01' });
    const g = (await a.call('/api/goals', 'POST', { name: 'Moto', target: '2000' })).data.id;
    await a.call(`/api/goals/${g}/moves`, 'POST', { amount: '300', date: '2026-11-01' });
    const w = (await a.call('/api/weeks', 'POST', { pay_date: '2026-11-07', period_start: '2026-11-02', period_end: '2026-11-07' })).data.id;
    await a.call(`/api/weeks/${w}/items`, 'POST', { kind: 'vale', description: 'v', amount: '100', date: '2026-11-03' });
    const backup = (await a.call('/api/backup')).data;
    assert.equal(backup.app, 'Vitin7 Finance'); assert.equal(backup.version, 3);
    const before = JSON.stringify((await a.call('/api/data')).data.debts);
    await a.call('/api/debts/' + id, 'DELETE'); await a.call('/api/goals/' + g, 'DELETE'); await a.call('/api/weeks/' + w, 'DELETE');
    assert.equal((await a.call('/api/data')).data.debts.length, 0);
    const r = await a.call('/api/restore', 'POST', backup); assert.equal(r.status, 200);
    assert.ok(fs.readdirSync(a.backupDir).some(f => f.startsWith('antes-restauracao')));
    const d = (await a.call('/api/data')).data;
    assert.equal(JSON.stringify(d.debts), before); assert.equal(d.goals[0].percent, 15); assert.equal(d.weeks[0].remaining_cents, 50000);
    assert.equal(d.dashboard.balance_cents, backup.data.transactions.reduce((x, t) => x + (t.kind === 'entrada' ? t.amount_cents : -t.amount_cents), 0));
    // backup corrompido: nada muda
    const broken = structuredClone(backup); broken.data.payments[0].debt_id = 99999;
    assert.equal((await a.call('/api/restore', 'POST', broken)).status, 400);
    assert.equal(JSON.stringify((await a.call('/api/data')).data.debts), before);
    assert.equal((await a.call('/api/restore', 'POST', { app: 'Outro' })).status, 400);
    await a.stop();
  });

  function criarBancoV2(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE debts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, total REAL NOT NULL, paid REAL NOT NULL DEFAULT 0, due_date TEXT, note TEXT DEFAULT '');
      CREATE TABLE payments (id INTEGER PRIMARY KEY, debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE, amount REAL NOT NULL, paid_at TEXT NOT NULL);
      CREATE TABLE goals (id INTEGER PRIMARY KEY, name TEXT NOT NULL, target REAL NOT NULL, saved REAL NOT NULL DEFAULT 0, deadline TEXT);
      CREATE TABLE deposits (id INTEGER PRIMARY KEY, goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE, amount REAL NOT NULL, date TEXT NOT NULL);
      CREATE TABLE transactions (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, category TEXT, description TEXT NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL);
      CREATE TABLE events (id INTEGER PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0);
      CREATE TABLE weekly (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL);
      CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '');
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX idx_tx_date ON transactions(date);
      INSERT INTO debts VALUES (1,'João',50.1,20.1,'2026-11-30','antigo'),(2,'Nubank',200,0,NULL,'');
      INSERT INTO payments VALUES (1,1,20.1,'2026-11-01');
      INSERT INTO goals VALUES (1,'Moto',2500,75.5,'2027-03-01');
      INSERT INTO deposits VALUES (1,1,75.5,'2026-11-01');
      INSERT INTO transactions VALUES (1,'entrada','Trabalho','Semana',600,'2026-11-01');
      INSERT INTO events VALUES (1,'Pagar conta','2026-11-05','conta',12.34);
      INSERT INTO weekly VALUES (1,'adiantamento','Vale',100,'2026-11-03'),(2,'compra','Coca',6,'2026-11-04'),(3,'desconto','Falta',100,'2026-11-02'),(4,'extra','Hora extra',30,'2026-11-10');
      INSERT INTO notes VALUES (1,'Minha nota','texto');
      INSERT INTO settings VALUES ('weekly_base','600');`);
    db.close();
  }
  test('migra banco da versão 2.0 (REAL) para centavos preservando tudo, com snapshot e tabelas legacy_*', async () => {
    criarBancoV2(dbFile('mig'));
    const a = await start('mig', { seed: true });
    assert.ok(a.info.migrated && a.info.migrated.snapshot && fs.existsSync(a.info.migrated.snapshot), 'snapshot prévio');
    const d = (await a.call('/api/data')).data;
    assert.equal(d.debts.length, 2, 'seed não roda sobre dados existentes');
    const joao = d.debts.find(x => x.name === 'João'); assert.equal(joao.total_cents, 5010); assert.equal(joao.paid_cents, 2010); assert.equal(joao.remaining_cents, 3000);
    assert.equal(d.goals[0].saved_cents, 7550); assert.equal(d.goals[0].target_cents, 250000);
    assert.equal(d.transactions[0].amount_cents, 60000); assert.equal(d.events[0].amount_cents, 1234);
    assert.equal(d.notes[0].title, 'Minha nota'); assert.equal(d.settings.weekly_base_cents, 60000);
    const semanas = d.weeks.sort((x, y) => x.pay_date.localeCompare(y.pay_date));
    assert.equal(semanas.length, 2); // 02–08/11 e 09–15/11
    assert.equal(semanas[0].vales_cents, 10000); assert.equal(semanas[0].descontos_cents, 10600); assert.equal(semanas[0].remaining_cents, 60000 - 10600 - 10000);
    assert.equal(semanas[1].extras_cents, 3000);
    const names = new Set(a.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    for (const t of ['legacy_debts', 'legacy_payments', 'legacy_weekly', 'legacy_goals']) assert.ok(names.has(t), t + ' preservada');
    assert.equal(a.db.prepare('SELECT COUNT(*) c FROM legacy_debts').get().c, 2);
    await a.stop();
    // reabrir: não migra de novo e nada muda
    const b = await start('mig', { seed: true });
    assert.equal(b.info.migrated, null);
    assert.equal((await b.call('/api/data')).data.debts.length, 2);
    await b.stop();
  });
  test('restaura backup JSON no formato da versão 2.0', async () => {
    const a = await start('v2json');
    const v2 = { app: 'Vitin7 Finance', version: 2, data: {
      debts: [{ id: 1, name: 'João', total: 50, paid: 20, due_date: '2026-11-30', note: '' }], payments: [{ id: 1, debt_id: 1, amount: 20, paid_at: '2026-11-01' }],
      goals: [{ id: 1, name: 'Moto', target: 2000, saved: 300, deadline: '' }], deposits: [{ id: 1, goal_id: 1, amount: 300, date: '2026-11-01' }],
      transactions: [], events: [], weekly: [{ id: 1, kind: 'adiantamento', description: 'Vale', amount: 100, date: '2026-11-03' }], notes: [], settings: [{ key: 'weekly_base', value: '600' }] } };
    const r = await a.call('/api/restore', 'POST', v2); assert.equal(r.status, 200); assert.equal(r.data.format, 'v2');
    const d = (await a.call('/api/data')).data;
    assert.equal(d.debts[0].remaining_cents, 3000); assert.equal(d.goals[0].percent, 15); assert.equal(d.weeks.length, 1);
    await a.stop();
  });
  test('reinício do servidor não perde dados e não duplica nada', async () => {
    let a = await start('persist', { seed: true });
    await a.call('/api/transactions', 'POST', { kind: 'saida', description: 'Mercado', amount: '12,34', date: '2026-11-01' });
    const id = (await a.call('/api/data')).data.debts[0].id;
    await a.call(`/api/debts/${id}/payments`, 'POST', { amount: '10', date: '2026-11-01' });
    const snap = JSON.stringify((await a.call('/api/data')).data.dashboard.balance_cents);
    await a.stop();
    a = await start('persist', { seed: true });
    const d = (await a.call('/api/data')).data;
    assert.equal(d.debts.length, 5); assert.equal(d.payments.length, 1); assert.equal(d.transactions.length, 2);
    assert.equal(JSON.stringify(d.dashboard.balance_cents), snap);
    assert.ok(fs.readdirSync(a.backupDir).some(f => f.startsWith('auto-')), 'snapshot diário criado');
    await a.stop();
  });
  test('pasta sem permissão de escrita gera erro claro (sem apagar nada)', () => {
    if (process.getuid && process.getuid() === 0) return; // root ignora permissões
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'ro-')); fs.chmodSync(dir, 0o500);
    assert.throws(() => createApp({ dbPath: path.join(dir, 'x', 'v.sqlite'), seed: false }), /permiss/i);
  });
});
