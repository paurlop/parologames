// Panel del propietario bajo ADMIN_PATH. Todo requiere sesión salvo GET/POST /entrar.
import fs from 'node:fs';
import crypto from 'node:crypto';
import express, { Router } from 'express';
import { renderLogin, renderAdminList, renderAdminForm } from '../views/index.js';
import { render, httpError } from '../render.js';
import { originCheck, readSubmittedToken, safeEqual, csrfError } from '../security/csrf.js';
import { verifyPassword, getDummyHash, MAX_PASSWORD_LENGTH } from '../security/passwords.js';
import { verifyTotp } from '../security/totp.js';
import { getOwner, consumeTotpStep } from '../services/owner.js';
import { gameUploadMiddleware, describeUploadError, UploadError } from '../services/uploads.js';
import { ID_RE } from '../services/games.js';
import { transaction } from '../db.js';

export const LOGIN_ERROR = 'Contraseña o código incorrectos.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['published', 'hidden']);
const FLASH = {
  creado: 'Juego creado.',
  actualizado: 'Cambios guardados.',
  eliminado: 'Juego eliminado.',
  estado: 'Estado actualizado.',
  procesando: 'Esa subida ya se está procesando. Espera unos segundos y recarga.',
};
const LOCK_KEY = 'owner';
const FAILURE_WINDOW_MS = 24 * 3600_000;
const MAX_LOCK_MS = 24 * 3600_000;

const str = (v) => (typeof v === 'string' ? v : undefined);
// eslint-disable-next-line no-control-regex
const stripControls = (s, keepNewlines) => s.replace(keepNewlines ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, '');
const len = (s) => [...s].length;

/** Valida los campos de texto del formulario de juego. */
export function validateGameFields(body) {
  const errors = {};
  const rawTitle = str(body.title); const rawTagline = str(body.tagline); const rawDesc = str(body.description); const rawStatus = str(body.status);
  const title = stripControls((rawTitle ?? '').normalize('NFC'), false).replace(/\s+/g, ' ').trim();
  const tagline = stripControls((rawTagline ?? '').normalize('NFC'), false).replace(/\s+/g, ' ').trim();
  const description = stripControls((rawDesc ?? '').normalize('NFC').replace(/\r\n?/g, '\n'), true).trim();
  const status = rawStatus ?? '';
  const featured = str(body.featured) === '1' || str(body.featured) === 'on';
  if (rawTitle === undefined && body.title !== undefined) errors.title = 'El título no es válido.';
  else if (len(title) < 1) errors.title = 'Escribe un título.';
  else if (len(title) > 80) errors.title = 'El título no puede superar 80 caracteres.';
  if (body.tagline !== undefined && rawTagline === undefined) errors.tagline = 'El subtítulo no es válido.';
  else if (len(tagline) > 140) errors.tagline = 'El subtítulo no puede superar 140 caracteres.';
  if (body.description !== undefined && rawDesc === undefined) errors.description = 'La descripción no es válida.';
  else if (len(description) > 4000) errors.description = 'La descripción no puede superar 4000 caracteres.';
  if (!STATUSES.has(status)) errors.status = 'Elige si el juego está publicado u oculto.';
  return { errors, fields: { title, tagline, description, status: STATUSES.has(status) ? status : 'hidden', featured } };
}

/**
 * @param {ReturnType<import('../context.js').getContext>} ctx
 * @param {ReturnType<import('../security/limits.js').createLimiters>} limiters
 */
export function adminRouter(ctx, limiters) {
  const { config, sessions, games, audit, preCsrf, db } = ctx;
  const A = config.adminPath;
  const upload = gameUploadMiddleware(config);
  const formLimits = { buildMb: config.maxBuildMb, downloadMb: config.maxDownloadMb, coverMb: config.maxCoverMb };
  const r = Router();

  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  r.use(originCheck(config.siteOrigin)); // antes de leer cualquier cuerpo
  r.use(express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 20, type: 'application/x-www-form-urlencoded' }));
  r.use((req, res, next) => {
    req.adminSession = sessions.get(sessions.readToken(req));
    next();
  });

  const reqInfo = (req, res) => ({ ipHash: ctx.hashIp(req.ip), reqId: res.locals.reqId });

  // ---------------------------------------------------------------- login
  const showLogin = (req, res, status = 200, error = null) => {
    render(res, renderLogin, { csrf: preCsrf.issue(req, res), error, adminPath: A }, status);
  };

  r.get('/entrar', (req, res) => {
    if (req.adminSession) return res.redirect(303, A);
    showLogin(req, res);
  });

  const lockState = {
    get: db.prepare('SELECT count, first_at, locked_until, lock_count FROM login_failures WHERE key = ?'),
    upsert: db.prepare(`INSERT INTO login_failures (key, count, first_at, locked_until, lock_count) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET count = excluded.count, first_at = excluded.first_at, locked_until = excluded.locked_until, lock_count = excluded.lock_count`),
    clear: db.prepare('DELETE FROM login_failures WHERE key = ?'),
  };

  /** Registra un fallo; bloquea la cuenta con backoff exponencial al llegar al umbral. */
  function registerFailure(info) {
    const now = Date.now();
    let lockedUntil = 0;
    transaction(db, () => {
      const row = lockState.get.get(LOCK_KEY);
      let count = 1; let firstAt = now; let lockCount = row ? Number(row.lock_count) : 0;
      if (row && now - Number(row.first_at) <= FAILURE_WINDOW_MS) { count = Number(row.count) + 1; firstAt = Number(row.first_at); }
      else if (row && now - Number(row.locked_until) > FAILURE_WINDOW_MS) lockCount = 0; // un día tranquilo reinicia el backoff
      if (count >= config.lockout.threshold) {
        lockCount += 1;
        const ms = Math.min(MAX_LOCK_MS, config.lockout.baseMinutes * 60_000 * 2 ** (lockCount - 1));
        lockedUntil = now + ms;
        count = 0;
      }
      lockState.upsert.run(LOCK_KEY, count, firstAt, lockedUntil || (row ? Number(row.locked_until) : 0), lockCount);
    });
    if (lockedUntil) audit.record('auth.locked', { ...info, detail: { until: new Date(lockedUntil).toISOString() } });
  }

  r.post('/entrar', limiters.login, async (req, res) => {
    const info = reqInfo(req, res);
    if (!preCsrf.verify(req)) {
      audit.record('auth.csrf_failed', { ...info, detail: { route: 'login' } });
      return showLogin(req, res, 403, 'El formulario caducó. Vuelve a intentarlo.');
    }
    const fail = (reason) => {
      audit.record('auth.login_failed', { ...info, detail: { reason } });
      showLogin(req, res, 401, LOGIN_ERROR);
    };
    const lock = lockState.get.get(LOCK_KEY);
    if (lock && Number(lock.locked_until) > Date.now()) return fail('locked');

    const password = str(req.body?.password) ?? '';
    const code = (str(req.body?.totp) ?? '').replace(/[\s-]/g, '');
    const owner = getOwner(db);
    let pwOk = false;
    try {
      pwOk = await verifyPassword(password.length <= MAX_PASSWORD_LENGTH ? password : '', owner?.password_hash ?? await getDummyHash());
    } catch (err) {
      if (err.code === 'SCRYPT_BUSY') return fail('busy');
      throw err;
    }
    const step = owner ? verifyTotp(owner.totp_secret, code, { lastStep: Number(owner.totp_last_step) }) : null;
    if (!owner || !pwOk || step === null || !consumeTotpStep(db, step)) {
      registerFailure(info);
      return fail(owner ? 'invalid_credentials' : 'no_owner');
    }
    lockState.clear.run(LOCK_KEY);
    sessions.destroy(sessions.readToken(req)); // rotación: nunca reutilizar un token previo
    const s = sessions.create({ ipHash: info.ipHash, uaHash: ctx.hashUa(req.get('user-agent')) });
    sessions.setCookie(res, s.token, s.expiresAt);
    preCsrf.clear(res);
    audit.record('auth.login_success', info);
    res.redirect(303, A);
  });

  // ---------------------------------------------------------------- todo lo demás exige sesión
  r.use((req, res, next) => {
    if (req.adminSession) return next();
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(303, `${A}/entrar`);
    next(httpError(403, 'authentication required'));
  });

  /** Cada handler vuelve a comprobar la sesión (defensa en profundidad). */
  const requireSession = (req) => {
    if (!req.adminSession) throw httpError(403, 'authentication required');
    return req.adminSession;
  };
  const checkCsrf = (req) => {
    const s = requireSession(req);
    if (!safeEqual(readSubmittedToken(req), s.csrf)) throw csrfError();
  };
  const csrfMw = (req, res, next) => {
    try { checkCsrf(req); next(); } catch (err) {
      audit.record('auth.csrf_failed', { ...reqInfo(req, res), detail: { route: req.path } });
      next(err);
    }
  };
  // Para multipart: si llega X-CSRF-Token se comprueba ANTES de aceptar archivos.
  const preUploadCsrf = (req, res, next) => {
    if (typeof req.headers['x-csrf-token'] === 'string') return csrfMw(req, res, next);
    requireSession(req);
    next();
  };
  const idOr404 = (req) => {
    if (!ID_RE.test(req.params.id)) throw httpError(404);
    return req.params.id;
  };

  r.post('/salir', csrfMw, (req, res) => {
    requireSession(req);
    sessions.destroy(sessions.readToken(req));
    sessions.clearCookie(res);
    audit.record('auth.logout', reqInfo(req, res));
    res.redirect(303, '/');
  });

  const showList = (req, res, flash = null, status = 200) => {
    const s = requireSession(req);
    render(res, renderAdminList, { games: games.adminList(), csrf: s.csrf, flash, adminPath: A }, status);
  };

  r.get('/', (req, res) => {
    const aviso = str(req.query.aviso);
    showList(req, res, aviso && Object.hasOwn(FLASH, aviso) ? FLASH[aviso] : null);
  });

  const formValues = (game) => ({
    title: game?.title ?? '',
    tagline: game?.tagline ?? '',
    description: game?.description ?? '',
    status: game?.status ?? 'hidden',
    featured: game?.featured ?? false,
    idempotencyKey: crypto.randomUUID(),
  });
  const showForm = (req, res, { game = null, values, errors = {}, status = 200 }) => {
    const s = requireSession(req);
    render(res, renderAdminForm, { game, csrf: s.csrf, errors, values, limits: formLimits, adminPath: A }, status);
  };

  r.get('/nuevo', (req, res) => {
    showForm(req, res, { values: formValues(null) });
  });

  r.get('/juegos/:id/editar', (req, res) => {
    requireSession(req);
    const game = games.adminGet(idOr404(req));
    if (!game) throw httpError(404);
    showForm(req, res, { game, values: formValues(game) });
  });

  const runUpload = (req, res) => new Promise((resolve) => { upload(req, res, (err) => resolve(err ?? null)); });

  /** Alta y edición comparten el flujo: multer → CSRF → idempotencia → validación → archivos. */
  async function handleGameForm(req, res, gameId) {
    requireSession(req);
    const existing = gameId ? games.adminGet(gameId) : null;
    if (gameId && !existing) throw httpError(404);
    const uploadErr = await runUpload(req, res);
    const tmpFiles = Object.values(req.files ?? {}).flat().map((f) => f.path).filter(Boolean);
    let reservedKey = null;
    try {
      const body = req.body ?? {};
      const key = str(body.idempotency_key) ?? '';
      const values = {
        title: str(body.title) ?? '', tagline: str(body.tagline) ?? '', description: str(body.description) ?? '',
        status: STATUSES.has(str(body.status)) ? body.status : (existing?.status ?? 'hidden'),
        featured: str(body.featured) === '1' || str(body.featured) === 'on',
        idempotencyKey: UUID_RE.test(key) ? key : crypto.randomUUID(),
      };
      if (uploadErr) {
        const d = describeUploadError(uploadErr, config);
        if (!d) throw uploadErr;
        res.set('Connection', 'close');
        return showForm(req, res, { game: existing, values, errors: { [d.field]: d.message }, status: d.status });
      }
      checkCsrf(req);
      if (!UUID_RE.test(key)) {
        return showForm(req, res, { game: existing, values, errors: { _form: 'El formulario caducó. Revisa los datos y vuelve a enviarlo.' }, status: 400 });
      }
      const resv = games.reserveRequest(key);
      if (resv.state === 'done') return res.redirect(303, resv.gameId ? `${A}/juegos/${resv.gameId}/editar` : A);
      if (resv.state === 'pending') return res.redirect(303, `${A}?aviso=procesando`);
      reservedKey = key;

      const { errors, fields } = validateGameFields(body);
      const files = {
        buildTmp: req.files?.build?.[0]?.path, coverTmp: req.files?.cover?.[0]?.path, downloadTmp: req.files?.download?.[0]?.path,
      };
      if (!gameId && !files.buildTmp) errors.build = 'Sube el ZIP con el build web del juego.';
      if (Object.keys(errors).length) return showForm(req, res, { game: existing, values, errors, status: 400 });

      let id = gameId;
      try {
        if (gameId) await games.update(gameId, fields, files, { removeDownload: str(body.remove_download) === '1', idempotencyKey: key });
        else id = await games.create(fields, files, key);
      } catch (err) {
        if (err instanceof UploadError) {
          return showForm(req, res, { game: existing, values, errors: { [err.field]: err.message }, status: err.status });
        }
        throw err;
      }
      reservedKey = null;
      audit.record(gameId ? 'game.updated' : 'game.created', { ...reqInfo(req, res), detail: { gameId: id, build: Boolean(files.buildTmp) } });
      res.redirect(303, `${A}?aviso=${gameId ? 'actualizado' : 'creado'}`);
    } finally {
      if (reservedKey) games.releaseRequest(reservedKey);
      for (const p of tmpFiles) await fs.promises.rm(p, { force: true }).catch(() => {});
    }
  }

  r.post('/juegos', limiters.upload, preUploadCsrf, (req, res) => handleGameForm(req, res, null));
  r.post('/juegos/:id', limiters.upload, preUploadCsrf, (req, res) => handleGameForm(req, res, idOr404(req)));

  r.post('/juegos/:id/estado', csrfMw, (req, res) => {
    requireSession(req);
    const id = idOr404(req);
    const status = str(req.body?.status);
    if (!STATUSES.has(status)) throw httpError(400, 'invalid status');
    if (!games.setStatus(id, status)) throw httpError(404);
    audit.record('game.status', { ...reqInfo(req, res), detail: { gameId: id, status } });
    res.redirect(303, `${A}?aviso=estado`);
  });

  r.post('/juegos/:id/eliminar', csrfMw, async (req, res) => {
    requireSession(req);
    const id = idOr404(req);
    if (str(req.body?.confirm) !== '1') return showList(req, res, 'Marca la casilla de confirmación para eliminar el juego.', 400);
    if (!(await games.remove(id))) throw httpError(404);
    audit.record('game.deleted', { ...reqInfo(req, res), detail: { gameId: id } });
    res.redirect(303, `${A}?aviso=eliminado`);
  });

  return r;
}
