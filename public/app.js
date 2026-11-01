'use strict';
(function () {
if (window.__v7loaded) return; // já iniciado (evita ouvintes duplicados se o arquivo for carregado duas vezes)
window.__v7loaded = true; // sinaliza ao boot.js que este arquivo foi carregado e executado
/* Vitin7 Finance — interface. Nenhum valor é fixo no HTML: tudo vem de /api/data (SQLite). */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- ícones ----------
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l12-4v4"/><circle cx="17" cy="14" r="1"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  swap: '<path d="M7 4v14M3 14l4 4 4-4"/><path d="M17 20V6M13 10l4-4 4 4"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-8"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 12h6M9 16h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  check: '<path d="M5 12l4.5 4.5L19 7"/>', left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M12 4v12M6 11l6 6 6-6M5 20h14"/>', up: '<path d="M12 20V8M6 13l6-6 6 6M5 4h14"/>', bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

const NAV = [
  ['inicio', 'Início', 'home', 'Visão geral das suas finanças.'],
  ['dividas', 'Dívidas', 'wallet', 'Quanto você deve, quanto já pagou e o que falta.'],
  ['semana', 'Salário', 'briefcase', 'Controle semanal: dias, vales, descontos e recebimento.'],
  ['metas', 'Metas', 'target', 'Cada depósito aproxima você do objetivo.'],
  ['movimentos', 'Movimentações', 'swap', 'Receitas e despesas registradas.'],
  ['calendario', 'Calendário', 'calendar', 'Vencimentos, pagamentos e compromissos.'],
  ['relatorios', 'Relatórios', 'chart', 'Quanto entrou, saiu, foi para dívidas e para a reserva.'],
  ['plano', 'Planejamento', 'compass', 'Uma ordem de pagamento sem comprometer todo o salário.'],
  ['notas', 'Anotações', 'note', 'Registre o que for importante.'],
  ['config', 'Ajustes', 'gear', 'Valores base, notificações e backup.'],
];
const BOTTOM = ['inicio', 'dividas', 'semana', 'metas'];

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const toIn = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',');
const fd = (d) => (d ? d.split('-').reverse().join('/') : '—');
const fdShort = (d) => `${d.slice(8)}/${d.slice(5, 7)}`;
const wdShort = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
const monthLabel = (m) => new Date(m + '-01T12:00:00Z').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShort = (m) => new Date(m + '-01T12:00:00Z').toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const compact = (c) => { const v = c / 100; return Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); };

const STATUS_DAY = { trabalhado: 'Trabalhou', falta: 'Falta (desconta a diária)', feriado: 'Feriado não pago (desconta a diária)', feriado_pago: 'Feriado pago', folga: 'Folga' };
const EV_TYPES = [['conta', 'Conta a pagar'], ['pagamento', 'Pagamento a receber'], ['trabalho', 'Trabalho'], ['feriado', 'Feriado'], ['lembrete', 'Lembrete'], ['outro', 'Outro']];
const EV_COLOR = { conta: 'red', pagamento: 'green', trabalho: 'blue', feriado: 'gray', lembrete: '', outro: 'gray' };
const WEEK_CHIP = { previsto: ['Previsto', 'gold'], parcial: ['Parcial', 'blue'], recebido: ['Recebido', 'green'] };
const SRC_LABEL = { salary: 'Salário', salary_advance: 'Vale', debt_payment: 'Dívida', goal_deposit: 'Meta', goal_withdraw: 'Meta' };

// ---------- estado ----------
let S = null;
const ui = { page: 'inicio', debtFilter: 'abertas', debtSort: 'prioridade', weekId: null, txMonth: null, txKind: 'todos', calMonth: null, calDay: null, repPeriod: 'month', repMonth: null, planAvail: '', open: new Set() };
let renderToken = 0;

// ---------- API ----------
async function api(route, { method = 'GET', body, timeout = 20000 } = {}) {
  const attempts = method === 'GET' ? 3 : 1; // leituras são repetidas; escritas nunca (evita duplicar lançamento)
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((res) => setTimeout(res, 900 * i));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch('/api' + route, { method, signal: ctl.signal, headers: { 'X-Requested-With': 'vitin7', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
      let data = null;
      try { data = await r.json(); } catch { /* resposta sem corpo JSON */ }
      if (!r.ok) {
        const err = new Error((data && data.error) || `Erro ${r.status} ao falar com o servidor.`);
        err.status = r.status;
        if (method === 'GET' && [502, 503, 504].includes(r.status) && i < attempts - 1) { lastErr = err; continue; }
        throw err;
      }
      if (data === null || typeof data !== 'object') throw new Error('O servidor respondeu algo inesperado (não é JSON). Se estiver na hospedagem, confira se a aplicação iniciou sem erros nos logs.');
      return data;
    } catch (e) {
      if (e.status) throw e; // erro HTTP já tratado: não repetir
      lastErr = e.name === 'AbortError'
        ? new Error('O servidor demorou demais para responder (mais de ' + Math.round(timeout / 1000) + 's).')
        : (e.message && !/fetch|network|load failed/i.test(e.message) ? e : new Error('Servidor indisponível. Verifique sua conexão e se a aplicação está online.'));
    } finally { clearTimeout(timer); }
  }
  throw lastErr;
}
function setConn(ok, text) { const c = $('#conn'); c.className = 'conn ' + (ok ? 'ok' : 'err'); $('span:last-child', c).textContent = text; }
let retryTimer;
async function load() {
  clearTimeout(retryTimer);
  try {
    const data = await api('/data');
    if (!data || !data.dashboard || !data.settings) throw new Error('Resposta incompleta do servidor.');
    S = data;
    setConn(true, 'Banco conectado');
  } catch (e) {
    setConn(false, 'Sem conexão');
    window.__v7ready = true;
    if (S) { toast(e.message, true); return false; } // já havia dados na tela: mantém e avisa
    $('#content').innerHTML = `<div class="hint warn"><b>Não foi possível carregar os dados.</b> ${esc(e.message)} <button class="btn sm" data-act="retry">Tentar novamente</button><br><small>Nova tentativa automática em instantes… (<a href="/api/health" target="_blank" rel="noopener">testar servidor</a>)</small></div>`;
    retryTimer = setTimeout(load, 6000);
    return false;
  }
  ui.txMonth = ui.txMonth || S.today.slice(0, 7);
  ui.calMonth = ui.calMonth || S.today.slice(0, 7);
  ui.repMonth = ui.repMonth || S.today.slice(0, 7);
  try { await render(); } catch (e) {
    console.error(e);
    $('#content').innerHTML = `<div class="hint warn"><b>Erro ao montar a tela.</b> ${esc(e.message)} <button class="btn sm" data-act="retry">Tentar novamente</button></div>`;
  }
  window.__v7ready = true;
  maybeNotify();
  return true;
}

// ---------- feedback ----------
let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, error ? 5000 : 3200);
}

// ---------- modal ----------
function fieldHtml(f) {
  const v = f.value ?? '';
  const wide = f.wide ? ' wide' : '';
  const hint = f.hint ? `<small>${esc(f.hint)}</small>` : '';
  if (f.type === 'checkbox') return `<label class="check wide" ${f.id ? `id="${f.id}"` : ''}><input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
  if (f.type === 'select') return `<label class="field${wide}"><span>${esc(f.label)}</span><select name="${f.name}">${f.options.map(([val, t]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>${hint}</label>`;
  if (f.type === 'textarea') return `<label class="field${wide}"><span>${esc(f.label)}</span><textarea name="${f.name}" rows="4" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>${hint}</label>`;
  const type = f.type === 'money' || f.type === 'percent' ? 'text' : (f.type || 'text');
  const mode = f.type === 'money' || f.type === 'percent' ? 'inputmode="decimal"' : '';
  const ph = f.placeholder ?? (f.type === 'money' ? '0,00' : '');
  return `<label class="field${wide}"><span>${esc(f.label)}</span><input type="${type}" name="${f.name}" value="${esc(v)}" ${mode} placeholder="${esc(ph)}" ${f.required ? 'required' : ''} autocomplete="off">${hint}</label>`;
}
function closeModal() { const m = $('#modal'); if (m.open) m.close(); }
function openForm({ title, sub = '', fields = [], submit = 'Salvar', extra = '', onOpen, onSubmit, danger = false }) {
  const stale = $('#modal-form');
  const form = stale.cloneNode(false); // formulário novo a cada abertura: descarta ouvintes de diálogos anteriores
  stale.replaceWith(form);
  form.innerHTML = `<h3>${esc(title)}</h3>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}${fields.length ? `<div class="fields">${fields.map(fieldHtml).join('')}</div>` : ''}${extra}<div class="modal-error" id="modal-error" role="alert"></div><div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button type="submit" class="btn ${danger ? 'danger' : ''}" id="modal-submit">${esc(submit)}</button></div>`;
  const err = $('#modal-error', form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const values = {};
    for (const f of fields) {
      const el = form.elements.namedItem(f.name);
      if (!el) continue;
      values[f.name] = f.type === 'checkbox' ? el.checked : el.value;
      if (f.required && !String(values[f.name]).trim()) { err.textContent = `Preencha: ${f.label}.`; el.focus(); return; }
    }
    const btn = $('#modal-submit'); btn.disabled = true; err.textContent = '';
    try {
      const msg = await onSubmit(values);
      closeModal();
      if (msg) toast(msg);
      await load();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
  $('[data-close]', form).onclick = closeModal;
  if (onOpen) onOpen(form);
  const m = $('#modal');
  if (!m.open) m.showModal();
  const first = $('input:not([type=checkbox]),select,textarea', form);
  if (first && window.innerWidth > 800) first.focus();
}
const confirmBox = ({ title, text, confirm = 'Excluir' }) => new Promise((resolve) => {
  let done = false;
  openForm({ title, sub: text, submit: confirm, danger: true, onSubmit: async () => { done = true; resolve(true); return ''; } });
  $('#modal').addEventListener('close', () => { if (!done) resolve(false); }, { once: true });
});
async function mutate(fn, okMsg) {
  try { await fn(); toast(okMsg); await load(); } catch (e) { toast(e.message, true); }
}

// ---------- componentes ----------
const stat = (label, value, cls = '', sub = '') => `<div class="card stat"><small>${esc(label)}</small><span class="v money ${cls}">${value}</span>${sub ? `<span class="s">${esc(sub)}</span>` : ''}</div>`;
const empty = (text, btn = '') => `<div class="empty">${esc(text)}${btn ? `<div>${btn}</div>` : ''}</div>`;
const btn = (act, label, { cls = '', icon = '', data = {} } = {}) => `<button type="button" class="btn ${cls}" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${icon ? ic(icon) : ''}${label ? `<span>${esc(label)}</span>` : ''}</button>`;
const iconBtn = (act, icon, label, data = {}, cls = 'ghost') => `<button type="button" class="btn sm icon ${cls}" data-act="${act}" aria-label="${esc(label)}" title="${esc(label)}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${ic(icon)}</button>`;
const weekChip = (st) => `<span class="chip ${WEEK_CHIP[st][1]}">${WEEK_CHIP[st][0]}</span>`;
const sign = (dir) => (dir === 'entrada' ? '+' : '−');

function barChart(rows, labelFn, series) {
  const W = 640, H = 230, L = 46, R = 8, T = 12, B = 28;
  const max = Math.max(1, ...rows.flatMap(r => series.map(s => Math.max(0, r[s.key]))));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const gw = (W - L - R) / rows.length, bw = Math.min(26, (gw * 0.76) / series.length);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const y = T + (H - T - B) * (1 - i / 4);
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#2a2824"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${compact(top * i / 4)}</text>`;
  }
  rows.forEach((r, i) => {
    const x0 = L + gw * i + (gw - bw * series.length) / 2;
    series.forEach((s, j) => {
      const h = Math.max(0, r[s.key]) / top * (H - T - B);
      g += `<rect x="${x0 + j * bw}" y="${H - B - h}" width="${bw - 2}" height="${Math.max(h, r[s.key] > 0 ? 2 : 0)}" rx="3" fill="${s.color}"><title>${esc(labelFn(r))} • ${esc(s.label)}: ${brl(r[s.key])}</title></rect>`;
    });
    g += `<text x="${L + gw * i + gw / 2}" y="${H - 9}" text-anchor="middle">${esc(labelFn(r))}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras">${g}</svg><div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`;
}
const C = { green: '#86d1a2', red: '#f08d8a', gold: '#e0b866', blue: '#8fbbe0' };

// ---------- páginas ----------
const pages = {
  inicio() {
    const d = S.dashboard, w = d.week;
    const hero = w
      ? `<div class="hero"><div class="lbl">Falta receber · pagamento em ${fd(w.pay_date)}</div><div class="big money">${brl(w.remaining_cents)}</div>
         <div class="meta"><span>Líquido previsto <b>${brl(w.net_cents)}</b></span><span>Já recebido (vales e pagamentos) <b>${brl(w.received_cents)}</b></span>${weekChip(w.status)}</div>
         <div class="acts">${w.remaining_cents > 0 ? btn('receive', 'Receber salário', { icon: 'check', data: { id: w.id } }) : ''}${btn('open-week', 'Abrir semana', { cls: 'ghost', data: { id: w.id } })}</div></div>`
      : `<div class="hero"><div class="lbl">Salário semanal</div><div class="big money">${brl(S.settings.weekly_base_cents)}</div><div class="meta"><span>Nenhuma semana cadastrada ainda.</span></div><div class="acts">${btn('week-new', 'Cadastrar semana de pagamento', { icon: 'plus' })}</div></div>`;
    const quick = `<div class="toolbar">${btn('tx-new', 'Receita', { cls: 'soft', icon: 'plus', data: { kind: 'entrada' } })}${btn('tx-new', 'Despesa', { cls: 'soft', icon: 'plus', data: { kind: 'saida' } })}${btn('debt-pay', 'Pagar dívida', { cls: 'soft', icon: 'wallet' })}${btn('goal-move', 'Guardar em meta', { cls: 'soft', icon: 'target', data: { kind: 'deposito' } })}</div>`;
    const stats = `<div class="grid g4">
      ${stat('Saldo financeiro registrado', brl(d.balance_cents), d.balance_cents < 0 ? 'red' : 'gold', 'Entradas − saídas registradas')}
      ${stat('Salário previsto da semana', w ? brl(w.net_cents) : '—', '', w ? `${fd(w.period_start)} a ${fd(w.period_end)}` : 'Sem semana cadastrada')}
      ${stat('Falta receber', w ? brl(w.remaining_cents) : '—', 'green', w ? `Vales recebidos: ${brl(w.vales_cents)}` : '')}
      ${stat('Dívidas pendentes', brl(d.debts_pending_cents), d.debts_pending_cents ? 'red' : 'green', `${d.debts_open_count} em aberto`)}
      ${stat('Gastos do mês', brl(d.month_spent_cents), 'red', 'Sem dívidas e metas')}
      ${stat('Receitas do mês', brl(d.month_income_cents), 'green', monthLabel(d.month))}
      ${stat('Valor guardado', brl(d.saved_total_cents), 'gold', 'Soma das metas')}
      ${stat('Pago em dívidas (mês)', brl(d.month_debt_paid_cents), '', 'Pagamentos registrados')}</div>`;
    const chart = `<div class="panel"><div class="panel-head"><h3>Entradas e saídas</h3><span class="muted" style="font-size:12.5px">Últimos 6 meses</span></div>${barChart(d.series, r => monthShort(r.month), [{ key: 'income_cents', label: 'Entradas', color: C.green }, { key: 'spent_cents', label: 'Gastos', color: C.red }, { key: 'debt_paid_cents', label: 'Dívidas pagas', color: C.gold }])}</div>`;
    const upcoming = `<div class="panel"><div class="panel-head"><h3>Próximas contas</h3>${btn('go', 'Calendário', { cls: 'ghost sm', data: { page: 'calendario' } })}</div>${d.upcoming.length ? d.upcoming.map(u => `<div class="row"><div class="main"><b>${esc(u.title)}</b><small>${fd(u.date)} · ${u.days < 0 ? `venceu há ${-u.days} dia(s)` : u.days === 0 ? 'hoje' : `em ${u.days} dia(s)`}</small></div><div class="side"><span class="amt ${u.days < 0 ? 'red' : ''}">${brl(u.amount_cents)}</span></div></div>`).join('') : empty('Nenhuma conta ou vencimento cadastrado.')}</div>`;
    const goals = `<div class="panel"><div class="panel-head"><h3>Metas</h3>${btn('go', 'Ver metas', { cls: 'ghost sm', data: { page: 'metas' } })}</div>${d.goals.length ? d.goals.map(g => `<div class="row"><div class="main"><b>${esc(g.name)}</b><small>${brl(g.saved_cents)} de ${brl(g.target_cents)}</small><div class="bar"><i style="width:${g.percent}%"></i></div></div><div class="side"><span class="amt gold">${g.percent}%</span></div></div>`).join('') : empty('Crie sua primeira meta.', btn('goal-new', 'Nova meta', { icon: 'plus' }))}</div>`;
    const act = `<div class="panel"><h3>Atividades recentes</h3>${d.activity.length ? d.activity.map(a => `<div class="row"><div class="main"><b>${esc(a.text)}</b><small>${fd(a.date)}</small></div><div class="side"><span class="amt ${a.dir === 'entrada' ? 'green' : 'red'}">${sign(a.dir)}${brl(a.amount_cents)}</span></div></div>`).join('') : empty('As movimentações aparecerão aqui.')}</div>`;
    return `${hero}${quick}${stats}<div class="split">${chart}${upcoming}</div><div class="split" style="margin-top:16px">${act}${goals}</div>`;
  },

  dividas() {
    const total = S.debts.reduce((a, d) => a + d.total_cents, 0), paid = S.debts.reduce((a, d) => a + d.paid_cents, 0);
    const open = S.debts.filter(d => d.remaining_cents > 0);
    let list = S.debts.filter(d => ui.debtFilter === 'todas' || (ui.debtFilter === 'abertas' ? d.remaining_cents > 0 : d.remaining_cents === 0));
    const dueKey = (d) => d.due_date || '9999-99-99';
    const sorters = {
      prioridade: (a, b) => a.priority - b.priority || dueKey(a).localeCompare(dueKey(b)) || b.remaining_cents - a.remaining_cents,
      vencimento: (a, b) => dueKey(a).localeCompare(dueKey(b)),
      valor: (a, b) => b.remaining_cents - a.remaining_cents,
      nome: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
    };
    list = list.sort(sorters[ui.debtSort]);
    const PR = { 1: ['Alta', 'red'], 2: ['Média', 'gold'], 3: ['Baixa', 'blue'] };
    const rows = list.map(d => {
      const pays = S.payments.filter(p => p.debt_id === d.id);
      const od = d.status === 'vencida' ? `<span class="chip red">Vencida</span>` : d.status === 'quitada' ? `<span class="chip green">Quitada</span>` : '';
      return `<div class="row" style="align-items:flex-start"><div class="main"><b>${esc(d.name)}</b> ${od}<span class="chip ${PR[d.priority][1]}">Prioridade ${PR[d.priority][0].toLowerCase()}</span>
        <small>${esc(d.description || '')}${d.description ? ' · ' : ''}${d.due_date ? 'vence em ' + fd(d.due_date) : 'sem vencimento'}${d.interest_bp ? ` · juros ${(d.interest_bp / 100).toLocaleString('pt-BR')}% ao mês` : ''}</small>
        <div class="bar ${d.remaining_cents === 0 ? 'green' : ''}"><i style="width:${d.percent}%"></i></div>
        <small>Pago ${brl(d.paid_cents)} de ${brl(d.total_cents)} · ${d.percent}%</small>
        <details class="hist" data-key="d${d.id}" ${ui.open.has('d' + d.id) ? 'open' : ''}><summary>Histórico de pagamentos (${pays.length})</summary>${pays.length ? pays.map(p => `<div class="hist-row"><span>${fd(p.paid_at)}${p.note ? ' · ' + esc(p.note) : ''}</span><span class="side"><b class="green">${brl(p.amount_cents)}</b>${iconBtn('pay-del', 'trash', 'Estornar pagamento', { id: p.id }, 'danger')}</span></div>`).join('') : '<div class="hist-row">Nenhum pagamento ainda.</div>'}</details></div>
        <div class="side" style="flex-direction:column;align-items:flex-end"><span class="amt ${d.remaining_cents ? 'red' : 'green'}" style="font-size:18px">${brl(d.remaining_cents)}</span><small class="faint">${d.remaining_cents ? 'restante' : 'sem saldo'}</small>
        <div class="side">${d.remaining_cents ? btn('debt-pay', 'Pagar', { cls: 'sm', data: { id: d.id } }) : ''}${iconBtn('debt-edit', 'edit', 'Editar dívida', { id: d.id })}${iconBtn('debt-del', 'trash', 'Excluir dívida', { id: d.id }, 'danger')}</div></div></div>`;
    }).join('');
    const mine = new Map(S.debts.map(d => [norm(d.name), d]));
    const conf = S.initial_debts.map(r => {
      const m = mine.get(norm(r.name));
      const state = !m ? `<span class="chip red">Não cadastrada</span> ${btn('add-initial', 'Adicionar', { cls: 'sm soft', data: { name: r.name, cents: r.cents } })}` : m.total_cents === r.cents ? `<span class="chip green">Confere</span>` : `<span class="chip gold">Valor diferente: cadastrado ${brl(m.total_cents)}</span>`;
      return `<div class="row"><div class="main"><b>${esc(r.name)}</b><small>Referência informada: ${brl(r.cents)}</small></div><div class="side">${state}</div></div>`;
    }).join('');
    const refTotal = S.initial_debts.reduce((a, r) => a + r.cents, 0);
    return `<div class="grid g4">${stat('Saldo devedor', brl(open.reduce((a, d) => a + d.remaining_cents, 0)), 'red', `${open.length} em aberto`)}${stat('Já pago', brl(paid), 'green')}${stat('Total original', brl(total), '')}${stat('Quitadas', String(S.debts.length - open.length), 'gold', `de ${S.debts.length}`)}</div>
      <div class="toolbar">${btn('debt-new', 'Nova dívida', { icon: 'plus' })}<span class="grow"></span>
        <select data-change="debt-filter" aria-label="Filtro"><option value="abertas" ${ui.debtFilter === 'abertas' ? 'selected' : ''}>Em aberto</option><option value="quitadas" ${ui.debtFilter === 'quitadas' ? 'selected' : ''}>Quitadas</option><option value="todas" ${ui.debtFilter === 'todas' ? 'selected' : ''}>Todas</option></select>
        <select data-change="debt-sort" aria-label="Ordenar">${[['prioridade', 'Ordenar: prioridade'], ['vencimento', 'Ordenar: vencimento'], ['valor', 'Ordenar: maior valor'], ['nome', 'Ordenar: nome']].map(([v, t]) => `<option value="${v}" ${ui.debtSort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="panel">${rows || empty('Nenhuma dívida neste filtro.', btn('debt-new', 'Cadastrar dívida', { icon: 'plus' }))}</div>
      <details class="panel hist" data-key="conf" ${ui.open.has('conf') ? 'open' : ''}><summary>Conferir cadastro inicial (referência: ${brl(refTotal)})</summary><p class="muted" style="font-size:13px">Valores informados na criação do sistema. Nada é alterado automaticamente: se algum valor estiver diferente, edite a dívida.</p>${conf}</details>`;
  },

  metas() {
    const saved = S.goals.reduce((a, g) => a + Math.max(0, g.saved_cents), 0), target = S.goals.reduce((a, g) => a + g.target_cents, 0);
    const rows = S.goals.map(g => {
      const moves = S.goal_moves.filter(m => m.goal_id === g.id);
      const left = g.deadline ? daysBetween(S.today, g.deadline) : null;
      return `<div class="row" style="align-items:flex-start"><div class="main"><b>${esc(g.name)}</b> ${g.percent >= 100 ? '<span class="chip green">Meta atingida</span>' : ''}
        <small>${brl(g.saved_cents)} de ${brl(g.target_cents)} · faltam ${brl(g.missing_cents)}${g.deadline ? ` · prazo ${fd(g.deadline)}${left !== null && g.percent < 100 ? (left < 0 ? ' (vencido)' : ` (${left} dias)`) : ''}` : ''}</small>
        <div class="bar green"><i style="width:${g.percent}%"></i></div>
        <details class="hist" data-key="g${g.id}" ${ui.open.has('g' + g.id) ? 'open' : ''}><summary>Histórico (${moves.length})</summary>${moves.length ? moves.map(m => `<div class="hist-row"><span>${fd(m.date)} · ${m.kind === 'deposito' ? 'Depósito' : 'Retirada'}${m.note ? ' · ' + esc(m.note) : ''}</span><span class="side"><b class="${m.kind === 'deposito' ? 'green' : 'red'}">${m.kind === 'deposito' ? '+' : '−'}${brl(m.amount_cents)}</b>${iconBtn('move-del', 'trash', 'Excluir movimentação', { id: m.id }, 'danger')}</span></div>`).join('') : '<div class="hist-row">Sem depósitos ainda.</div>'}</details></div>
        <div class="side" style="flex-direction:column;align-items:flex-end"><span class="amt gold" style="font-size:22px">${g.percent}%</span><div class="side">${btn('goal-move', 'Depositar', { cls: 'sm', data: { id: g.id, kind: 'deposito' } })}${btn('goal-move', 'Retirar', { cls: 'sm ghost', data: { id: g.id, kind: 'retirada' } })}${iconBtn('goal-edit', 'edit', 'Editar meta', { id: g.id })}${iconBtn('goal-del', 'trash', 'Excluir meta', { id: g.id }, 'danger')}</div></div></div>`;
    }).join('');
    return `<div class="grid g3">${stat('Total guardado', brl(saved), 'gold')}${stat('Valor de todas as metas', brl(target))}${stat('Falta guardar', brl(Math.max(0, target - saved)), 'red')}</div>
      <div class="toolbar">${btn('goal-new', 'Nova meta', { icon: 'plus' })}</div>
      <div class="panel">${rows || empty('Crie uma meta: moto, viagem, reserva de emergência…', btn('goal-new', 'Criar meta', { icon: 'plus' }))}</div>
      <div class="hint">Depósitos saem do seu saldo registrado (viram uma saída “Metas”, que não conta como gasto). Retirar devolve o valor ao saldo. Ao registrar, você pode desmarcar essa opção.</div>`;
  },

  movimentos() {
    const months = [...new Set([S.today.slice(0, 7), ...S.transactions.map(t => t.date.slice(0, 7))])].sort().reverse();
    const list = S.transactions.filter(t => t.date.slice(0, 7) === ui.txMonth && (ui.txKind === 'todos' || t.kind === ui.txKind));
    const inc = list.filter(t => t.kind === 'entrada').reduce((a, t) => a + t.amount_cents, 0), out = list.filter(t => t.kind === 'saida').reduce((a, t) => a + t.amount_cents, 0);
    return `<div class="toolbar">${btn('tx-new', 'Receita', { icon: 'plus', data: { kind: 'entrada' } })}${btn('tx-new', 'Despesa', { icon: 'plus', cls: 'soft', data: { kind: 'saida' } })}<span class="grow"></span>
      <select data-change="tx-month" aria-label="Mês">${months.map(m => `<option value="${m}" ${m === ui.txMonth ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
      <select data-change="tx-kind" aria-label="Tipo">${[['todos', 'Todos'], ['entrada', 'Entradas'], ['saida', 'Saídas']].map(([v, t]) => `<option value="${v}" ${ui.txKind === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="grid g3">${stat('Entradas', brl(inc), 'green')}${stat('Saídas (inclui dívidas e metas)', brl(out), 'red')}${stat('Saldo do período', brl(inc - out), inc - out >= 0 ? 'gold' : 'red')}</div>
      <div class="panel">${list.length ? list.map(t => `<div class="row"><div class="main"><b>${esc(t.description)}</b> ${t.source !== 'manual' ? `<span class="chip">${SRC_LABEL[t.source] || 'Automático'} · automático</span>` : ''}<small>${esc(t.category || 'Sem categoria')} · ${fd(t.date)}</small></div><div class="side"><span class="amt ${t.kind === 'entrada' ? 'green' : 'red'}">${sign(t.kind)}${brl(t.amount_cents)}</span>${t.source === 'manual' ? iconBtn('tx-edit', 'edit', 'Editar', { id: t.id }) + iconBtn('tx-del', 'trash', 'Excluir', { id: t.id }, 'danger') : ''}</div></div>`).join('') : empty('Nenhuma movimentação neste período.')}</div>
      <div class="hint">Lançamentos marcados como <b>automático</b> nascem de pagamentos de dívidas, depósitos em metas e do salário. Para alterá-los, mexa na origem — assim nada é contado duas vezes.</div>`;
  },

  semana() {
    if (!S.weeks.length) return `<div class="panel">${empty('Nenhuma semana cadastrada. Crie a semana de pagamento para controlar dias, vales, descontos e o valor a receber.', btn('week-new', 'Cadastrar semana', { icon: 'plus' }))}</div>`;
    const w = S.weeks.find(x => x.id === ui.weekId) || S.weeks.find(x => x.id === S.dashboard.week?.id) || S.weeks[0];
    ui.weekId = w.id;
    const KIND = { vale: ['Vale', 'blue'], desconto: ['Desconto', 'red'], extra: ['Extra', 'green'] };
    const ids = []; for (let d = w.period_start; d <= w.period_end && ids.length < 33; d = addDays(d, 1)) ids.push(d);
    const dayMap = new Map(w.days.map(x => [x.date, x.status]));
    const line = (label, val, cls = '') => `<div class="sum-row"><span>${label}</span><span class="money ${cls}">${val}</span></div>`;
    const summary = `<div class="panel"><div class="panel-head"><h3>Cálculo da semana</h3>${weekChip(w.status)}</div>
      ${line('Salário-base previsto', brl(w.base_cents))}
      ${w.extras_cents ? line('Extras / horas extras', '+' + brl(w.extras_cents), 'green') : ''}
      ${line(`Faltas e feriados não pagos (${w.absence_days} × ${brl(w.daily_cents)})`, '−' + brl(w.absence_cents), w.absence_cents ? 'red' : '')}
      ${line('Descontos (compras, etc.)', '−' + brl(w.descontos_cents), w.descontos_cents ? 'red' : '')}
      <div class="sum-row total"><span>Total líquido da semana</span><span class="money gold">${brl(w.net_cents)}</span></div>
      ${line('Vales/adiantamentos já recebidos', '−' + brl(w.vales_cents), 'blue')}
      ${line('Salário já recebido', '−' + brl(w.receipts_cents), 'green')}
      <div class="sum-row total"><span>Falta receber</span><span class="money ${w.remaining_cents ? 'green' : 'muted'}">${brl(w.remaining_cents)}</span></div>
      ${w.over_cents ? `<div class="hint warn" style="margin-top:10px">Você recebeu ${brl(w.over_cents)} a mais do que o líquido da semana. Confira vales e descontos.</div>` : ''}
      <p class="muted" style="font-size:12.5px;margin:10px 0 0">Vales já entraram no seu caixa quando foram recebidos; aqui eles só reduzem o que falta, sem contar como despesa.</p></div>`;
    const receipts = `<div class="panel"><div class="panel-head"><h3>Recebimentos do salário</h3>${w.remaining_cents > 0 ? btn('receive', 'Receber', { cls: 'sm', icon: 'check', data: { id: w.id } }) : ''}</div>
      ${w.receipts.length ? w.receipts.map(r => `<div class="row"><div class="main"><b>Recebido em ${fd(r.date)}</b></div><div class="side"><span class="amt green">${brl(r.amount_cents)}</span>${iconBtn('receipt-del', 'trash', 'Excluir recebimento', { id: r.id }, 'danger')}</div></div>`).join('') : empty('Nenhum recebimento registrado nesta semana.')}</div>`;
    const days = `<div class="panel"><div class="panel-head"><h3>Dias da semana</h3><span class="muted" style="font-size:12.5px">Trabalhou ${w.counts.trabalhado} · Faltas ${w.counts.falta} · Feriados não pagos ${w.counts.feriado}</span></div>
      <div class="days">${ids.map(d => `<div class="daycell ${dayMap.get(d) || ''}"><b>${wdShort(d)}</b><small>${fdShort(d)}</small><select data-change="day-status" data-date="${d}" aria-label="Status de ${fd(d)}"><option value="">Sem registro</option>${Object.entries(STATUS_DAY).map(([v, t]) => `<option value="${v}" ${dayMap.get(d) === v ? 'selected' : ''}>${t.split(' (')[0]}</option>`).join('')}</select></div>`).join('')}</div>
      <p class="muted" style="font-size:12.5px;margin:10px 0 0">“Falta” e “Feriado não pago” descontam a diária de ${brl(w.daily_cents)}. Dias sem registro contam como trabalhados.</p></div>`;
    const items = `<div class="panel"><div class="panel-head"><h3>Vales, descontos e extras</h3><div class="toolbar" style="margin:0">${btn('item-new', 'Vale', { cls: 'sm soft', data: { kind: 'vale' } })}${btn('item-new', 'Desconto', { cls: 'sm soft', data: { kind: 'desconto' } })}${btn('item-new', 'Extra', { cls: 'sm soft', data: { kind: 'extra' } })}</div></div>
      ${w.items.length ? w.items.map(i => `<div class="row"><div class="main"><b>${esc(i.description)}</b> <span class="chip ${KIND[i.kind][1]}">${KIND[i.kind][0]}</span><small>${fd(i.date)}</small></div><div class="side"><span class="amt ${i.kind === 'extra' ? 'green' : 'red'}">${i.kind === 'extra' ? '+' : '−'}${brl(i.amount_cents)}</span>${iconBtn('item-edit', 'edit', 'Editar', { id: i.id })}${iconBtn('item-del', 'trash', 'Excluir', { id: i.id }, 'danger')}</div></div>`).join('') : empty('Nenhum vale, desconto ou extra nesta semana.')}</div>`;
    const history = `<div class="panel"><h3>Todas as semanas</h3>${S.weeks.map(x => `<div class="row"><div class="main"><b>Pagamento ${fd(x.pay_date)}</b><small>Período ${fd(x.period_start)} a ${fd(x.period_end)} · líquido ${brl(x.net_cents)}</small></div><div class="side">${weekChip(x.status)}<span class="amt">${brl(x.remaining_cents)}</span>${x.id === w.id ? '<span class="chip gold">aberta</span>' : btn('open-week', 'Abrir', { cls: 'sm ghost', data: { id: x.id } })}</div></div>`).join('')}</div>`;
    return `<div class="toolbar"><select data-change="week-select" aria-label="Semana">${S.weeks.map(x => `<option value="${x.id}" ${x.id === w.id ? 'selected' : ''}>Pagamento ${fd(x.pay_date)} — ${WEEK_CHIP[x.status][0]}</option>`).join('')}</select>${btn('week-new', 'Nova semana', { icon: 'plus' })}${btn('week-edit', 'Editar', { cls: 'ghost', data: { id: w.id } })}${iconBtn('week-del', 'trash', 'Excluir semana', { id: w.id }, 'danger')}</div>
      <div class="hint">Período: <b>${fd(w.period_start)} a ${fd(w.period_end)}</b> · pagamento em <b>${fd(w.pay_date)}</b>. Cada semana é calculada sozinha: nada daqui altera outra semana.</div>
      <div class="split">${summary}<div>${receipts}${items}</div></div>${days}${history}`;
  },

  calendario() {
    const [y, mo] = ui.calMonth.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1, 12));
    const lead = (first.getUTCDay() + 6) % 7;
    const itemsOn = (date) => {
      const out = [];
      S.events.filter(e => e.date === date).forEach(e => out.push({ c: EV_COLOR[e.type], t: e.title, sub: EV_TYPES.find(x => x[0] === e.type)[1] + (e.amount_cents ? ' · ' + brl(e.amount_cents) : '') + (e.done ? ' · concluído' : ''), ev: e }));
      S.debts.filter(d => d.remaining_cents > 0 && d.due_date === date).forEach(d => out.push({ c: 'red', t: 'Vence: ' + d.name, sub: 'Dívida · ' + brl(d.remaining_cents) }));
      S.weeks.filter(w => w.pay_date === date).forEach(w => out.push({ c: 'green', t: 'Pagamento do salário', sub: w.remaining_cents ? 'A receber ' + brl(w.remaining_cents) : 'Recebido' }));
      const wd = S.work_days.find(x => x.date === date);
      if (wd) out.push({ c: wd.status === 'trabalhado' ? 'green' : wd.status === 'falta' || wd.status === 'feriado' ? 'red' : 'gray', t: STATUS_DAY[wd.status].split(' (')[0], sub: 'Dia de trabalho' });
      return out;
    };
    let cells = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map(x => `<div class="wd">${x}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const date = addDays(first.toISOString().slice(0, 10), i - lead);
      const its = itemsOn(date);
      cells += `<button type="button" class="day ${date.slice(0, 7) !== ui.calMonth ? 'other' : ''} ${date === S.today ? 'today' : ''} ${date === ui.calDay ? 'sel' : ''}" data-act="cal-day" data-date="${date}" aria-label="${fd(date)}${its.length ? ', ' + its.length + ' item(ns)' : ''}"><b>${Number(date.slice(8))}</b><span class="dots">${its.slice(0, 5).map(x => `<i class="${x.c}"></i>`).join('')}</span></button>`;
    }
    const selected = ui.calDay || S.today;
    const sel = itemsOn(selected);
    const up = S.events.filter(e => e.date >= S.today).slice(0, 8);
    return `<div class="split"><div class="panel"><div class="cal-head">${iconBtn('cal-prev', 'left', 'Mês anterior')}<h3>${monthLabel(ui.calMonth)}</h3>${iconBtn('cal-next', 'right', 'Próximo mês')}</div><div class="cal">${cells}</div>
      <div class="legend"><span><i style="background:var(--red)"></i>Contas e vencimentos</span><span><i style="background:var(--green)"></i>Pagamentos e dias trabalhados</span><span><i style="background:var(--blue)"></i>Trabalho</span><span><i style="background:var(--gold)"></i>Lembretes</span></div></div>
      <div><div class="panel"><div class="panel-head"><h3>${fd(selected)}</h3>${btn('ev-new', 'Evento', { cls: 'sm', icon: 'plus', data: { date: selected } })}</div>${sel.length ? sel.map(x => `<div class="row"><div class="main"><b>${esc(x.t)}</b><small>${esc(x.sub)}</small></div>${x.ev ? `<div class="side">${iconBtn('ev-done', 'check', x.ev.done ? 'Reabrir' : 'Marcar como concluído', { id: x.ev.id }, x.ev.done ? 'soft' : 'ghost')}${iconBtn('ev-edit', 'edit', 'Editar', { id: x.ev.id })}${iconBtn('ev-del', 'trash', 'Excluir', { id: x.ev.id }, 'danger')}</div>` : ''}</div>`).join('') : empty('Nada neste dia.')}</div>
      <div class="panel"><h3>Próximos compromissos</h3>${up.length ? up.map(e => `<div class="row"><div class="main"><b>${esc(e.title)}</b><small>${fd(e.date)} · ${EV_TYPES.find(x => x[0] === e.type)[1]}${e.done ? ' · concluído' : ''}</small></div><div class="side">${e.amount_cents ? `<span class="amt">${brl(e.amount_cents)}</span>` : ''}</div></div>`).join('') : empty('Nenhum compromisso futuro.')}</div></div></div>`;
  },

  notas() {
    return `<div class="toolbar">${btn('note-new', 'Nova anotação', { icon: 'plus' })}</div><div class="panel">${S.notes.length ? S.notes.map(n => `<div class="row" style="align-items:flex-start"><div class="main"><b>${esc(n.title)}</b><small style="white-space:pre-wrap">${esc(n.body)}</small></div><div class="side">${iconBtn('note-edit', 'edit', 'Editar', { id: n.id })}${iconBtn('note-del', 'trash', 'Excluir', { id: n.id }, 'danger')}</div></div>`).join('') : empty('Nenhuma anotação ainda.', btn('note-new', 'Criar anotação', { icon: 'plus' }))}</div>`;
  },

  config() {
    const s = S.settings;
    const notif = 'Notification' in window ? Notification.permission : 'indisponível';
    return `<div class="panel"><h3>Valores base e planejamento</h3><form id="settings-form" class="fields" novalidate>
        <label class="field"><span>Salário semanal base (R$)</span><input type="text" inputmode="decimal" name="weekly_base" value="${toIn(s.weekly_base_cents)}"></label>
        <label class="field"><span>Valor da diária (R$)</span><input type="text" inputmode="decimal" name="daily_rate" value="${toIn(s.daily_rate_cents)}"></label>
        <label class="field"><span>% do salário para dívidas</span><input type="text" inputmode="numeric" name="debt_pct" value="${s.debt_pct}"></label>
        <label class="field"><span>% do salário para economizar</span><input type="text" inputmode="numeric" name="save_pct" value="${s.save_pct}"></label>
        <label class="field"><span>Avisar com antecedência de (dias)</span><input type="text" inputmode="numeric" name="alert_days" value="${s.alert_days}"></label>
        <div class="field" style="align-self:end"><button class="btn" type="submit">Salvar ajustes</button></div></form>
        <p class="muted" style="font-size:12.5px;margin:12px 0 0">Mudar o salário base ou a diária vale para as <b>próximas</b> semanas; semanas já cadastradas mantêm seus valores. O restante (100% − dívidas − economia) fica reservado para suas despesas pessoais.</p></div>
      <div class="panel"><h3>Notificações do navegador</h3><p class="muted" style="margin-top:0">Permissão atual: <b>${notif === 'granted' ? 'concedida' : notif === 'denied' ? 'bloqueada' : notif === 'default' ? 'ainda não pedida' : notif}</b>. Os avisos aparecem quando você abre o app; não há envio em segundo plano com o app fechado (isso exigiria um serviço de push, que esta versão não usa). Alguns celulares só liberam notificações para apps instalados na tela inicial.</p>
        ${notif === 'default' ? btn('notif', 'Ativar notificações', { icon: 'bell' }) : ''}</div>
      <div class="panel"><h3>Backup</h3><p class="muted" style="margin-top:0">Baixe uma cópia completa dos seus dados e guarde fora do servidor. Ao restaurar, o servidor salva uma cópia do estado atual antes de substituir tudo (também aceita backups da versão 2.0).</p>
        <div class="toolbar">${btn('backup', 'Baixar backup', { icon: 'down' })}${btn('restore', 'Restaurar backup', { cls: 'ghost', icon: 'up' })}</div></div>
      <div class="panel"><h3>Sistema</h3><p class="muted" style="margin-top:0">Vitin7 Finance 3.0 · valores em centavos inteiros · SQLite persistente.</p><div class="toolbar">${btn('health', 'Verificar conexão', { cls: 'ghost sm' })}</div><p id="health-out" class="muted" style="margin:0"></p></div>
      <div class="hint warn"><b>Privacidade:</b> não há tela de login. Quem tiver o endereço público consegue ver e alterar seus dados. Veja no README como proteger com a variável ACCESS_KEY.</div>`;
  },
};

// páginas que precisam de dados extras do servidor
async function pageRelatorios() {
  const q = new URLSearchParams({ period: ui.repPeriod, month: ui.repMonth, count: ui.repPeriod === 'week' ? '8' : '6' });
  const r = await api('/reports?' + q);
  const months = [...new Set([S.today.slice(0, 7), ...S.transactions.map(t => t.date.slice(0, 7))])].sort().reverse();
  const sel = r.selected, maxCat = Math.max(1, ...r.categories.map(c => c.cents));
  const label = r.period === 'week' ? (x) => fdShort(x.week) : (x) => monthShort(x.month);
  const tot = (k) => r.rows.reduce((a, x) => a + x[k], 0);
  return `<div class="toolbar"><select data-change="rep-period" aria-label="Período"><option value="month" ${ui.repPeriod === 'month' ? 'selected' : ''}>Por mês</option><option value="week" ${ui.repPeriod === 'week' ? 'selected' : ''}>Por semana</option></select>
      <select data-change="rep-month" aria-label="Mês de referência">${months.map(m => `<option value="${m}" ${m === ui.repMonth ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></div>
    <div class="grid g4">${stat('Ganhei', brl(sel.income_cents), 'green', monthLabel(r.month))}${stat('Gastei', brl(sel.spent_cents), 'red', 'Sem dívidas e metas')}${stat('Paguei em dívidas', brl(sel.debt_paid_cents), 'gold')}${stat('Economizei (metas)', brl(sel.saved_cents), 'blue', `Sobrou livre: ${brl(sel.free_cents)}`)}</div>
    <div class="panel"><div class="panel-head"><h3>${r.period === 'week' ? 'Últimas 8 semanas (início na segunda)' : 'Últimos 6 meses'}</h3></div>${barChart(r.rows, label, [{ key: 'income_cents', label: 'Ganhei', color: C.green }, { key: 'spent_cents', label: 'Gastei', color: C.red }, { key: 'debt_paid_cents', label: 'Dívidas', color: C.gold }, { key: 'saved_cents', label: 'Economizei', color: C.blue }])}
      <div class="grid g4" style="margin:14px 0 0">${stat('Total ganho', brl(tot('income_cents')), 'green')}${stat('Total gasto', brl(tot('spent_cents')), 'red')}${stat('Total em dívidas', brl(tot('debt_paid_cents')), 'gold')}${stat('Total economizado', brl(tot('saved_cents')), 'blue')}</div></div>
    <div class="panel"><h3>Onde o dinheiro foi gasto em ${monthLabel(r.month)}</h3>${r.categories.length ? r.categories.map(c => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between"><b>${esc(c.name)}</b><span class="amt red">${brl(c.cents)}</span></div><div class="bar"><i style="width:${Math.round(c.cents / maxCat * 100)}%;background:linear-gradient(90deg,#8a3f3d,#f08d8a)"></i></div></div>`).join('') : empty('Nenhuma despesa categorizada neste mês.')}</div>`;
}

async function pagePlano() {
  const r = await api('/plan' + (ui.planAvail ? '?available=' + encodeURIComponent(ui.planAvail) : ''));
  const seg = (c, color) => `<i style="width:${r.basis_cents ? Math.max(0, c / r.basis_cents * 100) : 0}%;background:${color}"></i>`;
  return `<div class="panel"><h3>Quanto dá para destinar às dívidas</h3>
      <p class="muted" style="margin-top:0">Base: <b>${brl(r.basis_cents)}</b> (${esc(r.basis_label)}). Você define quanto vai para dívidas (${r.debt_pct}%), economia (${r.save_pct}%) e o resto fica para suas despesas pessoais — nunca o salário inteiro.</p>
      <div class="stack">${seg(r.budget_cents > r.basis_cents ? r.basis_cents : r.budget_cents, C.gold)}${seg(r.savings_cents, C.blue)}${seg(r.personal_cents, '#4a4639')}</div>
      <div class="legend"><span><i style="background:${C.gold}"></i>Dívidas ${brl(r.budget_cents)}</span><span><i style="background:${C.blue}"></i>Economizar ${brl(r.savings_cents)}</span><span><i style="background:#4a4639"></i>Pessoal ${brl(r.personal_cents)}</span></div>
      <form id="plan-form" class="toolbar" style="margin:14px 0 0" novalidate><input type="text" inputmode="decimal" name="available" placeholder="Outro valor disponível (R$) — opcional" value="${esc(ui.planAvail)}" style="max-width:300px"><button class="btn sm" type="submit">Recalcular</button>${ui.planAvail ? '<button class="btn sm ghost" type="button" data-act="plan-reset">Usar sugestão</button>' : ''}</form>
      ${r.exceeds_basis ? `<div class="hint warn" style="margin-top:12px">Esse valor é maior que a base de ${brl(r.basis_cents)}. Confira se não vai faltar para suas despesas pessoais.</div>` : ''}</div>
    <div class="panel"><div class="panel-head"><h3>Ordem sugerida de pagamento</h3>${r.weeks_to_clear ? `<span class="chip gold">≈ ${r.weeks_to_clear} semana(s) para quitar tudo neste ritmo</span>` : ''}</div>
      ${r.items.length ? r.items.map((it, i) => `<div class="row"><div class="main"><b>${i + 1}. ${esc(it.name)}</b><small>Deve ${brl(it.remaining_cents)}${it.due_date ? ' · vence ' + fd(it.due_date) : ''} · ${esc(it.why)}</small></div><div class="side">${it.suggested_cents ? `<span class="amt green">pagar ${brl(it.suggested_cents)}</span>${btn('plan-pay', 'Registrar', { cls: 'sm soft', data: { id: it.debt_id, cents: it.suggested_cents } })}` : '<span class="chip">aguardar</span>'}</div></div>`).join('') : empty('Nenhuma dívida em aberto. 🎉')}</div>
    <div class="hint"><b>Como a ordem é definida:</b> dívidas vencidas primeiro, depois as que vencem em até 7 dias; em seguida, as com maior juros ao mês, prioridade mais alta, vencimento mais próximo e, no empate, o menor saldo. Juros só são considerados se você informar a taxa na dívida. É uma sugestão: nada é pago automaticamente.</div>`;
}

// ---------- render ----------
async function render() {
  const token = ++renderToken;
  const [, title, , sub] = NAV.find(n => n[0] === ui.page);
  $('#title').textContent = title; $('#subtitle').textContent = sub;
  document.title = `${title} · Vitin7 Finance`;
  $('#sidebar').innerHTML = `<div class="brand"><div class="logo">V7</div><div><b>VITIN7</b><span>Finance</span></div></div><nav>${NAV.map(n => `<button type="button" class="nav-btn ${n[0] === ui.page ? 'active' : ''}" data-nav="${n[0]}">${ic(n[2])}<span>${n[1]}</span></button>`).join('')}</nav><div class="foot">Seu controle, suas conquistas.</div>`;
  $('#bottomnav').innerHTML = NAV.filter(n => BOTTOM.includes(n[0])).map(n => `<button type="button" class="${n[0] === ui.page ? 'active' : ''}" data-nav="${n[0]}">${ic(n[2])}<span>${n[1]}</span></button>`).join('') + `<button type="button" class="${BOTTOM.includes(ui.page) ? '' : 'active'}" data-act="more">${ic('more')}<span>Mais</span></button>`;
  const al = ui.page === 'inicio' ? S.dashboard.alerts : [];
  $('#alerts').innerHTML = al.length ? `<div class="alerts">${al.map(a => `<div class="alert ${a.level}">${ic(a.level === 'good' ? 'check' : 'bell')}<span>${esc(a.text)}</span></div>`).join('')}</div>` : '';
  let html;
  try {
    html = ui.page === 'relatorios' ? await pageRelatorios() : ui.page === 'plano' ? await pagePlano() : pages[ui.page]();
  } catch (e) { html = `<div class="hint warn">${esc(e.message)}</div>`; }
  if (token !== renderToken) return;
  const y = window.scrollY;
  $('#content').innerHTML = html;
  window.scrollTo(0, y);
}
function go(page, { scroll = true } = {}) {
  if (!NAV.some(n => n[0] === page)) page = 'inicio';
  const changed = ui.page !== page;
  ui.page = page;
  if (location.hash !== '#' + page) history.pushState(null, '', '#' + page);
  if (S) render().then(() => { if (changed && scroll) window.scrollTo(0, 0); });
}
window.addEventListener('popstate', () => { ui.page = (location.hash || '#inicio').slice(1); if (!NAV.some(n => n[0] === ui.page)) ui.page = 'inicio'; if (S) render(); });

// ---------- diálogos de cada ação ----------
const dateField = (v) => ({ name: 'date', label: 'Data', type: 'date', value: v || S.today, required: true });

function debtForm(d) {
  openForm({
    title: d ? 'Editar dívida' : 'Nova dívida', submit: d ? 'Salvar alterações' : 'Adicionar dívida',
    fields: [
      { name: 'name', label: 'Credor', value: d?.name, required: true, wide: true, placeholder: 'Ex.: Nubank' },
      { name: 'total', label: 'Valor total (R$)', type: 'money', value: d ? toIn(d.total_cents) : '', required: true },
      { name: 'due_date', label: 'Vencimento', type: 'date', value: d?.due_date || '' },
      { name: 'priority', label: 'Prioridade', type: 'select', value: d?.priority ?? 2, options: [[1, 'Alta'], [2, 'Média'], [3, 'Baixa']] },
      { name: 'interest', label: 'Juros ao mês (%)', type: 'money', value: d?.interest_bp ? (d.interest_bp / 100).toString().replace('.', ',') : '', placeholder: 'Opcional, ex.: 2,5' },
      { name: 'description', label: 'Descrição', value: d?.description, wide: true, placeholder: 'Opcional' },
    ],
    onSubmit: async (v) => { await api(d ? '/debts/' + d.id : '/debts', { method: d ? 'PUT' : 'POST', body: v }); return d ? 'Dívida atualizada.' : 'Dívida adicionada.'; },
  });
}
function payDialog(debtId) {
  const open = S.debts.filter(d => d.remaining_cents > 0);
  if (!open.length) return toast('Não há dívidas em aberto.', true);
  const cur = open.find(d => d.id === Number(debtId)) || open[0];
  openForm({
    title: debtId ? `Pagar — ${cur.name}` : 'Pagar dívida', sub: debtId ? `Saldo atual: ${brl(cur.remaining_cents)}` : '', submit: 'Registrar pagamento',
    fields: [
      ...(debtId ? [] : [{ name: 'debt', label: 'Dívida', type: 'select', wide: true, value: cur.id, options: open.map(d => [d.id, `${d.name} — ${brl(d.remaining_cents)}`]) }]),
      { name: 'amount', label: 'Valor pago (R$)', type: 'money', required: true },
      dateField(),
      { name: 'note', label: 'Observação', wide: true, placeholder: 'Opcional' },
      { name: 'register_cash', label: 'Lançar como saída no meu saldo', type: 'checkbox', value: true },
    ],
    extra: `<div class="live" id="live"></div><button type="button" class="btn sm ghost" id="pay-all">Quitar tudo</button>`,
    onOpen: (f) => {
      const sel = () => open.find(d => d.id === Number(f.elements.namedItem('debt')?.value || debtId)) || cur;
      const upd = () => {
        const d = sel(), raw = f.elements.namedItem('amount').value.trim().replace(/\./g, '').replace(',', '.');
        const n = Math.round(parseFloat(raw) * 100);
        $('#live', f).textContent = Number.isFinite(n) && n > 0 ? (n > d.remaining_cents ? `Valor acima do saldo (${brl(d.remaining_cents)}).` : `Restará ${brl(d.remaining_cents - n)} em ${d.name}.`) : `Saldo atual: ${brl(d.remaining_cents)}`;
      };
      f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
      $('#pay-all', f).onclick = () => { f.elements.namedItem('amount').value = toIn(sel().remaining_cents); upd(); };
    },
    onSubmit: async (v) => { const id = debtId || v.debt; await api(`/debts/${id}/payments`, { method: 'POST', body: { amount: v.amount, date: v.date, note: v.note, register_cash: v.register_cash } }); return 'Pagamento registrado.'; },
  });
}
function goalForm(g) {
  openForm({
    title: g ? 'Editar meta' : 'Nova meta', submit: g ? 'Salvar alterações' : 'Criar meta',
    fields: [
      { name: 'name', label: 'Nome da meta', value: g?.name, required: true, wide: true, placeholder: 'Ex.: Comprar uma moto' },
      { name: 'target', label: 'Valor desejado (R$)', type: 'money', value: g ? toIn(g.target_cents) : '', required: true },
      { name: 'deadline', label: 'Prazo', type: 'date', value: g?.deadline || '' },
      { name: 'note', label: 'Observação', wide: true, value: g?.note, placeholder: 'Opcional' },
    ],
    onSubmit: async (v) => { await api(g ? '/goals/' + g.id : '/goals', { method: g ? 'PUT' : 'POST', body: v }); return g ? 'Meta atualizada.' : 'Meta criada.'; },
  });
}
function goalMoveDialog(goalId, kind) {
  if (!S.goals.length) return toast('Crie uma meta primeiro.', true);
  const cur = S.goals.find(g => g.id === Number(goalId)) || S.goals[0];
  openForm({
    title: kind === 'retirada' ? 'Retirar da meta' : 'Depositar na meta', sub: goalId ? `${cur.name} · guardado ${brl(cur.saved_cents)}` : '', submit: kind === 'retirada' ? 'Registrar retirada' : 'Registrar depósito',
    fields: [
      ...(goalId ? [] : [{ name: 'goal', label: 'Meta', type: 'select', wide: true, value: cur.id, options: S.goals.map(g => [g.id, `${g.name} — ${g.percent}%`]) }]),
      { name: 'amount', label: 'Valor (R$)', type: 'money', required: true }, dateField(),
      { name: 'note', label: 'Observação', wide: true, placeholder: 'Opcional' },
      { name: 'register_cash', label: kind === 'retirada' ? 'Devolver ao meu saldo' : 'Descontar do meu saldo', type: 'checkbox', value: true },
    ],
    onSubmit: async (v) => { await api(`/goals/${goalId || v.goal}/moves`, { method: 'POST', body: { kind, amount: v.amount, date: v.date, note: v.note, register_cash: v.register_cash } }); return kind === 'retirada' ? 'Retirada registrada.' : 'Depósito registrado.'; },
  });
}
function txForm(kind, t) {
  openForm({
    title: t ? 'Editar movimentação' : kind === 'entrada' ? 'Nova receita' : 'Nova despesa', submit: t ? 'Salvar alterações' : 'Registrar',
    fields: [
      { name: 'kind', label: 'Tipo', type: 'select', value: t?.kind || kind, options: [['saida', 'Despesa (saída)'], ['entrada', 'Receita (entrada)']] },
      { name: 'amount', label: 'Valor (R$)', type: 'money', value: t ? toIn(t.amount_cents) : '', required: true },
      { name: 'description', label: 'Descrição', value: t?.description, required: true, wide: true, placeholder: 'Ex.: Mercado' },
      { name: 'category', label: 'Categoria', value: t?.category, placeholder: 'Ex.: Alimentação' }, dateField(t?.date),
    ],
    onSubmit: async (v) => { await api(t ? '/transactions/' + t.id : '/transactions', { method: t ? 'PUT' : 'POST', body: v }); return t ? 'Movimentação atualizada.' : 'Movimentação registrada.'; },
  });
}
function weekForm(w) {
  const t = S.today;
  openForm({
    title: w ? 'Editar semana' : 'Nova semana de pagamento', sub: 'O período define quais dias de trabalho entram no cálculo. Períodos não podem se sobrepor.', submit: w ? 'Salvar alterações' : 'Criar semana',
    fields: [
      { name: 'pay_date', label: 'Data do pagamento', type: 'date', value: w?.pay_date || t, required: true },
      { name: 'period_start', label: 'Início do período', type: 'date', value: w?.period_start || addDays(t, -6), required: true },
      { name: 'period_end', label: 'Fim do período', type: 'date', value: w?.period_end || t, required: true },
      { name: 'base', label: 'Salário-base (R$)', type: 'money', value: toIn(w ? w.base_cents : S.settings.weekly_base_cents), required: true },
      { name: 'daily', label: 'Valor da diária (R$)', type: 'money', value: toIn(w ? w.daily_cents : S.settings.daily_rate_cents), required: true },
      { name: 'note', label: 'Observação', wide: true, value: w?.note },
    ],
    onOpen: (f) => {
      if (w) return;
      f.elements.namedItem('pay_date').addEventListener('change', (e) => { if (!e.target.value) return; f.elements.namedItem('period_end').value = e.target.value; f.elements.namedItem('period_start').value = addDays(e.target.value, -6); });
    },
    onSubmit: async (v) => { const r = await api(w ? '/weeks/' + w.id : '/weeks', { method: w ? 'PUT' : 'POST', body: v }); if (!w) ui.weekId = r.id; return w ? 'Semana atualizada.' : 'Semana criada.'; },
  });
}
function itemForm(kind, item) {
  const w = S.weeks.find(x => x.id === ui.weekId);
  const inPeriod = S.today >= w.period_start && S.today <= w.period_end;
  const hadCash = item && kind === 'vale';
  openForm({
    title: item ? 'Editar lançamento' : { vale: 'Novo vale (adiantamento)', desconto: 'Novo desconto', extra: 'Novo extra' }[kind], submit: item ? 'Salvar alterações' : 'Adicionar',
    fields: [
      { name: 'kind', label: 'Tipo', type: 'select', value: kind, options: [['vale', 'Vale / adiantamento já recebido'], ['desconto', 'Desconto (ex.: compra)'], ['extra', 'Extra / hora extra']] },
      { name: 'amount', label: 'Valor (R$)', type: 'money', value: item ? toIn(item.amount_cents) : '', required: true },
      { name: 'description', label: 'Descrição', value: item?.description || '', required: true, wide: true, placeholder: kind === 'vale' ? 'Ex.: Vale de terça' : kind === 'desconto' ? 'Ex.: Coca-Cola' : 'Ex.: Hora extra' },
      dateField(item?.date || (inPeriod ? S.today : w.period_end)),
      { name: 'register_cash', label: 'Vale: lançar entrada no meu saldo (o dinheiro já foi recebido)', type: 'checkbox', value: item ? !!S.transactions.find(t => t.source === 'salary_advance' && t.source_id === item.id) : true, id: 'cash-row' },
    ],
    extra: '<p class="sub muted" style="font-size:13px;margin:0">Vales e descontos reduzem apenas esta semana. O vale não é contado como despesa: ele só abate o que falta receber.</p>',
    onOpen: (f) => { const k = f.elements.namedItem('kind'), row = $('#cash-row', f); const sync = () => { row.hidden = k.value !== 'vale'; }; k.addEventListener('change', sync); sync(); void hadCash; },
    onSubmit: async (v) => { const body = { ...v }; if (item) await api('/week-items/' + item.id, { method: 'PUT', body }); else await api(`/weeks/${w.id}/items`, { method: 'POST', body }); return 'Lançamento salvo.'; },
  });
}
function receiveDialog(weekId) {
  const w = S.weeks.find(x => x.id === Number(weekId));
  openForm({
    title: 'Receber salário', sub: `Semana de ${fd(w.pay_date)} · falta receber ${brl(w.remaining_cents)}`, submit: 'Registrar recebimento',
    fields: [{ name: 'amount', label: 'Valor recebido (R$)', type: 'money', value: toIn(w.remaining_cents), required: true }, dateField(), { name: 'register_cash', label: 'Lançar entrada no meu saldo', type: 'checkbox', value: true }],
    extra: '<p class="sub muted" style="font-size:13px;margin:0">Pode ser parcial. O valor entra uma única vez como receita “Salário”; vales anteriores já foram descontados do que falta.</p>',
    onSubmit: async (v) => { await api(`/weeks/${w.id}/receipts`, { method: 'POST', body: v }); return 'Salário registrado.'; },
  });
}
function eventForm(date, ev) {
  openForm({
    title: ev ? 'Editar evento' : 'Novo evento', submit: ev ? 'Salvar alterações' : 'Adicionar ao calendário',
    fields: [
      { name: 'title', label: 'Título', value: ev?.title, required: true, wide: true, placeholder: 'Ex.: Pagar cartão' }, dateField(ev?.date || date),
      { name: 'type', label: 'Tipo', type: 'select', value: ev?.type || 'conta', options: EV_TYPES },
      { name: 'amount', label: 'Valor (opcional)', type: 'money', value: ev?.amount_cents ? toIn(ev.amount_cents) : '' }, { name: 'note', label: 'Observação', value: ev?.note, wide: true },
    ],
    onSubmit: async (v) => { await api(ev ? '/events/' + ev.id : '/events', { method: ev ? 'PUT' : 'POST', body: v }); ui.calDay = v.date; ui.calMonth = v.date.slice(0, 7); return 'Evento salvo.'; },
  });
}
function noteForm(n) {
  openForm({
    title: n ? 'Editar anotação' : 'Nova anotação', submit: 'Salvar anotação',
    fields: [{ name: 'title', label: 'Título', value: n?.title, required: true, wide: true }, { name: 'body', label: 'Detalhes', type: 'textarea', value: n?.body, wide: true }],
    onSubmit: async (v) => { await api(n ? '/notes/' + n.id : '/notes', { method: n ? 'PUT' : 'POST', body: v }); return 'Anotação salva.'; },
  });
}

// ---------- ações ----------
const byId = (list, id) => list.find(x => x.id === Number(id));
const A = {
  retry: () => load(),
  go: (d) => go(d.page),
  more: () => openForm({ title: 'Mais opções', submit: 'Fechar', extra: `<div class="menu-list">${NAV.filter(n => !BOTTOM.includes(n[0])).map(n => `<button type="button" class="nav-btn" data-nav="${n[0]}" data-close-modal>${ic(n[2])}<span>${n[1]}</span></button>`).join('')}</div>`, onSubmit: async () => '' }),
  'debt-new': () => debtForm(), 'debt-edit': (d) => debtForm(byId(S.debts, d.id)),
  'debt-del': async (d) => { const x = byId(S.debts, d.id); if (await confirmBox({ title: `Excluir “${x.name}”?`, text: 'O histórico de pagamentos e os lançamentos de saldo ligados a essa dívida também serão removidos. Esta ação não pode ser desfeita.' })) mutate(() => api('/debts/' + x.id, { method: 'DELETE' }), 'Dívida excluída.'); },
  'debt-pay': (d) => payDialog(d.id),
  'pay-del': async (d) => { if (await confirmBox({ title: 'Estornar este pagamento?', text: 'O valor volta para o saldo da dívida e a saída vinculada é removida.', confirm: 'Estornar' })) mutate(() => api('/payments/' + d.id, { method: 'DELETE' }), 'Pagamento estornado.'); },
  'add-initial': (d) => mutate(() => api('/debts', { method: 'POST', body: { name: d.name, total: toIn(Number(d.cents)) } }), 'Dívida adicionada.'),
  'plan-pay': (d) => { payDialog(d.id); setTimeout(() => { const f = $('#modal-form'); if (f) { f.elements.namedItem('amount').value = toIn(Number(d.cents)); f.dispatchEvent(new Event('input')); } }, 0); },
  'plan-reset': () => { ui.planAvail = ''; render(); },
  'goal-new': () => goalForm(), 'goal-edit': (d) => goalForm(byId(S.goals, d.id)),
  'goal-del': async (d) => { const x = byId(S.goals, d.id); if (await confirmBox({ title: `Excluir a meta “${x.name}”?`, text: 'Os depósitos e retiradas dessa meta, e os lançamentos de saldo ligados a eles, também serão removidos.' })) mutate(() => api('/goals/' + x.id, { method: 'DELETE' }), 'Meta excluída.'); },
  'goal-move': (d) => goalMoveDialog(d.id, d.kind),
  'move-del': async (d) => { if (await confirmBox({ title: 'Excluir esta movimentação?', text: 'O saldo da meta será recalculado.' })) mutate(() => api('/goal-moves/' + d.id, { method: 'DELETE' }), 'Movimentação excluída.'); },
  'tx-new': (d) => txForm(d.kind), 'tx-edit': (d) => txForm(null, byId(S.transactions, d.id)),
  'tx-del': async (d) => { if (await confirmBox({ title: 'Excluir esta movimentação?', text: 'Esta ação não pode ser desfeita.' })) mutate(() => api('/transactions/' + d.id, { method: 'DELETE' }), 'Movimentação excluída.'); },
  'week-new': () => { if (ui.page !== 'semana') go('semana'); weekForm(); }, 'week-edit': (d) => weekForm(byId(S.weeks, d.id)),
  'week-del': async (d) => { const w = byId(S.weeks, d.id); if (await confirmBox({ title: `Excluir a semana de ${fd(w.pay_date)}?`, text: 'Vales, descontos, recebimentos e os lançamentos de saldo dessa semana serão removidos. Os dias de trabalho ficam salvos.' })) { ui.weekId = null; mutate(() => api('/weeks/' + w.id, { method: 'DELETE' }), 'Semana excluída.'); } },
  'open-week': (d) => { ui.weekId = Number(d.id); go('semana'); },
  'item-new': (d) => itemForm(d.kind), 'item-edit': (d) => { const w = S.weeks.find(x => x.id === ui.weekId); const it = byId(w.items, d.id); itemForm(it.kind, it); },
  'item-del': async (d) => { if (await confirmBox({ title: 'Excluir este lançamento?', text: 'O valor da semana será recalculado e, se for um vale, a entrada no saldo também sai.' })) mutate(() => api('/week-items/' + d.id, { method: 'DELETE' }), 'Lançamento excluído.'); },
  receive: (d) => receiveDialog(d.id),
  'receipt-del': async (d) => { if (await confirmBox({ title: 'Excluir este recebimento?', text: 'O valor volta para “falta receber” e a entrada no saldo é removida.' })) mutate(() => api('/week-receipts/' + d.id, { method: 'DELETE' }), 'Recebimento excluído.'); },
  'cal-prev': () => { ui.calMonth = shiftMonth(ui.calMonth, -1); render(); }, 'cal-next': () => { ui.calMonth = shiftMonth(ui.calMonth, 1); render(); },
  'cal-day': (d) => { ui.calDay = d.date; if (d.date.slice(0, 7) !== ui.calMonth) ui.calMonth = d.date.slice(0, 7); render(); },
  'ev-new': (d) => eventForm(d.date), 'ev-edit': (d) => eventForm(null, byId(S.events, d.id)),
  'ev-done': (d) => { const e = byId(S.events, d.id); mutate(() => api('/events/' + e.id, { method: 'PUT', body: { title: e.title, date: e.date, type: e.type, amount: e.amount_cents ? toIn(e.amount_cents) : '', note: e.note, done: !e.done } }), e.done ? 'Evento reaberto.' : 'Evento concluído.'); },
  'ev-del': async (d) => { if (await confirmBox({ title: 'Excluir este evento?', text: 'Esta ação não pode ser desfeita.' })) mutate(() => api('/events/' + d.id, { method: 'DELETE' }), 'Evento excluído.'); },
  'note-new': () => noteForm(), 'note-edit': (d) => noteForm(byId(S.notes, d.id)),
  'note-del': async (d) => { if (await confirmBox({ title: 'Excluir esta anotação?', text: 'Esta ação não pode ser desfeita.' })) mutate(() => api('/notes/' + d.id, { method: 'DELETE' }), 'Anotação excluída.'); },
  health: async () => { try { const r = await api('/health'); $('#health-out').textContent = `Servidor ${r.status} · banco ${r.database} · schema v${r.schema} · app ${r.version}`; } catch (e) { $('#health-out').textContent = e.message; } },
  notif: async () => { try { const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Notificações ativadas.' : 'Permissão não concedida.', p !== 'granted'); render(); if (p === 'granted') maybeNotify(); } catch { toast('Seu navegador não suporta notificações.', true); } },
  backup: async () => {
    try {
      const data = await api('/backup');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `vitin7-backup-${S.today}.json` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Backup baixado.');
    } catch (e) { toast(e.message, true); }
  },
  restore: () => $('#restore-file').click(),
};

// ---------- eventos ----------
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { if (nav.hasAttribute('data-close-modal')) closeModal(); go(nav.dataset.nav); return; }
  const b = e.target.closest('[data-act]');
  if (b && A[b.dataset.act]) { e.preventDefault(); A[b.dataset.act]({ ...b.dataset }); }
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const v = el.value;
  switch (el.dataset.change) {
    case 'debt-filter': ui.debtFilter = v; return render();
    case 'debt-sort': ui.debtSort = v; return render();
    case 'tx-month': ui.txMonth = v; return render();
    case 'tx-kind': ui.txKind = v; return render();
    case 'rep-period': ui.repPeriod = v; return render();
    case 'rep-month': ui.repMonth = v; return render();
    case 'week-select': ui.weekId = Number(v); return render();
    case 'day-status': return mutate(() => api('/workdays/' + el.dataset.date, { method: 'PUT', body: { status: v || null } }), 'Dia salvo.');
    default:
  }
});
document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.id === 'settings-form') {
    e.preventDefault();
    mutate(() => api('/settings', { method: 'PUT', body: Object.fromEntries(new FormData(f)) }), 'Ajustes salvos.');
  } else if (f.id === 'plan-form') {
    e.preventDefault(); ui.planAvail = new FormData(f).get('available').trim(); render();
  }
});
document.addEventListener('toggle', (e) => { const k = e.target.dataset?.key; if (k) { e.target.open ? ui.open.add(k) : ui.open.delete(k); } }, true);
$('#restore-file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  let obj;
  try { obj = JSON.parse(await file.text()); } catch { return toast('O arquivo não é um JSON válido.', true); }
  if (obj.app !== 'Vitin7 Finance' || !obj.data) return toast('Esse arquivo não é um backup do Vitin7 Finance.', true);
  if (await confirmBox({ title: 'Restaurar este backup?', text: `Todos os dados atuais serão substituídos pelos do arquivo (gerado em ${obj.createdAt ? new Date(obj.createdAt).toLocaleString('pt-BR') : 'data desconhecida'}). Uma cópia do estado atual é salva no servidor antes.`, confirm: 'Restaurar' })) {
    mutate(() => api('/restore', { method: 'POST', body: obj }), 'Backup restaurado.');
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && S && !$('#modal').open) load(); });

// ---------- notificações (somente com permissão explícita, dedupe diário) ----------
function maybeNotify() {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !S) return;
    const seen = JSON.parse(localStorage.getItem('v7-notified') || '{}');
    const key = S.today;
    const done = seen[key] || [];
    for (const a of S.dashboard.alerts.filter(x => x.level === 'danger' || x.level === 'warn' || x.level === 'info' || x.level === 'good')) {
      if (done.includes(a.text)) continue;
      new Notification('Vitin7 Finance', { body: a.text, icon: '/favicon.svg', tag: a.text });
      done.push(a.text);
    }
    localStorage.setItem('v7-notified', JSON.stringify({ [key]: done }));
  } catch { /* notificações são opcionais */ }
}

// ---------- início ----------
ui.page = (location.hash || '#inicio').slice(1);
if (!NAV.some(n => n[0] === ui.page)) ui.page = 'inicio';
load();
})();
