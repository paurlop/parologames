import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';
import { html, raw, attr, escapeHtml } from '../src/html.js';
import { hashPassword, verifyPassword } from '../src/security/passwords.js';
import { hotp, totp, verifyTotp, base32Encode, base32Decode, currentStep, otpauthUri } from '../src/security/totp.js';
import { parseCookies, serializeCookie } from '../src/security/cookies.js';
import { safeEqual } from '../src/security/csrf.js';
import { loadConfig, ConfigError } from '../src/config.js';
import { slugify, toView } from '../src/services/games.js';
import { extractBuild, detectImageType, validateCover, validateZipMagic, UploadError, checkEntryName } from '../src/services/uploads.js';
import { writeZipFromDir } from '../src/services/zip-writer.js';
import { contentTypeFor } from '../src/services/mime.js';
import { redact } from '../src/log.js';
import { validateGameFields } from '../src/routes/admin.js';
import { buildZip, tempDir, validGameZip, TINY_PNG, TINY_JPEG } from './helpers.js';

describe('html escaping', () => {
  test('escapes interpolations by default', () => {
    const evil = `<script>alert("x")</script>&'\``;
    assert.equal(String(html`<p>${evil}</p>`), '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;&#96;</p>');
  });
  test('nested templates and raw are not double-escaped; arrays join', () => {
    const items = ['<a>', 'b'].map((x) => html`<li>${x}</li>`);
    assert.equal(String(html`<ul>${items}</ul>${raw('<hr>')}`), '<ul><li>&lt;a&gt;</li><li>b</li></ul><hr>');
  });
  test('null/undefined/booleans render empty; attr strips control chars', () => {
    assert.equal(String(html`${null}${undefined}${false}${true}`), '');
    assert.equal(String(html`<a title="${attr('a"b\u0000c')}">`), '<a title="a&quot;bc">');
    assert.equal(escapeHtml(0), '0');
  });
});

describe('scrypt passwords', () => {
  test('hash format and verify', async () => {
    const h = await hashPassword('una contraseña larga');
    assert.match(h, /^scrypt\$131072\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.equal(await verifyPassword('una contraseña larga', h), true);
    assert.equal(await verifyPassword('una contraseña larg', h), false);
    assert.equal(await verifyPassword('', h), false);
  });
  test('rejects malformed or abusive stored hashes without throwing', async () => {
    assert.equal(await verifyPassword('x', 'nope'), false);
    assert.equal(await verifyPassword('x', 'scrypt$1073741824$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'), false);
    assert.equal(await verifyPassword('x', 'bcrypt$1$2$3$4$5'), false);
    assert.equal(await verifyPassword('x'.repeat(5000), 'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(88)), false);
  });
});

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  const sha1Key = Buffer.from('12345678901234567890');
  const sha256Key = Buffer.from('12345678901234567890123456789012');
  const sha512Key = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234');
  const vectors = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  for (const [t, s1, s256, s512] of vectors) {
    test(`T=${t}`, () => {
      const now = t * 1000;
      assert.equal(totp(sha1Key, { now, digits: 8 }), s1);
      assert.equal(totp(sha256Key, { now, digits: 8, algorithm: 'sha256' }), s256);
      assert.equal(totp(sha512Key, { now, digits: 8, algorithm: 'sha512' }), s512);
    });
  }
  test('RFC 4226 HOTP vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, i) => assert.equal(hotp(sha1Key, i), code));
  });
  test('base32 round trip', () => {
    assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
    assert.deepEqual(base32Decode('MZXW6YTBOI'), Buffer.from('foobar'));
    assert.deepEqual(base32Decode(base32Encode(sha1Key)), sha1Key);
  });
  test('verify window ±1 and replay protection', () => {
    const secret = base32Encode(sha1Key);
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    assert.equal(verifyTotp(secret, totp(secret, { now }), { now }), step);
    assert.equal(verifyTotp(secret, totp(secret, { step: step - 1 }), { now }), step - 1);
    assert.equal(verifyTotp(secret, totp(secret, { step: step + 1 }), { now }), step + 1);
    assert.equal(verifyTotp(secret, totp(secret, { step: step + 2 }), { now }), null);
    assert.equal(verifyTotp(secret, totp(secret, { now }), { now, lastStep: step }), null, 'same step cannot be reused');
    assert.equal(verifyTotp(secret, '12345', { now }), null);
    assert.equal(verifyTotp(secret, 'abcdef', { now }), null);
  });
  test('otpauth uri', () => {
    assert.match(otpauthUri({ secret: 'ABC' }), /^otpauth:\/\/totp\/parologames%3Aowner\?secret=ABC&issuer=parologames/);
  });
});

describe('cookies, csrf compare, log redaction', () => {
  test('parse/serialize', () => {
    assert.deepEqual({ ...parseCookies('a=1; b=2; a=3') }, { a: '1', b: '2' });
    assert.equal(serializeCookie('s', 'abc', { maxAge: 10, secure: true }), 's=abc; Path=/; SameSite=Strict; Max-Age=10; HttpOnly; Secure');
    assert.throws(() => serializeCookie('s', 'a;b'));
  });
  test('safeEqual', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual(undefined, 'a'), false);
  });
  test('redact', () => {
    assert.deepEqual(redact({ password: 'x', nested: { totp: '1', Cookie: 'c', ok: 1 } }), { password: '[redacted]', nested: { totp: '[redacted]', Cookie: '[redacted]', ok: 1 } });
  });
});

describe('config', () => {
  test('dev defaults: different origins', () => {
    const c = loadConfig({ NODE_ENV: 'development', DATA_DIR: tempDir() });
    assert.equal(c.siteOrigin, 'http://localhost:3000');
    assert.equal(c.gamesOrigin, 'http://127.0.0.1:3001');
    assert.equal(c.warnings.length, 1);
  });
  test('production fails fast without IP_HASH_SALT and never echoes secrets', () => {
    const secret = 'short-secret-value';
    assert.throws(() => loadConfig({ NODE_ENV: 'production', SITE_ORIGIN: 'https://a.example', GAMES_ORIGIN: 'https://play.b.example' }), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.match(err.message, /IP_HASH_SALT/);
      return true;
    });
    assert.throws(() => loadConfig({ NODE_ENV: 'production', SITE_ORIGIN: 'https://a.example', GAMES_ORIGIN: 'https://play.b.example', IP_HASH_SALT: secret }), (err) => {
      assert.ok(!err.message.includes(secret));
      return true;
    });
  });
  test('rejects same origins and bad admin path', () => {
    assert.throws(() => loadConfig({ SITE_ORIGIN: 'http://x:1', GAMES_ORIGIN: 'http://x:1' }), /distintos/);
    assert.throws(() => loadConfig({ ADMIN_PATH: '/juegos' }), /ADMIN_PATH/);
    assert.throws(() => loadConfig({ ADMIN_PATH: 'panel' }), /ADMIN_PATH/);
  });
});

describe('form validation and slugs', () => {
  test('slugify', () => {
    assert.equal(slugify('¡Él Ñandú Veloz!  2'), 'el-nandu-veloz-2');
    assert.equal(slugify('???'), 'juego');
    assert.ok(slugify('a'.repeat(200)).length <= 60);
  });
  test('field limits', () => {
    assert.deepEqual(Object.keys(validateGameFields({ title: '', status: 'x' }).errors).sort(), ['status', 'title']);
    assert.ok(validateGameFields({ title: 'a'.repeat(81), status: 'hidden' }).errors.title);
    assert.ok(validateGameFields({ title: 'ok', tagline: 'a'.repeat(141), status: 'hidden' }).errors.tagline);
    assert.ok(validateGameFields({ title: 'ok', description: 'a'.repeat(4001), status: 'hidden' }).errors.description);
    assert.ok(validateGameFields({ title: ['a', 'b'], status: 'hidden' }).errors.title);
    const ok = validateGameFields({ title: '  Hola\u0000  mundo ', status: 'published', featured: '1' });
    assert.deepEqual(ok.errors, {});
    assert.equal(ok.fields.title, 'Hola mundo');
    assert.equal(ok.fields.featured, true);
  });
  test('view game object never exposes disk paths', () => {
    const v = toView({ id: 'a', slug: 's', title: 't', tagline: '', description: '', cover_file: 'c.png', build_dir: 'x/y', download_file: null, download_size: null, web_zip_file: 'z.zip', web_zip_size: 5, web_size: 9, status: 'published', featured: 1, created_at: 0, updated_at: 0 });
    assert.equal(JSON.stringify(v).includes('x/y'), false);
    assert.equal(JSON.stringify(v).includes('z.zip'), false);
    assert.equal(v.hasDownload, true);
    assert.equal(v.downloadSize, 5);
  });
});

describe('mime', () => {
  test('pre-compressed and wasm types', () => {
    assert.deepEqual(contentTypeFor('a.wasm'), { type: 'application/wasm' });
    assert.deepEqual(contentTypeFor('Build/x.wasm.br'), { type: 'application/wasm', encoding: 'br' });
    assert.deepEqual(contentTypeFor('x.js.gz'), { type: 'text/javascript; charset=utf-8', encoding: 'gzip' });
    assert.deepEqual(contentTypeFor('x.data.gz'), { type: 'application/octet-stream', encoding: 'gzip' });
    assert.equal(contentTypeFor('x.pck').type, 'application/octet-stream');
    assert.equal(contentTypeFor('weird.exe').type, 'application/octet-stream');
  });
});

describe('uploads: magic bytes', () => {
  test('image detection', async () => {
    assert.equal(detectImageType(TINY_PNG), 'png');
    assert.equal(detectImageType(TINY_JPEG), 'jpg');
    assert.equal(detectImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
    assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')), null);
    const dir = tempDir();
    const f = path.join(dir, 'fake.png');
    fs.writeFileSync(f, 'GIF89a not allowed');
    await assert.rejects(validateCover(f), (e) => e instanceof UploadError && e.field === 'cover');
    fs.writeFileSync(f, 'not a zip');
    await assert.rejects(validateZipMagic(f), UploadError);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('uploads: safe ZIP extraction', () => {
  const run = async (zipBuf, opts = {}) => {
    const dir = tempDir();
    const zipPath = path.join(dir, 'in.zip');
    fs.writeFileSync(zipPath, zipBuf);
    const dest = path.join(dir, 'out');
    try {
      const r = await extractBuild(zipPath, dest, { maxTotalBytes: 50 * 1024 * 1024, ...opts });
      return { r, dest, dir };
    } catch (err) {
      assert.equal(fs.existsSync(path.join(dir, 'escaped.txt')), false);
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
  };
  const rejectsWith = (p, re) => assert.rejects(p, (e) => { assert.ok(e instanceof UploadError, `expected UploadError, got ${e}`); assert.match(e.message, re); return true; });

  test('valid zip extracts', async () => {
    const { r, dest, dir } = await run(validGameZip());
    assert.equal(r.files, 3);
    assert.ok(fs.existsSync(path.join(dest, 'index.html')));
    assert.ok(fs.existsSync(path.join(dest, 'assets', 'sprite.png')));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test('single top-level folder is flattened; macOS junk skipped', async () => {
    const { dest, dir } = await run(buildZip([
      { name: 'MyGame/', dir: true }, { name: 'MyGame/index.html', data: '<p>x' }, { name: 'MyGame/a.js', data: '1' },
      { name: '__MACOSX/MyGame/._index.html', data: 'junk' }, { name: 'MyGame/.DS_Store', data: 'junk' },
    ]));
    assert.ok(fs.existsSync(path.join(dest, 'index.html')));
    assert.equal(fs.existsSync(path.join(dest, 'MyGame')), false);
    assert.equal(fs.existsSync(path.join(dest, '.DS_Store')), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test('zip-slip ../ rejected', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: '../escaped.txt', data: 'x' }])), /ruta|Ruta/));
  test('absolute path rejected', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: '/etc/x.txt', data: 'x' }])), /ruta|Ruta/i));
  test('backslash rejected', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: '..\\escaped.txt', data: 'x' }])), /ruta|Ruta/i));
  test('drive letter rejected', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: 'C:/x.txt', data: 'x' }])), /ruta|Ruta/i));
  test('checkEntryName', () => {
    assert.throws(() => checkEntryName('a//b.js'), UploadError);
    assert.throws(() => checkEntryName('a/./b.js'), UploadError);
    assert.throws(() => checkEntryName('a/b\u0001.js'), UploadError);
    assert.deepEqual(checkEntryName('a/b.js'), ['a', 'b.js']);
  });
  test('symlink rejected', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: 'link.js', data: '/etc/passwd', method: 0, externalAttr: (0o120777 << 16) >>> 0 }])), /simb/));
  test('duplicate path (case-insensitive) rejected', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: 'a.js', data: '1' }, { name: 'A.js', data: '2' }])), /duplicada/));
  test('disallowed extension rejected', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: 'virus.exe', data: 'MZ' }])), /no permitido/));
  test('double extension .exe.gz rejected', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: 'a.exe.gz', data: 'x' }])), /no permitido/));
  test('no index.html rejected', () => rejectsWith(run(buildZip([{ name: 'a/index.html', data: 'x' }, { name: 'b/x.js', data: 'x' }])), /index\.html/));
  test('zip bomb (ratio) rejected', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: 'big.data', data: Buffer.alloc(20 * 1024 * 1024) }])), /bomba/));
  test('total uncompressed limit enforced', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: 'a.bin', data: Buffer.alloc(3000, 1), method: 0 }]), { maxTotalBytes: 2000 }), /supera/));
  test('per-file limit enforced', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: 'a.bin', data: Buffer.alloc(3000, 1), method: 0 }]), { maxFileBytes: 1000 }), /supera/));
  test('too many entries rejected', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, ...Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.txt`, data: 'x' }))]), { maxEntries: 10 }), /demasiados/));
  test('lying uncompressed size rejected', () => rejectsWith(run(buildZip([{ name: 'index.html', data: 'x' }, { name: 'a.js', data: Buffer.alloc(5000, 97), fakeUncompressedSize: 10 }])), /tamaños|dañado|ZIP/));
  test('not a zip rejected', () => rejectsWith(run(Buffer.from('hello world')), /ZIP/));
});

describe('zip writer', () => {
  test('round trip readable by yauzl with correct contents', async () => {
    const dir = tempDir();
    const src = path.join(dir, 'src');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(src, 'index.html'), '<h1>hola ñ</h1>');
    fs.writeFileSync(path.join(src, 'sub', 'img.png'), TINY_PNG);
    fs.writeFileSync(path.join(src, 'sub', 'big.js'), 'x'.repeat(100000));
    const out = path.join(dir, 'out.zip');
    const { files } = await writeZipFromDir(src, out);
    assert.equal(files, 3);
    const contents = await new Promise((resolve, reject) => {
      yauzl.open(out, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
        if (err) return reject(err);
        const got = {};
        zip.on('entry', (e) => zip.openReadStream(e, (err2, s) => {
          if (err2) return reject(err2);
          const chunks = []; s.on('data', (c) => chunks.push(c)); s.on('end', () => { got[e.fileName] = Buffer.concat(chunks); zip.readEntry(); });
        }));
        zip.on('end', () => resolve(got));
        zip.on('error', reject);
        zip.readEntry();
      });
    });
    assert.equal(contents['index.html'].toString(), '<h1>hola ñ</h1>');
    assert.deepEqual(contents['sub/img.png'], TINY_PNG);
    assert.equal(contents['sub/big.js'].length, 100000);
    // y también pasa nuestra propia validación de extracción
    const dest = path.join(dir, 'again');
    await extractBuild(out, dest, { maxTotalBytes: 1e7 });
    assert.ok(fs.existsSync(path.join(dest, 'sub', 'big.js')));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
