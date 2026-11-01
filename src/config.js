'use strict';
// Configuração central. Lê um .env opcional (sem dependências) e detecta a Square Cloud.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function loadDotEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  } catch { /* .env é opcional */ }
}
loadDotEnv(path.join(ROOT, '.env'));

// Na Square Cloud a aplicação roda em /application. Se esse diretório existe,
// assumimos produção mesmo que NODE_ENV não tenha sido definido no painel.
const onSquareCloud = ROOT.startsWith('/application');
const production = process.env.NODE_ENV === 'production' || onSquareCloud;

const PORT = Number(process.env.PORT || (production ? 80 : 3000));
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = path.resolve(
  process.env.DB_PATH || (production ? '/application/data/vitin7.sqlite' : path.join(ROOT, 'data', 'vitin7.sqlite'))
);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('PORT inválida: ' + process.env.PORT);

module.exports = {
  ROOT, PORT, HOST, DB_PATH, production, onSquareCloud,
  // Proteção opcional por senha única (HTTP Basic do navegador, sem tela de login própria).
  ACCESS_KEY: process.env.ACCESS_KEY || '',
  TZ: process.env.APP_TZ || 'America/Sao_Paulo',
  BACKUP_DIR: path.join(path.dirname(DB_PATH), 'backups'),
};
