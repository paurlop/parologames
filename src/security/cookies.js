// Parseo y serialización mínimos de cookies (sin dependencias).

/** @returns {Record<string,string>} */
export function parseCookies(header) {
  const out = Object.create(null);
  if (typeof header !== 'string' || header.length > 8192) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(name in out)) out[name] = value; // la primera gana (evita "cookie tossing" con rutas más específicas)
  }
  return out;
}

/**
 * @param {string} name
 * @param {string} value solo caracteres seguros (base64url)
 * @param {{ maxAge?: number, secure?: boolean, httpOnly?: boolean, sameSite?: 'Strict'|'Lax' }} opts
 */
export function serializeCookie(name, value, { maxAge, secure = false, httpOnly = true, sameSite = 'Strict' } = {}) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('unsafe cookie value');
  let s = `${name}=${value}; Path=/; SameSite=${sameSite}`;
  if (maxAge !== undefined) s += `; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
  if (httpOnly) s += '; HttpOnly';
  if (secure) s += '; Secure';
  return s;
}

export function appendSetCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [String(prev)]) : [];
  res.setHeader('Set-Cookie', [...list, cookie]);
}
