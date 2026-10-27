// Tipos MIME de los archivos de juego y extensiones permitidas en los ZIP.

const UTF8 = '; charset=utf-8';
export const MIME = Object.freeze({
  html: 'text/html' + UTF8, htm: 'text/html' + UTF8,
  js: 'text/javascript' + UTF8, mjs: 'text/javascript' + UTF8,
  css: 'text/css' + UTF8, json: 'application/json' + UTF8, map: 'application/json' + UTF8,
  wasm: 'application/wasm',
  data: 'application/octet-stream', pck: 'application/octet-stream', bin: 'application/octet-stream',
  mem: 'application/octet-stream', unityweb: 'application/octet-stream', basis: 'application/octet-stream',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', ktx2: 'image/ktx2',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  txt: 'text/plain' + UTF8, xml: 'application/xml' + UTF8, csv: 'text/csv' + UTF8,
  atlas: 'text/plain' + UTF8, fnt: 'text/plain' + UTF8,
  glsl: 'text/plain' + UTF8, frag: 'text/plain' + UTF8, vert: 'text/plain' + UTF8,
  gz: 'application/gzip', br: 'application/octet-stream',
});

export const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME));

/** Extensión en minúsculas (sin punto) o ''. */
export function extOf(name) {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

/**
 * Cabeceras para servir un archivo de juego. Los precomprimidos (`x.js.gz`, `x.wasm.br`)
 * se sirven con su tipo base y Content-Encoding.
 * @returns {{ type: string, encoding?: 'gzip'|'br' }}
 */
export function contentTypeFor(name) {
  const ext = extOf(name);
  if (ext === 'gz' || ext === 'br') {
    const inner = extOf(name.slice(0, -(ext.length + 1)));
    if (inner && inner !== 'gz' && inner !== 'br' && MIME[inner]) {
      return { type: MIME[inner], encoding: ext === 'gz' ? 'gzip' : 'br' };
    }
    return { type: 'application/octet-stream' };
  }
  return { type: MIME[ext] ?? 'application/octet-stream' };
}

/** Tipos que ya vienen comprimidos (no merece la pena deflate al crear el ZIP de descarga). */
export const PRECOMPRESSED = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'mp3', 'ogg', 'm4a', 'mp4', 'webm', 'woff', 'woff2', 'gz', 'br', 'unityweb', 'ktx2', 'basis']);
