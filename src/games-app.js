// App Express del origen de juegos: solo /play/:id/... de juegos publicados y /healthz.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import { getContext } from './context.js';
import { gamesHeaders } from './security/headers.js';
import { createLimiters } from './security/limits.js';
import { healthRouter } from './routes/health.js';
import { contentTypeFor } from './services/mime.js';
import { requestContext, accessLog } from './app.js';

// Segmento de ruta aceptable: sin '..', sin ocultos, sin separadores ni caracteres raros.
// eslint-disable-next-line no-control-regex
const BAD_SEGMENT = /[\\/:*?"<>|\u0000-\u001f\u007f]/;

function plain(res, status, text) {
  res.status(status).set('Cache-Control', 'no-store').type('text/plain; charset=utf-8').send(text);
}

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any, logger?: any }} deps
 */
export function createGamesApp({ db, config, logger }) {
  const ctx = getContext({ db, config, logger });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);
  app.set('strict routing', true); // /play/:id y /play/:id/ son rutas distintas
  const limiters = createLimiters(config, (req, res, status) => plain(res, status, 'Demasiadas peticiones.'));

  app.use(requestContext('-'));
  app.use(accessLog(ctx));
  app.use(gamesHeaders(config));
  app.use(healthRouter(ctx, { ready: false }));
  app.use(limiters.games);

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.set('Allow', 'GET, HEAD'); return plain(res, 405, 'Método no permitido.'); }
    next();
  });

  app.get('/play/:id', (req, res) => {
    const base = ctx.games.publishedBuildDir(req.params.id);
    if (!base) return plain(res, 404, 'No encontrado.');
    res.redirect(301, `/play/${req.params.id}/`);
  });

  app.get('/play/:id/{*file}', async (req, res, next) => {
    const base = ctx.games.publishedBuildDir(req.params.id);
    if (!base) return plain(res, 404, 'No encontrado.');
    const segments = Array.isArray(req.params.file) ? req.params.file : [];
    const rel = segments.length ? segments : ['index.html'];
    if (rel.some((s) => !s || s === '.' || s === '..' || s.startsWith('.') || BAD_SEGMENT.test(s) || s.length > 255)) {
      return plain(res, 404, 'No encontrado.');
    }
    const full = path.resolve(base, ...rel);
    if (!full.startsWith(path.resolve(base) + path.sep)) return plain(res, 404, 'No encontrado.');
    let stat;
    try { stat = await fs.promises.lstat(full); } catch { return plain(res, 404, 'No encontrado.'); }
    if (!stat.isFile()) return plain(res, 404, 'No encontrado.');

    const name = rel[rel.length - 1];
    const { type, encoding } = contentTypeFor(name);
    const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
    const isHtml = type.startsWith('text/html');
    res.set({
      'Content-Type': type,
      'Content-Length': String(stat.size),
      'ETag': etag,
      'Last-Modified': stat.mtime.toUTCString(),
      // El HTML se revalida siempre (cambia al subir una versión nueva); el resto, caché corta + ETag.
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=600',
    });
    if (encoding) res.set('Content-Encoding', encoding);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    if (req.method === 'HEAD') return res.end();
    try {
      await pipeline(fs.createReadStream(full), res);
    } catch (err) {
      if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') ctx.logger.warn('play.stream_error', { reqId: res.locals.reqId, err: { message: err.message, code: err.code } });
      if (!res.headersSent) return next(err);
      res.destroy();
    }
  });

  app.use((req, res) => plain(res, 404, 'No encontrado.'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = Number(err.status ?? err.statusCode) || 500;
    if (status < 400 || status > 599) status = 500;
    if (status >= 500) ctx.logger.error('request.error', { reqId: res.locals.reqId, err });
    if (res.headersSent) return res.destroy();
    plain(res, status, status === 404 ? 'No encontrado.' : 'Error.');
  });
  return app;
}
