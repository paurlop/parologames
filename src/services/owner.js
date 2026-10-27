// Credenciales del propietario (tabla `owner`, una sola fila con id = 1).

/** @param {import('node:sqlite').DatabaseSync} db */
export function getOwner(db) {
  return db.prepare('SELECT password_hash, totp_secret, totp_last_step FROM owner WHERE id = 1').get() ?? null;
}

/** Crea o reemplaza contraseña y secreto TOTP. */
export function setOwner(db, { passwordHash, totpSecret, totpLastStep = 0 }) {
  const now = Date.now();
  db.prepare(`INSERT INTO owner (id, password_hash, totp_secret, totp_last_step, created_at, updated_at)
              VALUES (1, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, totp_secret = excluded.totp_secret,
                totp_last_step = excluded.totp_last_step, updated_at = excluded.updated_at`)
    .run(passwordHash, totpSecret, totpLastStep, now, now);
}

/** Cambia solo el secreto TOTP. Devuelve false si no hay propietario. */
export function rotateTotp(db, { totpSecret, totpLastStep = 0 }) {
  const r = db.prepare('UPDATE owner SET totp_secret = ?, totp_last_step = ?, updated_at = ? WHERE id = 1')
    .run(totpSecret, totpLastStep, Date.now());
  return Number(r.changes) === 1;
}

/**
 * Marca un paso TOTP como usado de forma atómica. false si ya se usó ese paso u otro posterior
 * (evita reutilizar un código incluso con peticiones simultáneas).
 */
export function consumeTotpStep(db, step) {
  const r = db.prepare('UPDATE owner SET totp_last_step = ? WHERE id = 1 AND totp_last_step < ?').run(step, step);
  return Number(r.changes) === 1;
}
