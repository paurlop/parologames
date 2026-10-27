#!/usr/bin/env node
// scripts/backup.js — copia de seguridad consistente de parologames.
//
// Qué hace:
//   1. Instantánea consistente de la BD con `VACUUM INTO` (segura con la app en marcha, modo WAL).
//   2. Comprueba la instantánea con `PRAGMA integrity_check`.
//   3. Copia games/, covers/ y downloads/ (los enlaces simbólicos se ignoran).
//   4. Escribe manifest.json con tamaño y SHA-256 de cada archivo.
//   5. Empaqueta en parolo-<fecha>.tar.gz si hay `tar` (si no, deja el directorio).
//   6. Si BACKUP_PASSPHRASE está definida, cifra con AES-256-GCM → parolo-<fecha>.tar.gz.enc.
//   7. Conserva las últimas BACKUP_KEEP copias (14 por defecto) y borra las anteriores.
//
// Variables: DATA_DIR (./data), BACKUP_DIR (./backups), BACKUP_KEEP (14),
//            BACKUP_PASSPHRASE (opcional, mínimo 12 caracteres), BACKUP_FORMAT (auto|tar|dir).
// Opciones:  --format=auto|tar|dir
// Sale con código distinto de 0 ante cualquier fallo. Nunca escribe la contraseña en el log.
//
// Sin dependencias: solo módulos integrados de Node 24.

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const DB_FILE = 'parolo.db';
export const FILE_DIRS = ['games', 'covers', 'downloads'];
export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_VERSION = 1;

/** Formato del archivo cifrado: MAGIC(8) | log2N(1) | r(1) | p(1) | salt(16) | iv(12) | datos | tag(16) */
export const ENC_MAGIC = Buffer.from('PAROLOB1', 'ascii');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
export const ENC_HEADER_LEN = ENC_MAGIC.length + 3 + SALT_LEN + IV_LEN;
const SCRYPT_DEFAULT = { log2N: 17, r: 8, p: 1 };
const MIN_PASSPHRASE_LEN = 12;

export const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const ARCHIVE_RE = /^parolo-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.tar\.gz(\.enc)?(\.partial)?$/;
const LOCK_FILE = '.backup.lock';
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

/** Fecha ISO apta para nombres de archivo (sin ':'), con milisegundos. */
export function makeStamp(date = new Date()) {
  return date.toISOString().replace(/:/g, '-').replace('.', '-');
}

/** Entorno para procesos hijo sin secretos. */
export function childEnv() {
  const env = { ...process.env };
  delete env.BACKUP_PASSPHRASE;
  delete env.IP_HASH_SALT;
  return env;
}

let tarCache;
/** ¿Hay un `tar` capaz de gzip en el PATH? */
export function hasTar() {
  if (tarCache === undefined) {
    const r = spawnSync('tar', ['--version'], { stdio: 'ignore', env: childEnv() });
    tarCache = !r.error && r.status === 0;
  }
  return tarCache;
}

/** Ejecuta tar con rutas relativas a `cwd` (evita problemas con letras de unidad en Windows). */
export function runTar(args, cwd) {
  const r = spawnSync('tar', args, { cwd, encoding: 'utf8', env: childEnv(), maxBuffer: 64 * 1024 * 1024 });
  if (r.error) {
    // En Windows, ENOENT también aparece si el directorio de trabajo supera MAX_PATH (260).
    const hint = r.error.code === 'ENOENT' && cwd.length > 240 ? ' (ruta demasiado larga para Windows)' : '';
    throw new Error(`no se pudo ejecutar tar: ${r.error.message}${hint}`);
  }
  if (r.status !== 0) throw new Error(`tar terminó con código ${r.status}: ${(r.stderr || '').trim().slice(0, 500)}`);
  return r.stdout || '';
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(file), async function* (src) {
    for await (const chunk of src) hash.update(chunk);
  });
  return hash.digest('hex');
}

/**
 * Recorre `root` y devuelve archivos regulares (rutas relativas POSIX).
 * @param {string} root
 * @param {{ onSymlink?: (rel: string) => void }} [opts]
 * @returns {Promise<string[]>}
 */
export async function walkFiles(root, opts = {}) {
  const out = [];
  async function walk(dir, rel) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) {
        if (opts.onSymlink) opts.onSymlink(r);
        else throw new Error(`enlace simbólico no permitido: ${r}`);
      } else if (e.isDirectory()) {
        await walk(abs, r);
      } else if (e.isFile()) {
        out.push(r);
      } else {
        throw new Error(`tipo de archivo no soportado: ${r}`);
      }
    }
  }
  await walk(root, '');
  return out.sort();
}

/** Copia recursiva de archivos regulares. Ignora enlaces simbólicos (avisando). */
export async function copyTree(src, dst, log) {
  await fsp.mkdir(dst, { recursive: true });
  const files = await walkFiles(src, { onSymlink: (rel) => log(`AVISO: se ignora el enlace simbólico ${rel}`) });
  for (const rel of files) {
    const to = path.join(dst, ...rel.split('/'));
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(path.join(src, ...rel.split('/')), to, fs.constants.COPYFILE_EXCL);
  }
  return files.length;
}

async function deriveKey(passphrase, salt, { log2N, r, p }) {
  const N = 2 ** log2N;
  return scryptAsync(Buffer.from(passphrase, 'utf8'), salt, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
}

export function checkPassphrase(passphrase) {
  if (passphrase && passphrase.length < MIN_PASSPHRASE_LEN) {
    throw new Error(`BACKUP_PASSPHRASE debe tener al menos ${MIN_PASSPHRASE_LEN} caracteres`);
  }
}

/** Cifra `inPath` → `outPath` con AES-256-GCM (clave derivada con scrypt; sal e IV aleatorios). */
export async function encryptFile(inPath, outPath, passphrase, params = SCRYPT_DEFAULT) {
  checkPassphrase(passphrase);
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const header = Buffer.concat([ENC_MAGIC, Buffer.from([params.log2N, params.r, params.p]), salt, iv]);
  const key = await deriveKey(passphrase, salt, params);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  try {
    await pipeline(
      fs.createReadStream(inPath),
      async function* (src) {
        yield header;
        for await (const chunk of src) yield cipher.update(chunk);
        yield cipher.final();
        yield cipher.getAuthTag();
      },
      fs.createWriteStream(outPath, { flags: 'wx' }),
    );
  } catch (err) {
    await fsp.rm(outPath, { force: true });
    throw err;
  }
}

/** Descifra y autentica. Si la etiqueta GCM no cuadra, borra la salida y lanza error. */
export async function decryptFile(inPath, outPath, passphrase) {
  if (!passphrase) throw new Error('la copia está cifrada: define BACKUP_PASSPHRASE');
  const { size } = await fsp.stat(inPath);
  if (size < ENC_HEADER_LEN + TAG_LEN) throw new Error('archivo cifrado truncado');
  const fh = await fsp.open(inPath, 'r');
  const header = Buffer.alloc(ENC_HEADER_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  try {
    await fh.read(header, 0, ENC_HEADER_LEN, 0);
    await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    await fh.close();
  }
  if (!header.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) throw new Error('no es una copia cifrada de parologames');
  let o = ENC_MAGIC.length;
  const params = { log2N: header[o++], r: header[o++], p: header[o++] };
  if (params.log2N < 14 || params.log2N > 20 || params.r < 1 || params.r > 32 || params.p < 1 || params.p > 4) {
    throw new Error('parámetros de cifrado no válidos');
  }
  const salt = header.subarray(o, o + SALT_LEN); o += SALT_LEN;
  const iv = header.subarray(o, o + IV_LEN);
  const key = await deriveKey(passphrase, salt, params);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const end = size - TAG_LEN - 1;
  try {
    await pipeline(
      end >= ENC_HEADER_LEN ? fs.createReadStream(inPath, { start: ENC_HEADER_LEN, end }) : [],
      async function* (src) {
        for await (const chunk of src) yield decipher.update(chunk);
        yield decipher.final();
      },
      fs.createWriteStream(outPath, { flags: 'wx' }),
    );
  } catch {
    await fsp.rm(outPath, { force: true });
    throw new Error('no se pudo descifrar: contraseña incorrecta o archivo dañado/manipulado');
  }
}

/** Instantánea consistente con VACUUM INTO + comprobación de integridad. */
export function snapshotDb(dbPath, target) {
  const src = new DatabaseSync(dbPath, { timeout: 15000 });
  try {
    src.prepare('VACUUM INTO ?').run(target);
  } finally {
    src.close();
  }
  checkDbIntegrity(target);
}

export function checkDbIntegrity(dbPath) {
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    const msgs = rows.map((r) => Object.values(r)[0]);
    if (msgs.length !== 1 || msgs[0] !== 'ok') {
      throw new Error(`integrity_check falló: ${msgs.slice(0, 5).join('; ')}`);
    }
  } finally {
    db.close();
  }
}

/** Genera el manifiesto con SHA-256 de todos los archivos de `dir`. */
export async function buildManifest(dir, meta = {}) {
  const files = [];
  for (const rel of await walkFiles(dir)) {
    if (rel === MANIFEST_FILE) continue;
    const abs = path.join(dir, ...rel.split('/'));
    const { size } = await fsp.stat(abs);
    files.push({ path: rel, size, sha256: await sha256File(abs) });
  }
  return { version: MANIFEST_VERSION, app: 'parologames', createdAt: new Date().toISOString(), ...meta, files };
}

async function acquireLock(backupDir) {
  const lockPath = path.join(backupDir, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fsp.open(lockPath, 'wx');
      await fh.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      await fh.close();
      return async () => { await fsp.rm(lockPath, { force: true }); };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const st = await fsp.stat(lockPath).catch(() => null);
      if (st && Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        await fsp.rm(lockPath, { force: true });
        continue;
      }
      throw new Error(`hay otra copia en curso (${lockPath}); si no es así, borra ese archivo`);
    }
  }
  throw new Error('no se pudo obtener el bloqueo de copias');
}

/**
 * Conserva las `keep` copias completas más recientes y borra el resto.
 * Solo toca entradas con el formato de nombre de este script.
 */
export async function rotateBackups(backupDir, keep, log = () => {}, current) {
  const entries = await fsp.readdir(backupDir, { withFileTypes: true });
  const complete = new Map(); // stamp → [nombres]
  const junk = [];
  for (const e of entries) {
    if (e.isDirectory() && STAMP_RE.test(e.name)) {
      if (e.name === current || fs.existsSync(path.join(backupDir, e.name, MANIFEST_FILE))) {
        (complete.get(e.name) ?? complete.set(e.name, []).get(e.name)).push(e.name);
      } else junk.push(e.name); // directorio incompleto (proceso interrumpido)
    } else if (e.isFile()) {
      const m = ARCHIVE_RE.exec(e.name);
      if (!m) continue;
      if (m[3]) { junk.push(e.name); continue; } // .partial
      (complete.get(m[1]) ?? complete.set(m[1], []).get(m[1])).push(e.name);
    }
  }
  const stamps = [...complete.keys()].sort().reverse();
  const doomed = stamps.slice(keep).flatMap((s) => complete.get(s));
  for (const name of [...junk, ...doomed]) {
    if (name === current) continue;
    await fsp.rm(path.join(backupDir, name), { recursive: true, force: true });
    log(`rotación: borrado ${name}`);
  }
  return { kept: stamps.slice(0, keep), removed: doomed, junk };
}

/**
 * @param {{ dataDir: string, backupDir: string, passphrase?: string, keep?: number,
 *           format?: 'auto'|'tar'|'dir', log?: (m: string) => void }} opts
 * @returns {Promise<{ path: string, stamp: string, files: number, encrypted: boolean }>}
 */
export async function runBackup(opts) {
  const log = opts.log ?? (() => {});
  const dataDir = path.resolve(opts.dataDir);
  const backupDir = path.resolve(opts.backupDir);
  const passphrase = opts.passphrase || '';
  const keep = opts.keep ?? 14;
  const format = opts.format ?? 'auto';
  if (!['auto', 'tar', 'dir'].includes(format)) throw new Error(`formato no válido: ${format}`);
  if (!Number.isInteger(keep) || keep < 1) throw new Error('BACKUP_KEEP debe ser un entero ≥ 1');
  checkPassphrase(passphrase);
  if (passphrase && format === 'dir') throw new Error('el cifrado requiere empaquetar: usa --format=tar o auto');

  const dbPath = path.join(dataDir, DB_FILE);
  if (!fs.existsSync(dbPath)) throw new Error(`no existe la base de datos ${dbPath}`);
  for (const d of FILE_DIRS) {
    const rel = path.relative(path.join(dataDir, d), backupDir);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`BACKUP_DIR no puede estar dentro de ${d}/`);
  }

  const pack = format === 'tar' || (format === 'auto' && hasTar());
  if (format === 'tar' && !hasTar()) throw new Error('no se encontró tar');
  if (passphrase && !pack) throw new Error('BACKUP_PASSPHRASE requiere tar para empaquetar; instala tar o quita la contraseña');

  await fsp.mkdir(backupDir, { recursive: true });
  const release = await acquireLock(backupDir);
  let stamp = makeStamp();
  let t = Date.now();
  while (fs.existsSync(path.join(backupDir, stamp)) || fs.existsSync(path.join(backupDir, `parolo-${stamp}.tar.gz`)) || fs.existsSync(path.join(backupDir, `parolo-${stamp}.tar.gz.enc`))) {
    stamp = makeStamp(new Date(++t));
  }
  const workDir = path.join(backupDir, stamp);
  const archive = path.join(backupDir, `parolo-${stamp}.tar.gz`);
  const encrypted = `${archive}.enc`;
  const cleanup = [];
  try {
    await fsp.mkdir(workDir);
    cleanup.push(workDir);

    log(`instantánea de la BD → ${stamp}/${DB_FILE}`);
    snapshotDb(dbPath, path.join(workDir, DB_FILE));
    for (const suffix of ['-wal', '-shm', '-journal']) await fsp.rm(path.join(workDir, DB_FILE + suffix), { force: true });

    for (const d of FILE_DIRS) {
      const src = path.join(dataDir, d);
      if (!fs.existsSync(src)) {
        log(`AVISO: no existe ${d}/, se guarda vacío`);
        await fsp.mkdir(path.join(workDir, d));
        continue;
      }
      const n = await copyTree(src, path.join(workDir, d), log);
      log(`copiados ${n} archivos de ${d}/`);
    }

    const manifest = await buildManifest(workDir, { stamp });
    await fsp.writeFile(path.join(workDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    log(`manifiesto: ${manifest.files.length} archivos con SHA-256`);

    let result = workDir;
    if (pack) {
      const partial = `${archive}.partial`;
      cleanup.push(partial, archive);
      runTar(['-czf', path.basename(partial), '-C', stamp, '.'], backupDir);
      // Comprobación rápida: el archivo se puede leer y contiene todo.
      const listed = runTar(['-tzf', path.basename(partial)], backupDir).split(/\r?\n/).filter((l) => l && !l.endsWith('/'));
      if (listed.length < manifest.files.length + 1) throw new Error('el archivo tar no contiene todos los archivos');
      await fsp.rename(partial, archive);
      await fsp.rm(workDir, { recursive: true, force: true });
      result = archive;
      if (passphrase) {
        cleanup.push(encrypted);
        log('cifrando con AES-256-GCM');
        await encryptFile(archive, encrypted, passphrase);
        await fsp.rm(archive, { force: true });
        result = encrypted;
      }
    } else {
      log('AVISO: tar no disponible (o --format=dir); la copia queda como directorio sin comprimir');
    }

    cleanup.length = 0;
    await rotateBackups(backupDir, keep, log, path.basename(result));
    return { path: result, stamp, files: manifest.files.length, encrypted: Boolean(passphrase) };
  } catch (err) {
    for (const p of cleanup) await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
    throw err;
  } finally {
    await release();
  }
}

function parseFormat(argv) {
  let format = process.env.BACKUP_FORMAT || 'auto';
  for (const a of argv) {
    if (a.startsWith('--format=')) format = a.slice('--format='.length);
    else if (a === '--help' || a === '-h') {
      console.log('uso: node scripts/backup.js [--format=auto|tar|dir]\n' +
        'variables: DATA_DIR, BACKUP_DIR, BACKUP_KEEP, BACKUP_PASSPHRASE, BACKUP_FORMAT');
      process.exit(0);
    } else throw new Error(`opción desconocida: ${a}`);
  }
  return format;
}

async function main() {
  const log = (m) => console.log(`[backup] ${m}`);
  // Leer el secreto y sacarlo del entorno para que no lo hereden procesos hijo.
  const passphrase = process.env.BACKUP_PASSPHRASE || '';
  delete process.env.BACKUP_PASSPHRASE;
  try {
    const keepRaw = process.env.BACKUP_KEEP ?? '14';
    const keep = /^\d+$/.test(keepRaw) ? Number(keepRaw) : NaN;
    const r = await runBackup({
      dataDir: process.env.DATA_DIR || './data',
      backupDir: process.env.BACKUP_DIR || './backups',
      passphrase,
      keep,
      format: parseFormat(process.argv.slice(2)),
      log,
    });
    log(`OK ${r.path} (${r.files} archivos${r.encrypted ? ', cifrada' : ''})`);
  } catch (err) {
    console.error(`[backup] ERROR: ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}

const isMain = import.meta.main ?? (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMain) await main();
