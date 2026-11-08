/** Zero-install local preview for the Cloudflare Worker + D1-shaped API. */
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = join(root, 'public');
const dbDir = process.env.TASKLAB_DATA_DIR ? resolve(process.env.TASKLAB_DATA_DIR) : join(root, 'local-dev-data');
mkdirSync(dbDir, { recursive: true });
const db = new DatabaseSync(join(dbDir, 'task-lab.sqlite'));
db.exec(readFileSync(join(root, 'migrations', '0001_initial.sql'), 'utf8'));
// Cloudflare tracks migrations itself. The standalone SQLite preview uses user_version.
if (db.prepare('PRAGMA user_version').get().user_version < 2) {
  db.exec(readFileSync(join(root, 'migrations', '0002_quality_reporting.sql'), 'utf8'));
  db.exec('PRAGMA user_version = 2');
}

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  async first() { return this.db.prepare(this.sql).get(...this.args) || null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { const result = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: result.changes } }; }
}
const DB = {
  prepare(sql) { return new Statement(db, sql); },
  async batch(statements) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = [];
      for (const s of statements) {
        const statement = db.prepare(s.sql);
        const rows = statement.columns().length ? statement.all(...s.args) : (statement.run(...s.args), []);
        result.push({ success: true, results: rows });
      }
      db.exec('COMMIT'); return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  },
};

function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n) return;
  db.prepare('INSERT INTO users(id,first_name) VALUES(?,?) ON CONFLICT DO NOTHING').run('90001', 'Demo Admin');
  const insert = db.prepare(`INSERT INTO campaigns
    (id,title,description,game_url,instructions,question1,question2,question3,reward_points,capacity,status,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run(randomUUID(), 'Explore Telegram’s example Mini App',
    'Practice a structured usability test using Telegram’s publicly documented Mini App example. This is not a sponsored campaign.',
    'https://t.me/DurgerKingBot',
    'Open the demo bot. Explore how its Mini App is launched. Do not make purchases or share private information. Return here and report what you found.',
    'How easy was it to locate and open the Mini App?',
    'Which part of the experience was confusing or difficult?',
    'What one change would improve the first-time experience?',
    20, 12, 'active', '90001');
  insert.run(randomUUID(), 'Review a Mini App onboarding guide',
    'A second sample task to demonstrate how an administrator activates campaigns. Not sponsored.',
    'https://core.telegram.org/bots/webapps',
    'Open the official Telegram documentation, find the Mini App launch options, and explain what a new user might misunderstand.',
    'Which Mini App launch options did you find?',
    'Which launch flow seems hardest for beginners?',
    'How would you simplify the documentation for new users?',
    15, 8, 'draft', '90001');
}
seed();
const DEV_KEY = randomBytes(24).toString('hex');
const env = { DB, ENVIRONMENT: 'development', LOCAL_DEV_KEY: DEV_KEY,
  ADMIN_TELEGRAM_IDS: '90001', BOT_TOKEN: process.env.BOT_TOKEN || '' };
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/__local_session') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ devKey: DEV_KEY, profiles: ['10001', '90001'] })); return;
  }
  if (url.pathname.startsWith('/api/')) {
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
        if (body.length > 11000) { res.writeHead(413); res.end('Too large'); return; }
      }
      const request = new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
        method: req.method, headers: req.headers,
        ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body } : {}),
      });
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { console.error(error); res.writeHead(500); res.end('Local server failure'); }
    return;
  }
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const path = resolve(publicDir, relative);
  if (!path.startsWith(publicDir + '/') || !existsSync(path)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff' });
    res.end(readFileSync(path));
  } catch { res.writeHead(500); res.end('Read error'); }
});
const port = Number(process.env.PORT || 8787);
server.listen(port, '127.0.0.1', () => console.log(`\nTaskLab local prototype: http://127.0.0.1:${port}\nLocal-only profiles: Demo Tester & Demo Admin\nSimulated points ONLY; no real payouts.\n`));
