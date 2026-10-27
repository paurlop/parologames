import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, createOwner, Client, extractCsrf, login, freshCode, PASSWORD, gameForm, validGameZip } from './helpers.js';
import { totp, currentStep } from '../src/security/totp.js';
import { sha256 } from '../src/security/sessions.js';

const events = (app, name) => app.db.prepare('SELECT event, ip_hash, detail_json FROM audit_log WHERE event = ?').all(name);

describe('login', () => {
  let app;
  before(async () => { app = await startTestApp({ RATE_LOGIN_PER_15MIN: '1000', LOGIN_LOCK_THRESHOLD: '3', LOGIN_LOCK_MINUTES: '15' }); await createOwner(app); });
  after(() => app.close());

  async function attempt(fields) {
    const c = new Client(app.site, app.siteOrigin);
    const page = await c.get(`${app.adminPath}/entrar`);
    const csrf = extractCsrf(await page.text());
    const res = await c.postForm(`${app.adminPath}/entrar`, { _csrf: csrf, ...fields });
    return { c, res };
  }

  test('success sets a hardened session cookie, stores only the hash and logs auth.login_success', async () => {
    const { res, c } = await attempt({ password: PASSWORD, totp: freshCode(app) });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), app.adminPath);
    const cookie = res.headers.getSetCookie().find((s) => s.startsWith('parolo_s='));
    assert.ok(cookie, 'session cookie set');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
    const token = c.cookies.get('parolo_s');
    assert.equal(token.length, 43);
    const rows = app.db.prepare('SELECT token_hash FROM sessions').all();
    assert.ok(rows.some((r) => r.token_hash === sha256(token)));
    assert.ok(!rows.some((r) => r.token_hash === token));
    const panel = await c.get(app.adminPath);
    assert.equal(panel.status, 200);
    assert.equal(panel.headers.get('cache-control'), 'no-store');
    assert.equal(panel.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(events(app, 'auth.login_success').length, 1);
  });

  test('same TOTP code cannot be reused', async () => {
    app.db.prepare('UPDATE owner SET totp_last_step = 0').run();
    const code = totp(app.totpSecret, { step: currentStep() });
    assert.equal((await attempt({ password: PASSWORD, totp: code })).res.status, 303);
    assert.equal((await attempt({ password: PASSWORD, totp: code })).res.status, 401);
    app.db.prepare('DELETE FROM login_failures').run();
  });

  test('failures give one generic message and audit without secrets', async () => {
    const wrongPw = await attempt({ password: 'wrong password!!', totp: freshCode(app) });
    const wrongCode = await attempt({ password: PASSWORD, totp: '000000' === freshCode(app) ? '111111' : '000000' });
    assert.equal(wrongPw.res.status, 401);
    assert.equal(wrongCode.res.status, 401);
    const t1 = await wrongPw.res.text(); const t2 = await wrongCode.res.text();
    assert.ok(t1.includes('Contraseña o código incorrectos.'));
    assert.ok(t2.includes('Contraseña o código incorrectos.'));
    assert.equal(wrongPw.c.cookies.has('parolo_s'), false);
    const failed = events(app, 'auth.login_failed');
    assert.ok(failed.length >= 2);
    for (const f of failed) {
      assert.match(f.ip_hash, /^[a-f0-9]{32}$/);
      assert.ok(!f.detail_json.includes('wrong password'));
      assert.ok(!f.ip_hash.includes('127.0.0.1'));
    }
    assert.ok(!app.logs.join('').includes('wrong password!!'));
    app.db.prepare('DELETE FROM login_failures').run();
  });

  test('account lockout after repeated failures, even with correct credentials, with backoff', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await attempt({ password: 'nope nope nope', totp: '123456' })).res.status, 401);
    const locked = app.db.prepare("SELECT locked_until, lock_count FROM login_failures WHERE key = 'owner'").get();
    assert.ok(locked.locked_until > Date.now() + 14 * 60_000);
    assert.equal(locked.lock_count, 1);
    assert.equal(events(app, 'auth.locked').length, 1);
    const ok = await attempt({ password: PASSWORD, totp: freshCode(app) });
    assert.equal(ok.res.status, 401, 'locked account rejects even valid credentials');
    // segunda tanda: el bloqueo se duplica
    app.db.prepare("UPDATE login_failures SET locked_until = 0 WHERE key = 'owner'").run();
    for (let i = 0; i < 3; i++) await attempt({ password: 'nope nope nope', totp: '123456' });
    const second = app.db.prepare("SELECT locked_until, lock_count FROM login_failures WHERE key = 'owner'").get();
    assert.equal(second.lock_count, 2);
    assert.ok(second.locked_until > Date.now() + 29 * 60_000);
    app.db.prepare('DELETE FROM login_failures').run();
  });

  test('login form CSRF: missing/invalid token or foreign origin rejected', async () => {
    const c = new Client(app.site, app.siteOrigin);
    await c.get(`${app.adminPath}/entrar`);
    const noToken = await c.postForm(`${app.adminPath}/entrar`, { password: PASSWORD, totp: freshCode(app) });
    assert.equal(noToken.status, 403);
    const badToken = await c.postForm(`${app.adminPath}/entrar`, { _csrf: 'x'.repeat(43), password: PASSWORD, totp: freshCode(app) });
    assert.equal(badToken.status, 403);
    const page = await c.get(`${app.adminPath}/entrar`);
    const csrf = extractCsrf(await page.text());
    const foreign = await c.postForm(`${app.adminPath}/entrar`, { _csrf: csrf, password: PASSWORD, totp: freshCode(app) }, { origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    const noOrigin = await c.request(`${app.adminPath}/entrar`, { method: 'POST', origin: null, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, password: PASSWORD, totp: freshCode(app) }) });
    assert.equal(noOrigin.status, 403);
    const sfs = await c.request(`${app.adminPath}/entrar`, { method: 'POST', origin: null, headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf }) });
    assert.equal(sfs.status, 403);
    assert.equal(c.cookies.has('parolo_s'), false);
  });

  test('session CSRF: admin POST without/with wrong token rejected; logout deletes server-side', async () => {
    const { client, csrf } = await login(app);
    const before = app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    assert.equal((await client.postForm(`${app.adminPath}/salir`, {})).status, 403);
    assert.equal((await client.postForm(`${app.adminPath}/salir`, { _csrf: csrf + 'x' })).status, 403);
    assert.equal((await client.postForm(`${app.adminPath}/salir`, { _csrf: csrf }, { origin: 'http://evil.example' })).status, 403);
    // multipart: cabecera X-CSRF-Token incorrecta se rechaza antes de aceptar archivos
    const up = await client.postMultipart(`${app.adminPath}/juegos`, gameForm({ csrf, build: validGameZip() }), { headers: { 'x-csrf-token': 'bad' } });
    assert.equal(up.status, 403);
    const up2 = await client.postMultipart(`${app.adminPath}/juegos`, gameForm({ csrf: 'bad', build: validGameZip() }));
    assert.equal(up2.status, 403);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM games').get().n, 0);
    const token = client.cookies.get('parolo_s');
    const out = await client.postForm(`${app.adminPath}/salir`, { _csrf: csrf });
    assert.equal(out.status, 303);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(sha256(token)).n, 0);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, before - 1);
    // el token antiguo ya no sirve
    const replay = await fetch(`${app.site}${app.adminPath}`, { headers: { cookie: `parolo_s=${token}` }, redirect: 'manual' });
    assert.equal(replay.status, 303);
  });

  test('session token is rotated on login', async () => {
    const { client } = await login(app);
    const first = client.cookies.get('parolo_s');
    const page = await client.get(`${app.adminPath}/entrar`);
    assert.equal(page.status, 303); // ya con sesión
    // nuevo login con la cookie antigua presente → token nuevo y el viejo destruido
    const c2 = new Client(app.site, app.siteOrigin);
    c2.cookies.set('parolo_s', first);
    // fuerza la página de login sin sesión válida en el cliente nuevo
    app.db.prepare('UPDATE sessions SET expires_at = 0 WHERE token_hash = ?').run(sha256(first));
    const p = await c2.get(`${app.adminPath}/entrar`);
    const csrf = extractCsrf(await p.text());
    const res = await c2.postForm(`${app.adminPath}/entrar`, { _csrf: csrf, password: PASSWORD, totp: freshCode(app) });
    assert.equal(res.status, 303);
    assert.notEqual(c2.cookies.get('parolo_s'), first);
  });

  test('idle timeout expires sessions', async () => {
    const { client } = await login(app);
    const token = client.cookies.get('parolo_s');
    app.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(Date.now() - 61 * 60_000, sha256(token));
    assert.equal((await client.get(app.adminPath)).status, 303);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(sha256(token)).n, 0);
  });
});

describe('admin routes require auth', () => {
  let app;
  before(async () => { app = await startTestApp(); await createOwner(app); });
  after(() => app.close());

  const id = '0123456789abcdef';
  const routes = [
    ['GET', '/'], ['GET', '/nuevo'], ['GET', `/juegos/${id}/editar`],
    ['POST', '/salir'], ['POST', '/juegos'], ['POST', `/juegos/${id}`], ['POST', `/juegos/${id}/estado`], ['POST', `/juegos/${id}/eliminar`],
    ['GET', '/cualquier-cosa'], ['PUT', '/juegos'], ['DELETE', `/juegos/${id}`],
  ];
  for (const [method, p] of routes) {
    test(`${method} ${p} anonymous → redirect/401/403`, async () => {
      const c = new Client(app.site, app.siteOrigin);
      const res = await c.request(app.adminPath + p, { method, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : 'a=1' });
      assert.ok([303, 401, 403].includes(res.status), `got ${res.status}`);
      if (res.status === 303) assert.equal(res.headers.get('location'), `${app.adminPath}/entrar`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    });
  }
  test('forged session cookie is rejected', async () => {
    const res = await fetch(`${app.site}${app.adminPath}/nuevo`, { headers: { cookie: `parolo_s=${'A'.repeat(43)}` }, redirect: 'manual' });
    assert.equal(res.status, 303);
  });
  test('admin is not reachable outside ADMIN_PATH', async () => {
    for (const p of ['/admin', '/panel2', '/juegos/nuevo']) {
      const res = await fetch(app.site + p, { redirect: 'manual' });
      assert.equal(res.status, 404, p);
    }
    const post = await fetch(app.site + '/juegos', { method: 'POST', redirect: 'manual' });
    assert.equal(post.status, 405);
  });
});

describe('custom ADMIN_PATH', () => {
  let app;
  before(async () => { app = await startTestApp({ ADMIN_PATH: '/x-7f3a' }); await createOwner(app); });
  after(() => app.close());
  test('panel lives only under the configured path', async () => {
    assert.equal((await fetch(app.site + '/panel', { redirect: 'manual' })).status, 404);
    assert.equal((await fetch(app.site + '/x-7f3a', { redirect: 'manual' })).status, 303);
    const { client } = await login(app);
    assert.equal((await client.get('/x-7f3a/nuevo')).status, 200);
  });
});

describe('rate limiting', () => {
  let app;
  before(async () => { app = await startTestApp({ RATE_LOGIN_PER_15MIN: '2', RATE_GLOBAL_PER_MIN: '15', RATE_DOWNLOAD_PER_10MIN: '1' }); await createOwner(app); });
  after(() => app.close());

  test('login limiter returns 429 with standard headers', async () => {
    const c = new Client(app.site, app.siteOrigin);
    const page = await c.get(`${app.adminPath}/entrar`);
    const csrf = extractCsrf(await page.text());
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await c.postForm(`${app.adminPath}/entrar`, { _csrf: csrf, password: 'x', totp: '000000' })).status);
    assert.deepEqual(statuses, [401, 401, 429]);
    const res = await c.postForm(`${app.adminPath}/entrar`, { _csrf: csrf, password: 'x', totp: '000000' });
    assert.equal(res.status, 429);
    assert.ok(res.headers.get('ratelimit'));
    assert.ok(res.headers.get('ratelimit-policy'));
    assert.ok(res.headers.get('retry-after'));
  });

  test('global limiter returns 429', async () => {
    let last;
    for (let i = 0; i < 20; i++) last = await fetch(app.site + '/juegos');
    assert.equal(last.status, 429);
    assert.match(last.headers.get('content-security-policy'), /default-src 'none'/);
  });
});
