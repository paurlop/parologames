// App Express del sitio: público + panel.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getContext } from './context.js';
import { siteHeaders } from './security/headers.js';
import { createLimiters } from './security/limits.js';
import { healthRouter } from './routes/health.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { renderError } from './views/index.js';
import { render } from './render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');

/** Hash corto del contenido de public/ (o versión + arranque si no existe). */
export function computeAssetVersion(dir = PUBLIC_DIR) {
  const h = crypto.createHash('sha256');
  let any = false;
  const walk = (d, rel) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) { h.update(r).update('\0').update(fs.readFileSync(path.join(d, e.name))).update('\0'); any = true; }
    }
  };
  walk(dir, '');
  if (!any) {
    let version = '0';
    try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { /* sin package.json */ }
    h.update(`${version}:${Date.now()}`);
  }
  return h.digest('hex').slice(0, 10);
}

/** Id de petición, nonce CSP y versión de assets. */
export function requestContext(assetVersion) {
  return (req, res, next) => {
    const reqId = crypto.randomUUID();
    res.locals.reqId = reqId;
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    res.locals.assetVersion = assetVersion;
    res.setHeader('X-Request-Id', reqId);
    next();
  };
}

/** Log de acceso al terminar la respuesta (sin query string en rutas del panel). */
export function accessLog(ctx, { adminPath } = {}) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const raw = req.originalUrl || req.url;
      const p = raw.split('?')[0];
      const isAdmin = adminPath && (p === adminPath || p.startsWith(adminPath + '/'));
      ctx.logger.info('http', {
        reqId: res.locals.reqId,
        method: req.method,
        path: isAdmin ? p : raw.slice(0, 512),
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - start) / 1000n) / 1000,
        bytes: Number(res.getHeader('Content-Length')) || undefined,
        ipHash: ctx.hashIp(req.ip),
      });
    });
    next();
  };
}

/** Manejador central de errores del sitio: renderError sin detalles internos. */
export function errorHandler(ctx) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    let status = Number(err.status ?? err.statusCode) || 500;
    if (status < 400 || status > 599) status = 500;
    const reqId = res.locals.reqId;
    if (status >= 500) ctx.logger.error('request.error', { reqId, method: req.method, err });
    else ctx.logger.info('request.rejected', { reqId, status, code: err.code, msg2: err.message });
    if (res.headersSent) { res.destroy(); return; }
    if (status === 413 || err.code === 'CSRF_ORIGIN') res.set('Connection', 'close');
    if (err.type === 'entity.parse.failed') status = 400;
    try {
      render(res, renderError, { status }, status);
    } catch (viewErr) {
      ctx.logger.error('view.error', { reqId, err: viewErr });
      res.status(status).type('text/plain; charset=utf-8').send(`Error ${status}`);
    }
  };
}

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any, logger?: any }} deps
 */
export function createApp({ db, config, logger }) {
  const ctx = getContext({ db, config, logger });
  const assetVersion = computeAssetVersion();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');
  app.set('etag', false); // las páginas llevan nonce por petición

  const onLimit = (req, res, status) => {
    res.set('Cache-Control', 'no-store');
    render(res, renderError, { status }, status);
  };
  const limiters = createLimiters(config, onLimit);

  app.use(requestContext(assetVersion));
  app.use(accessLog(ctx, { adminPath: config.adminPath }));
  app.use(siteHeaders(config));
  app.use(healthRouter(ctx));
  app.use(limiters.global);

  app.use('/static', express.static(PUBLIC_DIR, {
    index: false,
    dotfiles: 'deny',
    fallthrough: true,
    redirect: false,
    etag: true,
    lastModified: true,
    maxAge: '365d',
    immutable: true,
    setHeaders: (res) => { res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); },
  }));

  // Solo GET/HEAD fuera del panel.
  app.use((req, res, next) => {
    const p = req.path;
    const inAdmin = p === config.adminPath || p.startsWith(config.adminPath + '/');
    if (!inAdmin && req.method !== 'GET' && req.method !== 'HEAD') {
      res.set('Allow', 'GET, HEAD');
      return next(Object.assign(new Error('method not allowed'), { status: 405 }));
    }
    next();
  });

  app.use(publicRouter(ctx, limiters));
  if (config.adminEnabled) app.use(config.adminPath, adminRouter(ctx, limiters));

  app.use((req, res, next) => next(Object.assign(new Error('not found'), { status: 404 })));
  app.use(errorHandler(ctx));
  return app;
}
