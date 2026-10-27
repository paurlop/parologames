// Utilidades de test: arrancar la app en puertos efímeros con un DATA_DIR temporal,
// crear el propietario, iniciar sesión (TOTP calculado) y construir ZIPs en memoria.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import zlib from 'node:zlib';
import { startServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/security/passwords.js';
import { generateSecret, totp, currentStep } from '../src/security/totp.js';
import { setOwner } from '../src/services/owner.js';
import { createLogger } from '../src/log.js';

export const PASSWORD = 'correct horse battery staple';

export async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

export function tempDir(prefix = 'parolo-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Arranca sitio + origen de juegos. Devuelve { site, games, siteOrigin, gamesOrigin, db, config, close, ... }.
 * @param {Record<string,string>} [env] variables extra
 */
export async function startTestApp(env = {}) {
  const dataDir = tempDir();
  const [port, gamesPort] = [await freePort(), await freePort()];
  const fullEnv = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    GAMES_PORT: String(gamesPort),
    SITE_ORIGIN: `http://127.0.0.1:${port}`,
    GAMES_ORIGIN: `http://localhost:${gamesPort}`,
    DATA_DIR: dataDir,
    IP_HASH_SALT: 'test-salt-test-salt-test-salt-test-salt-0123',
    LOG_LEVEL: 'silent',
    ...env,
  };
  const config = loadConfig(fullEnv);
  const logs = [];
  const logger = createLogger({ level: env.LOG_LEVEL || 'debug', stream: { write: (s) => logs.push(s) } });
  const handle = await startServer({ config, logger });
  const site = `http://127.0.0.1:${handle.sitePort}`;
  const games = `http://127.0.0.1:${handle.gamesPort}`;
  return {
    ...handle,
    logs,
    dataDir,
    site,
    games,
    siteOrigin: config.siteOrigin,
    gamesOrigin: config.gamesOrigin,
    adminPath: config.adminPath,
    async close() {
      await handle.shutdown('test');
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

/** Crea el propietario directamente en la BD. Devuelve el secreto TOTP. */
export async function createOwner(app, password = PASSWORD) {
  const secret = generateSecret();
  setOwner(app.db, { passwordHash: await hashPassword(password), totpSecret: secret });
  app.totpSecret = secret;
  return secret;
}

/** Código TOTP válido que aún no se ha usado (paso actual o siguiente). */
export function freshCode(app, secret = app.totpSecret) {
  const last = Number(app.db.prepare('SELECT totp_last_step AS s FROM owner WHERE id = 1').get()?.s ?? 0);
  let step = currentStep();
  if (step <= last) step = last + 1;
  if (step > currentStep() + 1) { // en tests permitimos reutilizar reiniciando el registro
    app.db.prepare('UPDATE owner SET totp_last_step = 0').run();
    step = currentStep();
  }
  return totp(secret, { step });
}

/** Cliente con tarro de cookies y redirect manual. */
export class Client {
  constructor(base, origin) { this.base = base; this.origin = origin; this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(); const value = pair.slice(i + 1).trim();
      const maxAge = attrs.map((a) => a.trim()).find((a) => /^max-age=/i.test(a));
      if (value === '' || (maxAge && Number(maxAge.split('=')[1]) <= 0)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  async request(p, { method = 'GET', headers = {}, body, origin = this.origin } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.cookie = this.cookieHeader();
    if (method !== 'GET' && method !== 'HEAD' && origin && !('origin' in h)) h.origin = origin;
    const res = await fetch(this.base + p, { method, headers: h, body, redirect: 'manual' });
    this.store(res);
    return res;
  }
  get(p, opts = {}) { return this.request(p, { ...opts, method: 'GET' }); }
  postForm(p, fields, opts = {}) {
    return this.request(p, { ...opts, method: 'POST', body: new URLSearchParams(fields), headers: { 'content-type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) } });
  }
  postMultipart(p, form, opts = {}) { return this.request(p, { ...opts, method: 'POST', body: form }); }
}

/** Extrae el valor del input oculto _csrf del HTML. */
export function extractCsrf(htmlText) {
  for (const m of htmlText.matchAll(/<input\b[^>]*>/gi)) {
    if (/name=["']?_csrf["']?/.test(m[0])) {
      const v = m[0].match(/value=["']([^"']*)["']/);
      if (v) return v[1].replace(/&amp;/g, '&');
    }
  }
  throw new Error('no _csrf input in page');
}

/** Inicia sesión y devuelve { client, csrf } con la sesión del panel. */
export async function login(app, { password = PASSWORD, code } = {}) {
  const client = new Client(app.site, app.siteOrigin);
  const page = await client.get(`${app.adminPath}/entrar`);
  const csrf = extractCsrf(await page.text());
  const res = await client.postForm(`${app.adminPath}/entrar`, { _csrf: csrf, password, totp: code ?? freshCode(app) });
  if (res.status !== 303) throw new Error(`login failed: ${res.status}`);
  const panel = await client.get(app.adminPath);
  const sessionCsrf = extractCsrf(await panel.text());
  return { client, csrf: sessionCsrf };
}

// ---------------------------------------------------------------------------------------------
// ZIP en memoria (para construir casos válidos y maliciosos)

/**
 * @param {Array<{ name: string, data?: Buffer|string, method?: 0|8, externalAttr?: number, dir?: boolean,
 *   fakeUncompressedSize?: number, rawName?: Buffer }>} entries
 */
export function buildZip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const e of entries) {
    const name = e.rawName ?? Buffer.from(e.name, 'utf8');
    const data = e.dir ? Buffer.alloc(0) : Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '');
    const method = e.dir ? 0 : (e.method ?? 8);
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data) >>> 0;
    const usize = e.fakeUncompressedSize ?? data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28);
    const attr = e.externalAttr ?? (e.dir ? ((0o040755 << 16) >>> 0) | 0x10 : (0o100644 << 16) >>> 0);
    ch.writeUInt32LE(attr >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export const GAME_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><canvas id="c"></canvas><script src="game.js"></script></body></html>';

export function validGameZip(extra = []) {
  return buildZip([
    { name: 'index.html', data: GAME_HTML },
    { name: 'game.js', data: 'console.log("hola");' },
    { name: 'assets/sprite.png', data: TINY_PNG, method: 0 },
    ...extra,
  ]);
}

/** PNG 1x1 válido. */
export const TINY_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
export const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

/** FormData del formulario de juego. */
export function gameForm({ csrf, title = 'Mi juego', tagline = 'Corto', description = 'Largo', status = 'published', featured, build, cover, download, key = crypto.randomUUID(), extra = {} } = {}) {
  const f = new FormData();
  if (csrf !== undefined) f.append('_csrf', csrf);
  f.append('idempotency_key', key);
  f.append('title', title);
  f.append('tagline', tagline);
  f.append('description', description);
  f.append('status', status);
  if (featured) f.append('featured', '1');
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  if (cover) f.append('cover', new Blob([cover]), 'cover.png');
  if (build) f.append('build', new Blob([build], { type: 'application/zip' }), 'build.zip');
  if (download) f.append('download', new Blob([download], { type: 'application/zip' }), 'download.zip');
  return f;
}

/** Crea un juego vía el panel y devuelve su fila de BD. */
export async function uploadGame(app, client, csrf, opts = {}) {
  const res = await client.postMultipart(`${app.adminPath}/juegos`, gameForm({ csrf, build: validGameZip(), cover: TINY_PNG, ...opts }));
  if (res.status !== 303) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return app.db.prepare('SELECT * FROM games ORDER BY created_at DESC, rowid DESC LIMIT 1').get();
}
