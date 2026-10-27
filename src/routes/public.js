// Rutas públicas (solo GET/HEAD).
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { renderSplash, renderCatalog, renderGame } from '../views/index.js';
import { render, httpError } from '../render.js';
import { SLUG_RE } from '../services/games.js';

/**
 * @param {ReturnType<import('../context.js').getContext>} ctx
 * @param {ReturnType<import('../security/limits.js').createLimiters>} limiters
 */
export function publicRouter(ctx, limiters) {
  const { games, config } = ctx;
  const r = Router();

  r.get('/', (req, res) => {
    render(res, renderSplash, { featured: games.featured(), latest: games.latestPublished(4) });
  });

  r.get('/juegos', (req, res, next) => {
    const raw = req.query.pagina;
    let page = 1;
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !/^[1-9]\d{0,4}$/.test(raw)) return next(httpError(404));
      page = Number(raw);
    }
    const result = games.listPublished(page);
    if (page > result.totalPages) return next(httpError(404));
    render(res, renderCatalog, { games: result.games, page, totalPages: result.totalPages, total: result.total });
  });

  r.get('/juegos/:slug', (req, res, next) => {
    const found = SLUG_RE.test(req.params.slug) ? games.publishedBySlug(req.params.slug) : null;
    if (!found) return next(httpError(404));
    const { game } = found;
    render(res, renderGame, { game, playUrl: `${config.gamesOrigin}/play/${game.id}/` });
  });

  r.get('/juegos/:slug/descargar', limiters.download, async (req, res, next) => {
    const found = SLUG_RE.test(req.params.slug) ? games.publishedBySlug(req.params.slug) : null;
    if (!found || !found.downloadPath) return next(httpError(404));
    let stat;
    try { stat = await fs.promises.stat(found.downloadPath); } catch { return next(httpError(404)); }
    if (!stat.isFile()) return next(httpError(404));
    const slug = found.game.slug;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${slug}.zip"; filename*=UTF-8''${encodeURIComponent(slug)}.zip`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=300',
      'Last-Modified': stat.mtime.toUTCString(),
    });
    if (req.method === 'HEAD') return res.end();
    try {
      await pipeline(fs.createReadStream(found.downloadPath), res);
    } catch (err) {
      if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') ctx.logger.warn('download.stream_error', { reqId: res.locals.reqId, err: { message: err.message, code: err.code } });
      if (!res.headersSent) return next(err);
      res.destroy();
    }
  });

  // Portadas: públicas si el juego está publicado; las de juegos ocultos solo con sesión de propietario.
  r.get('/media/portadas/:file', (req, res, next) => {
    const file = req.params.file;
    const status = games.coverStatus(file);
    if (!status) return next(httpError(404));
    if (status !== 'published') {
      if (!ctx.sessions.get(ctx.sessions.readToken(req))) return next(httpError(404));
      res.set('Cache-Control', 'private, no-store');
    } else {
      res.set('Cache-Control', 'public, max-age=31536000, immutable'); // nombre aleatorio por versión
    }
    res.sendFile(games.coverPath(file), { dotfiles: 'deny', lastModified: true, headers: { 'X-Content-Type-Options': 'nosniff' } }, (err) => {
      if (err && !res.headersSent) next(httpError(404));
    });
  });

  r.get('/robots.txt', (req, res) => {
    res.type('text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=86400')
      .send('User-agent: *\nAllow: /\nDisallow: /juegos/*/descargar\n');
  });

  r.get('/favicon.ico', (req, res) => {
    res.redirect(301, `/static/favicon.svg?v=${res.locals.assetVersion}`);
  });

  return r;
}
