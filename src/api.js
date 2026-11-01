'use strict';
// Regras de negócio e rotas da API do Vitin7 Finance.
// Todos os valores trafegam em CENTAVOS (campos *_cents). Entradas de formulário em reais são convertidas aqui.
const { tx, exportBackup, restoreBackup, INITIAL_DEBTS, mondayOf, addDays, validDate, todayBR } = require('./db');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m, s = 400) => new HttpError(s, m);
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------- validação ----------
function parseMoney(v, { allowZero = false, label = 'Valor' } = {}) {
  if (v === null || v === undefined || typeof v === 'boolean') throw bad(`${label}: informe um valor.`);
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v).trim();
  s = s.replace(/^R\$\s*/, '');
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw bad(`${label}: use um número positivo com até 2 casas decimais.`);
  const [i, f = ''] = s.split('.');
  const cents = Number(i) * 100 + Number((f + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > 9_999_999_999) throw bad(`${label} acima do limite permitido.`);
  if (cents === 0 && !allowZero) throw bad(`${label} deve ser maior que zero.`);
  return cents;
}
const reqText = (v, label, max = 120) => {
  const s = String(v ?? '').trim();
  if (!s) throw bad(`${label} é obrigatório.`);
  if (s.length > max) throw bad(`${label} muito longo (máximo ${max} caracteres).`);
  return s;
};
const optText = (v, max = 500) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw bad(`Texto acima do limite de ${max} caracteres.`);
  return s;
};
const reqDate = (v, label = 'Data') => {
  if (!validDate(v)) throw bad(`${label} inválida.`);
  return v;
};
const optDate = (v, label) => (v === undefined || v === null || v === '' ? null : reqDate(v, label));
const oneOf = (v, list, label) => {
  if (!list.includes(v)) throw bad(`${label} inválido.`);
  return v;
};
const intRange = (v, min, max, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} deve ser um número inteiro entre ${min} e ${max}.`);
  return n;
};
const parseRate = (v) => { // juros ao mês em % → pontos-base inteiros
  if (v === undefined || v === null || String(v).trim() === '') return 0;
  const s = String(v).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s) || Number(s) > 1000) throw bad('Juros ao mês: use um percentual válido (ex.: 2,5).');
  return Math.round(Number(s) * 100);
};
const id = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw bad('ID inválido.');
  return n;
};
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);

// ---------- apoio ----------
function syncTx(db, source, sourceId, spec) {
  db.prepare('DELETE FROM transactions WHERE source=? AND source_id=?').run(source, sourceId);
  if (spec) {
    db.prepare('INSERT INTO transactions(kind,category,description,amount_cents,date,source,source_id) VALUES(?,?,?,?,?,?,?)')
      .run(spec.kind, spec.category, spec.description, spec.amount_cents, spec.date, source, sourceId);
  }
}
function assertNotDuplicate(db, table, where, params) {
  const r = db.prepare(`SELECT id FROM ${table} WHERE ${where} AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 seconds') LIMIT 1`).get(...params);
  if (r) throw bad('Um registro idêntico acabou de ser salvo. Aguarde alguns segundos se for realmente outro.', 409);
}
const must = (row, msg) => { if (!row) throw bad(msg, 404); return row; };

const DEBT_SQL = `SELECT d.*, COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.debt_id=d.id),0) AS paid_cents FROM debts d`;
function debtView(r, today) {
  const remaining = Math.max(0, r.total_cents - r.paid_cents);
  const status = remaining === 0 ? 'quitada' : (r.due_date && r.due_date < today ? 'vencida' : 'aberta');
  return { ...r, remaining_cents: remaining, status, percent: Math.min(100, Math.round(r.paid_cents * 100 / r.total_cents)) };
}
const getDebt = (db, i) => must(db.prepare(DEBT_SQL + ' WHERE d.id=?').get(i), 'Dívida não encontrada.');

const GOAL_SQL = `SELECT g.*, COALESCE((SELECT SUM(CASE kind WHEN 'deposito' THEN amount_cents ELSE -amount_cents END) FROM goal_moves m WHERE m.goal_id=g.id),0) AS saved_cents FROM goals g`;
function goalView(r) {
  return { ...r, percent: Math.min(100, Math.floor(Math.max(0, r.saved_cents) * 100 / r.target_cents)), missing_cents: Math.max(0, r.target_cents - r.saved_cents) };
}
const getGoal = (db, i) => must(db.prepare(GOAL_SQL + ' WHERE g.id=?').get(i), 'Meta não encontrada.');

function getSettings(db) {
  const o = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) o[r.key] = r.value;
  return {
    weekly_base_cents: Number(o.weekly_base_cents || 60000),
    daily_rate_cents: Number(o.daily_rate_cents || 10000),
    debt_pct: Number(o.debt_pct || 40),
    save_pct: Number(o.save_pct || 10),
    alert_days: Number(o.alert_days || 3),
  };
}

// ---------- semana de pagamento ----------
function weekSummary(db, w) {
  const items = db.prepare('SELECT * FROM week_items WHERE week_id=? ORDER BY date,id').all(w.id);
  const receipts = db.prepare('SELECT * FROM week_receipts WHERE week_id=? ORDER BY date,id').all(w.id);
  const days = db.prepare('SELECT * FROM work_days WHERE date BETWEEN ? AND ? ORDER BY date').all(w.period_start, w.period_end);
  const sum = (k) => items.filter(i => i.kind === k).reduce((a, i) => a + i.amount_cents, 0);
  const counts = { trabalhado: 0, falta: 0, feriado: 0, feriado_pago: 0, folga: 0 };
  for (const d of days) counts[d.status]++;
  const absence_days = counts.falta + counts.feriado;
  const absence_cents = absence_days * w.daily_cents;
  const extras_cents = sum('extra'), vales_cents = sum('vale'), descontos_cents = sum('desconto');
  const gross_cents = w.base_cents + extras_cents - absence_cents;      // salário bruto previsto da semana
  const net_cents = gross_cents - descontos_cents;                       // total que a semana rende (inclui vales)
  const receipts_cents = receipts.reduce((a, r) => a + r.amount_cents, 0);
  const received_cents = vales_cents + receipts_cents;                   // vales são adiantamentos já recebidos
  const remaining_cents = Math.max(0, net_cents - received_cents);
  const status = received_cents > 0 && remaining_cents === 0 ? 'recebido' : (received_cents > 0 ? 'parcial' : 'previsto');
  return {
    ...w, items, receipts, days, counts, absence_days, absence_cents, extras_cents, vales_cents, descontos_cents,
    gross_cents, net_cents, receipts_cents, received_cents, remaining_cents,
    over_cents: Math.max(0, received_cents - net_cents), status,
  };
}
const getWeek = (db, i) => must(db.prepare('SELECT * FROM weeks WHERE id=?').get(i), 'Semana não encontrada.');

function weekBody(db, x, ownId = null) {
  const settings = getSettings(db);
  const pay_date = reqDate(x.pay_date, 'Data do pagamento');
  const period_end = x.period_end ? reqDate(x.period_end, 'Fim do período') : pay_date;
  const period_start = x.period_start ? reqDate(x.period_start, 'Início do período') : addDays(period_end, -6);
  if (period_start > period_end) throw bad('O início do período não pode ser depois do fim.');
  if (daysBetween(period_start, period_end) > 31) throw bad('Período máximo de 32 dias.');
  const overlap = db.prepare('SELECT pay_date FROM weeks WHERE id != ? AND period_start <= ? AND period_end >= ?').get(ownId ?? -1, period_end, period_start);
  if (overlap) throw bad(`Este período sobrepõe a semana paga em ${overlap.pay_date.split('-').reverse().join('/')}. Cada dia só pode pertencer a uma semana.`, 409);
  const dup = db.prepare('SELECT id FROM weeks WHERE pay_date=? AND id != ?').get(pay_date, ownId ?? -1);
  if (dup) throw bad('Já existe uma semana com essa data de pagamento.', 409);
  return {
    pay_date, period_start, period_end,
    base_cents: x.base === undefined || x.base === '' ? settings.weekly_base_cents : parseMoney(x.base, { allowZero: true, label: 'Salário-base' }),
    daily_cents: x.daily === undefined || x.daily === '' ? settings.daily_rate_cents : parseMoney(x.daily, { allowZero: true, label: 'Valor da diária' }),
    note: optText(x.note),
  };
}

function itemSpec(week, item) {
  if (item.kind !== 'vale') return null;
  return { kind: 'entrada', category: 'Salário', description: `Vale recebido (adiantamento) — semana de ${week.pay_date.split('-').reverse().join('/')}`, amount_cents: item.amount_cents, date: item.date };
}

// ---------- dashboard / relatórios / plano ----------
function pickCurrentWeek(weeks, today) {
  return weeks.find(w => w.period_start <= today && today <= w.period_end)
    || weeks.filter(w => w.remaining_cents > 0 && w.pay_date >= today).sort((a, b) => a.pay_date.localeCompare(b.pay_date))[0]
    || weeks.filter(w => w.remaining_cents > 0).sort((a, b) => b.pay_date.localeCompare(a.pay_date))[0]
    || weeks.slice().sort((a, b) => b.pay_date.localeCompare(a.pay_date))[0] || null;
}

const SPEND_EXCLUDED = ['debt_payment', 'goal_deposit'];     // não são "gasto": aparecem em linhas próprias
const INCOME_EXCLUDED = ['goal_withdraw'];                    // retirada de meta não é receita nova

function monthStats(db, month) {
  const tx = db.prepare("SELECT kind,source,amount_cents FROM transactions WHERE substr(date,1,7)=?").all(month);
  const income = tx.filter(t => t.kind === 'entrada' && !INCOME_EXCLUDED.includes(t.source)).reduce((a, t) => a + t.amount_cents, 0);
  const spent = tx.filter(t => t.kind === 'saida' && !SPEND_EXCLUDED.includes(t.source)).reduce((a, t) => a + t.amount_cents, 0);
  const debt_paid = db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM payments WHERE substr(paid_at,1,7)=?").get(month).s;
  const saved = db.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'deposito' THEN amount_cents ELSE -amount_cents END),0) s FROM goal_moves WHERE substr(date,1,7)=?").get(month).s;
  return { month, income_cents: income, spent_cents: spent, debt_paid_cents: debt_paid, saved_cents: saved, free_cents: income - spent - debt_paid - saved };
}
const shiftMonth = (month, n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

function buildAlerts(db, settings, today, debts, weeks) {
  const lim = settings.alert_days, out = [];
  for (const d of debts.filter(x => x.remaining_cents > 0 && x.due_date)) {
    const n = daysBetween(today, d.due_date);
    if (n < 0) out.push({ level: 'danger', text: `Dívida com ${d.name} venceu há ${-n} dia(s): ${brl(d.remaining_cents)}`, date: d.due_date });
    else if (n <= lim) out.push({ level: 'warn', text: `Dívida com ${d.name} ${n === 0 ? 'vence hoje' : `vence em ${n} dia(s)`}: ${brl(d.remaining_cents)}`, date: d.due_date });
  }
  for (const e of db.prepare("SELECT * FROM events WHERE done=0 AND date BETWEEN ? AND ?").all(today, addDays(today, lim))) {
    const n = daysBetween(today, e.date);
    out.push({ level: 'info', text: `${e.title} — ${n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`}${e.amount_cents ? ' · ' + brl(e.amount_cents) : ''}`, date: e.date });
  }
  for (const w of weeks.filter(x => x.remaining_cents > 0 && x.pay_date >= today && daysBetween(today, x.pay_date) <= lim)) {
    out.push({ level: 'good', text: `Pagamento previsto ${w.pay_date === today ? 'hoje' : 'em ' + daysBetween(today, w.pay_date) + ' dia(s)'}: ${brl(w.remaining_cents)} a receber`, date: w.pay_date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function buildDashboard(db, today, settings, debts, goals, weeks) {
  const month = today.slice(0, 7);
  const bal = db.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'entrada' THEN amount_cents ELSE -amount_cents END),0) s FROM transactions").get().s;
  const cur = pickCurrentWeek(weeks, today);
  const open = debts.filter(d => d.remaining_cents > 0);
  const upcoming = [
    ...db.prepare("SELECT * FROM events WHERE type='conta' AND done=0 AND date >= ? ORDER BY date LIMIT 8").all(addDays(today, -30))
      .map(e => ({ kind: 'conta', title: e.title, date: e.date, amount_cents: e.amount_cents, event_id: e.id })),
    ...open.filter(d => d.due_date).map(d => ({ kind: 'divida', title: 'Dívida • ' + d.name, date: d.due_date, amount_cents: d.remaining_cents, debt_id: d.id })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8).map(u => ({ ...u, days: daysBetween(today, u.date) }));
  const activity = db.prepare(`
    SELECT 'transacao' AS type, created_at, description AS text, amount_cents, kind AS dir, date FROM transactions WHERE source='manual'
    UNION ALL SELECT 'pagamento', p.created_at, 'Pagamento • ' || d.name, p.amount_cents, 'saida', p.paid_at FROM payments p JOIN debts d ON d.id=p.debt_id
    UNION ALL SELECT 'meta', m.created_at, (CASE m.kind WHEN 'deposito' THEN 'Depósito • ' ELSE 'Retirada • ' END) || g.name, m.amount_cents, (CASE m.kind WHEN 'deposito' THEN 'saida' ELSE 'entrada' END), m.date FROM goal_moves m JOIN goals g ON g.id=m.goal_id
    UNION ALL SELECT 'salario', r.created_at, 'Salário recebido', r.amount_cents, 'entrada', r.date FROM week_receipts r
    UNION ALL SELECT 'semana', i.created_at, (CASE i.kind WHEN 'vale' THEN 'Vale • ' WHEN 'desconto' THEN 'Desconto • ' ELSE 'Extra • ' END) || i.description, i.amount_cents, (CASE i.kind WHEN 'desconto' THEN 'saida' ELSE 'entrada' END), i.date FROM week_items i
    ORDER BY created_at DESC LIMIT 10`).all();
  const m = monthStats(db, month);
  const series = [];
  for (let i = 5; i >= 0; i--) series.push(monthStats(db, shiftMonth(month, -i)));
  return {
    today, month,
    balance_cents: bal,
    week: cur && { id: cur.id, pay_date: cur.pay_date, period_start: cur.period_start, period_end: cur.period_end, gross_cents: cur.gross_cents, net_cents: cur.net_cents, received_cents: cur.received_cents, vales_cents: cur.vales_cents, remaining_cents: cur.remaining_cents, status: cur.status },
    debts_pending_cents: open.reduce((a, d) => a + d.remaining_cents, 0),
    debts_open_count: open.length,
    month_spent_cents: m.spent_cents, month_income_cents: m.income_cents, month_debt_paid_cents: m.debt_paid_cents, month_saved_cents: m.saved_cents,
    saved_total_cents: goals.reduce((a, g) => a + Math.max(0, g.saved_cents), 0),
    upcoming, goals: goals.slice(0, 4).map(g => ({ id: g.id, name: g.name, percent: g.percent, saved_cents: g.saved_cents, target_cents: g.target_cents })),
    activity, series,
    alerts: buildAlerts(db, settings, today, debts, weeks),
  };
}

function buildReports(db, q, today) {
  const period = q.period === 'week' ? 'week' : 'month';
  const count = Math.min(24, Math.max(2, Number(q.count) || (period === 'week' ? 8 : 6)));
  const month = /^\d{4}-\d{2}$/.test(q.month || '') ? q.month : today.slice(0, 7);
  let rows = [];
  if (period === 'month') {
    for (let i = count - 1; i >= 0; i--) rows.push(monthStats(db, shiftMonth(month, -i)));
  } else {
    const start = mondayOf(today);
    const map = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const s = addDays(start, -7 * i);
      map.set(s, { week: s, income_cents: 0, spent_cents: 0, debt_paid_cents: 0, saved_cents: 0 });
    }
    const first = [...map.keys()][0], last = addDays(start, 6);
    for (const t of db.prepare('SELECT kind,source,amount_cents,date FROM transactions WHERE date BETWEEN ? AND ?').all(first, last)) {
      const r = map.get(mondayOf(t.date));
      if (!r) continue;
      if (t.kind === 'entrada' && !INCOME_EXCLUDED.includes(t.source)) r.income_cents += t.amount_cents;
      if (t.kind === 'saida' && !SPEND_EXCLUDED.includes(t.source)) r.spent_cents += t.amount_cents;
    }
    for (const p of db.prepare('SELECT amount_cents,paid_at FROM payments WHERE paid_at BETWEEN ? AND ?').all(first, last)) map.get(mondayOf(p.paid_at)).debt_paid_cents += p.amount_cents;
    for (const g of db.prepare('SELECT kind,amount_cents,date FROM goal_moves WHERE date BETWEEN ? AND ?').all(first, last)) map.get(mondayOf(g.date)).saved_cents += g.kind === 'deposito' ? g.amount_cents : -g.amount_cents;
    rows = [...map.values()].map(r => ({ ...r, free_cents: r.income_cents - r.spent_cents - r.debt_paid_cents - r.saved_cents }));
  }
  const cat = {};
  for (const t of db.prepare("SELECT category,source,amount_cents FROM transactions WHERE kind='saida' AND substr(date,1,7)=?").all(month)) {
    if (SPEND_EXCLUDED.includes(t.source)) continue;
    const k = t.category || 'Sem categoria';
    cat[k] = (cat[k] || 0) + t.amount_cents;
  }
  return { period, month, rows, categories: Object.entries(cat).map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents), selected: monthStats(db, month) };
}

function buildPlan(db, q, today) {
  const settings = getSettings(db);
  const debts = db.prepare(DEBT_SQL).all().map(r => debtView(r, today)).filter(d => d.remaining_cents > 0);
  const weeks = db.prepare('SELECT * FROM weeks').all().map(w => weekSummary(db, w));
  const target = weeks.filter(w => w.remaining_cents > 0 && w.pay_date >= addDays(today, -7)).sort((a, b) => a.pay_date.localeCompare(b.pay_date))[0];
  const basis_cents = target ? target.remaining_cents : settings.weekly_base_cents;
  const basis_label = target ? `a receber na semana de ${target.pay_date.split('-').reverse().join('/')}` : 'estimativa pelo salário-base semanal (nenhuma semana pendente cadastrada)';
  const suggested = Math.floor(basis_cents * settings.debt_pct / 100);
  const hasOverride = q.available !== undefined && String(q.available).trim() !== '';
  const budget = hasOverride ? parseMoney(q.available, { allowZero: true, label: 'Valor disponível' }) : suggested;
  const tier = (d) => (d.due_date && d.due_date < today ? 0 : d.due_date && daysBetween(today, d.due_date) <= 7 ? 1 : 2);
  const ordered = debts.slice().sort((a, b) =>
    tier(a) - tier(b) || b.interest_bp - a.interest_bp || a.priority - b.priority
    || (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.remaining_cents - b.remaining_cents);
  let left = budget;
  const items = ordered.map((d, i) => {
    const give = Math.min(d.remaining_cents, left);
    left -= give;
    const why = [];
    if (d.due_date && d.due_date < today) why.push(`vencida há ${daysBetween(d.due_date, today)} dia(s)`);
    else if (d.due_date && daysBetween(today, d.due_date) <= 7) why.push(`vence em ${daysBetween(today, d.due_date)} dia(s)`);
    if (d.interest_bp > 0) why.push(`juros de ${(d.interest_bp / 100).toLocaleString('pt-BR')}% ao mês (≈ ${brl(Math.round(d.remaining_cents * d.interest_bp / 10000))}/mês)`);
    if (d.priority === 1) why.push('prioridade alta');
    if (!why.length) why.push(i === 0 ? 'menor saldo / sem urgência: quitar rápido libera fôlego' : 'sem urgência no momento');
    return { debt_id: d.id, name: d.name, remaining_cents: d.remaining_cents, due_date: d.due_date, interest_bp: d.interest_bp, suggested_cents: give, after_cents: d.remaining_cents - give, why: why.join(' · ') };
  });
  const total_open = debts.reduce((a, d) => a + d.remaining_cents, 0);
  return {
    basis_cents, basis_label, debt_pct: settings.debt_pct, save_pct: settings.save_pct,
    budget_cents: budget, suggested_budget_cents: suggested,
    personal_cents: Math.floor(basis_cents * Math.max(0, 100 - settings.debt_pct - settings.save_pct) / 100),
    savings_cents: Math.floor(basis_cents * settings.save_pct / 100),
    exceeds_basis: budget > basis_cents,
    leftover_cents: left, total_open_cents: total_open,
    weeks_to_clear: budget > 0 && total_open > 0 ? Math.ceil(total_open / budget) : null,
    items,
  };
}

function getState(db) {
  const today = todayBR();
  const settings = getSettings(db);
  const debts = db.prepare(DEBT_SQL + ' ORDER BY d.id').all().map(r => debtView(r, today));
  const goals = db.prepare(GOAL_SQL + ' ORDER BY g.id').all().map(goalView);
  const weeks = db.prepare('SELECT * FROM weeks ORDER BY pay_date DESC').all().map(w => weekSummary(db, w));
  return {
    today, settings, debts, goals, weeks,
    payments: db.prepare('SELECT p.*, d.name AS debt_name FROM payments p JOIN debts d ON d.id=p.debt_id ORDER BY p.paid_at DESC, p.id DESC').all(),
    goal_moves: db.prepare('SELECT m.*, g.name AS goal_name FROM goal_moves m JOIN goals g ON g.id=m.goal_id ORDER BY m.date DESC, m.id DESC').all(),
    transactions: db.prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC').all(),
    events: db.prepare('SELECT * FROM events ORDER BY date, id').all(),
    work_days: db.prepare('SELECT * FROM work_days ORDER BY date').all(),
    notes: db.prepare('SELECT * FROM notes ORDER BY id DESC').all(),
    initial_debts: INITIAL_DEBTS,
    dashboard: buildDashboard(db, today, settings, debts, goals, weeks),
  };
}

// ---------- rotas ----------
function createRoutes(db, { backupDir, info }) {
  const T = (fn) => tx(db, fn);
  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });
  const ok = (extra = {}, status = 200) => ({ status, body: { ok: true, ...extra } });
  const today = () => todayBR();

  add('GET', '/api/health', () => {
    db.prepare('SELECT 1').get();
    const uv = db.prepare('PRAGMA user_version').get().user_version;
    return { status: 200, body: { status: 'ok', database: 'connected', schema: uv, version: '3.0.1' } };
  });
  add('GET', '/api/data', () => ({ status: 200, body: getState(db) }));
  add('GET', '/api/reports', ({ query }) => ({ status: 200, body: buildReports(db, query, today()) }));
  add('GET', '/api/plan', ({ query }) => ({ status: 200, body: buildPlan(db, query, today()) }));
  add('GET', '/api/backup', () => ({ status: 200, body: exportBackup(db), download: `vitin7-backup-${today()}.json` }));
  add('POST', '/api/restore', ({ body }) => {
    const r = restoreBackup(db, body, backupDir);
    return ok({ message: 'Backup restaurado. O estado anterior foi salvo no servidor.', ...r });
  });

  // ----- dívidas -----
  const debtBody = (x) => ({
    name: reqText(x.name, 'Credor'), description: optText(x.description), total_cents: parseMoney(x.total, { label: 'Valor total' }),
    due_date: optDate(x.due_date, 'Vencimento'), priority: x.priority === undefined || x.priority === '' ? 2 : intRange(x.priority, 1, 3, 'Prioridade'),
    interest_bp: parseRate(x.interest),
  });
  add('POST', '/api/debts', ({ body }) => {
    const b = debtBody(body);
    assertNotDuplicate(db, 'debts', 'name=? AND total_cents=? AND COALESCE(due_date,\'\')=?', [b.name, b.total_cents, b.due_date || '']);
    const r = db.prepare('INSERT INTO debts(name,description,total_cents,due_date,priority,interest_bp) VALUES(?,?,?,?,?,?)').run(b.name, b.description, b.total_cents, b.due_date, b.priority, b.interest_bp);
    return ok({ id: Number(r.lastInsertRowid) }, 201);
  });
  add('PUT', '/api/debts/:id', ({ params, body }) => {
    const i = id(params.id), cur = getDebt(db, i), b = debtBody(body);
    if (b.total_cents < cur.paid_cents) throw bad(`O total não pode ser menor que o já pago (${brl(cur.paid_cents)}).`);
    db.prepare("UPDATE debts SET name=?,description=?,total_cents=?,due_date=?,priority=?,interest_bp=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
      .run(b.name, b.description, b.total_cents, b.due_date, b.priority, b.interest_bp, i);
    return ok();
  });
  add('DELETE', '/api/debts/:id', ({ params }) => T(() => {
    const i = id(params.id); getDebt(db, i);
    for (const p of db.prepare('SELECT id FROM payments WHERE debt_id=?').all(i)) syncTx(db, 'debt_payment', p.id, null);
    db.prepare('DELETE FROM debts WHERE id=?').run(i);
    return ok();
  }));
  add('POST', '/api/debts/:id/payments', ({ params, body }) => T(() => {
    const i = id(params.id), d = getDebt(db, i);
    const amount = parseMoney(body.amount, { label: 'Valor do pagamento' });
    const date = body.date ? reqDate(body.date, 'Data do pagamento') : today();
    const remaining = d.total_cents - d.paid_cents;
    if (remaining <= 0) throw bad('Esta dívida já está quitada.', 409);
    if (amount > remaining) throw bad(`Pagamento acima do saldo da dívida (restam ${brl(remaining)}).`);
    assertNotDuplicate(db, 'payments', 'debt_id=? AND amount_cents=? AND paid_at=?', [i, amount, date]);
    const r = db.prepare('INSERT INTO payments(debt_id,amount_cents,paid_at,note) VALUES(?,?,?,?)').run(i, amount, date, optText(body.note, 200));
    const pid = Number(r.lastInsertRowid);
    if (body.register_cash !== false && body.register_cash !== 'false' && body.register_cash !== 'off') {
      syncTx(db, 'debt_payment', pid, { kind: 'saida', category: 'Dívidas', description: `Pagamento — ${d.name}`, amount_cents: amount, date });
    }
    return ok({ id: pid, remaining_cents: remaining - amount }, 201);
  }));
  add('DELETE', '/api/payments/:id', ({ params }) => T(() => {
    const i = id(params.id);
    must(db.prepare('SELECT id FROM payments WHERE id=?').get(i), 'Pagamento não encontrado.');
    syncTx(db, 'debt_payment', i, null);
    db.prepare('DELETE FROM payments WHERE id=?').run(i);
    return ok();
  }));

  // ----- metas -----
  const goalBody = (x) => ({ name: reqText(x.name, 'Nome da meta'), target_cents: parseMoney(x.target, { label: 'Valor desejado' }), deadline: optDate(x.deadline, 'Prazo'), note: optText(x.note) });
  add('POST', '/api/goals', ({ body }) => {
    const b = goalBody(body);
    assertNotDuplicate(db, 'goals', 'name=? AND target_cents=?', [b.name, b.target_cents]);
    const r = db.prepare('INSERT INTO goals(name,target_cents,deadline,note) VALUES(?,?,?,?)').run(b.name, b.target_cents, b.deadline, b.note);
    return ok({ id: Number(r.lastInsertRowid) }, 201);
  });
  add('PUT', '/api/goals/:id', ({ params, body }) => {
    const i = id(params.id); getGoal(db, i);
    const b = goalBody(body);
    db.prepare('UPDATE goals SET name=?,target_cents=?,deadline=?,note=? WHERE id=?').run(b.name, b.target_cents, b.deadline, b.note, i);
    return ok();
  });
  add('DELETE', '/api/goals/:id', ({ params }) => T(() => {
    const i = id(params.id); getGoal(db, i);
    for (const m of db.prepare('SELECT id,kind FROM goal_moves WHERE goal_id=?').all(i)) syncTx(db, m.kind === 'deposito' ? 'goal_deposit' : 'goal_withdraw', m.id, null);
    db.prepare('DELETE FROM goals WHERE id=?').run(i);
    return ok();
  }));
  add('POST', '/api/goals/:id/moves', ({ params, body }) => T(() => {
    const i = id(params.id), g = getGoal(db, i);
    const kind = oneOf(body.kind || 'deposito', ['deposito', 'retirada'], 'Tipo de movimentação');
    const amount = parseMoney(body.amount, { label: 'Valor' });
    const date = body.date ? reqDate(body.date) : today();
    if (kind === 'retirada' && amount > g.saved_cents) throw bad(`Retirada acima do valor guardado (${brl(Math.max(0, g.saved_cents))}).`);
    assertNotDuplicate(db, 'goal_moves', 'goal_id=? AND kind=? AND amount_cents=? AND date=?', [i, kind, amount, date]);
    const r = db.prepare('INSERT INTO goal_moves(goal_id,kind,amount_cents,date,note) VALUES(?,?,?,?,?)').run(i, kind, amount, date, optText(body.note, 200));
    const mid = Number(r.lastInsertRowid);
    if (body.register_cash !== false && body.register_cash !== 'false' && body.register_cash !== 'off') {
      syncTx(db, kind === 'deposito' ? 'goal_deposit' : 'goal_withdraw', mid, kind === 'deposito'
        ? { kind: 'saida', category: 'Metas', description: `Depósito — ${g.name}`, amount_cents: amount, date }
        : { kind: 'entrada', category: 'Metas', description: `Retirada — ${g.name}`, amount_cents: amount, date });
    }
    return ok({ id: mid }, 201);
  }));
  add('DELETE', '/api/goal-moves/:id', ({ params }) => T(() => {
    const i = id(params.id);
    const m = must(db.prepare('SELECT * FROM goal_moves WHERE id=?').get(i), 'Movimentação não encontrada.');
    const g = getGoal(db, m.goal_id);
    if (m.kind === 'deposito' && g.saved_cents - m.amount_cents < 0) throw bad('Não é possível excluir este depósito: há retiradas que dependem dele.', 409);
    syncTx(db, m.kind === 'deposito' ? 'goal_deposit' : 'goal_withdraw', i, null);
    db.prepare('DELETE FROM goal_moves WHERE id=?').run(i);
    return ok();
  }));

  // ----- receitas e despesas -----
  const txBody = (x) => ({ kind: oneOf(x.kind, ['entrada', 'saida'], 'Tipo'), category: optText(x.category, 60), description: reqText(x.description, 'Descrição', 160), amount_cents: parseMoney(x.amount), date: reqDate(x.date) });
  const manualTx = (i) => {
    const t = must(db.prepare('SELECT * FROM transactions WHERE id=?').get(i), 'Lançamento não encontrado.');
    if (t.source !== 'manual') throw bad('Este lançamento foi gerado automaticamente. Altere ou exclua na origem (Dívidas, Metas ou Pagamento semanal).', 409);
    return t;
  };
  add('POST', '/api/transactions', ({ body }) => {
    const b = txBody(body);
    assertNotDuplicate(db, 'transactions', "source='manual' AND kind=? AND amount_cents=? AND date=? AND description=?", [b.kind, b.amount_cents, b.date, b.description]);
    const r = db.prepare("INSERT INTO transactions(kind,category,description,amount_cents,date,source) VALUES(?,?,?,?,?,'manual')").run(b.kind, b.category, b.description, b.amount_cents, b.date);
    return ok({ id: Number(r.lastInsertRowid) }, 201);
  });
  add('PUT', '/api/transactions/:id', ({ params, body }) => {
    const i = id(params.id); manualTx(i);
    const b = txBody(body);
    db.prepare('UPDATE transactions SET kind=?,category=?,description=?,amount_cents=?,date=? WHERE id=?').run(b.kind, b.category, b.description, b.amount_cents, b.date, i);
    return ok();
  });
  add('DELETE', '/api/transactions/:id', ({ params }) => { const i = id(params.id); manualTx(i); db.prepare('DELETE FROM transactions WHERE id=?').run(i); return ok(); });

  // ----- calendário -----
  const evBody = (x, cur) => ({
    title: reqText(x.title, 'Título'), date: reqDate(x.date), type: oneOf(x.type, ['conta', 'pagamento', 'trabalho', 'feriado', 'lembrete', 'outro'], 'Tipo de evento'),
    amount_cents: x.amount === undefined || x.amount === '' || x.amount === null ? 0 : parseMoney(x.amount, { allowZero: true }), note: optText(x.note),
    done: x.done === undefined ? (cur ? cur.done : 0) : (x.done === true || x.done === 1 || x.done === '1' ? 1 : 0),
  });
  add('POST', '/api/events', ({ body }) => {
    const b = evBody(body);
    assertNotDuplicate(db, 'events', 'title=? AND date=? AND type=?', [b.title, b.date, b.type]);
    const r = db.prepare('INSERT INTO events(title,date,type,amount_cents,note,done) VALUES(?,?,?,?,?,?)').run(b.title, b.date, b.type, b.amount_cents, b.note, b.done);
    return ok({ id: Number(r.lastInsertRowid) }, 201);
  });
  add('PUT', '/api/events/:id', ({ params, body }) => {
    const i = id(params.id), cur = must(db.prepare('SELECT * FROM events WHERE id=?').get(i), 'Evento não encontrado.');
    const b = evBody(body, cur);
    db.prepare('UPDATE events SET title=?,date=?,type=?,amount_cents=?,note=?,done=? WHERE id=?').run(b.title, b.date, b.type, b.amount_cents, b.note, b.done, i);
    return ok();
  });
  add('DELETE', '/api/events/:id', ({ params }) => {
    const r = db.prepare('DELETE FROM events WHERE id=?').run(id(params.id));
    if (!r.changes) throw bad('Evento não encontrado.', 404);
    return ok();
  });

  // ----- anotações -----
  const noteBody = (x) => ({ title: reqText(x.title, 'Título', 120), body: optText(x.body, 5000) });
  add('POST', '/api/notes', ({ body }) => {
    const b = noteBody(body);
    const r = db.prepare('INSERT INTO notes(title,body) VALUES(?,?)').run(b.title, b.body);
    return ok({ id: Number(r.lastInsertRowid) }, 201);
  });
  add('PUT', '/api/notes/:id', ({ params, body }) => {
    const i = id(params.id), b = noteBody(body);
    const r = db.prepare("UPDATE notes SET title=?,body=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(b.title, b.body, i);
    if (!r.changes) throw bad('Anotação não encontrada.', 404);
    return ok();
  });
  add('DELETE', '/api/notes/:id', ({ params }) => {
    const r = db.prepare('DELETE FROM notes WHERE id=?').run(id(params.id));
    if (!r.changes) throw bad('Anotação não encontrada.', 404);
    return ok();
  });

  // ----- semana de pagamento -----
  add('POST', '/api/weeks', ({ body }) => {
    const b = weekBody(db, body);
    const r = db.prepare('INSERT INTO weeks(pay_date,period_start,period_end,base_cents,daily_cents,note) VALUES(?,?,?,?,?,?)').run(b.pay_date, b.period_start, b.period_end, b.base_cents, b.daily_cents, b.note);
    return ok({ id: Number(r.lastInsertRowid) }, 201);
  });
  add('PUT', '/api/weeks/:id', ({ params, body }) => {
    const i = id(params.id); getWeek(db, i);
    const b = weekBody(db, body, i);
    db.prepare('UPDATE weeks SET pay_date=?,period_start=?,period_end=?,base_cents=?,daily_cents=?,note=? WHERE id=?').run(b.pay_date, b.period_start, b.period_end, b.base_cents, b.daily_cents, b.note, i);
    return ok();
  });
  add('DELETE', '/api/weeks/:id', ({ params }) => T(() => {
    const i = id(params.id); getWeek(db, i);
    for (const it of db.prepare('SELECT id FROM week_items WHERE week_id=?').all(i)) syncTx(db, 'salary_advance', it.id, null);
    for (const r of db.prepare('SELECT id FROM week_receipts WHERE week_id=?').all(i)) syncTx(db, 'salary', r.id, null);
    db.prepare('DELETE FROM weeks WHERE id=?').run(i);
    return ok();
  }));
  const itemBody = (x) => ({ kind: oneOf(x.kind, ['vale', 'desconto', 'extra'], 'Tipo do lançamento'), description: reqText(x.description, 'Descrição', 120), amount_cents: parseMoney(x.amount), date: reqDate(x.date) });
  const wantsCash = (x) => x.register_cash !== false && x.register_cash !== 'false' && x.register_cash !== 'off';
  add('POST', '/api/weeks/:id/items', ({ params, body }) => T(() => {
    const w = getWeek(db, id(params.id)), b = itemBody(body);
    assertNotDuplicate(db, 'week_items', 'week_id=? AND kind=? AND amount_cents=? AND date=? AND description=?', [w.id, b.kind, b.amount_cents, b.date, b.description]);
    const r = db.prepare('INSERT INTO week_items(week_id,kind,description,amount_cents,date) VALUES(?,?,?,?,?)').run(w.id, b.kind, b.description, b.amount_cents, b.date);
    const iid = Number(r.lastInsertRowid);
    if (b.kind === 'vale' && wantsCash(body)) syncTx(db, 'salary_advance', iid, itemSpec(w, { ...b }));
    return ok({ id: iid }, 201);
  }));
  add('PUT', '/api/week-items/:id', ({ params, body }) => T(() => {
    const i = id(params.id), cur = must(db.prepare('SELECT * FROM week_items WHERE id=?').get(i), 'Lançamento não encontrado.');
    const w = getWeek(db, cur.week_id), b = itemBody(body);
    const hadCash = !!db.prepare("SELECT 1 FROM transactions WHERE source='salary_advance' AND source_id=?").get(i);
    db.prepare('UPDATE week_items SET kind=?,description=?,amount_cents=?,date=? WHERE id=?').run(b.kind, b.description, b.amount_cents, b.date, i);
    const cash = body.register_cash === undefined ? hadCash : wantsCash(body);
    syncTx(db, 'salary_advance', i, b.kind === 'vale' && cash ? itemSpec(w, b) : null);
    return ok();
  }));
  add('DELETE', '/api/week-items/:id', ({ params }) => T(() => {
    const i = id(params.id);
    must(db.prepare('SELECT id FROM week_items WHERE id=?').get(i), 'Lançamento não encontrado.');
    syncTx(db, 'salary_advance', i, null);
    db.prepare('DELETE FROM week_items WHERE id=?').run(i);
    return ok();
  }));
  add('POST', '/api/weeks/:id/receipts', ({ params, body }) => T(() => {
    const w = weekSummary(db, getWeek(db, id(params.id)));
    const amount = body.amount === undefined || body.amount === '' ? w.remaining_cents : parseMoney(body.amount, { label: 'Valor recebido' });
    if (amount <= 0) throw bad('Não há valor restante a receber nesta semana.', 409);
    const date = body.date ? reqDate(body.date, 'Data do recebimento') : today();
    if (amount > w.remaining_cents) throw bad(`Valor acima do que falta receber (${brl(w.remaining_cents)}).`);
    assertNotDuplicate(db, 'week_receipts', 'week_id=? AND amount_cents=? AND date=?', [w.id, amount, date]);
    const r = db.prepare('INSERT INTO week_receipts(week_id,amount_cents,date) VALUES(?,?,?)').run(w.id, amount, date);
    const rid = Number(r.lastInsertRowid);
    if (wantsCash(body)) syncTx(db, 'salary', rid, { kind: 'entrada', category: 'Salário', description: `Salário recebido — semana de ${w.pay_date.split('-').reverse().join('/')}`, amount_cents: amount, date });
    return ok({ id: rid, remaining_cents: w.remaining_cents - amount }, 201);
  }));
  add('DELETE', '/api/week-receipts/:id', ({ params }) => T(() => {
    const i = id(params.id);
    must(db.prepare('SELECT id FROM week_receipts WHERE id=?').get(i), 'Recebimento não encontrado.');
    syncTx(db, 'salary', i, null);
    db.prepare('DELETE FROM week_receipts WHERE id=?').run(i);
    return ok();
  }));
  add('PUT', '/api/workdays/:date', ({ params, body }) => {
    const date = reqDate(params.date);
    if (body.status === null || body.status === '' || body.status === undefined) { db.prepare('DELETE FROM work_days WHERE date=?').run(date); return ok(); }
    const status = oneOf(body.status, ['trabalhado', 'falta', 'feriado', 'feriado_pago', 'folga'], 'Status do dia');
    db.prepare('INSERT INTO work_days(date,status,note) VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET status=excluded.status,note=excluded.note').run(date, status, optText(body.note, 120));
    return ok();
  });

  // ----- configurações -----
  add('PUT', '/api/settings', ({ body }) => T(() => {
    const cur = getSettings(db), next = { ...cur };
    if (body.weekly_base !== undefined) next.weekly_base_cents = parseMoney(body.weekly_base, { label: 'Salário semanal base' });
    if (body.daily_rate !== undefined) next.daily_rate_cents = parseMoney(body.daily_rate, { allowZero: true, label: 'Valor da diária' });
    if (body.debt_pct !== undefined) next.debt_pct = intRange(body.debt_pct, 0, 100, '% para dívidas');
    if (body.save_pct !== undefined) next.save_pct = intRange(body.save_pct, 0, 100, '% para economizar');
    if (body.alert_days !== undefined) next.alert_days = intRange(body.alert_days, 0, 30, 'Dias de antecedência dos alertas');
    if (next.debt_pct + next.save_pct > 100) throw bad('A soma de dívidas + economia não pode passar de 100% (o restante é seu dinheiro pessoal).');
    const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const k of Object.keys(next)) up.run(k, String(next[k]));
    return ok();
  }));

  return routes;
}

function mapDbError(e) {
  const m = String(e.message || '');
  if (/UNIQUE constraint failed: weeks\.pay_date/.test(m)) return bad('Já existe uma semana com essa data de pagamento.', 409);
  if (/UNIQUE constraint/.test(m)) return bad('Registro duplicado.', 409);
  if (/CHECK constraint|NOT NULL constraint|FOREIGN KEY constraint/.test(m)) return bad('Dados inválidos para o banco de dados.', 400);
  return null;
}

module.exports = { createRoutes, HttpError, mapDbError, parseMoney, getState };
