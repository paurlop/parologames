// Escritor de ZIP mínimo (sin dependencias): crea un .zip a partir de un directorio.
// Usa deflate (o "store" para formatos ya comprimidos), escribe la cabecera local con
// ceros y la corrige después con escrituras posicionales; sin ZIP64 (límite 4 GiB).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { extOf, PRECOMPRESSED } from './mime.js';

const MAX_U32 = 0xffffffff;

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const year = Math.max(1980, d.getFullYear());
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Lista de archivos (rutas relativas con /) bajo dir, ordenada. Ignora enlaces simbólicos. */
export async function listFiles(dir) {
  const out = [];
  const walk = async (rel) => {
    const entries = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true });
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  await walk('');
  return out.sort();
}

/**
 * Crea outPath (no debe existir) con todos los archivos de srcDir.
 * @returns {Promise<{ size: number, files: number }>}
 */
export async function writeZipFromDir(srcDir, outPath) {
  const files = await listFiles(srcDir);
  const fh = await fs.promises.open(outPath, 'wx');
  const central = [];
  let pos = 0;
  try {
    for (const rel of files) {
      const name = Buffer.from(rel, 'utf8');
      const abs = path.join(srcDir, ...rel.split('/'));
      const stat = await fs.promises.stat(abs);
      const method = PRECOMPRESSED.has(extOf(rel)) ? 0 : 8;
      const { time, date } = dosDateTime(stat.mtime);
      const headerOffset = pos;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // versión necesaria
      local.writeUInt16LE(0x0800, 6); // nombres UTF-8
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      // CRC y tamaños (14..25) se rellenan después
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      await fh.write(local, 0, 30, pos); pos += 30;
      await fh.write(name, 0, name.length, pos); pos += name.length;

      let crc = 0; let usize = 0; let csize = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) { crc = zlib.crc32(chunk, crc); usize += chunk.length; cb(null, chunk); },
      });
      const sink = async function (source) {
        for await (const chunk of source) {
          await fh.write(chunk, 0, chunk.length, pos);
          pos += chunk.length; csize += chunk.length;
        }
      };
      const stages = [fs.createReadStream(abs), counter];
      if (method === 8) stages.push(zlib.createDeflateRaw({ level: 6 }));
      await pipeline(...stages, sink);
      if (usize > MAX_U32 || csize > MAX_U32 || pos > MAX_U32) throw new Error('ZIP demasiado grande (sin soporte ZIP64)');

      const fix = Buffer.alloc(12);
      fix.writeUInt32LE(crc >>> 0, 0); fix.writeUInt32LE(csize, 4); fix.writeUInt32LE(usize, 8);
      await fh.write(fix, 0, 12, headerOffset + 14);
      central.push({ name, method, time, date, crc: crc >>> 0, csize, usize, offset: headerOffset });
    }

    const cdStart = pos;
    for (const e of central) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE((3 << 8) | 20, 4); // creado en "Unix", v2.0
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.csize, 20);
      c.writeUInt32LE(e.usize, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // archivo regular rw-r--r--
      c.writeUInt32LE(e.offset, 42);
      await fh.write(c, 0, 46, pos); pos += 46;
      await fh.write(e.name, 0, e.name.length, pos); pos += e.name.length;
    }
    if (central.length > 0xffff) throw new Error('Demasiados archivos para un ZIP sin ZIP64');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(pos - cdStart, 12);
    end.writeUInt32LE(cdStart, 16);
    await fh.write(end, 0, 22, pos); pos += 22;
    await fh.sync();
  } catch (err) {
    await fh.close().catch(() => {});
    await fs.promises.rm(outPath, { force: true }).catch(() => {});
    throw err;
  }
  await fh.close();
  return { size: pos, files: files.length };
}
