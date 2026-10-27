// CRUD de juegos con sentencias preparadas y transacciones, caché del catálogo público
// y gestión de archivos (build versionado, portada, descargas).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { transaction } from '../db.js';
import { extractBuild, validateCover, validateZipMagic, UploadError } from './uploads.js';
import { writeZipFromDir } from './zip-writer.js';

export const PER_PAGE = 24;
export const ID_RE = /^[a-f0-9]{16}$/;
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
export const COVER_FILE_RE = /^[a-f0-9]{32}\.(png|jpg|webp)$/;
const DOWNLOAD_FILE_RE = /^[a-f0-9]{32}\.zip$/;
const BUILD_DIR_RE = /^[a-f0-9]{16}\/v[a-z0-9]{6,20}$/;
const MB = 1024 * 1024;

export const newId = () => crypto.randomBytes(8).toString('hex');
const randomName = (ext) => `${crypto.randomBytes(16).toString('hex')}.${ext}`;
const newVersion = () => `v${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;

/** Slug ASCII en minúsculas con guiones a partir del título. */
export function slugify(title) {
  const s = String(title)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'juego';
}

const SELECT_COLS = `id, slug, title, tagline, description, cover_file, build_dir, download_file, download_size,
  web_zip_file, web_zip_size, web_size, status, featured, created_at, updated_at`;

/** Objeto `game` para las vistas: nunca contiene rutas de disco. */
export function toView(row) {
  if (!row) return null;
  const separate = Boolean(row.download_file);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    description: row.description,
    coverUrl: row.cover_file ? `/media/portadas/${row.cover_file}` : null,
    hasDownload: separate || Boolean(row.web_zip_file),
    hasSeparateDownload: separate,
    downloadSize: separate ? Number(row.download_size) : (row.web_zip_file ? Number(row.web_zip_size) : 0),
    webSize: Number(row.web_size),
    status: row.status,
    featured: Boolean(row.featured),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  };
}

function createCache(ttlMs) {
  const map = new Map();
  return {
    get(key, compute) {
      if (ttlMs <= 0) return compute();
      const hit = map.get(key);
      const now = Date.now();
      if (hit && hit.exp > now) return hit.value;
      const value = compute();
      if (map.size > 500) map.clear();
      map.set(key, { exp: now + ttlMs, value });
      return value;
    },
    clear() { map.clear(); },
  };
}

async function rmQuiet(p, logger) {
  if (!p) return;
  try { await fs.promises.rm(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch (err) {
    logger?.warn('files.remove_failed', { err: { message: err.message, code: err.code } });
  }
}

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any, logger: any }} deps
 */
export function createGameService({ db, config, logger }) {
  const P = config.paths;
  const cache = createCache(config.cacheTtlMs);
  const st = {
    countPublished: db.prepare("SELECT COUNT(*) AS n FROM games WHERE status = 'published'"),
    pagePublished: db.prepare(`SELECT ${SELECT_COLS} FROM games WHERE status = 'published' ORDER BY created_at DESC, id LIMIT ? OFFSET ?`),
    featured: db.prepare(`SELECT ${SELECT_COLS} FROM games WHERE status = 'published' ORDER BY featured DESC, created_at DESC, id LIMIT 1`),
    bySlugPublished: db.prepare(`SELECT ${SELECT_COLS} FROM games WHERE slug = ? AND status = 'published'`),
    byIdPublished: db.prepare(`SELECT ${SELECT_COLS} FROM games WHERE id = ? AND status = 'published'`),
    byId: db.prepare(`SELECT ${SELECT_COLS} FROM games WHERE id = ?`),
    all: db.prepare(`SELECT ${SELECT_COLS} FROM games ORDER BY created_at DESC, id`),
    slugExists: db.prepare('SELECT 1 AS x FROM games WHERE slug = ?'),
    coverOwner: db.prepare('SELECT status FROM games WHERE cover_file = ?'),
    insert: db.prepare(`INSERT INTO games (id, slug, title, tagline, description, cover_file, build_dir, download_file, download_size,
      web_zip_file, web_zip_size, web_size, status, featured, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    update: db.prepare(`UPDATE games SET title = ?, tagline = ?, description = ?, cover_file = ?, build_dir = ?, download_file = ?,
      download_size = ?, web_zip_file = ?, web_zip_size = ?, web_size = ?, status = ?, featured = ?, updated_at = ? WHERE id = ?`),
    unfeatureOthers: db.prepare('UPDATE games SET featured = 0 WHERE featured = 1 AND id <> ?'),
    setStatus: db.prepare('UPDATE games SET status = ?, updated_at = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM games WHERE id = ?'),
    reqGet: db.prepare('SELECT game_id, created_at FROM upload_requests WHERE idempotency_key = ?'),
    reqReserve: db.prepare('INSERT INTO upload_requests (idempotency_key, game_id, created_at) VALUES (?, NULL, ?) ON CONFLICT DO NOTHING'),
    reqComplete: db.prepare('UPDATE upload_requests SET game_id = ? WHERE idempotency_key = ?'),
    reqRelease: db.prepare('DELETE FROM upload_requests WHERE idempotency_key = ? AND game_id IS NULL'),
    reqPurge: db.prepare('DELETE FROM upload_requests WHERE created_at < ?'),
  };

  const uniqueSlug = (title) => {
    const base = slugify(title);
    if (!st.slugExists.get(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const s = `${base.slice(0, 55)}-${i}`;
      if (!st.slugExists.get(s)) return s;
    }
    return `${base.slice(0, 50)}-${crypto.randomBytes(3).toString('hex')}`;
  };

  /** Rutas absolutas internas (comprobadas) a partir de valores de la BD. */
  const abs = {
    build: (dir) => (dir && BUILD_DIR_RE.test(dir) ? path.join(P.games, ...dir.split('/')) : null),
    cover: (f) => (f && COVER_FILE_RE.test(f) ? path.join(P.covers, f) : null),
    download: (f) => (f && DOWNLOAD_FILE_RE.test(f) ? path.join(P.downloads, f) : null),
  };

  /** Prepara build, ZIP web, portada y descarga a partir de archivos temporales. */
  async function stageFiles(id, { buildTmp, coverTmp, downloadTmp }, created) {
    const out = {};
    if (coverTmp) {
      const ext = await validateCover(coverTmp);
      out.cover_file = randomName(ext);
      const dest = path.join(P.covers, out.cover_file);
      await fs.promises.rename(coverTmp, dest);
      created.push(dest);
    }
    if (downloadTmp) {
      await validateZipMagic(downloadTmp, 'download');
      out.download_file = randomName('zip');
      const dest = path.join(P.downloads, out.download_file);
      out.download_size = (await fs.promises.stat(downloadTmp)).size;
      await fs.promises.rename(downloadTmp, dest);
      created.push(dest);
    }
    if (buildTmp) {
      const version = newVersion();
      out.build_dir = `${id}/${version}`;
      const gameDir = path.join(P.games, id);
      await fs.promises.mkdir(gameDir, { recursive: true });
      const dest = path.join(gameDir, version);
      created.push(dest);
      const { totalBytes } = await extractBuild(buildTmp, dest, { maxTotalBytes: config.maxBuildMb * 3 * MB });
      out.web_size = totalBytes;
      out.web_zip_file = randomName('zip');
      const zipDest = path.join(P.downloads, out.web_zip_file);
      created.push(zipDest);
      out.web_zip_size = (await writeZipFromDir(dest, zipDest)).size;
    }
    return out;
  }

  const service = {
    invalidate() { cache.clear(); },

    listPublished(page = 1) {
      return cache.get(`page:${page}`, () => {
        const total = Number(st.countPublished.get().n);
        const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
        const games = st.pagePublished.all(PER_PAGE, (page - 1) * PER_PAGE).map(toView);
        return { games, total, totalPages, page };
      });
    },
    latestPublished(n = 4) {
      return cache.get(`latest:${n}`, () => st.pagePublished.all(n, 0).map(toView));
    },
    featured() {
      return cache.get('featured', () => toView(st.featured.get()));
    },
    publishedBySlug(slug) {
      if (!SLUG_RE.test(slug)) return null;
      return cache.get(`slug:${slug}`, () => {
        const row = st.bySlugPublished.get(slug);
        return row ? { game: toView(row), downloadPath: abs.download(row.download_file) ?? abs.download(row.web_zip_file) } : null;
      });
    },
    /** Para el origen de juegos: directorio del build publicado (interno, nunca a vistas). */
    publishedBuildDir(id) {
      if (!ID_RE.test(id)) return null;
      return cache.get(`build:${id}`, () => abs.build(st.byIdPublished.get(id)?.build_dir));
    },
    /** 'published' | 'hidden' | null */
    coverStatus(file) {
      if (!COVER_FILE_RE.test(file)) return null;
      return cache.get(`cover:${file}`, () => st.coverOwner.get(file)?.status ?? null);
    },
    coverPath: (file) => abs.cover(file),

    adminList() { return st.all.all().map(toView); },
    adminGet(id) { return ID_RE.test(id) ? toView(st.byId.get(id)) : null; },

    // --- Idempotencia ------------------------------------------------------------------
    /** @returns {{ state: 'new' } | { state: 'done', gameId: string|null } | { state: 'pending' }} */
    reserveRequest(key) {
      const r = st.reqReserve.run(key, Date.now());
      if (Number(r.changes) === 1) return { state: 'new' };
      const row = st.reqGet.get(key);
      if (!row) return { state: 'new' };
      return row.game_id ? { state: 'done', gameId: row.game_id } : { state: 'pending' };
    },
    releaseRequest(key) { st.reqRelease.run(key); },
    purgeRequests() { return Number(st.reqPurge.run(Date.now() - 7 * 24 * 3600_000).changes); },

    // --- Escrituras -----------------------------------------------------------------------
    /**
     * Crea un juego a partir de campos validados y archivos temporales.
     * @returns {Promise<string>} id
     */
    async create(fields, files, idempotencyKey) {
      const id = newId();
      const created = [];
      try {
        if (!files.buildTmp) throw new UploadError('build', 'Sube el ZIP con el build web del juego.');
        const staged = await stageFiles(id, files, created);
        const now = Date.now();
        transaction(db, () => {
          if (fields.featured) st.unfeatureOthers.run(id);
          st.insert.run(id, uniqueSlug(fields.title), fields.title, fields.tagline, fields.description, staged.cover_file ?? null,
            staged.build_dir, staged.download_file ?? null, staged.download_size ?? null, staged.web_zip_file, staged.web_zip_size,
            staged.web_size, fields.status, fields.featured ? 1 : 0, now, now);
          if (idempotencyKey) st.reqComplete.run(id, idempotencyKey);
        });
        created.length = 0; // confirmado: ya no son temporales
        return id;
      } finally {
        cache.clear();
        for (const p of created) await rmQuiet(p, logger);
        if (created.length) await rmQuiet(path.join(P.games, id), logger);
      }
    },

    /** Actualiza un juego. Los archivos nuevos sustituyen a los antiguos tras el commit. */
    async update(id, fields, files, { removeDownload = false, idempotencyKey } = {}) {
      const current = ID_RE.test(id) ? st.byId.get(id) : null;
      if (!current) return false;
      const created = [];
      const toDelete = [];
      try {
        const staged = await stageFiles(id, files, created);
        const next = { ...current, ...staged };
        if (staged.cover_file && current.cover_file) toDelete.push(abs.cover(current.cover_file));
        if (staged.build_dir) {
          toDelete.push(abs.build(current.build_dir));
          if (current.web_zip_file) toDelete.push(abs.download(current.web_zip_file));
        }
        if (staged.download_file && current.download_file) toDelete.push(abs.download(current.download_file));
        if (removeDownload && !staged.download_file && current.download_file) {
          toDelete.push(abs.download(current.download_file));
          next.download_file = null; next.download_size = null;
        }
        transaction(db, () => {
          if (fields.featured) st.unfeatureOthers.run(id);
          st.update.run(fields.title, fields.tagline, fields.description, next.cover_file, next.build_dir, next.download_file,
            next.download_size, next.web_zip_file, next.web_zip_size, next.web_size, fields.status, fields.featured ? 1 : 0, Date.now(), id);
          if (idempotencyKey) st.reqComplete.run(id, idempotencyKey);
        });
        created.length = 0;
      } catch (err) {
        toDelete.length = 0;
        throw err;
      } finally {
        cache.clear();
        for (const p of created) await rmQuiet(p, logger);
        for (const p of toDelete) await rmQuiet(p, logger);
      }
      return true;
    },

    setStatus(id, status) {
      if (!ID_RE.test(id)) return false;
      const ok = Number(st.setStatus.run(status, Date.now(), id).changes) === 1;
      cache.clear();
      return ok;
    },

    async remove(id) {
      const row = ID_RE.test(id) ? st.byId.get(id) : null;
      if (!row) return false;
      transaction(db, () => { st.del.run(id); });
      cache.clear();
      await rmQuiet(path.join(P.games, id), logger);
      await rmQuiet(abs.cover(row.cover_file), logger);
      await rmQuiet(abs.download(row.download_file), logger);
      await rmQuiet(abs.download(row.web_zip_file), logger);
      return true;
    },

    /**
     * Inserta un juego cuyos archivos ya están en su sitio (seed-demo).
     */
    insertPrepared({ id, title, tagline, description, coverFile, buildDir, webZipFile, webZipSize, webSize, status = 'published', featured = false, createdAt }) {
      const now = createdAt ?? Date.now();
      transaction(db, () => {
        if (featured) st.unfeatureOthers.run(id);
        st.insert.run(id, uniqueSlug(title), title, tagline, description, coverFile, buildDir, null, null, webZipFile, webZipSize, webSize, status, featured ? 1 : 0, now, now);
      });
      cache.clear();
    },

    /** Borra archivos huérfanos (versiones antiguas, temporales que quedaron por un fallo). */
    async sweepOrphans() {
      const rows = st.all.all();
      const builds = new Set(rows.map((r) => r.build_dir));
      const files = new Set(rows.flatMap((r) => [r.cover_file, r.download_file, r.web_zip_file]).filter(Boolean));
      let removed = 0;
      const ls = async (d) => { try { return await fs.promises.readdir(d, { withFileTypes: true }); } catch { return []; } };
      for (const g of await ls(P.games)) {
        if (!g.isDirectory() || !ID_RE.test(g.name)) continue;
        const versions = await ls(path.join(P.games, g.name));
        const live = versions.filter((v) => builds.has(`${g.name}/${v.name}`));
        for (const v of versions) {
          if (!builds.has(`${g.name}/${v.name}`)) { await rmQuiet(path.join(P.games, g.name, v.name), logger); removed++; }
        }
        if (live.length === 0) await rmQuiet(path.join(P.games, g.name), logger);
      }
      for (const [dir, re] of [[P.covers, COVER_FILE_RE], [P.downloads, DOWNLOAD_FILE_RE]]) {
        for (const f of await ls(dir)) {
          if (f.isFile() && re.test(f.name) && !files.has(f.name)) { await rmQuiet(path.join(dir, f.name), logger); removed++; }
        }
      }
      return removed;
    },
  };
  return service;
}
