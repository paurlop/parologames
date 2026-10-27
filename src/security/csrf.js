// CSRF: token sincronizado ligado a la sesión, token pre-sesión para el login
// (cookie aleatoria + HMAC) y comprobación de Origin / Sec-Fetch-Site.
import crypto from 'node:crypto';
import { parseCookies, serializeCookie, appendSetCookie } from './cookies.js';
import { randomToken } from './sessions.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Comparación en tiempo constante de dos strings. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba); // gasta un tiempo similar
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * true si la petición viene del propio sitio según Origin (o Sec-Fetch-Site si falta Origin).
 * Las peticiones sin ninguna de las dos cabeceras se rechazan.
 */
export function isSameOriginRequest(req, siteOrigin) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '') return origin === siteOrigin;
  const sfs = req.headers['sec-fetch-site'];
  if (typeof sfs === 'string') return sfs === 'same-origin';
  return false;
}

/** Middleware: rechaza (403) peticiones no seguras de otro origen. */
export function originCheck(siteOrigin) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (!isSameOriginRequest(req, siteOrigin)) {
      const err = new Error('cross-origin request rejected');
      err.status = 403; err.expose = false; err.code = 'CSRF_ORIGIN';
      return next(err);
    }
    next();
  };
}

/** Token CSRF enviado por el cliente: cabecera X-CSRF-Token o campo _csrf. */
export function readSubmittedToken(req) {
  const h = req.headers['x-csrf-token'];
  if (typeof h === 'string' && h) return h;
  const b = req.body?._csrf;
  return typeof b === 'string' ? b : undefined;
}

/** Token pre-sesión para el formulario de login. */
export function createPreSessionCsrf(config) {
  const cookieName = config.isProd ? '__Host-parolo_pre' : 'parolo_pre';
  const key = crypto.createHmac('sha256', config.ipHashSalt).update('parolo:csrf-pre:v1').digest();
  const sign = (nonce) => crypto.createHmac('sha256', key).update(nonce).digest('base64url');
  return {
    cookieName,
    /** Asegura la cookie y devuelve el token para el formulario. */
    issue(req, res) {
      let nonce = parseCookies(req.headers.cookie)[cookieName];
      if (!nonce || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
        nonce = randomToken(32);
        appendSetCookie(res, serializeCookie(cookieName, nonce, { maxAge: 3600, secure: config.isProd }));
      }
      return sign(nonce);
    },
    verify(req) {
      const nonce = parseCookies(req.headers.cookie)[cookieName];
      if (!nonce || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return false;
      return safeEqual(readSubmittedToken(req), sign(nonce));
    },
    clear(res) {
      appendSetCookie(res, serializeCookie(cookieName, '', { maxAge: 0, secure: config.isProd }));
    },
  };
}

export function csrfError() {
  const err = new Error('invalid csrf token');
  err.status = 403; err.code = 'CSRF_TOKEN';
  return err;
}
