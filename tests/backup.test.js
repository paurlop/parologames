// tests/backup.test.js — copias de seguridad y restauración de extremo a extremo.
// Ejecuta los scripts reales como procesos hijo (igual que cron o un operador).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BACKUP = path.join(ROOT, 'scripts', 'backup.js');
const RESTORE = path.join(ROOT, 'scripts', 'restore.js');
const PASS = 'prueba-frase-larga-123!';
const HAS_TAR = (() => {
  const r = spawnSync('tar', ['--version'], { stdio: 'ignore' });
  return !r.error && r.status === 0;
})();

let tmp;
let dataDir;
let freePort;
const files = {
  'games/g1/index.html': Buffer.from('<!doctype html><title>g1</title>'),
  'games/g1/sub/app.js': Buffer.from('console.log("hola")'),
  'covers/c1.png': randomBytes(4096),
  'downloads/d1.zip': randomBytes(100 * 1024),
};

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function baseEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['DATA_DIR', 'BACKUP_DIR', 'BACKUP_KEEP', 'BACKUP_PASSPHRASE', 'BACKUP_FORMAT', 'PORT']) delete env[k];
  return { ...env, PORT: String(freePort), ...extra };
}

function run(script, args, env) {
  return spawnSync(process.execPath, [script, ...args], { env: baseEnv(env), encoding: 'utf8' });
}

function backup(backupDir, env = {}, args = []) {
  const r = run(BACKUP, args, { DATA_DIR: dataDir, BACKUP_DIR: backupDir, ...env });
  assert.equal(r.status, 0, `backup falló:\n${r.stdout}\n${r.stderr}`);
  return r;
}

function onlyEntry(dir) {
  const list = fs.readdirSync(dir).filter((n) => !n.startsWith('.'));
  assert.equal(list.length, 1, `se esperaba una copia en ${dir}: ${list}`);
  return path.join(dir, list[0]);
}

function readRows(dbFile) {
  const db = new DatabaseSync(dbFile);
  try { return db.prepare('SELECT id, title FROM games ORDER BY id').all().map((r) => ({ ...r })); } finally { db.close(); }
}

function assertRestored(target) {
  assert.deepEqual(readRows(path.join(target, 'parolo.db')).map((r) => r.title), ['Uno', 'Dos', 'Tres', 'Cuatro (WAL)']);
  for (const [rel, buf] of Object.entries(files)) {
    assert.equal(sha(fs.readFileSync(path.join(target, rel))), sha(buf), rel);
  }
  assert.ok(fs.statSync(path.join(target, 'tmp')).isDirectory(), 'tmp/ debe existir');
  assert.ok(!fs.existsSync(path.join(target, 'manifest.json')), 'el manifiesto no se deja en DATA_DIR');
}

function makeLiveDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'MARCA-ANTIGUA.txt'), 'datos previos');
}

function flipByte(file, offset) {
  const buf = fs.readFileSync(file);
  const at = offset ?? Math.floor(buf.length / 2);
  buf[at] ^= 0xff;
  fs.writeFileSync(file, buf);
}

function noStagingLeft(parent) {
  return fs.readdirSync(parent).filter((n) => n.includes('.restore-'));
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parolo-backup-test-'));
  dataDir = path.join(tmp, 'data');
  freePort = await new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  for (const [rel, buf] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, rel), buf);
  }
  fs.mkdirSync(path.join(dataDir, 'tmp'));
  const db = new DatabaseSync(path.join(dataDir, 'parolo.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE games (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO games (title) VALUES (?)');
  for (const t of ['Uno', 'Dos', 'Tres']) ins.run(t);
  db.close();
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('copia en formato directorio con la app "en marcha" (conexión WAL abierta)', () => {
  // Una conexión abierta con escrituras sin checkpoint simula la app viva.
  const live = new DatabaseSync(path.join(dataDir, 'parolo.db'));
  live.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0');
  live.prepare('INSERT INTO games (title) VALUES (?)').run('Cuatro (WAL)');
  try {
    backup(path.join(tmp, 'b-dir'), {}, ['--format=dir']);
  } finally {
    live.close();
  }
  const dir = onlyEntry(path.join(tmp, 'b-dir'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.files.map((f) => f.path).sort(), ['parolo.db', ...Object.keys(files)].sort());
  for (const f of manifest.files) {
    assert.equal(f.sha256, sha(fs.readFileSync(path.join(dir, f.path))), f.path);
  }
  assert.equal(readRows(path.join(dir, 'parolo.db')).length, 4, 'la instantánea incluye lo que estaba en el WAL');
});

test('restore se niega sin --yes y no toca nada', () => {
  const dir = onlyEntry(path.join(tmp, 'b-dir'));
  const target = path.join(tmp, 'live-noyes');
  makeLiveDir(target);
  const r = run(RESTORE, [dir], { DATA_DIR: target });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--yes/);
  assert.deepEqual(fs.readdirSync(target), ['MARCA-ANTIGUA.txt']);
});

test('restore rechaza una copia con un byte alterado y deja intactos los datos vivos', () => {
  const good = onlyEntry(path.join(tmp, 'b-dir'));
  for (const rel of ['covers/c1.png', 'parolo.db']) {
    const bad = path.join(tmp, `corrupta-${rel.replace(/\W/g, '_')}`);
    fs.cpSync(good, bad, { recursive: true });
    flipByte(path.join(bad, rel), rel === 'parolo.db' ? 200 : undefined);
    const target = path.join(tmp, 'live-corrupt');
    makeLiveDir(target);
    const r = run(RESTORE, [bad, '--yes'], { DATA_DIR: target });
    assert.equal(r.status, 1, `${rel}: debía fallar\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /SHA-256 no coincide/);
    assert.deepEqual(fs.readdirSync(target), ['MARCA-ANTIGUA.txt']);
    assert.deepEqual(noStagingLeft(tmp), []);
  }
  // Un archivo de más que no figura en el manifiesto también se rechaza.
  const extra = path.join(tmp, 'corrupta-extra');
  fs.cpSync(good, extra, { recursive: true });
  fs.writeFileSync(path.join(extra, 'games', 'intruso.js'), 'x');
  const r = run(RESTORE, [extra, '--verify-only'], { DATA_DIR: path.join(tmp, 'nada') });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no listados/);
});

test('restore de una copia en directorio buena a un DATA_DIR nuevo', () => {
  const good = onlyEntry(path.join(tmp, 'b-dir'));
  const target = path.join(tmp, 'fresh', 'data');
  const v = run(RESTORE, [good, '--verify-only'], { DATA_DIR: target });
  assert.equal(v.status, 0, v.stderr);
  assert.ok(!fs.existsSync(target), '--verify-only no crea nada');
  const r = run(RESTORE, [good, '--yes'], { DATA_DIR: target });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assertRestored(target);
});

test('copia cifrada (AES-256-GCM): sin fugas de contraseña, rechaza manipulación y restaura', { skip: !HAS_TAR && 'tar no disponible' }, () => {
  const bdir = path.join(tmp, 'b-enc');
  const r = backup(bdir, { BACKUP_PASSPHRASE: PASS });
  assert.ok(!(r.stdout + r.stderr).includes(PASS), 'la contraseña no debe aparecer en la salida');
  const enc = onlyEntry(bdir);
  assert.match(path.basename(enc), /^parolo-.+\.tar\.gz\.enc$/);
  const head = fs.readFileSync(enc).subarray(0, 8).toString('ascii');
  assert.equal(head, 'PAROLOB1');

  const target = path.join(tmp, 'live-enc');
  makeLiveDir(target);

  // Sin contraseña / contraseña incorrecta / byte alterado → rechazo sin tocar nada.
  const bad = path.join(tmp, 'alterada.tar.gz.enc');
  fs.copyFileSync(enc, bad);
  flipByte(bad);
  for (const [src, env, why] of [
    [enc, {}, /BACKUP_PASSPHRASE/],
    [enc, { BACKUP_PASSPHRASE: 'otra-frase-distinta-456' }, /descifrar/],
    [bad, { BACKUP_PASSPHRASE: PASS }, /descifrar/],
  ]) {
    const x = run(RESTORE, [src, '--yes'], { DATA_DIR: target, ...env });
    assert.equal(x.status, 1, `${x.stdout}\n${x.stderr}`);
    assert.match(x.stderr, why);
    assert.deepEqual(fs.readdirSync(target), ['MARCA-ANTIGUA.txt']);
  }
  assert.deepEqual(noStagingLeft(tmp), []);

  const ok = run(RESTORE, [enc, '--yes'], { DATA_DIR: target, BACKUP_PASSPHRASE: PASS });
  assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
  assert.ok(!(ok.stdout + ok.stderr).includes(PASS));
  assertRestored(target);
  const previous = fs.readdirSync(tmp).filter((n) => n.startsWith('live-enc.before-restore-'));
  assert.equal(previous.length, 1, 'los datos anteriores se apartan, no se borran');
  assert.ok(fs.existsSync(path.join(tmp, previous[0], 'MARCA-ANTIGUA.txt')));
});

test('copia .tar.gz sin cifrar se restaura', { skip: !HAS_TAR && 'tar no disponible' }, () => {
  const bdir = path.join(tmp, 'b-tgz');
  backup(bdir);
  const tgz = onlyEntry(bdir);
  assert.match(path.basename(tgz), /^parolo-.+\.tar\.gz$/);
  const target = path.join(tmp, 'live-tgz');
  const r = run(RESTORE, [tgz, '--yes'], { DATA_DIR: target });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assertRestored(target);
});

test('restore se niega si la BD viva está bloqueada (app en marcha)', () => {
  const good = onlyEntry(path.join(tmp, 'b-dir'));
  const target = path.join(tmp, 'live-locked');
  fs.mkdirSync(target);
  const db = new DatabaseSync(path.join(target, 'parolo.db'));
  db.exec('CREATE TABLE t (x); BEGIN EXCLUSIVE; INSERT INTO t VALUES (1);');
  try {
    const r = run(RESTORE, [good, '--yes'], { DATA_DIR: target });
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /bloqueada/);
  } finally {
    db.exec('ROLLBACK');
    db.close();
  }
  assert.ok(fs.existsSync(path.join(target, 'parolo.db')));
  assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.startsWith('live-locked.before')), []);
});

test('rotación: conserva las BACKUP_KEEP más recientes y no toca archivos ajenos', () => {
  const bdir = path.join(tmp, 'b-rot');
  fs.mkdirSync(bdir);
  fs.writeFileSync(path.join(bdir, 'notas.txt'), 'no borrar');
  fs.mkdirSync(path.join(bdir, '2000-01-01T00-00-00-000Z')); // incompleta (sin manifiesto)
  for (let i = 0; i < 3; i++) backup(bdir, { BACKUP_KEEP: '2' }, ['--format=dir']);
  const left = fs.readdirSync(bdir).sort();
  assert.equal(left.length, 3, String(left));
  assert.ok(left.includes('notas.txt'));
  assert.ok(!left.includes('2000-01-01T00-00-00-000Z'));
});

test('backup falla con código ≠ 0 ante errores', () => {
  const noDb = run(BACKUP, [], { DATA_DIR: path.join(tmp, 'no-existe'), BACKUP_DIR: path.join(tmp, 'b-err') });
  assert.equal(noDb.status, 1);
  assert.match(noDb.stderr, /no existe la base de datos/);
  const shortPass = run(BACKUP, [], { DATA_DIR: dataDir, BACKUP_DIR: path.join(tmp, 'b-err'), BACKUP_PASSPHRASE: 'corta' });
  assert.equal(shortPass.status, 1);
  assert.ok(!shortPass.stderr.includes('corta'));
  const badKeep = run(BACKUP, [], { DATA_DIR: dataDir, BACKUP_DIR: path.join(tmp, 'b-err'), BACKUP_KEEP: 'muchas' });
  assert.equal(badKeep.status, 1);
});
