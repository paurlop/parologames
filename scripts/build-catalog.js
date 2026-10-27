#!/usr/bin/env node
// Construye una base de datos nueva a partir de games-dist/catalog.json (despliegues de solo lectura, p. ej. Render
// gratis, donde el disco se borra en cada reinicio). Cada juego pasa por la misma validación de ZIP y portada que el
// panel. Los ids salen del slug, así que el servicio de la web y el de los juegos generan exactamente lo mismo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveDataDir, dataPaths } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createGameService, slugify } from '../src/services/games.js';
import { extractBuild, detectImageType } from '../src/services/uploads.js';
import { writeZipFromDir } from '../src/services/zip-writer.js';
import { createLogger } from '../src/log.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'games-dist');
const MAX_BUILD_BYTES = 300 * 1024 * 1024;

const dirSize = (dir) => fs.readdirSync(dir, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile()).reduce((n, e) => n + fs.statSync(path.join(e.parentPath, e.name)).size, 0);

async function main() {
  const catalog = JSON.parse(fs.readFileSync(path.join(DIST, 'catalog.json'), 'utf8'));
  const dataDir = resolveDataDir(process.env);
  const paths = dataPaths(dataDir);
  if (fs.existsSync(paths.db)) throw new Error(`${paths.db} ya existe: build-catalog solo crea datos desde cero`);
  for (const d of [paths.games, paths.covers, paths.downloads, paths.tmp]) fs.mkdirSync(d, { recursive: true });
  const db = openDb(paths.db);
  const games = createGameService({ db, config: { paths, cacheTtlMs: 0 }, logger: createLogger({ level: 'warn' }) });
  try {
    for (const [i, g] of catalog.entries()) {
      const file = (name) => path.join(DIST, path.basename(name));
      const id = crypto.createHash('sha256').update(slugify(g.title)).digest('hex').slice(0, 16);
      const buildDir = path.join(paths.games, id, 'vcatalog');
      fs.mkdirSync(path.dirname(buildDir), { recursive: true });
      await extractBuild(file(g.zip), buildDir, { maxTotalBytes: MAX_BUILD_BYTES });

      let coverFile = null;
      if (g.cover) {
        const buf = fs.readFileSync(file(g.cover));
        const type = detectImageType(buf);
        if (!type) throw new Error(`${g.cover}: la portada no es PNG, JPG ni WebP`);
        coverFile = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32)}.${type}`;
        fs.writeFileSync(path.join(paths.covers, coverFile), buf);
      }

      const webZipFile = `${id}${'0'.repeat(16)}.zip`;
      const { size: webZipSize } = await writeZipFromDir(buildDir, path.join(paths.downloads, webZipFile));
      games.insertPrepared({
        id, title: g.title, tagline: g.tagline ?? '', description: g.description ?? '', coverFile,
        buildDir: `${id}/vcatalog`, webZipFile, webZipSize, webSize: dirSize(buildDir),
        status: g.status === 'hidden' ? 'hidden' : 'published', featured: Boolean(g.featured),
        // Newest first on the shelf follows the catalogue order: the first entry is the newest.
        createdAt: Date.now() - i * 1000,
      });
      process.stdout.write(`Añadido «${g.title}»\n`);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => { process.stderr.write(`Error: ${err.message}\n`); process.exit(1); });
