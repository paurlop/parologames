// Subidas: almacenamiento temporal (multer), validación de portadas y ZIPs por bytes mágicos,
// y extracción segura del build con yauzl (zip-slip, symlinks, bombas, extensiones…).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import multer from 'multer';
import yauzl from 'yauzl';
import { ALLOWED_EXTENSIONS, extOf } from './mime.js';

const MB = 1024 * 1024;

/** Error de validación de subida con mensaje en español para el formulario. */
export class UploadError extends Error {
  /** @param {string} field @param {string} message @param {number} [status] */
  constructor(field, message, status = 400) {
    super(message);
    this.name = 'UploadError';
    this.field = field;
    this.status = status;
  }
}

export const ZIP_LIMITS = Object.freeze({
  maxEntries: 5000,
  maxFileBytes: 100 * MB,
  maxRatio: 100,
  ratioMinBytes: 1 * MB, // la relación solo se comprueba en entradas grandes
  maxPathLength: 512,
  maxDepth: 32,
});

const JUNK = (segments) => segments.includes('__MACOSX')
  || ['.ds_store', 'thumbs.db', 'desktop.ini'].includes(segments[segments.length - 1].toLowerCase());

// ---------------------------------------------------------------------------------------------
// Almacenamiento temporal para multer: nombres aleatorios en DATA_DIR/tmp y límite por campo.

/**
 * @param {string} tmpDir
 * @param {Record<string, number>} limits bytes máximos por nombre de campo
 */
export function limitedDiskStorage(tmpDir, limits) {
  return {
    _handleFile(req, file, cb) {
      const limit = limits[file.fieldname];
      if (!limit) return cb(new UploadError('_form', 'Campo de archivo no esperado.'));
      const dest = path.join(tmpDir, `${crypto.randomBytes(16).toString('hex')}.upload`);
      let size = 0;
      const counter = new Transform({
        transform(chunk, _e, done) {
          size += chunk.length;
          if (size > limit) return done(new UploadError(file.fieldname, `El archivo supera el máximo de ${Math.round(limit / MB)} MB.`, 413));
          done(null, chunk);
        },
      });
      pipeline(file.stream, counter, fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 }))
        .then(() => cb(null, { path: dest, size }))
        .catch((err) => {
          fs.promises.rm(dest, { force: true }).finally(() => cb(err));
        });
    },
    _removeFile(_req, file, cb) {
      fs.promises.rm(file.path, { force: true }).then(() => cb(null), cb);
    },
  };
}

/** Middleware multer para el formulario de juego. */
export function gameUploadMiddleware(config) {
  const limits = {
    build: config.maxBuildMb * MB,
    download: config.maxDownloadMb * MB,
    cover: config.maxCoverMb * MB,
  };
  return multer({
    storage: limitedDiskStorage(config.paths.tmp, limits),
    limits: {
      fileSize: Math.max(...Object.values(limits)),
      files: 3,
      fields: 20,
      fieldSize: 32 * 1024,
      fieldNameSize: 64,
      parts: 25,
      headerPairs: 100,
    },
  }).fields([{ name: 'build', maxCount: 1 }, { name: 'download', maxCount: 1 }, { name: 'cover', maxCount: 1 }]);
}

/** Traduce errores de multer a { field, message, status }. */
export function describeUploadError(err, config) {
  if (err instanceof UploadError) return { field: err.field, message: err.message, status: err.status };
  if (err && err.name === 'MulterError') {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE': {
        const f = err.field || '_form';
        const mb = f === 'cover' ? config.maxCoverMb : f === 'download' ? config.maxDownloadMb : config.maxBuildMb;
        return { field: f, message: `El archivo supera el máximo de ${mb} MB.`, status: 413 };
      }
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return { field: '_form', message: 'Solo se admite un archivo por campo (portada, build y descarga).', status: 400 };
      case 'LIMIT_FIELD_VALUE':
        return { field: '_form', message: 'Algún campo de texto es demasiado largo.', status: 413 };
      default:
        return { field: '_form', message: 'El formulario no es válido. Vuelve a intentarlo.', status: 400 };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Bytes mágicos

async function readHead(file, n) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally { await fh.close(); }
}

/** Detecta PNG/JPEG/WebP por bytes mágicos. @returns {'png'|'jpg'|'webp'|null} */
export function detectImageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** @returns {Promise<'png'|'jpg'|'webp'>} */
export async function validateCover(file) {
  const type = detectImageType(await readHead(file, 16));
  if (!type) throw new UploadError('cover', 'La portada debe ser una imagen PNG, JPEG o WebP.');
  return type;
}

export async function validateZipMagic(file, field = 'download') {
  const head = await readHead(file, 4);
  if (!(head.length === 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) {
    throw new UploadError(field, 'El archivo debe ser un ZIP válido.');
  }
}

// ---------------------------------------------------------------------------------------------
// Extracción segura del build

const openZip = (file, opts) => new Promise((resolve, reject) => {
  yauzl.open(file, opts, (err, zip) => (err ? reject(err) : resolve(zip)));
});

function mapYauzlError(err) {
  const m = String(err?.message || '');
  if (/absolute path|invalid relative path|invalid characters/i.test(m)) {
    return new UploadError('build', 'El ZIP contiene rutas no permitidas (absolutas, con «..» o con barras invertidas).');
  }
  if (/encrypt/i.test(m)) return new UploadError('build', 'El ZIP no puede estar cifrado.');
  if (/too many|size mismatch|exceeded|overflow/i.test(m)) return new UploadError('build', 'El ZIP está dañado o declara tamaños falsos.');
  return new UploadError('build', 'No se pudo leer el ZIP. Comprueba que no está dañado.');
}

/** Lee todas las entradas del directorio central sin extraer nada. */
function readEntries(zip, maxEntries) {
  return new Promise((resolve, reject) => {
    const entries = [];
    zip.on('error', reject);
    zip.on('entry', (entry) => {
      entries.push(entry);
      if (entries.length > maxEntries) {
        reject(new UploadError('build', `El ZIP tiene demasiados archivos (máximo ${maxEntries}).`));
        return;
      }
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.readEntry();
  });
}

/**
 * Valida un nombre de entrada y devuelve sus segmentos, o lanza UploadError.
 * @param {string} name
 */
export function checkEntryName(name) {
  const bad = () => new UploadError('build', `Ruta no permitida en el ZIP: «${name.slice(0, 120)}».`);
  // eslint-disable-next-line no-control-regex
  if (!name || name.includes('\\') || /[\u0000-\u001f\u007f]/.test(name) || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw bad();
  if (name.length > ZIP_LIMITS.maxPathLength) throw bad();
  const trimmed = name.endsWith('/') ? name.slice(0, -1) : name;
  const segments = trimmed.split('/');
  if (segments.length > ZIP_LIMITS.maxDepth) throw bad();
  for (const s of segments) {
    if (s === '' || s === '.' || s === '..' || s.length > 255 || /[:*?"<>|]/.test(s)) throw bad();
  }
  return segments;
}

const isSymlink = (entry) => ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;

/**
 * Valida el ZIP y lo extrae en destDir (que no debe existir). Si index.html está dentro de
 * una única carpeta de primer nivel, la aplana.
 * @param {string} zipPath
 * @param {string} destDir
 * @param {{ maxTotalBytes: number, maxFileBytes?: number, maxEntries?: number }} opts
 * @returns {Promise<{ totalBytes: number, files: number }>}
 */
export async function extractBuild(zipPath, destDir, { maxTotalBytes, maxFileBytes = ZIP_LIMITS.maxFileBytes, maxEntries = ZIP_LIMITS.maxEntries }) {
  await validateZipMagic(zipPath, 'build');
  let zip;
  try {
    zip = await openZip(zipPath, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: true });
  } catch (err) { throw mapYauzlError(err); }
  try {
    if (zip.entryCount > maxEntries) throw new UploadError('build', `El ZIP tiene demasiados archivos (máximo ${maxEntries}).`);
    let entries;
    try { entries = await readEntries(zip, maxEntries); } catch (err) { throw err instanceof UploadError ? err : mapYauzlError(err); }

    // 1) Validación de todas las entradas antes de escribir nada
    const files = [];
    const seen = new Set();
    let declaredTotal = 0;
    for (const entry of entries) {
      const segments = checkEntryName(entry.fileName);
      const key = segments.join('/').normalize('NFC').toLowerCase();
      if (seen.has(key + (entry.fileName.endsWith('/') ? '/' : ''))) throw new UploadError('build', `Ruta duplicada en el ZIP: «${entry.fileName.slice(0, 120)}».`);
      seen.add(key + (entry.fileName.endsWith('/') ? '/' : ''));
      if (isSymlink(entry)) throw new UploadError('build', 'El ZIP no puede contener enlaces simbólicos.');
      if (entry.isEncrypted()) throw new UploadError('build', 'El ZIP no puede estar cifrado.');
      if (entry.fileName.endsWith('/')) continue; // directorio
      if (JUNK(segments) || segments.some((s) => s.startsWith('.'))) continue; // metadatos de macOS/Windows y ocultos
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw new UploadError('build', 'El ZIP usa un método de compresión no soportado.');
      const ext = extOf(entry.fileName);
      const innerOk = (ext !== 'gz' && ext !== 'br') || ALLOWED_EXTENSIONS.has(extOf(entry.fileName.slice(0, -(ext.length + 1))));
      if (!ext || !ALLOWED_EXTENSIONS.has(ext) || !innerOk) {
        throw new UploadError('build', `Tipo de archivo no permitido en el ZIP: «${segments[segments.length - 1].slice(0, 80)}».`);
      }
      if (entry.uncompressedSize > maxFileBytes) throw new UploadError('build', `Un archivo del ZIP supera ${Math.round(maxFileBytes / MB)} MB descomprimido.`);
      if (entry.uncompressedSize > 0 && entry.compressedSize === 0) throw new UploadError('build', 'El ZIP parece una bomba de descompresión.');
      if (entry.uncompressedSize >= ZIP_LIMITS.ratioMinBytes && entry.uncompressedSize / entry.compressedSize > ZIP_LIMITS.maxRatio) {
        throw new UploadError('build', 'El ZIP parece una bomba de descompresión (relación de compresión excesiva).');
      }
      declaredTotal += entry.uncompressedSize;
      if (declaredTotal > maxTotalBytes) throw new UploadError('build', `El build descomprimido supera ${Math.round(maxTotalBytes / MB)} MB.`);
      files.push({ entry, segments });
    }

    // 2) Raíz: index.html en la raíz o en una única carpeta de primer nivel
    let strip = 0;
    const has = (p) => files.some((f) => f.segments.join('/').toLowerCase() === p);
    if (!has('index.html')) {
      const tops = new Set(files.map((f) => f.segments[0]));
      const [top] = tops;
      if (tops.size === 1 && files.every((f) => f.segments.length > 1) && has(`${top.toLowerCase()}/index.html`)) strip = 1;
      else throw new UploadError('build', 'El ZIP debe contener un index.html en la raíz o dentro de una única carpeta.');
    }
    // index.html exacto en minúsculas (el origen de juegos sirve /index.html)
    if (!files.some((f) => f.segments.slice(strip).join('/') === 'index.html')) {
      throw new UploadError('build', 'El archivo de entrada debe llamarse exactamente «index.html».');
    }

    // 3) Extracción con conteo real de bytes (defensa en profundidad frente a tamaños falsos)
    await fs.promises.mkdir(destDir, { recursive: false });
    const root = path.resolve(destDir);
    let total = 0;
    for (const { entry, segments } of files) {
      const rel = segments.slice(strip);
      const dest = path.resolve(root, ...rel);
      if (!dest.startsWith(root + path.sep)) throw new UploadError('build', 'Ruta no permitida en el ZIP.');
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (err, s) => (err ? reject(mapYauzlError(err)) : resolve(s))));
      let written = 0;
      const guard = new Transform({
        transform(chunk, _e, done) {
          written += chunk.length; total += chunk.length;
          if (written > entry.uncompressedSize || written > maxFileBytes || total > maxTotalBytes) {
            return done(new UploadError('build', 'El ZIP declara tamaños falsos o supera el límite descomprimido.'));
          }
          done(null, chunk);
        },
      });
      try {
        await pipeline(stream, guard, fs.createWriteStream(dest, { flags: 'wx', mode: 0o644 }));
      } catch (err) {
        throw err instanceof UploadError ? err : mapYauzlError(err);
      }
    }
    return { totalBytes: total, files: files.length };
  } finally {
    zip.close();
  }
}
