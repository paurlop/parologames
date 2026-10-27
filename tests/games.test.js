import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { startTestApp, createOwner, login, gameForm, validGameZip, buildZip, uploadGame, TINY_PNG, TINY_JPEG, GAME_HTML } from './helpers.js';

describe('games: upload, play, download, admin', () => {
  let app; let client; let csrf;
  before(async () => {
    app = await startTestApp({ MAX_BUILD_MB: '2', MAX_COVER_MB: '1', MAX_DOWNLOAD_MB: '1' });
    await createOwner(app);
    ({ client, csrf } = await login(app));
  });
  after(() => app.close());

  const count = () => app.db.prepare('SELECT COUNT(*) AS n FROM games').get().n;
  const tmpFiles = () => fs.readdirSync(path.join(app.dataDir, 'tmp'));
  const post = (form, p = `${app.adminPath}/juegos`) => client.postMultipart(p, form);

  test('valid ZIP builds a playable game on the games origin', async () => {
    const extra = [
      { name: 'Build/game.wasm', data: Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]) },
      { name: 'Build/game.js.gz', data: zlib.gzipSync('console.log(1)'), method: 0 },
      { name: 'Build/game.data.br', data: zlib.brotliCompressSync(Buffer.alloc(100, 7)), method: 0 },
      { name: 'Build/game.pck', data: Buffer.alloc(10) },
    ];
    const res = await post(gameForm({ csrf, title: 'Pong <b>Deluxe</b>', build: validGameZip(extra), cover: TINY_PNG, featured: true }));
    assert.equal(res.status, 303, await res.text());
    assert.equal(res.headers.get('location'), `${app.adminPath}?aviso=creado`);
    const row = app.db.prepare('SELECT * FROM games').get();
    assert.equal(row.slug, 'pong-b-deluxe-b');
    assert.equal(row.status, 'published');
    assert.match(row.cover_file, /^[a-f0-9]{32}\.png$/);
    assert.ok(row.web_zip_file);

    const page = await fetch(`${app.site}/juegos/${row.slug}`);
    assert.equal(page.status, 200);
    const body = await page.text();
    assert.ok(body.includes(`${app.gamesOrigin}/play/${row.id}/`), 'play url in game page');
    assert.ok(!body.includes('<b>Deluxe</b>'), 'title escaped');
    assert.ok(!body.includes(app.dataDir) && !body.includes(row.build_dir), 'no disk paths');

    const play = await fetch(`${app.games}/play/${row.id}/`);
    assert.equal(play.status, 200);
    assert.equal(play.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await play.text(), GAME_HTML);
    assert.equal(play.headers.get('set-cookie'), null);
    const js = await fetch(`${app.games}/play/${row.id}/game.js`);
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
    const wasm = await fetch(`${app.games}/play/${row.id}/Build/game.wasm`);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    const gz = await fetch(`${app.games}/play/${row.id}/Build/game.js.gz`);
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    assert.equal(gz.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(await gz.text(), 'console.log(1)'); // fetch descomprime
    const br = await fetch(`${app.games}/play/${row.id}/Build/game.data.br`, { method: 'HEAD' });
    assert.equal(br.headers.get('content-encoding'), 'br');
    assert.equal(br.headers.get('content-type'), 'application/octet-stream');
    const etag = js.headers.get('etag');
    assert.equal((await fetch(`${app.games}/play/${row.id}/game.js`, { headers: { 'if-none-match': etag } })).status, 304);

    for (const bad of ['/play/' + row.id + '/../../parolo.db', '/play/' + row.id + '/%2e%2e/%2e%2e/parolo.db', '/play/' + row.id + '/assets%2f..%2f..%2fx', '/play/' + row.id + '/nope.js', '/play/ffffffffffffffff/', '/play/../parolo.db', '/', '/juegos', '/media/portadas/x.png']) {
      const r = await fetch(app.games + bad);
      assert.equal(r.status, 404, bad);
    }
    // portada pública
    const cover = await fetch(`${app.site}/media/portadas/${row.cover_file}`);
    assert.equal(cover.status, 200);
    assert.equal(cover.headers.get('content-type'), 'image/png');
    assert.match(cover.headers.get('cache-control'), /immutable/);
    // portada y destacado en la portada/listado
    const splash = await (await fetch(app.site + '/')).text();
    assert.ok(splash.includes(row.slug));
    assert.equal(tmpFiles().length, 0, 'tmp cleaned');
  });

  test('download returns attachment (web build ZIP) with HEAD support', async () => {
    const row = app.db.prepare('SELECT * FROM games').get();
    const res = await fetch(`${app.site}/juegos/${row.slug}/descargar`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.match(res.headers.get('content-disposition'), new RegExp(`^attachment; filename="${row.slug}\\.zip"`));
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.readUInt32LE(0), 0x04034b50);
    assert.equal(Number(res.headers.get('content-length')), buf.length);
    const head = await fetch(`${app.site}/juegos/${row.slug}/descargar`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(buf.length));
  });

  test('separate download ZIP is served instead, and can be removed on edit', async () => {
    const row = app.db.prepare('SELECT * FROM games').get();
    const dl = buildZip([{ name: 'game.exe.txt', data: 'desktop build' }]);
    const edit = await post(gameForm({ csrf, title: row.title, status: 'published', download: dl }), `${app.adminPath}/juegos/${row.id}`);
    assert.equal(edit.status, 303, await edit.text());
    const res = await fetch(`${app.site}/juegos/${row.slug}/descargar`);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), dl);
    const rm = await post(gameForm({ csrf, title: row.title, status: 'published', extra: { remove_download: '1' } }), `${app.adminPath}/juegos/${row.id}`);
    assert.equal(rm.status, 303);
    const after2 = app.db.prepare('SELECT download_file FROM games WHERE id = ?').get(row.id);
    assert.equal(after2.download_file, null);
    assert.equal(fs.readdirSync(path.join(app.dataDir, 'downloads')).length, 1, 'old download file deleted');
  });

  test('edit with new build swaps version and deletes the old one', async () => {
    const row = app.db.prepare('SELECT * FROM games').get();
    const newHtml = '<!doctype html><title>v2</title><p>v2';
    const res = await post(gameForm({ csrf, title: 'Pong v2', status: 'published', build: buildZip([{ name: 'index.html', data: newHtml }]) }), `${app.adminPath}/juegos/${row.id}`);
    assert.equal(res.status, 303, await res.text());
    const updated = app.db.prepare('SELECT * FROM games WHERE id = ?').get(row.id);
    assert.notEqual(updated.build_dir, row.build_dir);
    assert.equal(updated.slug, row.slug, 'slug is stable across edits');
    assert.equal(updated.title, 'Pong v2');
    assert.equal(fs.existsSync(path.join(app.dataDir, 'games', ...row.build_dir.split('/'))), false);
    assert.equal(await (await fetch(`${app.games}/play/${row.id}/`)).text(), newHtml);
  });

  test('zip-slip entry rejected with Spanish form error, nothing created', async () => {
    const before = count();
    const res = await post(gameForm({ csrf, build: buildZip([{ name: 'index.html', data: 'x' }, { name: '../../evil.js', data: 'x' }]) }));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /Ruta|rutas/);
    assert.equal(count(), before);
    assert.equal(tmpFiles().length, 0);
    assert.deepEqual(fs.readdirSync(path.join(app.dataDir, 'games')).length, 1);
  });

  test('zip bomb rejected', async () => {
    const res = await post(gameForm({ csrf, build: buildZip([{ name: 'index.html', data: 'x' }, { name: 'a.data', data: Buffer.alloc(30 * 1024 * 1024) }]) }));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /bomba/);
  });

  test('oversize build rejected with 413', async () => {
    const big = buildZip([{ name: 'index.html', data: 'x' }, { name: 'a.bin', data: Buffer.alloc(2.5 * 1024 * 1024, 1), method: 0 }]);
    const res = await post(gameForm({ csrf, build: big }));
    assert.equal(res.status, 413);
    assert.match(await res.text(), /supera el máximo de 2 MB/);
    assert.equal(tmpFiles().length, 0);
  });

  test('disallowed extension rejected', async () => {
    const res = await post(gameForm({ csrf, build: validGameZip([{ name: 'setup.exe', data: 'MZ' }]) }));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /no permitido/);
  });

  test('cover magic-byte validation (and JPEG accepted)', async () => {
    const bad = await post(gameForm({ csrf, build: validGameZip(), cover: Buffer.from('<svg onload=alert(1)>') }));
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /PNG, JPEG o WebP/);
    const before = count();
    const ok = await post(gameForm({ csrf, title: 'Jpeg', build: validGameZip(), cover: TINY_JPEG, status: 'hidden' }));
    assert.equal(ok.status, 303);
    assert.equal(count(), before + 1);
    assert.match(app.db.prepare("SELECT cover_file FROM games WHERE title = 'Jpeg'").get().cover_file, /\.jpg$/);
  });

  test('download field must be a ZIP', async () => {
    const res = await post(gameForm({ csrf, build: validGameZip(), download: Buffer.from('MZ fake exe') }));
    assert.equal(res.status, 400);
  });

  test('validation errors re-render with values and keep the idempotency key', async () => {
    const key = crypto.randomUUID();
    const res = await post(gameForm({ csrf, title: '', key, build: validGameZip() }));
    assert.equal(res.status, 400);
    const body = await res.text();
    assert.ok(body.includes(key), 'idempotency key preserved');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM upload_requests WHERE idempotency_key = ?').get(key).n, 0);
    const missing = await post(gameForm({ csrf, title: 'Sin build' }));
    assert.equal(missing.status, 400);
  });

  test('duplicate submission with same idempotency key does not duplicate', async () => {
    const key = crypto.randomUUID();
    const before = count();
    const r1 = await post(gameForm({ csrf, title: 'Idem', key, build: validGameZip() }));
    assert.equal(r1.status, 303);
    const r2 = await post(gameForm({ csrf, title: 'Idem', key, build: validGameZip() }));
    assert.equal(r2.status, 303);
    const id = app.db.prepare("SELECT id FROM games WHERE title = 'Idem'").get().id;
    assert.equal(r2.headers.get('location'), `${app.adminPath}/juegos/${id}/editar`);
    assert.equal(count(), before + 1);
  });

  test('slug collision gets a suffix', async () => {
    await uploadGame(app, client, csrf, { title: 'Repetido' });
    const second = await uploadGame(app, client, csrf, { title: 'Repetido' });
    assert.equal(second.slug, 'repetido-2');
  });

  test('hidden games 404 publicly (page, download, games origin, cover) but admin sees them', async () => {
    const g = await uploadGame(app, client, csrf, { title: 'Oculto', status: 'hidden' });
    assert.equal((await fetch(`${app.site}/juegos/${g.slug}`)).status, 404);
    assert.equal((await fetch(`${app.site}/juegos/${g.slug}/descargar`)).status, 404);
    assert.equal((await fetch(`${app.games}/play/${g.id}/`)).status, 404);
    assert.equal((await fetch(`${app.site}/media/portadas/${g.cover_file}`)).status, 404);
    const adminCover = await client.get(`/media/portadas/${g.cover_file}`);
    assert.equal(adminCover.status, 200);
    assert.equal(adminCover.headers.get('cache-control'), 'private, no-store');
    const list = await (await fetch(`${app.site}/juegos`)).text();
    assert.ok(!list.includes(g.slug));
    // publicar mediante /estado
    const pub = await client.postForm(`${app.adminPath}/juegos/${g.id}/estado`, { _csrf: csrf, status: 'published' });
    assert.equal(pub.status, 303);
    assert.equal((await fetch(`${app.site}/juegos/${g.slug}`)).status, 200, 'cache invalidated on admin write');
    assert.equal((await fetch(`${app.games}/play/${g.id}/`)).status, 200);
    const bad = await client.postForm(`${app.adminPath}/juegos/${g.id}/estado`, { _csrf: csrf, status: 'deleted' });
    assert.equal(bad.status, 400);
  });

  test('edit form renders for existing game and 404 for unknown/malformed ids', async () => {
    const g = app.db.prepare('SELECT id FROM games LIMIT 1').get();
    assert.equal((await client.get(`${app.adminPath}/juegos/${g.id}/editar`)).status, 200);
    assert.equal((await client.get(`${app.adminPath}/juegos/ffffffffffffffff/editar`)).status, 404);
    assert.equal((await client.get(`${app.adminPath}/juegos/'%20OR%201=1/editar`)).status, 404);
    assert.equal((await client.get(`${app.adminPath}/nuevo`)).status, 200);
  });

  test('delete requires confirm=1 and removes files', async () => {
    const g = await uploadGame(app, client, csrf, { title: 'Borrar' });
    const no = await client.postForm(`${app.adminPath}/juegos/${g.id}/eliminar`, { _csrf: csrf });
    assert.equal(no.status, 400);
    assert.ok(app.db.prepare('SELECT 1 FROM games WHERE id = ?').get(g.id));
    const yes = await client.postForm(`${app.adminPath}/juegos/${g.id}/eliminar`, { _csrf: csrf, confirm: '1' });
    assert.equal(yes.status, 303);
    assert.equal(app.db.prepare('SELECT 1 FROM games WHERE id = ?').get(g.id), undefined);
    assert.equal(fs.existsSync(path.join(app.dataDir, 'games', g.id)), false);
    assert.equal(fs.existsSync(path.join(app.dataDir, 'covers', g.cover_file)), false);
    assert.equal(fs.existsSync(path.join(app.dataDir, 'downloads', g.web_zip_file)), false);
    assert.equal((await fetch(`${app.games}/play/${g.id}/`)).status, 404);
  });

  test('catalogue paginates 24 per page; bad page numbers 404', async () => {
    const now = Date.now();
    const ins = app.db.prepare("INSERT INTO games (id, slug, title, build_dir, web_size, status, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'published', ?, ?)");
    for (let i = 0; i < 30; i++) ins.run(`aaaaaaaaaaaa${String(i).padStart(4, '0')}`, `pag-${i}`, `Pag ${i}`, `aaaaaaaaaaaa${String(i).padStart(4, '0')}/vtest000`, now + i, now + i);
    app.ctx.games.invalidate();
    const total = app.db.prepare("SELECT COUNT(*) AS n FROM games WHERE status = 'published'").get().n;
    const pages = Math.ceil(total / 24);
    const p1 = await (await fetch(`${app.site}/juegos`)).text();
    assert.ok(p1.includes('pag-29'));
    assert.ok(!p1.includes('pag-0"'));
    assert.equal((await fetch(`${app.site}/juegos?pagina=${pages}`)).status, 200);
    for (const bad of [String(pages + 1), '0', 'abc', '-1', '1e3']) {
      assert.equal((await fetch(`${app.site}/juegos?pagina=${bad}`)).status, 404, bad);
    }
    assert.equal((await fetch(`${app.site}/juegos?pagina=1&pagina=2`)).status, 404);
  });
});
