import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTestApp, createOwner, login, uploadGame, freePort, tempDir, extractCsrf, Client } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function csp(res) {
  return Object.fromEntries(res.headers.get('content-security-policy').split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
}

describe('security headers and routing', () => {
  let app; let game;
  before(async () => {
    app = await startTestApp();
    await createOwner(app);
    const { client, csrf } = await login(app);
    game = await uploadGame(app, client, csrf, { title: 'Headers' });
  });
  after(() => app.close());

  test('site: CSP with per-request nonce, frame-ancestors none, and hardening headers', async () => {
    const a = await fetch(app.site + '/');
    const b = await fetch(app.site + '/');
    const d = csp(a);
    assert.deepEqual(d['default-src'], ["'none'"]);
    assert.equal(d['script-src'][0], "'self'");
    assert.match(d['script-src'][1], /^'nonce-[A-Za-z0-9+/]{22}=='$/);
    assert.notEqual(csp(b)['script-src'][1], d['script-src'][1], 'fresh nonce per request');
    assert.deepEqual(d['frame-ancestors'], ["'none'"]);
    assert.deepEqual(d['frame-src'], [app.gamesOrigin]);
    assert.deepEqual(d['base-uri'], ["'none'"]);
    assert.deepEqual(d['form-action'], ["'self'"]);
    assert.equal(d['upgrade-insecure-requests'], undefined, 'no upgrade in dev/test');
    assert.ok(!a.headers.get('content-security-policy').includes('unsafe'));
    assert.equal(a.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(a.headers.get('x-frame-options'), 'DENY');
    assert.equal(a.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(a.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(a.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.match(a.headers.get('permissions-policy'), /camera=\(\)/);
    assert.match(a.headers.get('permissions-policy'), /microphone=\(\)/);
    assert.match(a.headers.get('permissions-policy'), /geolocation=\(\)/);
    assert.ok(a.headers.get('permissions-policy').includes(`fullscreen=(self "${app.gamesOrigin}")`));
    assert.equal(a.headers.get('x-powered-by'), null);
    assert.equal(a.headers.get('strict-transport-security'), null, 'no HSTS outside production');
    assert.match(a.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.equal(a.headers.get('access-control-allow-origin'), null);
  });

  test('games origin: permissive script CSP, frame-ancestors = site origin only, no cookies', async () => {
    const res = await fetch(`${app.games}/play/${game.id}/`, { headers: { cookie: 'parolo_s=abc' } });
    assert.equal(res.status, 200);
    const d = csp(res);
    assert.deepEqual(d['frame-ancestors'], [app.siteOrigin]);
    for (const k of ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'blob:']) assert.ok(d['script-src'].includes(k), k);
    assert.ok(d['connect-src'].includes("'self'"));
    assert.ok(!d['connect-src'].some((s) => s.startsWith('http')), 'no external connect');
    assert.deepEqual(d['object-src'], ["'none'"]);
    assert.equal(res.headers.get('x-frame-options'), null);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    const health = await fetch(`${app.games}/healthz`);
    assert.equal(health.status, 200);
    assert.ok(health.headers.get('content-security-policy').includes('frame-ancestors'));
    for (const p of ['/readyz', '/static/css/site.css', '/panel', '/robots.txt', '/play']) {
      assert.equal((await fetch(app.games + p, { redirect: 'manual' })).status, 404, p);
    }
    assert.equal((await fetch(`${app.games}/play/${game.id}/`, { method: 'POST' })).status, 405);
    const redir = await fetch(`${app.games}/play/${game.id}`, { redirect: 'manual' });
    assert.equal(redir.status, 301);
    assert.equal(redir.headers.get('location'), `/play/${game.id}/`);
  });

  test('/healthz and /readyz', async () => {
    const h = await fetch(app.site + '/healthz');
    assert.equal(h.status, 200);
    assert.equal(await h.text(), 'ok');
    assert.equal(h.headers.get('cache-control'), 'no-store');
    const r = await fetch(app.site + '/readyz');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'ready');
  });

  test('404 handler renders the error view without internals', async () => {
    const res = await fetch(app.site + '/no/existe');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.ok(!/stack|at \w+ \(|node_modules/i.test(body));
    assert.equal((await fetch(app.site + '/juegos/no-existe')).status, 404);
    assert.equal((await fetch(app.site + '/juegos/' + encodeURIComponent('<script>'))).status, 404);
  });

  test('static assets: immutable cache, no listing, dotfiles denied', async () => {
    const css = await fetch(app.site + '/static/css/site.css?v=1');
    if (css.status === 200) {
      assert.equal(css.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.match(css.headers.get('content-type'), /text\/css/);
    }
    assert.equal((await fetch(app.site + '/static/')).status, 404);
    assert.equal((await fetch(app.site + '/static/css/')).status, 404);
    assert.equal((await fetch(app.site + '/static/.env')).status, 404);
    assert.equal((await fetch(app.site + '/static/../package.json')).status, 404);
    assert.equal((await fetch(app.site + '/static/%2e%2e/package.json')).status, 404);
  });

  test('robots.txt does not reveal ADMIN_PATH; non-GET on public routes is 405', async () => {
    const r = await fetch(app.site + '/robots.txt');
    assert.ok(!(await r.text()).includes(app.adminPath));
    assert.equal((await fetch(app.site + '/', { method: 'POST' })).status, 405);
  });

  test('access log omits admin query strings and never logs secrets', async () => {
    await fetch(`${app.site}${app.adminPath}?aviso=secreto123`, { redirect: 'manual' });
    const lines = app.logs.map((l) => JSON.parse(l));
    const entry = lines.find((l) => l.msg === 'http' && l.path === app.adminPath);
    assert.ok(entry);
    assert.ok(!app.logs.join('').includes('secreto123'));
    assert.ok(lines.every((l) => typeof l.t === 'string' && typeof l.level === 'string'));
    assert.ok(!app.logs.join('').includes('correct horse'));
  });
});

describe('production mode', () => {
  let app;
  before(async () => {
    app = await startTestApp({ NODE_ENV: 'production', SITE_ORIGIN: 'https://parolo.example', GAMES_ORIGIN: 'https://play.parolo-games.example', TRUST_PROXY: '1' });
    await createOwner(app);
  });
  after(() => app.close());

  test('HSTS, upgrade-insecure-requests and __Host- Secure cookies', async () => {
    const res = await fetch(`${app.site}${app.adminPath}/entrar`);
    assert.equal(res.headers.get('strict-transport-security'), 'max-age=63072000; includeSubDomains; preload');
    assert.ok(res.headers.get('content-security-policy').includes('upgrade-insecure-requests'));
    const pre = res.headers.getSetCookie().find((c) => c.startsWith('__Host-parolo_pre='));
    assert.ok(pre);
    assert.match(pre, /Secure/);
    assert.match(pre, /Path=\//);
    assert.ok(!/Domain=/i.test(pre));
    const csrf = extractCsrf(await res.text());
    const c = new Client(app.site, app.siteOrigin);
    c.store(res);
    const { freshCode, PASSWORD } = await import('./helpers.js');
    const ok = await c.postForm(`${app.adminPath}/entrar`, { _csrf: csrf, password: PASSWORD, totp: freshCode(app) });
    assert.equal(ok.status, 303);
    const s = ok.headers.getSetCookie().find((x) => x.startsWith('__Host-parolo_s='));
    assert.ok(s);
    assert.match(s, /Secure/);
    assert.match(s, /HttpOnly/);
    assert.match(s, /SameSite=Strict/);
    const games = await fetch(`${app.games}/healthz`);
    assert.match(games.headers.get('strict-transport-security'), /max-age=63072000/);
  });
});

describe('graceful shutdown', () => {
  test('stops accepting, finishes in-flight requests, closes the DB', async () => {
    const app = await startTestApp();
    const port = new URL(app.site).port;
    // Petición en curso: cuerpo enviado a medias
    const responded = new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: `${app.adminPath}/entrar`, headers: { origin: app.siteOrigin, 'content-type': 'application/x-www-form-urlencoded', 'content-length': '11' } }, (res) => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.write('a=1&b');
      setTimeout(async () => {
        const done = app.shutdown('test');
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(app.siteServer.listening, false);
        assert.equal(app.gamesServer.listening, false);
        await assert.rejects(fetch(app.site + '/healthz'));
        req.end('=2&c=3');
        await done;
      }, 100);
    });
    assert.equal(await responded, 403, 'in-flight request completed');
    await app.shutdown();
    assert.equal(app.db.isOpen, false);
    fs.rmSync(app.dataDir, { recursive: true, force: true });
  });

  test('SIGTERM on a real process exits cleanly', { skip: process.platform === 'win32' && 'POSIX signals are not delivered on Windows' }, async () => {
    const dataDir = tempDir();
    const [p1, p2] = [await freePort(), await freePort()];
    const child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(p1), GAMES_PORT: String(p2), DATA_DIR: dataDir, LOG_LEVEL: 'info', IP_HASH_SALT: 'x'.repeat(40) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => { out += d; if (out.includes('server.listening')) resolve(); });
      child.on('exit', () => reject(new Error(`exited early: ${out}`)));
    });
    child.removeAllListeners('exit');
    const code = await new Promise((resolve) => { child.on('exit', (c) => resolve(c)); child.kill('SIGTERM'); });
    assert.equal(code, 0);
    assert.ok(out.includes('server.stopped'));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

describe('setup-admin script (non-interactive)', () => {
  test('creates owner with SETUP_PASSWORD --yes and prints the secret once', async () => {
    const dataDir = tempDir();
    const run = (args, env) => new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'scripts/setup-admin.js'), ...args], { env: { ...process.env, DATA_DIR: dataDir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('exit', (code) => resolve({ code, out, err }));
    });
    const short = await run(['--yes'], { SETUP_PASSWORD: 'short' });
    assert.notEqual(short.code, 0);
    const r = await run(['--yes'], { SETUP_PASSWORD: 'a long enough password' });
    assert.equal(r.code, 0, r.err);
    const secret = r.out.match(/TOTP_SECRET=([A-Z2-7]+)/)?.[1];
    assert.ok(secret && secret.length >= 32);
    assert.match(r.out, /otpauth:\/\/totp\//);
    assert.ok(!r.out.includes('a long enough password'));
    const { openDb } = await import('../src/db.js');
    const { verifyPassword } = await import('../src/security/passwords.js');
    let db = openDb(path.join(dataDir, 'parolo.db'));
    const owner = db.prepare('SELECT * FROM owner').get();
    assert.equal(owner.totp_secret, secret);
    assert.equal(await verifyPassword('a long enough password', owner.password_hash), true);
    db.close();
    const rot = await run(['--rotate-totp', '--yes'], {});
    assert.equal(rot.code, 0, rot.err);
    const secret2 = rot.out.match(/TOTP_SECRET=([A-Z2-7]+)/)?.[1];
    assert.ok(secret2 && secret2 !== secret);
    db = openDb(path.join(dataDir, 'parolo.db'));
    assert.equal(db.prepare('SELECT totp_secret FROM owner').get().totp_secret, secret2);
    assert.equal(await verifyPassword('a long enough password', db.prepare('SELECT password_hash FROM owner').get().password_hash), true);
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
