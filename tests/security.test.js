// Regresiones de la auditoría de seguridad: cada caso reproduce un ataque probado contra una instancia real.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { startTestApp, createOwner, Client, extractCsrf, login, freshCode, PASSWORD, uploadGame, gameForm, buildZip } from './helpers.js';
import { safeUrl } from '../src/views/_html.js';

const BS = '\\';

describe('safeUrl (contexto URL en las vistas)', () => {
  test('rechaza /\\host (los navegadores lo leen como //host) y caracteres de control', () => {
    assert.equal(safeUrl(`/${BS}evil.example/x`), '#');
    assert.equal(safeUrl(`/${BS}${BS}evil.example`), '#');
    assert.equal(safeUrl('/\tevil'), '#');
    assert.equal(safeUrl('/\n/evil.example'), '#');
    assert.equal(safeUrl('javascript:alert(1)'), '#');
    assert.equal(safeUrl('/media/portadas/0123456789abcdef0123456789abcdef.png'), '/media/portadas/0123456789abcdef0123456789abcdef.png');
    assert.equal(safeUrl('http://127.0.0.1:3001/play/0123456789abcdef/'), 'http://127.0.0.1:3001/play/0123456789abcdef/');
  });
  test('//host nunca se devuelve como ruta relativa', () => {
    assert.notEqual(safeUrl('//evil.example'), '//evil.example');
  });
});

describe('ataques HTTP contra una instancia real', () => {
  let app; let client; let csrf; let game;
  before(async () => {
    app = await startTestApp({ RATE_LOGIN_PER_15MIN: '1000' });
    await createOwner(app);
    ({ client, csrf } = await login(app));
    game = await uploadGame(app, client, csrf, {
      title: '"><script>alert(1)</script>', tagline: '<img src=x onerror=alert(2)>', description: '<svg onload=alert(3)>\n\njavascript:alert(4)',
    });
  });
  after(() => app.close());

  test('/readyz reutiliza el resultado durante 1 s (sin consulta + escritura por petición)', async () => {
    let writes = 0;
    const orig = fs.promises.writeFile;
    fs.promises.writeFile = (...a) => { if (String(a[0]).includes('.ready-')) writes++; return orig(...a); };
    try {
      const results = await Promise.all(Array.from({ length: 20 }, () => fetch(app.site + '/readyz').then((r) => r.status)));
      assert.ok(results.every((s) => s === 200));
      assert.ok(writes <= 1, `escrituras de sonda: ${writes}`);
    } finally { fs.promises.writeFile = orig; }
  });

  test('XSS: título/subtítulo/descripción se escapan en público y en el panel', async () => {
    for (const p of [`/juegos/${game.slug}`, '/juegos', '/']) {
      const h = await (await fetch(app.site + p)).text();
      assert.ok(!h.includes('<script>alert'), p);
      assert.ok(!/<img src=x onerror/.test(h), p);
      assert.ok(!h.includes('<svg onload'), p);
    }
    const h = await (await client.get(app.adminPath)).text();
    assert.ok(!h.includes('<script>alert'));
  });

  test('traversal codificado en /play/:id/* no sale del build', async () => {
    const base = `${app.games}/play/${game.id}`;
    for (const p of ['/..%2f..%2fparolo.db', '/..%2f..%2f..%2fparolo.db', '/%2e%2e/%2e%2e/parolo.db', '/..%5c..%5cparolo.db', '/index.html%00.js', '/%2findex.html', '/.hidden']) {
      assert.equal((await fetch(base + p, { redirect: 'manual' })).status, 404, p);
    }
    const raw = (path) => new Promise((resolve) => {
      const s = net.connect(new URL(app.games).port, '127.0.0.1', () => s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
      let d = ''; s.on('data', (c) => { d += c; }); s.on('end', () => resolve(d.split('\r\n')[0])); s.on('error', () => resolve('error'));
    });
    for (const p of [`/play/${game.id}/../../parolo.db`, `/play/${game.id}/..${BS}..${BS}parolo.db`, `/play/${game.id}/a/../../../parolo.db`]) {
      assert.match(await raw(p), / 404 /, p);
    }
    for (const p of ['/static/../src/config.js', '/static/%2e%2e/.env', '/media/portadas/..%2f..%2fparolo.db']) {
      const s = await new Promise((resolve) => {
        const sock = net.connect(new URL(app.site).port, '127.0.0.1', () => sock.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
        let d = ''; sock.on('data', (c) => { d += c; }); sock.on('end', () => resolve(d.split('\r\n')[0]));
      });
      assert.match(s, / 404 /, p);
    }
  });

  test('CSRF de login: Origin ajeno, sin Origin/Sec-Fetch-Site o Sec-Fetch-Site same-site → 403', async () => {
    const c = new Client(app.site, app.siteOrigin);
    const tok = extractCsrf(await (await c.get(`${app.adminPath}/entrar`)).text());
    const fields = { _csrf: tok, password: PASSWORD, totp: '000000' };
    assert.equal((await c.postForm(`${app.adminPath}/entrar`, fields, { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await c.postForm(`${app.adminPath}/entrar`, fields, { origin: null })).status, 403);
    assert.equal((await c.postForm(`${app.adminPath}/entrar`, fields, { origin: null, headers: { 'sec-fetch-site': 'same-site' } })).status, 403);
    assert.equal((await c.postForm(`${app.adminPath}/entrar`, fields, { headers: { origin: 'null' } })).status, 403);
  });

  test('fijación de sesión: un token plantado no sobrevive al login; tras salir el token viejo no vale', async () => {
    const c = new Client(app.site, app.siteOrigin);
    const planted = 'A'.repeat(43);
    c.cookies.set('parolo_s', planted);
    const tok = extractCsrf(await (await c.get(`${app.adminPath}/entrar`)).text());
    const res = await c.postForm(`${app.adminPath}/entrar`, { _csrf: tok, password: PASSWORD, totp: freshCode(app) });
    assert.equal(res.status, 303);
    const token = c.cookies.get('parolo_s');
    assert.notEqual(token, planted);
    const s = extractCsrf(await (await c.get(app.adminPath)).text());
    assert.equal((await c.postForm(`${app.adminPath}/salir`, { _csrf: s })).status, 303);
    const reuse = await fetch(app.site + app.adminPath, { redirect: 'manual', headers: { cookie: `parolo_s=${token}` } });
    assert.equal(reuse.status, 303);
    assert.equal(reuse.headers.get('location'), `${app.adminPath}/entrar`);
  });

  test('ZIP malicioso: rutas con dos puntos (ADS) y bombas se rechazan sin crear el juego', async () => {
    const before = app.db.prepare('SELECT COUNT(*) AS n FROM games').get().n;
    const idx = { name: 'index.html', data: '<p>x</p>' };
    for (const entries of [
      [idx, { name: 'index.html:evil.js', data: '1' }],
      [idx, { name: 'bomb.data', data: Buffer.alloc(20 * 1024 * 1024) }],
      [idx, { name: 'x.exe.gz', data: 'x' }],
    ]) {
      const res = await client.postMultipart(`${app.adminPath}/juegos`, gameForm({ csrf, build: buildZip(entries) }));
      assert.equal(res.status, 400);
    }
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM games').get().n, before);
  });

  test('X-Forwarded-For se ignora sin TRUST_PROXY (no permite saltarse el límite)', async () => {
    const a = await fetch(app.site + '/robots.txt', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    const b = await fetch(app.site + '/robots.txt', { headers: { 'x-forwarded-for': '5.6.7.8' } });
    const rem = (r) => Number(/remaining=(\d+)/.exec(r.headers.get('ratelimit'))[1]);
    assert.equal(rem(b), rem(a) - 1);
  });
});
