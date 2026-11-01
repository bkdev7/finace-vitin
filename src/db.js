'use strict';
// Banco SQLite do Vitin7 Finance.
// - Valores monetários em CENTAVOS INTEIROS.
// - Migração segura da versão 2.0 (valores REAL): snapshot antes, tabelas antigas preservadas como legacy_*.
// - Nunca apaga o arquivo do banco.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 3;

const INITIAL_DEBTS = [
  { name: 'João', cents: 5000 },
  { name: 'Augusto', cents: 15000 },
  { name: 'Stênio', cents: 5000 },
  { name: 'Mercado Pago', cents: 8000 },
  { name: 'Nubank', cents: 20000 },
];

const DEFAULT_SETTINGS = {
  weekly_base_cents: '60000', // R$ 600 por semana
  daily_rate_cents: '10000',  // R$ 100 por dia
  debt_pct: '40',             // % do valor a receber que pode ir para dívidas
  save_pct: '10',             // % para metas/economia (o resto fica para despesas pessoais)
  alert_days: '3',            // antecedência dos alertas
};

const TABLES = ['settings', 'debts', 'payments', 'goals', 'goal_moves', 'transactions', 'events',
  'weeks', 'week_items', 'week_receipts', 'work_days', 'notes'];

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  due_date TEXT,
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1,2,3)),
  interest_bp INTEGER NOT NULL DEFAULT 0 CHECK (interest_bp >= 0),
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  target_cents INTEGER NOT NULL CHECK (target_cents > 0),
  deadline TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS goal_moves (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('deposito','retirada')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('entrada','saida')),
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  source_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_tx_source ON transactions(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_tx_date ON transactions(date);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('conta','pagamento','trabalho','feriado','lembrete','outro')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  note TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS ix_events_date ON events(date);
CREATE TABLE IF NOT EXISTS weeks (
  id INTEGER PRIMARY KEY,
  pay_date TEXT NOT NULL UNIQUE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  base_cents INTEGER NOT NULL CHECK (base_cents >= 0),
  daily_cents INTEGER NOT NULL CHECK (daily_cents >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  CHECK (period_start <= period_end)
);
CREATE TABLE IF NOT EXISTS week_items (
  id INTEGER PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('vale','desconto','extra')),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS ix_items_week ON week_items(week_id);
CREATE TABLE IF NOT EXISTS week_receipts (
  id INTEGER PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS ix_receipts_week ON week_receipts(week_id);
CREATE TABLE IF NOT EXISTS work_days (
  date TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('trabalhado','falta','feriado','feriado_pago','folga')),
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW})
);
`;

const log = (...a) => console.log('[db]', ...a);
const toCents = (v) => Math.round(Number(v) * 100);
const todayBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { try { db.exec('ROLLBACK'); } catch { /* já encerrada */ } throw e; }
}

function snapshot(db, backupDir, label) {
  fs.mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  // mantém os 15 snapshots mais recentes
  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.sqlite')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 15))) fs.rmSync(path.join(backupDir, f), { force: true });
  return dest;
}

const tableNames = (db) => new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
const columns = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;

// Converte dados no formato da versão 2.0 (REAL, tabelas "weekly" e "deposits") para o schema atual.
// Deve rodar dentro de uma transação. Retorna contadores e avisos.
function importLegacy(db, d) {
  const out = { debts: 0, payments: 0, goals: 0, deposits: 0, transactions: 0, events: 0, weeks: 0, notes: 0, skipped: 0 };
  const today = todayBR();
  const debtIds = new Set(), goalIds = new Set();
  const cents = (v) => { const c = toCents(v); return Number.isFinite(c) ? c : NaN; };

  for (const r of d.debts || []) {
    const total = cents(r.total);
    if (!(total > 0) || !String(r.name || '').trim()) { out.skipped++; continue; }
    db.prepare('INSERT INTO debts(id,name,description,total_cents,due_date) VALUES(?,?,?,?,?)')
      .run(r.id, String(r.name).trim(), String(r.note || ''), total, validDate(r.due_date) ? r.due_date : null);
    debtIds.add(r.id); out.debts++;
  }
  const paidSum = new Map();
  for (const r of d.payments || []) {
    const a = cents(r.amount);
    if (!debtIds.has(r.debt_id) || !(a > 0)) { out.skipped++; continue; }
    db.prepare('INSERT INTO payments(id,debt_id,amount_cents,paid_at) VALUES(?,?,?,?)')
      .run(r.id, r.debt_id, a, validDate(r.paid_at) ? r.paid_at : today);
    paidSum.set(r.debt_id, (paidSum.get(r.debt_id) || 0) + a); out.payments++;
  }
  for (const r of d.debts || []) { // saldo pago sem histórico → pagamento de abertura
    if (!debtIds.has(r.id)) continue;
    const gap = Math.min(cents(r.paid) - (paidSum.get(r.id) || 0), cents(r.total) - (paidSum.get(r.id) || 0));
    if (gap > 0) {
      db.prepare('INSERT INTO payments(debt_id,amount_cents,paid_at,note) VALUES(?,?,?,?)')
        .run(r.id, gap, today, 'Saldo pago anterior (migração)'); out.payments++;
    }
  }
  for (const r of d.goals || []) {
    const t = cents(r.target);
    if (!(t > 0) || !String(r.name || '').trim()) { out.skipped++; continue; }
    db.prepare('INSERT INTO goals(id,name,target_cents,deadline) VALUES(?,?,?,?)')
      .run(r.id, String(r.name).trim(), t, validDate(r.deadline) ? r.deadline : null);
    goalIds.add(r.id); out.goals++;
  }
  const depSum = new Map();
  for (const r of d.deposits || []) {
    const a = cents(r.amount);
    if (!goalIds.has(r.goal_id) || !(a > 0)) { out.skipped++; continue; }
    db.prepare("INSERT INTO goal_moves(id,goal_id,kind,amount_cents,date) VALUES(?,?,'deposito',?,?)")
      .run(r.id, r.goal_id, a, validDate(r.date) ? r.date : today);
    depSum.set(r.goal_id, (depSum.get(r.goal_id) || 0) + a); out.deposits++;
  }
  for (const r of d.goals || []) {
    if (!goalIds.has(r.id)) continue;
    const gap = cents(r.saved) - (depSum.get(r.id) || 0);
    if (gap > 0) {
      db.prepare("INSERT INTO goal_moves(goal_id,kind,amount_cents,date,note) VALUES(?,'deposito',?,?,?)")
        .run(r.id, gap, today, 'Saldo guardado anterior (migração)'); out.deposits++;
    }
  }
  for (const r of d.transactions || []) {
    const a = cents(r.amount);
    if (!['entrada', 'saida'].includes(r.kind) || !(a > 0) || !validDate(r.date)) { out.skipped++; continue; }
    db.prepare('INSERT INTO transactions(id,kind,category,description,amount_cents,date) VALUES(?,?,?,?,?,?)')
      .run(r.id, r.kind, String(r.category || ''), String(r.description || 'Sem descrição'), a, r.date);
    out.transactions++;
  }
  for (const r of d.events || []) {
    const a = cents(r.amount || 0);
    if (!validDate(r.date) || !(a >= 0) || !String(r.title || '').trim()) { out.skipped++; continue; }
    const type = ['conta', 'pagamento', 'trabalho', 'feriado', 'lembrete', 'outro'].includes(r.type) ? r.type : 'outro';
    db.prepare('INSERT INTO events(id,title,date,type,amount_cents) VALUES(?,?,?,?,?)').run(r.id, String(r.title).trim(), r.date, type, a);
    out.events++;
  }
  for (const r of d.notes || []) {
    if (!String(r.title || '').trim()) { out.skipped++; continue; }
    db.prepare('INSERT INTO notes(id,title,body) VALUES(?,?,?)').run(r.id, String(r.title).trim(), String(r.body || ''));
    out.notes++;
  }
  // Ajustes semanais antigos → semanas (segunda a domingo), sem alterar nenhuma outra semana.
  const baseSetting = (d.settings || []).find(s => s.key === 'weekly_base');
  const base = baseSetting && cents(baseSetting.value) > 0 ? cents(baseSetting.value) : 60000;
  const kindMap = { desconto: 'desconto', compra: 'desconto', adiantamento: 'vale', extra: 'extra' };
  const byWeek = new Map();
  for (const r of d.weekly || []) {
    const a = cents(r.amount);
    if (!kindMap[r.kind] || !(a > 0) || !validDate(r.date)) { out.skipped++; continue; }
    const key = mondayOf(r.date);
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push({ ...r, a });
  }
  for (const [start, rows] of byWeek) {
    const end = addDays(start, 6);
    const w = db.prepare('INSERT INTO weeks(pay_date,period_start,period_end,base_cents,daily_cents,note) VALUES(?,?,?,?,?,?)')
      .run(end, start, end, base, 10000, 'Importada dos ajustes semanais da versão 2.0');
    for (const r of rows) {
      db.prepare('INSERT INTO week_items(week_id,kind,description,amount_cents,date) VALUES(?,?,?,?,?)')
        .run(Number(w.lastInsertRowid), kindMap[r.kind], String(r.description || r.kind), r.a, r.date);
    }
    out.weeks++;
  }
  if (baseSetting) db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('weekly_base_cents',?)").run(String(base));
  return out;
}

function readAll(db, names) {
  const data = {};
  for (const t of names) data[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return data;
}

function migrateLegacy(db, backupDir) {
  const snap = snapshot(db, backupDir, 'pre-migracao-v3');
  log('Snapshot antes da migração:', snap);
  const names = ['debts', 'payments', 'goals', 'deposits', 'transactions', 'events', 'weekly', 'notes', 'settings'];
  const present = tableNames(db);
  const legacy = readAll(db, names.filter(n => present.has(n)));
  const result = tx(db, () => {
    for (const t of names.filter(n => n !== 'settings' && present.has(n))) {
      db.exec(`ALTER TABLE ${t} RENAME TO legacy_${t}`);
    }
    db.exec(SCHEMA);
    return importLegacy(db, legacy);
  });
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  log('Migração v2→v3 concluída:', JSON.stringify(result), '(tabelas antigas mantidas como legacy_*)');
  return { ...result, snapshot: snap };
}

function seedInitialDebts(db) {
  const flag = db.prepare("SELECT value FROM settings WHERE key='seed_debts_v1'").get();
  if (flag) return { seeded: false, reason: 'já avaliado anteriormente' };
  return tx(db, () => {
    const count = db.prepare('SELECT COUNT(*) c FROM debts').get().c;
    db.prepare("INSERT INTO settings(key,value) VALUES('seed_debts_v1',?)").run(new Date().toISOString());
    if (count > 0) return { seeded: false, reason: 'já existem dívidas cadastradas; nada foi inserido' };
    const ins = db.prepare('INSERT INTO debts(name,total_cents) VALUES(?,?)');
    for (const d of INITIAL_DEBTS) ins.run(d.name, d.cents);
    return { seeded: true, count: INITIAL_DEBTS.length };
  });
}

function openDatabase(dbPath, { seed = true } = {}) {
  const dir = path.dirname(dbPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (e) {
    throw new Error(`Sem permissão de escrita em "${dir}" (${e.code}). Defina DB_PATH para uma pasta gravável e persistente.`);
  }
  const backupDir = path.join(dir, 'backups');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  // WAL é mais rápido, mas alguns volumes de hospedagem não suportam; testa de verdade (escrita + leitura) e volta ao modo padrão se falhar.
  try {
    db.exec('PRAGMA journal_mode=WAL;');
    db.exec('CREATE TABLE IF NOT EXISTS _probe(x); INSERT INTO _probe VALUES(1); DELETE FROM _probe; DROP TABLE _probe;');
    db.prepare('SELECT COUNT(*) c FROM sqlite_master').get();
  } catch (e) {
    log('WAL indisponível neste disco (' + e.message + '); usando journal_mode=DELETE.');
    try { db.exec('PRAGMA journal_mode=DELETE;'); } catch { /* segue com o padrão */ }
  }
  db.exec('PRAGMA synchronous=NORMAL;');

  const info = { migrated: null, seed: null, dbPath };
  const uv = db.prepare('PRAGMA user_version').get().user_version;
  const present = tableNames(db);
  if (uv < SCHEMA_VERSION && present.has('debts') && columns(db, 'debts').includes('total')) {
    info.migrated = migrateLegacy(db, backupDir);
  } else if (uv < SCHEMA_VERSION && present.has('debts') && !columns(db, 'debts').includes('total_cents')) {
    throw new Error('Banco existente com estrutura desconhecida em "debts". Nada foi alterado.');
  } else {
    db.exec(SCHEMA);
    if (uv < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  if (seed) info.seed = seedInitialDebts(db);
  try { info.dailySnapshot = maybeDailySnapshot(db, backupDir); } catch (e) { log('Snapshot diário falhou:', e.message); }
  return { db, info, backupDir };
}

// Um snapshot automático por dia (VACUUM INTO é consistente e não bloqueia leituras).
function maybeDailySnapshot(db, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  if (fs.readdirSync(backupDir).some(f => f.startsWith('auto-' + stamp))) return null;
  return snapshot(db, backupDir, 'auto-' + stamp);
}

// ---- Backup JSON (formato v3) e restauração (aceita v3 e v2) ----
function exportBackup(db) {
  return { app: 'Vitin7 Finance', version: SCHEMA_VERSION, createdAt: new Date().toISOString(), data: readAll(db, TABLES) };
}

function restoreBackup(db, payload, backupDir) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (!payload || payload.app !== 'Vitin7 Finance' || !payload.data || typeof payload.data !== 'object') {
    throw bad('Arquivo inválido: não é um backup do Vitin7 Finance.');
  }
  const d = payload.data;
  const isV3 = Number(payload.version) >= 3 && Array.isArray(d.debts) && (d.debts.length === 0 || 'total_cents' in d.debts[0]);
  const isV2 = !isV3 && Array.isArray(d.debts) && (d.debts.length === 0 || 'total' in d.debts[0]);
  if (!isV3 && !isV2) throw bad('Backup incompatível ou incompleto.');
  for (const v of Object.values(d)) if (Array.isArray(v) && v.length > 200000) throw bad('Backup grande demais.');

  const snap = snapshot(db, backupDir, 'antes-restauracao'); // cópia do estado atual
  const result = tx(db, () => {
    for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
    let summary;
    if (isV3) {
      for (const t of TABLES) {
        if (!Array.isArray(d[t])) continue;
        const cols = columns(db, t);
        for (const r of d[t]) {
          if (!r || typeof r !== 'object') throw bad('Linha inválida em ' + t);
          const cs = cols.filter(c => c in r);
          db.prepare(`INSERT INTO ${t}(${cs.join(',')}) VALUES(${cs.map(() => '?').join(',')})`).run(...cs.map(c => r[c]));
        }
      }
      summary = Object.fromEntries(TABLES.map(t => [t, Array.isArray(d[t]) ? d[t].length : 0]));
    } else {
      summary = importLegacy(db, d);
    }
    const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    if (fk.length) throw bad('Backup com referências quebradas (' + fk[0].table + '). Nada foi alterado.');
    return summary;
  });
  return { snapshot: snap, format: isV3 ? 'v3' : 'v2', summary: result };
}

module.exports = {
  openDatabase, tx, snapshot, exportBackup, restoreBackup, importLegacy,
  INITIAL_DEBTS, DEFAULT_SETTINGS, TABLES, SCHEMA_VERSION, mondayOf, addDays, validDate, todayBR,
};
