#!/usr/bin/env node
// scripts/restore.js — restaura una copia hecha con scripts/backup.js.
//
// uso: node scripts/restore.js <copia> --yes          restaura
//      node scripts/restore.js <copia> --verify-only  solo verifica (simulacro), no toca nada
//      opciones: --data-dir <dir> (por defecto DATA_DIR o ./data)
//
// <copia> puede ser un directorio de copia, un .tar.gz o un .tar.gz.enc (requiere BACKUP_PASSPHRASE).
//
// Orden de seguridad:
//   1. Sin --yes (ni --verify-only) se niega a hacer nada.
//   2. Prepara la copia en un directorio temporal junto a DATA_DIR y verifica TODO
//      (rutas, tipos, SHA-256 y tamaño de cada archivo del manifiesto, que no sobren archivos,
//      integrity_check de la BD) ANTES de tocar los datos vivos.
//   3. Comprueba que la app está parada (BD sin bloquear, /healthz no responde en PORT).
//   4. Mueve DATA_DIR a <DATA_DIR>.before-restore-<fecha> (no borra nada) y coloca la copia.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DB_FILE, FILE_DIRS, MANIFEST_FILE, MANIFEST_VERSION, ENC_MAGIC,
  makeStamp, sha256File, walkFiles, copyTree, decryptFile, checkDbIntegrity, runTar, hasTar,
} from './backup.js';

export class RestoreError extends Error {}

function isSafeRel(rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\\') || rel.includes('\0')) return false;
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return false;
  return rel.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

async function detectKind(src) {
  const st = await fsp.stat(src).catch(() => null);
  if (!st) throw new RestoreError(`no existe ${src}`);
  if (st.isDirectory()) return 'dir';
  const fh = await fsp.open(src, 'r');
  const head = Buffer.alloc(ENC_MAGIC.length);
  try { await fh.read(head, 0, head.length, 0); } finally { await fh.close(); }
  if (head.equals(ENC_MAGIC)) return 'enc';
  if (head[0] === 0x1f && head[1] === 0x8b) return 'tgz';
  throw new RestoreError('formato de copia no reconocido (se esperaba directorio, .tar.gz o .tar.gz.enc)');
}

/** Extrae un .tar.gz en `dest` tras comprobar que ninguna entrada se sale del destino. */
async function extractTar(archive, dest) {
  if (!hasTar()) throw new RestoreError('se necesita tar para restaurar un .tar.gz');
  let rel = path.relative(dest, archive);
  let copied = null;
  if (path.isAbsolute(rel)) { // otra unidad (Windows): copiar al lado
    copied = `${dest}.archive.tar.gz`;
    await fsp.copyFile(archive, copied);
    rel = path.relative(dest, copied);
  }
  try {
    const entries = runTar(['-tzf', rel], dest).split(/\r?\n/).filter(Boolean);
    for (const e of entries) {
      const clean = e.replace(/^(\.\/)+/, '').replace(/\/$/, '');
      if (clean === '' || clean === '.') continue;
      if (!isSafeRel(clean)) throw new RestoreError(`entrada peligrosa en el archivo: ${JSON.stringify(e)}`);
    }
    runTar(['-xzf', rel, '--no-same-owner'], dest);
  } finally {
    if (copied) await fsp.rm(copied, { force: true });
  }
}

/**
 * Verifica el directorio preparado contra su manifiesto. Lanza RestoreError si algo no cuadra.
 * @returns {Promise<object>} manifiesto
 */
export async function verifyStaged(dir) {
  const manifestPath = path.join(dir, MANIFEST_FILE);
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch {
    throw new RestoreError('falta manifest.json o no es JSON válido');
  }
  if (manifest?.version !== MANIFEST_VERSION || !Array.isArray(manifest.files)) {
    throw new RestoreError('manifiesto con formato no soportado');
  }
  // Ningún enlace simbólico ni tipo raro (walkFiles lanza si los encuentra).
  let present;
  try { present = new Set(await walkFiles(dir)); } catch (err) { throw new RestoreError(err.message); }
  present.delete(MANIFEST_FILE);

  const listed = new Set();
  for (const f of manifest.files) {
    if (!isSafeRel(f?.path) || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isInteger(f.size)) {
      throw new RestoreError(`entrada de manifiesto no válida: ${JSON.stringify(f?.path)}`);
    }
    if (listed.has(f.path)) throw new RestoreError(`entrada duplicada en el manifiesto: ${f.path}`);
    listed.add(f.path);
    if (!present.has(f.path)) throw new RestoreError(`falta el archivo ${f.path}`);
    const abs = path.join(dir, ...f.path.split('/'));
    const { size } = await fsp.stat(abs);
    if (size !== f.size) throw new RestoreError(`tamaño distinto en ${f.path} (${size} ≠ ${f.size})`);
    const sum = await sha256File(abs);
    if (sum !== f.sha256) throw new RestoreError(`SHA-256 no coincide en ${f.path}`);
  }
  const extra = [...present].filter((p) => !listed.has(p));
  if (extra.length) throw new RestoreError(`archivos no listados en el manifiesto: ${extra.slice(0, 5).join(', ')}`);
  if (!listed.has(DB_FILE)) throw new RestoreError(`la copia no contiene ${DB_FILE}`);
  const top = new Set([...listed].map((p) => p.split('/')[0]));
  for (const t of top) {
    if (t !== DB_FILE && !FILE_DIRS.includes(t)) throw new RestoreError(`contenido inesperado en la copia: ${t}`);
  }
  try {
    checkDbIntegrity(path.join(dir, DB_FILE));
  } catch (err) {
    throw new RestoreError(`la BD de la copia está dañada: ${err.message}`);
  } finally {
    for (const s of ['-wal', '-shm']) await fsp.rm(path.join(dir, DB_FILE + s), { force: true });
  }
  return manifest;
}

/** ¿Está la app usando DATA_DIR? Devuelve lista de problemas (bloqueantes) y avisos. */
export async function checkAppStopped(dataDir, port) {
  const problems = [];
  const warnings = [];
  const dbPath = path.join(dataDir, DB_FILE);
  if (fs.existsSync(dbPath)) {
    let db;
    try {
      db = new DatabaseSync(dbPath, { timeout: 0 });
      db.exec('BEGIN EXCLUSIVE');
      db.exec('ROLLBACK');
    } catch (err) {
      problems.push(`la BD viva está bloqueada (${err.message}); detén la app antes de restaurar`);
    } finally {
      try { db?.close(); } catch { /* ignorar */ }
    }
    for (const s of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + s)) warnings.push(`existe ${DB_FILE}${s}: puede que la app siga abierta o que no se cerrara bien`);
    }
  }
  if (port) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1500) });
      problems.push(`algo responde en http://127.0.0.1:${port}/healthz (HTTP ${res.status}); detén la app`);
    } catch { /* nada escuchando: bien */ }
  }
  return { problems, warnings };
}

/**
 * @param {{ source: string, dataDir: string, passphrase?: string, yes?: boolean,
 *           verifyOnly?: boolean, port?: string|number, log?: (m: string) => void }} opts
 */
export async function runRestore(opts) {
  const log = opts.log ?? (() => {});
  if (!opts.yes && !opts.verifyOnly) {
    throw new RestoreError('restaurar reemplaza los datos vivos: vuelve a ejecutar con --yes (o usa --verify-only)');
  }
  const source = path.resolve(opts.source);
  const dataDir = path.resolve(opts.dataDir);
  const parent = path.dirname(dataDir);
  const base = path.basename(dataDir);
  const stamp = makeStamp();
  const staging = path.join(parent, `.${base}.restore-${stamp}`);
  const decrypted = `${staging}.tar.gz`;

  await fsp.mkdir(parent, { recursive: true });
  const kind = await detectKind(source);
  log(`copia: ${source} (${kind})`);
  await fsp.mkdir(staging);
  let swapped = false;
  try {
    if (kind === 'dir') {
      await copyTree(source, staging, (m) => { throw new RestoreError(m); });
    } else if (kind === 'enc') {
      log('descifrando (AES-256-GCM)…');
      await decryptFile(source, decrypted, opts.passphrase).catch((e) => { throw new RestoreError(e.message); });
      await extractTar(decrypted, staging);
    } else {
      await extractTar(source, staging);
    }

    log('verificando SHA-256 de cada archivo…');
    const manifest = await verifyStaged(staging);
    log(`verificación OK: ${manifest.files.length} archivos, copia del ${manifest.createdAt ?? '?'}`);

    if (opts.verifyOnly) {
      log('--verify-only: no se ha tocado ningún dato');
      return { verified: true, restored: false, manifest };
    }

    const { problems, warnings } = await checkAppStopped(dataDir, opts.port);
    for (const w of warnings) log(`AVISO: ${w}`);
    if (problems.length) throw new RestoreError(problems.join('; '));

    await fsp.rm(path.join(staging, MANIFEST_FILE));
    for (const d of [...FILE_DIRS, 'tmp']) await fsp.mkdir(path.join(staging, d), { recursive: true });

    let previous = null;
    if (fs.existsSync(dataDir)) {
      previous = path.join(parent, `${base}.before-restore-${stamp}`);
      try {
        await fsp.rename(dataDir, previous);
      } catch (err) {
        const hint = ['EBUSY', 'EXDEV', 'EPERM'].includes(err.code)
          ? ' (¿DATA_DIR es un punto de montaje o hay archivos abiertos? monta el volumen en el directorio padre)'
          : '';
        throw new RestoreError(`no se pudo apartar ${dataDir}: ${err.code ?? err.message}${hint}`);
      }
      log(`datos actuales apartados en ${previous}`);
    }
    try {
      await fsp.rename(staging, dataDir);
      swapped = true;
    } catch (err) {
      if (previous) await fsp.rename(previous, dataDir).catch(() => {});
      throw new RestoreError(`no se pudo colocar la copia: ${err.code ?? err.message}; datos originales devueltos a su sitio`);
    }
    log(`restaurado en ${dataDir}`);
    return { verified: true, restored: true, previous, manifest };
  } finally {
    await fsp.rm(decrypted, { force: true }).catch(() => {});
    if (!swapped) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

function parseArgs(argv) {
  const opts = { yes: false, verifyOnly: false, dataDir: null, source: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') opts.yes = true;
    else if (a === '--verify-only') opts.verifyOnly = true;
    else if (a === '--data-dir') opts.dataDir = argv[++i];
    else if (a.startsWith('--data-dir=')) opts.dataDir = a.slice('--data-dir='.length);
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('-')) throw new RestoreError(`opción desconocida: ${a}`);
    else if (!opts.source) opts.source = a;
    else throw new RestoreError(`argumento de más: ${a}`);
  }
  return opts;
}

const USAGE = 'uso: node scripts/restore.js <copia> (--yes | --verify-only) [--data-dir <dir>]';

async function main() {
  const log = (m) => console.log(`[restore] ${m}`);
  const passphrase = process.env.BACKUP_PASSPHRASE || '';
  delete process.env.BACKUP_PASSPHRASE;
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[restore] ${err.message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (opts.help || !opts.source) {
    (opts.help ? console.log : console.error)(USAGE);
    process.exitCode = opts.help ? 0 : 2;
    return;
  }
  if (!opts.yes && !opts.verifyOnly) {
    console.error('[restore] NEGADO: restaurar reemplaza los datos vivos. Para la app y vuelve a ejecutar con --yes ' +
      '(o usa --verify-only para comprobar la copia sin tocar nada).');
    process.exitCode = 2;
    return;
  }
  try {
    const r = await runRestore({
      ...opts,
      dataDir: opts.dataDir || process.env.DATA_DIR || './data',
      passphrase,
      port: process.env.PORT || '3000',
      log,
    });
    if (r.restored) {
      log('listo. Arranca la app y comprueba el sitio.' +
        (r.previous ? ` Cuando estés conforme puedes borrar ${r.previous}.` : ''));
    }
  } catch (err) {
    console.error(`[restore] ERROR: ${err?.message ?? err}`);
    console.error('[restore] los datos vivos NO se han modificado.');
    process.exitCode = 1;
  }
}

const isMain = import.meta.main ?? (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMain) await main();
