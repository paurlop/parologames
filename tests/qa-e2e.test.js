// QA end-to-end: the full owner journey through the real HTTP endpoints, plus idempotency,
// pagination with 30 games, an HTML smoke check and a per-page latency budget.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestApp, createOwner, login, gameForm, validGameZip, TINY_PNG, Client } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_ZIP = path.join(ROOT, 'games-dist', 'palco-de-honor.zip');
const REAL_PNG = path.join(ROOT, 'games-dist', 'palco-de-honor.png');
const HAVE_REAL = fs.existsSync(REAL_ZIP) && fs.existsSync(REAL_PNG);
const BUDGET_MS = 150;

/** Uploads via the multipart endpoint the way admin.js does it (X-CSRF-Token header). */
async function upload(app, client, csrf, opts = {}) {
  const form = gameForm({ csrf, build: validGameZip(), cover: TINY_PNG, ...opts });
  return client.postMultipart(`${app.adminPath}/juegos`, form, { headers: { 'x-csrf-token': csrf } });
}
const rowBySlug = (app, slug) => app.db.prepare('SELECT * FROM games WHERE slug = ?').get(slug);
const countGames = (app) => Number(app.db.prepare('SELECT COUNT(*) AS n FROM games').get().n);
const text = async (url) => { const r = await fetch(url); return { status: r.status, body: await r.text(), res: r }; };

/** Minimal HTML smoke check: one <h1>, lang="es", non-empty <title>, unique ids, img alt, labelled inputs. */
function htmlProblems(body) {
  const problems = [];
  const h1 = body.match(/<h1\b/gi)?.length ?? 0;
  if (h1 !== 1) problems.push(`${h1} <h1>`);
  if (!/<html\b[^>]*\blang="es"/i.test(body)) problems.push('no lang="es"');
  if (!/<title>[^<]+<\/title>/i.test(body)) problems.push('no <title>');
  if (!/^<!doctype html>/i.test(body.trimStart())) problems.push('no doctype');
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) problems.push(`duplicate ids: ${[...new Set(dup)].join(',')}`);
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) if (!/\salt=/.test(m[0])) problems.push(`img without alt: ${m[0].slice(0, 60)}`);
  for (const m of body.matchAll(/<(input|textarea|select)\b[^>]*>/gi)) {
    const tag = m[0];
    if (/type="(hidden|submit|button)"/.test(tag)) continue;
    const id = tag.match(/\sid="([^"]+)"/)?.[1];
    const labelledFor = id && new RegExp(`<label[^>]*\\sfor="${id}"`).test(body);
    const wrapped = new RegExp(`<label\\b[^>]*>(?:(?!</label>).)*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 's').test(body);
    if (!labelledFor && !wrapped && !/aria-label(ledby)?=/.test(tag)) problems.push(`unlabelled control: ${tag.slice(0, 60)}`);
  }
  for (const m of body.matchAll(/aria-describedby="([^"]*)"/g)) {
    for (const ref of m[1].split(/\s+/).filter(Boolean)) if (!ids.includes(ref)) problems.push(`aria-describedby -> missing #${ref}`);
  }
  return problems;
}

describe('QA e2e: owner journey', () => {
  let app; let client; let csrf;
  const timings = [];
  const timed = async (label, url, init) => {
    const t0 = performance.now();
    const r = await fetch(url, init);
    const body = await r.text();
    const ms = performance.now() - t0;
    timings.push({ label, ms, status: r.status });
    return { status: r.status, body, res: r, ms };
  };

  before(async () => {
    app = await startTestApp({ RATE_UPLOAD_PER_HOUR: '1000', RATE_GLOBAL_PER_MIN: '100000', RATE_DOWNLOAD_PER_10MIN: '1000' });
    await createOwner(app);
    ({ client, csrf } = await login(app));
  });
  after(async () => {
    if (timings.length) {
      const worst = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5).map((t) => `${t.label}=${t.ms.toFixed(1)}ms`).join(' ');
      process.stdout.write(`# qa-e2e page timings (n=${timings.length}) worst: ${worst}\n`);
    }
    await app?.close();
  });

  test('full journey: upload → public → play → download → edit → hide → publish → feature → delete → logout', async () => {
    const build = HAVE_REAL ? fs.readFileSync(REAL_ZIP) : validGameZip();
    const cover = HAVE_REAL ? fs.readFileSync(REAL_PNG) : TINY_PNG;
    let res = await upload(app, client, csrf, { title: 'Palco de honor', tagline: 'Primera versión', description: 'Uno.\n\nDos.', build, cover });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `${app.adminPath}?aviso=creado`);
    const row = rowBySlug(app, 'palco-de-honor');
    assert.ok(row, 'game row created with slug from title');
    assert.ok(row.cover_file, 'cover stored');

    // Public pages
    const splash = await timed('/', `${app.site}/`);
    assert.equal(splash.status, 200);
    assert.match(splash.body, /href="\/juegos\/palco-de-honor"/);
    const shelf = await timed('/juegos', `${app.site}/juegos`);
    assert.match(shelf.body, /href="\/juegos\/palco-de-honor"/);
    assert.match(shelf.body, /Palco de honor/);
    const page = await timed('/juegos/:slug', `${app.site}/juegos/palco-de-honor`);
    assert.equal(page.status, 200);
    assert.match(page.body, /<h1[^>]*>Palco de honor<\/h1>/);
    const playUrl = page.body.match(/data-play="([^"]+)"/)[1];
    assert.equal(playUrl, `${app.gamesOrigin}/play/${row.id}/`);
    const coverUrl = page.body.match(/class="screen-cover" src="([^"]+)"/)[1];
    const coverRes = await fetch(app.site + coverUrl);
    assert.equal(coverRes.status, 200);
    assert.match(coverRes.headers.get('content-type'), /^image\/png/);
    await coverRes.arrayBuffer();

    // Play on the games origin (connect to the real port; GAMES_ORIGIN uses another host name)
    const play = await fetch(`${app.games}/play/${row.id}/`);
    assert.equal(play.status, 200);
    assert.match(play.headers.get('content-type'), /^text\/html/);
    assert.equal(play.headers.get('cache-control'), 'no-cache');
    assert.equal(play.headers.get('x-content-type-options'), 'nosniff');
    assert.match(play.headers.get('content-security-policy'), new RegExp(`frame-ancestors ${app.siteOrigin.replace(/[.]/g, '\\.')}(;|$)`));
    assert.equal(play.headers.get('set-cookie'), null);
    const idx = await play.text();
    assert.match(idx, /<html/i);
    if (HAVE_REAL) assert.match(idx, /<title>Palco de Honor<\/title>/);
    // The site page must frame only the games origin
    assert.match(page.res.headers.get('content-security-policy'), new RegExp(`frame-src ${app.gamesOrigin}`));

    // Download
    const dl = await fetch(`${app.site}/juegos/palco-de-honor/descargar`);
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-type'), 'application/zip');
    assert.match(dl.headers.get('content-disposition'), /^attachment; filename="palco-de-honor\.zip"/);
    const zipBytes = Buffer.from(await dl.arrayBuffer());
    assert.equal(zipBytes.readUInt32LE(0), 0x04034b50, 'starts with ZIP local header');
    assert.equal(zipBytes.length, Number(dl.headers.get('content-length')));

    // Edit title/tagline (no new files): slug stays
    const form = gameForm({ csrf, title: 'Palco de honor DX', tagline: 'Segunda versión', description: 'Nueva', status: 'published' });
    res = await client.postMultipart(`${app.adminPath}/juegos/${row.id}`, form, { headers: { 'x-csrf-token': csrf } });
    assert.equal(res.status, 303);
    const edited = app.db.prepare('SELECT * FROM games WHERE id = ?').get(row.id);
    assert.equal(edited.slug, 'palco-de-honor');
    assert.equal(edited.title, 'Palco de honor DX');
    assert.equal(edited.build_dir, row.build_dir, 'build untouched without a new ZIP');
    const after1 = await text(`${app.site}/juegos/palco-de-honor`);
    assert.match(after1.body, /Palco de honor DX/);
    assert.match(after1.body, /Segunda versión/);
    assert.equal((await fetch(`${app.site}/juegos/palco-de-honor-dx`)).status, 404);

    // Hide
    res = await client.postForm(`${app.adminPath}/juegos/${row.id}/estado`, { _csrf: csrf, status: 'hidden' });
    assert.equal(res.status, 303);
    assert.equal((await fetch(`${app.site}/juegos/palco-de-honor`)).status, 404);
    assert.equal((await fetch(`${app.site}/juegos/palco-de-honor/descargar`)).status, 404);
    assert.equal((await fetch(`${app.games}/play/${row.id}/`)).status, 404);
    assert.doesNotMatch((await text(`${app.site}/juegos`)).body, /palco-de-honor/);
    assert.doesNotMatch((await text(`${app.site}/`)).body, /palco-de-honor/);

    // Publish again
    res = await client.postForm(`${app.adminPath}/juegos/${row.id}/estado`, { _csrf: csrf, status: 'published' });
    assert.equal(res.status, 303);
    assert.equal((await fetch(`${app.site}/juegos/palco-de-honor`)).status, 200);
    assert.equal((await fetch(`${app.games}/play/${row.id}/`)).status, 200);

    // Feature flag → featured block on /juegos
    let shelfNow = (await text(`${app.site}/juegos`)).body;
    assert.doesNotMatch(shelfNow, /class="feature"/, 'no featured block before flag');
    const ff = gameForm({ csrf, title: 'Palco de honor DX', tagline: 'Segunda versión', description: 'Nueva', status: 'published', featured: true });
    res = await client.postMultipart(`${app.adminPath}/juegos/${row.id}`, ff, { headers: { 'x-csrf-token': csrf } });
    assert.equal(res.status, 303);
    shelfNow = (await text(`${app.site}/juegos`)).body;
    const block = shelfNow.match(/<section class="feature"[\s\S]*?<\/section>/)?.[0];
    assert.ok(block, 'featured block rendered');
    assert.match(block, /Palco de honor DX/);
    assert.match(block, /href="\/juegos\/palco-de-honor"/);

    // Delete: without confirm → 400, nothing removed; with confirm → gone from DB and disk
    const files = [
      path.join(app.dataDir, 'games', row.id),
      path.join(app.dataDir, 'covers', edited.cover_file),
      ...(edited.web_zip_file ? [path.join(app.dataDir, 'downloads', edited.web_zip_file)] : []),
    ];
    for (const f of files) assert.ok(fs.existsSync(f), `exists before delete: ${f}`);
    res = await client.postForm(`${app.adminPath}/juegos/${row.id}/eliminar`, { _csrf: csrf });
    assert.equal(res.status, 400);
    assert.ok(rowBySlug(app, 'palco-de-honor'));
    res = await client.postForm(`${app.adminPath}/juegos/${row.id}/eliminar`, { _csrf: csrf, confirm: '1' });
    assert.equal(res.status, 303);
    assert.equal(rowBySlug(app, 'palco-de-honor'), undefined);
    for (const f of files) assert.equal(fs.existsSync(f), false, `removed from disk: ${f}`);
    assert.equal((await fetch(`${app.site}/juegos/palco-de-honor`)).status, 404);
    assert.equal((await fetch(app.site + coverUrl)).status, 404);

    // Logout → session no longer valid
    const oldCookie = client.cookieHeader();
    res = await client.postForm(`${app.adminPath}/salir`, { _csrf: csrf });
    assert.equal(res.status, 303);
    const replay = await fetch(`${app.site}${app.adminPath}`, { headers: { cookie: oldCookie }, redirect: 'manual' });
    assert.equal(replay.status, 303);
    assert.equal(replay.headers.get('location'), `${app.adminPath}/entrar`);
    const replayPost = await fetch(`${app.site}${app.adminPath}/juegos`, {
      method: 'POST', redirect: 'manual', headers: { cookie: oldCookie, origin: app.siteOrigin, 'x-csrf-token': csrf }, body: gameForm({ csrf, build: validGameZip() }),
    });
    assert.equal(replayPost.status, 403);
    assert.equal(Number(app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n), 0);
    ({ client, csrf } = await login(app)); // for the following tests
  });

  test('duplicate submit with the same idempotency_key creates exactly one game', async () => {
    const before = countGames(app);
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      upload(app, client, csrf, { title: 'Doble envío', key }),
      upload(app, client, csrf, { title: 'Doble envío', key }),
    ]);
    const c = await upload(app, client, csrf, { title: 'Doble envío', key });
    for (const r of [a, b, c]) assert.equal(r.status, 303);
    assert.equal(countGames(app), before + 1);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM games WHERE title = 'Doble envío'").get().n, 1);
    assert.match(c.headers.get('location'), new RegExp(`${app.adminPath}/juegos/[0-9a-f]+/editar`));
    app.db.prepare("DELETE FROM games WHERE title = 'Doble envío'").run();
    app.db.prepare('DELETE FROM upload_requests').run();
  });

  test('pagination with 30 games: 24 per page, page 2 has the rest, bad pages handled', async () => {
    const existing = Number(app.db.prepare("SELECT COUNT(*) AS n FROM games WHERE status = 'published'").get().n);
    for (let i = 0; i < 30 - existing; i++) {
      const r = await upload(app, client, csrf, { title: `Juego ${String(i).padStart(2, '0')}` });
      assert.equal(r.status, 303);
    }
    const p1 = await timed('/juegos p1', `${app.site}/juegos`);
    const p2 = await timed('/juegos p2', `${app.site}/juegos?pagina=2`);
    const carts = (b) => b.match(/<li class="cart-slot">/g)?.length ?? 0;
    assert.equal(p1.status, 200);
    assert.equal(carts(p1.body), 24);
    assert.match(p1.body, /Página 1 de 2/);
    assert.match(p1.body, /href="\/juegos\?pagina=2" rel="next"/);
    assert.equal(p2.status, 200);
    assert.equal(carts(p2.body), 6);
    assert.match(p2.body, /Página 2 de 2/);
    assert.match(p2.body, /href="\/juegos" rel="prev"/);
    assert.match(p2.body, /<title>Juegos, página 2 · parologames<\/title>/);
    const slugs = (b) => [...b.matchAll(/<a class="cart" href="\/juegos\/([^"]+)"/g)].map((m) => m[1]);
    const all = [...slugs(p1.body), ...slugs(p2.body)];
    assert.equal(new Set(all).size, 30, 'no game repeated or missing across pages');
    for (const q of ['999', 'abc', '0', '-1', '1.5', '2abc', '']) {
      const r = await fetch(`${app.site}/juegos?pagina=${q}`);
      const b = await r.text();
      assert.equal(r.status, 404, `?pagina=${q}`);
      assert.match(b, /Este cartucho no existe/);
      assert.doesNotMatch(b, /at .*\.js:\d+|Error:/);
    }
    const arr = await fetch(`${app.site}/juegos?pagina=1&pagina=2`);
    assert.equal(arr.status, 404, 'repeated param is not a 500');
  });

  test('HTML smoke check on every page type', async () => {
    const row = app.db.prepare("SELECT * FROM games WHERE status = 'published' LIMIT 1").get();
    const pub = [`/`, `/juegos`, `/juegos?pagina=2`, `/juegos/${row.slug}`, `/no-existe`];
    const priv = [app.adminPath, `${app.adminPath}/nuevo`, `${app.adminPath}/juegos/${row.id}/editar`];
    const report = {};
    for (const p of pub) {
      const r = await timed(p, app.site + p);
      report[p] = htmlProblems(r.body);
    }
    for (const p of priv) {
      const t0 = performance.now();
      const r = await client.get(p);
      const body = await r.text();
      timings.push({ label: p, ms: performance.now() - t0, status: r.status });
      assert.equal(r.status, 200, p);
      report[p] = htmlProblems(body);
    }
    const anon = new Client(app.site, app.siteOrigin);
    const t0 = performance.now();
    const lr = await anon.get(`${app.adminPath}/entrar`);
    report.login = htmlProblems(await lr.text());
    timings.push({ label: 'login', ms: performance.now() - t0, status: lr.status });
    const bad = Object.entries(report).filter(([, v]) => v.length);
    assert.deepEqual(bad, [], JSON.stringify(Object.fromEntries(bad), null, 1));
  });

  test(`every page responds in under ${BUDGET_MS} ms locally (warm)`, async () => {
    const row = app.db.prepare("SELECT * FROM games WHERE status = 'published' LIMIT 1").get();
    const paths = ['/', '/juegos', '/juegos?pagina=2', `/juegos/${row.slug}`, '/healthz', '/readyz', '/robots.txt'];
    for (const p of paths) await fetch(app.site + p).then((r) => r.arrayBuffer()); // warm-up
    const slow = [];
    for (const p of paths) {
      for (let i = 0; i < 5; i++) {
        const r = await timed(p, app.site + p);
        if (r.ms >= BUDGET_MS) slow.push(`${p} ${r.ms.toFixed(1)}ms`);
      }
    }
    const play = await timed('play', `${app.games}/play/${row.id}/`);
    if (play.ms >= BUDGET_MS) slow.push(`play ${play.ms.toFixed(1)}ms`);
    const all = timings.filter((t) => t.status < 400).map((t) => t.ms).sort((a, b) => a - b);
    const pct = (q) => all[Math.min(all.length - 1, Math.floor(q * all.length))].toFixed(1);
    process.stdout.write(`# qa-e2e latency over ${all.length} page requests: p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${all.at(-1).toFixed(1)}ms\n`);
    assert.deepEqual(slow, []);
  });
});
