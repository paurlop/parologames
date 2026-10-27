// Hash de contraseñas con scrypt (N=2^17, r=8, p=1, 64 bytes) y comparación en tiempo constante.
import crypto from 'node:crypto';

export const SCRYPT_PARAMS = Object.freeze({ N: 2 ** 17, r: 8, p: 1, keylen: 64 });
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

// scrypt usa ~128*N*r bytes; dejamos margen.
const maxmemFor = (N, r) => 128 * N * r * 2 + 1024 * 1024;

// Limita cuántos scrypt corren a la vez (cada uno reserva ~128 MB) para que un ataque
// de login en paralelo no agote la memoria ni el threadpool.
const MAX_CONCURRENT = 2;
const MAX_QUEUE = 16;
let running = 0;
const queue = [];

async function withSlot(fn) {
  if (running >= MAX_CONCURRENT) {
    if (queue.length >= MAX_QUEUE) throw Object.assign(new Error('scrypt queue full'), { code: 'SCRYPT_BUSY' });
    await new Promise((resolve) => queue.push(resolve));
  }
  running++;
  try { return await fn(); } finally {
    running--;
    const next = queue.shift();
    if (next) next();
  }
}

function scryptAsync(password, salt, keylen, opts) {
  return withSlot(() => new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  }));
}

/**
 * @param {string} password
 * @returns {Promise<string>} `scrypt$N$r$p$salt$hash` (salt y hash en base64)
 */
export async function hashPassword(password, params = SCRYPT_PARAMS) {
  if (typeof password !== 'string' || password.length === 0) throw new TypeError('password required');
  const { N, r, p, keylen } = params;
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password.normalize('NFC'), salt, keylen, { N, r, p, maxmem: maxmemFor(N, r) });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Verifica una contraseña contra un hash almacenado. Nunca lanza por datos inválidos: devuelve false.
 * @param {string} password
 * @param {string} stored
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  // Parámetros acotados: un hash manipulado no puede provocar un DoS de memoria.
  if (!Number.isInteger(N) || N < 2 ** 14 || N > 2 ** 20 || (N & (N - 1)) !== 0) return false;
  if (!Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length < 16 || expected.length < 32 || expected.length > 128) return false;
  const key = await scryptAsync(password.normalize('NFC'), salt, expected.length, { N, r, p, maxmem: maxmemFor(N, r) });
  return crypto.timingSafeEqual(key, expected);
}

let dummyHash;
/** Hash ficticio para igualar tiempos cuando no hay propietario configurado. */
export async function getDummyHash() {
  dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}
