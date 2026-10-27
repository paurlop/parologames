// /healthz (proceso vivo) y /readyz (BD accesible y DATA_DIR escribible).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any, state: { shuttingDown: boolean } }} ctx
 * @param {{ ready?: boolean }} [opts]
 */
export function healthRouter(ctx, { ready = true } = {}) {
  const r = Router();
  const noStore = (res) => res.set('Cache-Control', 'no-store').type('text/plain; charset=utf-8');

  r.get('/healthz', (req, res) => { noStore(res).send('ok'); });

  if (ready) {
    // /readyz va antes del limitador global (para el orquestador): una sola comprobación
    // (consulta + escritura en disco) a la vez y su resultado se reutiliza durante 1 s,
    // para que nadie pueda forzar trabajo de disco por petición.
    let last = { at: 0, ok: false };
    let inFlight = null;
    const check = async (reqId) => {
      try {
        ctx.db.prepare('SELECT 1 AS ok').get();
        const probe = path.join(ctx.config.paths.tmp, `.ready-${crypto.randomBytes(6).toString('hex')}`);
        await fs.promises.writeFile(probe, 'ok', { flag: 'wx' });
        await fs.promises.rm(probe, { force: true });
        return true;
      } catch (err) {
        ctx.logger.error('readyz.failed', { reqId, err: { message: err.message, code: err.code } });
        return false;
      }
    };
    r.get('/readyz', async (req, res) => {
      noStore(res);
      if (ctx.state.shuttingDown) return res.status(503).send('shutting down');
      let ok;
      if (Date.now() - last.at < 1000) ok = last.ok;
      else {
        inFlight ??= check(res.locals.reqId).then((v) => { last = { at: Date.now(), ok: v }; inFlight = null; return v; });
        ok = await inFlight;
      }
      if (ok) res.send('ready');
      else res.status(503).send('not ready');
    });
  }
  return r;
}
