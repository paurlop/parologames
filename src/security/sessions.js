// Sesiones: token aleatorio de 32 bytes en cookie; en BD solo su SHA-256.
import crypto from 'node:crypto';
import { parseCookies, serializeCookie, appendSetCookie } from './cookies.js';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes en base64url

export function sessionCookieName(config) {
  return config.isProd ? '__Host-parolo_s' : 'parolo_s';
}

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any }} deps
 */
export function createSessionStore({ db, config }) {
  const ttlMs = config.sessionTtlHours * 3600_000;
  const idleMs = config.sessionIdleMinutes * 60_000;
  const cookieName = sessionCookieName(config);
  const st = {
    insert: db.prepare('INSERT INTO sessions (token_hash, csrf, created_at, expires_at, last_seen_at, ip_hash, ua_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    get: db.prepare('SELECT token_hash, csrf, created_at, expires_at, last_seen_at FROM sessions WHERE token_hash = ?'),
    touch: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?'),
    del: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    delAll: db.prepare('DELETE FROM sessions'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?'),
  };

  return {
    cookieName,
    /** Crea una sesión nueva. Devuelve el token en claro (solo para la cookie). */
    create({ ipHash = null, uaHash = null } = {}) {
      const token = randomToken(32);
      const csrf = randomToken(32);
      const now = Date.now();
      st.insert.run(sha256(token), csrf, now, now + ttlMs, now, ipHash, uaHash);
      return { token, csrf, expiresAt: now + ttlMs };
    },
    /** Sesión válida para el token, o null. Actualiza la actividad. */
    get(token) {
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
      const hash = sha256(token);
      const row = st.get.get(hash);
      if (!row) return null;
      const now = Date.now();
      if (row.expires_at <= now || row.last_seen_at + idleMs <= now) {
        st.del.run(hash);
        return null;
      }
      if (now - row.last_seen_at > 30_000) st.touch.run(now, hash);
      return { tokenHash: hash, csrf: row.csrf, createdAt: row.created_at, expiresAt: row.expires_at };
    },
    destroy(token) {
      if (typeof token === 'string' && TOKEN_RE.test(token)) st.del.run(sha256(token));
    },
    destroyAll() { st.delAll.run(); },
    purgeExpired() {
      const now = Date.now();
      return Number(st.purge.run(now, now - idleMs).changes);
    },
    readToken(req) {
      return parseCookies(req.headers.cookie)[cookieName];
    },
    setCookie(res, token, expiresAt) {
      appendSetCookie(res, serializeCookie(cookieName, token, {
        maxAge: (expiresAt - Date.now()) / 1000, secure: config.isProd, httpOnly: true, sameSite: 'Strict',
      }));
    },
    clearCookie(res) {
      appendSetCookie(res, serializeCookie(cookieName, '', { maxAge: 0, secure: config.isProd }));
    },
  };
}
