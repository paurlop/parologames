#!/usr/bin/env node
// Crea 3 juegos de demostración (título «Demo: …») con portada PNG generada, para ver el sitio con contenido.
// Son juegos reales y pequeños escritos para este proyecto; el propietario puede borrarlos desde el panel.
// Idempotente: si ya existe un juego con el mismo título, lo salta.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveDataDir, dataPaths } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createGameService, newId } from '../src/services/games.js';
import { writeZipFromDir } from '../src/services/zip-writer.js';
import { createLogger } from '../src/log.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ PNG mínimo (RGB, 8 bits)
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
/** @param {number} w @param {number} h @param {(x:number,y:number)=>[number,number,number]} pixel */
export function encodePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filtro "None"
    for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); raw[o++] = r; raw[o++] = g; raw[o++] = b; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// Portadas 600x800: diseño plano y geométrico con el color de cada juego.
const COVERS = {
  pong: (bg, fg, accent) => (x, y) => {
    if (x >= 296 && x < 304 && (y % 48) < 28) return fg;           // red central
    if (x >= 70 && x < 100 && y >= 300 && y < 460) return fg;      // pala izquierda
    if (x >= 500 && x < 530 && y >= 380 && y < 540) return fg;     // pala derecha
    if ((x - 380) ** 2 + (y - 330) ** 2 < 34 ** 2) return accent;  // bola
    return bg;
  },
  snake: (bg, fg, accent) => (x, y) => {
    const cx = Math.floor(x / 50); const cy = Math.floor(y / 50);
    const body = [[2, 12], [3, 12], [4, 12], [5, 12], [6, 12], [7, 12], [7, 11], [7, 10], [7, 9], [6, 9], [5, 9], [4, 9], [4, 8], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7]];
    if (x % 50 > 3 && y % 50 > 3 && body.some(([bx, by]) => bx === cx && by === cy)) return fg;
    if ((x - 475) ** 2 + (y - 225) ** 2 < 22 ** 2) return accent;
    if ((cx + cy) % 2 === 0) return bg.map((c) => Math.min(255, c + 10));
    return bg;
  },
  breakout: (bg, fg, accent) => (x, y) => {
    const rows = ['#ff5d8f', '#ff8a5c', '#ffd25c', '#7ee08a', '#5cc8ff'];
    if (y >= 140 && y < 140 + rows.length * 44 && x % 75 > 5 && (y - 140) % 44 > 5) return hex(rows[Math.floor((y - 140) / 44)]);
    if (x >= 220 && x < 380 && y >= 680 && y < 704) return fg;
    if ((x - 330) ** 2 + (y - 560) ** 2 < 20 ** 2) return accent;
    return bg;
  },
};

const DEMOS = [
  {
    key: 'pong', file: 'pong.html', title: 'Demo: Pong', featured: true,
    tagline: 'Juego de demostración: el clásico de las dos palas.',
    description: 'Juego de demostración incluido para ver el sitio con contenido. Puedes borrarlo desde el panel.\n\nControles: W/S o flechas, ratón o dedo. Gana quien llegue antes a 7.',
    colors: ['#10202a', '#e8f4f0', '#ffd34d'],
  },
  {
    key: 'snake', file: 'snake.html', title: 'Demo: Serpiente', featured: false,
    tagline: 'Juego de demostración: come, crece y no te muerdas.',
    description: 'Juego de demostración incluido para ver el sitio con contenido. Puedes borrarlo desde el panel.\n\nControles: flechas o WASD; en móvil, desliza el dedo.',
    colors: ['#1b2412', '#9cc95a', '#ff6b4a'],
  },
  {
    key: 'breakout', file: 'breakout.html', title: 'Demo: Ladrillos', featured: false,
    tagline: 'Juego de demostración: rompe todos los ladrillos.',
    description: 'Juego de demostración incluido para ver el sitio con contenido. Puedes borrarlo desde el panel.\n\nControles: flechas o A/D, ratón o dedo. Espacio o toque para lanzar.',
    colors: ['#2a1830', '#fbe9ff', '#fbe9ff'],
  },
];

async function main() {
  const dataDir = resolveDataDir(process.env);
  const paths = dataPaths(dataDir);
  for (const d of [paths.games, paths.covers, paths.downloads, paths.tmp]) fs.mkdirSync(d, { recursive: true });
  const db = openDb(paths.db);
  const logger = createLogger({ level: 'warn' });
  const games = createGameService({ db, config: { paths, cacheTtlMs: 0 }, logger });
  try {
    for (const demo of DEMOS) {
      if (db.prepare('SELECT 1 AS x FROM games WHERE title = ?').get(demo.title)) {
        process.stdout.write(`Ya existe «${demo.title}», se salta.\n`);
        continue;
      }
      const id = newId();
      const version = `v${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
      const buildDir = path.join(paths.games, id, version);
      fs.mkdirSync(buildDir, { recursive: true });
      const htmlBuf = fs.readFileSync(path.join(HERE, 'demo', demo.file));
      fs.writeFileSync(path.join(buildDir, 'index.html'), htmlBuf);
      const webZipFile = `${crypto.randomBytes(16).toString('hex')}.zip`;
      const { size: webZipSize } = await writeZipFromDir(buildDir, path.join(paths.downloads, webZipFile));
      const [bg, fg, accent] = demo.colors.map(hex);
      const coverFile = `${crypto.randomBytes(16).toString('hex')}.png`;
      fs.writeFileSync(path.join(paths.covers, coverFile), encodePng(600, 800, COVERS[demo.key](bg, fg, accent)));
      games.insertPrepared({
        id, title: demo.title, tagline: demo.tagline, description: demo.description, coverFile,
        buildDir: `${id}/${version}`, webZipFile, webZipSize, webSize: htmlBuf.length, status: 'published', featured: demo.featured,
      });
      process.stdout.write(`Creado «${demo.title}» (${htmlBuf.length} bytes).\n`);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => { process.stderr.write(`Error: ${err.message}\n`); process.exit(1); });
