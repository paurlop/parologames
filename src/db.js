// SQLite (node:sqlite) con migraciones versionadas por PRAGMA user_version.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  // 1 — esquema inicial
  `
  CREATE TABLE games (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    tagline TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    cover_file TEXT,
    build_dir TEXT NOT NULL,
    download_file TEXT,
    download_size INTEGER,
    web_zip_file TEXT,
    web_zip_size INTEGER,
    web_size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'hidden' CHECK (status IN ('published','hidden')),
    featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX games_status_created ON games (status, created_at DESC);

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    csrf TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ip_hash TEXT,
    ua_hash TEXT
  ) STRICT;
  CREATE INDEX sessions_expires ON sessions (expires_at);

  CREATE TABLE login_failures (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    first_at INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0,
    lock_count INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    event TEXT NOT NULL,
    ip_hash TEXT,
    detail_json TEXT
  ) STRICT;
  CREATE INDEX audit_log_at ON audit_log (at);

  CREATE TABLE upload_requests (
    idempotency_key TEXT PRIMARY KEY,
    game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    totp_secret TEXT NOT NULL,
    totp_last_step INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Abre la BD, aplica PRAGMAs y migraciones.
 * @param {string} file ruta del archivo (o ':memory:')
 */
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = Number(db.prepare('PRAGMA user_version').get().user_version);
  if (current > MIGRATIONS.length) {
    throw new Error(`La BD tiene una versión de esquema (${current}) más nueva que esta aplicación (${MIGRATIONS.length})`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`); // entero controlado por el código, no por el usuario
    });
  }
}

/**
 * Ejecuta fn dentro de una transacción (BEGIN IMMEDIATE). fn debe ser síncrona.
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ya revertida */ }
    throw err;
  }
}
