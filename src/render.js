// Ayudante para renderizar vistas: añade csp (nonce) y assetVersion a cada llamada.

/**
 * @param {import('express').Response} res
 * @param {(data: any) => unknown} view
 * @param {object} data
 * @param {number} [status]
 */
export function render(res, view, data, status = 200) {
  const body = String(view({ ...data, csp: { nonce: res.locals.cspNonce }, assetVersion: res.locals.assetVersion }));
  if (!res.getHeader('Cache-Control')) res.set('Cache-Control', 'no-cache');
  res.status(status).type('html').send(body);
}

/** Error HTTP con estado (lo recoge el manejador central). */
export function httpError(status, message = 'error', extra = {}) {
  return Object.assign(new Error(message), { status, expose: false }, extra);
}
