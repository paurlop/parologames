// Minimal static file server for the Vite build (./dist). GET/HEAD only,
// no directory listing, no traversal outside the root, SPA fallback to index.html.

import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

/** Returns a request handler, or null when `root` does not exist. */
export function createStaticHandler(root) {
  const base = path.resolve(root);
  if (!statSafe(base)?.isDirectory()) return null;
  const index = path.join(base, 'index.html');

  return function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return send(res, 405, 'Method Not Allowed');
    }
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad Request'); }
    if (rel.includes('\0') || rel.includes('\\')) return send(res, 400, 'Bad Request');
    const file = path.resolve(base, '.' + path.posix.normalize('/' + rel));
    const relToBase = path.relative(base, file);
    if (relToBase.startsWith('..') || path.isAbsolute(relToBase)) return send(res, 403, 'Forbidden');
    // no dotfiles
    if (relToBase.split(path.sep).some((seg) => seg.startsWith('.'))) return send(res, 404, 'Not Found');

    let target = file;
    let st = statSafe(target);
    if (st?.isDirectory()) { target = path.join(target, 'index.html'); st = statSafe(target); }
    if (!st || !st.isFile()) {
      // SPA fallback for extension-less routes only; missing assets are real 404s
      if (path.extname(rel) === '' && statSafe(index)?.isFile()) { target = index; st = statSafe(index); }
      else return send(res, 404, 'Not Found');
    }
    const ext = path.extname(target).toLowerCase();
    const immutable = /[\\/]assets[\\/]/.test(path.relative(base, target)) && ext !== '.html';
    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(target);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  };
}

export { send as sendText };
