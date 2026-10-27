// TOTP (RFC 6238) sobre HOTP (RFC 4226). SHA-1, pasos de 30 s, 6 dígitos, ventana ±1.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 RFC 4648 sin relleno. */
export function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** Secreto aleatorio de 20 bytes en base32. */
export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/**
 * HOTP(K, C) — RFC 4226.
 * @param {Buffer} key
 * @param {number|bigint} counter
 */
export function hotp(key, counter, { digits = 6, algorithm = 'sha1' } = {}) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac(algorithm, key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const TOTP_STEP_SECONDS = 30;

export function currentStep(nowMs = Date.now(), period = TOTP_STEP_SECONDS) {
  return Math.floor(nowMs / 1000 / period);
}

/**
 * Código TOTP para un instante.
 * @param {string|Buffer} secret base32 o Buffer
 */
export function totp(secret, { now = Date.now(), period = TOTP_STEP_SECONDS, digits = 6, algorithm = 'sha1', step } = {}) {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  return hotp(key, step ?? currentStep(now, period), { digits, algorithm });
}

/**
 * Verifica un código con ventana ±window. Rechaza pasos <= lastStep (reutilización).
 * @returns {number|null} el paso aceptado, o null
 */
export function verifyTotp(secret, code, { now = Date.now(), window = 1, lastStep = 0, digits = 6 } = {}) {
  if (typeof code !== 'string' || !new RegExp(`^\\d{${digits}}$`).test(code)) return null;
  let key;
  try { key = base32Decode(secret); } catch { return null; }
  const cur = currentStep(now);
  let matched = null;
  const given = Buffer.from(code);
  // Recorre toda la ventana sin salir antes para no filtrar por tiempos.
  for (let s = cur - window; s <= cur + window; s++) {
    const ok = crypto.timingSafeEqual(Buffer.from(hotp(key, s, { digits })), given);
    if (ok && s > lastStep && matched === null) matched = s;
  }
  return matched;
}

/** URI otpauth:// para apps de autenticación. */
export function otpauthUri({ secret, account = 'owner', issuer = 'parologames' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}
