'use strict';
// Vitin7 Finance — servidor HTTP (frontend + API na mesma origem) com SQLite nativo do Node.js.
const major = Number(process.versions.node.split('.')[0]);
const minor = Number(process.versions.node.split('.')[1]);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node.js ${process.versions.node} não suporta o SQLite nativo sem flags. Use Node 22.13+ (recomendado 24).`);
  process.exit(1);
}

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cfg = require('./src/config');
const { openDatabase } = require('./src/db');
const { createRoutes, HttpError, mapDbError } = require('./src/api');

const PUBLIC_DIR = path.join(cfg.ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

// Somente os arquivos de /public (lista fechada, sem navegação de diretórios): banco e backups nunca são servidos.
function loadStatic() {
  const map = new Map();
  for (const f of fs.readdirSync(PUBLIC_DIR)) {
    const full = path.join(PUBLIC_DIR, f);
    if (fs.statSync(full).isFile() && MIME[path.extname(f)]) map.set('/' + f, full);
  }
  map.set('/', path.join(PUBLIC_DIR, 'index.html'));
  if (map.has('/favicon.svg')) map.set('/favicon.ico', map.get('/favicon.svg')); // navegadores pedem /favicon.ico sozinhos
  return map;
}

// Versão de build = hash do conteúdo dos arquivos de /public. Cada deploy gera URLs novas (?v=...) para app.js/style.css,
// então nem o navegador nem o CDN da hospedagem conseguem servir JavaScript/CSS antigo junto com o HTML novo.
function buildVersion() {
  const h = crypto.createHash('sha1');
  for (const f of fs.readdirSync(PUBLIC_DIR).sort()) {
    const full = path.join(PUBLIC_DIR, f);
    if (f !== 'index.html' && fs.statSync(full).isFile()) h.update(f).update(fs.readFileSync(full));
  }
  return h.digest('hex').slice(0, 10);
}
const BUILD = buildVersion();

function send(res, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...extra });
  res.end(body);
}

function readJSON(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new HttpError(413, 'Arquivo muito grande.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

// Proteção CSRF que NÃO depende do cabeçalho Host (proxies da hospedagem costumam reescrevê-lo, e comparar
// Origin x Host bloqueava todo salvamento). Escritas exigem (1) navegador declarando mesma origem, quando
// informa Sec-Fetch-Site, e (2) cabeçalho customizado, que páginas de outros sites não conseguem enviar.
function checkSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Origem não permitida.');
  if (req.headers['x-requested-with'] !== 'vitin7') throw new HttpError(403, 'Requisição não autorizada (cabeçalho X-Requested-With ausente).');
}

function checkAccessKey(req, res) {
  if (!cfg.ACCESS_KEY) return true;
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (m) {
    const given = Buffer.from(Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':'));
    const want = Buffer.from(cfg.ACCESS_KEY);
    if (given.length === want.length && crypto.timingSafeEqual(given, want)) return true;
  }
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Vitin7 Finance", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Acesso restrito.');
  return false;
}

function createApp({ dbPath = cfg.DB_PATH, seed = process.env.SEED_INITIAL_DEBTS !== 'false' } = {}) {
  const { db, info, backupDir } = openDatabase(dbPath, { seed });
  const routes = createRoutes(db, { backupDir, info });
  const statics = loadStatic();

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      const url = new URL(req.url, 'http://localhost');
      let pathname = url.pathname;
      try { pathname = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'URL inválida.'); }

      if (pathname === '/health' || pathname === '/api/health') { // sem dados sensíveis, sempre liberado para monitoramento
        const r = routes.find(x => x.method === 'GET' && x.re.test('/api/health')).handler({});
        return send(res, r.status, r.body);
      }
      if (!checkAccessKey(req, res)) return;

      if (pathname.startsWith('/api/')) {
        const route = routes.find(r => r.method === req.method && r.re.test(pathname));
        if (!route) {
          const known = routes.some(r => r.re.test(pathname));
          return send(res, known ? 405 : 404, { error: known ? 'Método não permitido.' : 'Rota de API não encontrada.' });
        }
        if (req.method !== 'GET') checkSameOrigin(req);
        const params = route.re.exec(pathname).groups || {};
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJSON(req, pathname === '/api/restore' ? 25_000_000 : 1_000_000);
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'JSON inválido.');
        const out = route.handler({ params, query: Object.fromEntries(url.searchParams), body });
        const extra = out.download ? { 'Content-Disposition': `attachment; filename="${out.download}"` } : {};
        return send(res, out.status, out.body, extra);
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método não permitido.' });
      const file = statics.get(pathname);
      if (!file) return send(res, 404, { error: 'Página não encontrada.' });
      if (path.basename(file) === 'index.html') { // página principal: nunca em cache, com a versão de build injetada
        const html = fs.readFileSync(file, 'utf8').replace(/__V__/g, BUILD);
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store, max-age=0', 'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
        return res.end(req.method === 'HEAD' ? undefined : html);
      }
      const stat = fs.statSync(file);
      const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
      const headers = { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-cache', 'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store', ETag: etag };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(200, { ...headers, 'Content-Length': stat.size });
      return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file));
    } catch (e) {
      let err = e;
      if (!(err instanceof HttpError) && Number.isInteger(e.status)) err = new HttpError(e.status, e.message); // erros de validação vindos de src/db.js
      if (!(err instanceof HttpError)) err = mapDbError(e) || e;
      if (!res.headersSent) {
        if (err instanceof HttpError) return send(res, err.status, { error: err.message });
        console.error(`[erro] ${req.method} ${req.url} -> ${e.stack || e.message}`);
        return send(res, 500, { error: 'Erro interno ao processar a solicitação. Tente novamente.' });
      }
      res.end();
    } finally {
      if (process.env.LOG_REQUESTS === 'true') console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
  // O proxy da hospedagem reaproveita conexões ociosas; o padrão do Node (5s) fechava antes dele e gerava falhas intermitentes.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;
  return { server, db, info, backupDir, dbPath };
}

if (require.main === module) {
  let app;
  try { app = createApp(); } catch (e) { console.error('[FALHA AO INICIAR]', e.message); process.exit(1); }
  const { server, db, info } = app;
  server.on('error', (e) => { console.error('[FALHA NO SERVIDOR]', e.code === 'EACCES' ? `Sem permissão para usar a porta ${cfg.PORT}.` : e.message); process.exit(1); });
  server.listen(cfg.PORT, cfg.HOST, () => {
    console.log(`Vitin7 Finance v3 online em http://${cfg.HOST}:${server.address().port}`);
    console.log(`SQLite: ${cfg.DB_PATH}`);
    if (info.migrated) console.log('Migração aplicada:', JSON.stringify(info.migrated));
    if (info.seed) console.log('Cadastro inicial de dívidas:', JSON.stringify(info.seed));
    console.log(cfg.ACCESS_KEY ? 'Acesso protegido por ACCESS_KEY.' : 'AVISO: sem login/senha. Quem tiver o link acessa os dados. Veja o README (seção Privacidade).');
  });
  process.on('uncaughtException', (e) => { console.error('[erro não tratado]', e && e.stack || e); });
  process.on('unhandledRejection', (e) => { console.error('[promessa rejeitada]', e && e.stack || e); });
  let closing = false;
  const shutdown = () => {
    if (closing) return; closing = true;
    server.close(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* ok */ } process.exit(0); });
    setTimeout(() => process.exit(1), 7000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createApp };
