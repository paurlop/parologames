// Cabeceras de seguridad para el sitio y para el origen de juegos.
import helmet from 'helmet';

const DENY_FEATURES = [
  'accelerometer', 'camera', 'display-capture', 'encrypted-media', 'geolocation', 'gyroscope', 'hid',
  'idle-detection', 'magnetometer', 'microphone', 'midi', 'payment', 'publickey-credentials-get',
  'screen-wake-lock', 'serial', 'usb', 'xr-spatial-tracking', 'browsing-topics',
];

function permissionsPolicy(allowSelfAnd) {
  const allow = allowSelfAnd ? `(self "${allowSelfAnd}")` : '(self)';
  return [
    ...DENY_FEATURES.map((f) => `${f}=()`),
    `fullscreen=${allow}`,
    `gamepad=${allow}`,
    `autoplay=${allow}`,
    'picture-in-picture=()',
  ].join(', ');
}

/** CSP del sitio como string (también la usan los tests). */
export function siteCsp(config, nonce) {
  const d = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    `frame-src ${config.gamesOrigin}`,
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ];
  if (config.isProd) d.push('upgrade-insecure-requests');
  return d.join('; ');
}

/** Middleware de cabeceras del sitio. Requiere res.locals.cspNonce. */
export function siteHeaders(config) {
  const h = helmet({
    contentSecurityPolicy: false, // la ponemos nosotros (con nonce por petición)
    strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    originAgentCluster: true,
  });
  const pp = permissionsPolicy(config.gamesOrigin);
  return (req, res, next) => {
    res.removeHeader('X-Powered-By');
    res.setHeader('Content-Security-Policy', siteCsp(config, res.locals.cspNonce));
    res.setHeader('Permissions-Policy', pp);
    h(req, res, next);
  };
}

/** CSP del origen de juegos: permite el código del juego (Unity/Godot necesitan eval y wasm). */
export function gamesCsp(config) {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline' blob: data:",
    ["img-src 'self' data: blob:", ...(config.gamesImgSrc ?? [])].join(' '),
    "font-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    ["connect-src 'self' blob: data:", ...(config.gamesConnectSrc ?? [])].join(' '),
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    `frame-ancestors ${config.siteOrigin}`,
  ].join('; ');
}

/** Middleware de cabeceras del origen de juegos. Nunca deja salir Set-Cookie. */
export function gamesHeaders(config) {
  const csp = gamesCsp(config);
  const pp = permissionsPolicy(null);
  return (req, res, next) => {
    // Defensa en profundidad: este origen jamás envía cookies.
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (name, value) => (String(name).toLowerCase() === 'set-cookie' ? res : setHeader(name, value));
    res.removeHeader('X-Powered-By');
    setHeader('Content-Security-Policy', csp);
    setHeader('Permissions-Policy', pp);
    setHeader('X-Content-Type-Options', 'nosniff');
    setHeader('Referrer-Policy', 'no-referrer');
    setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    setHeader('Origin-Agent-Cluster', '?1');
    setHeader('X-DNS-Prefetch-Control', 'off');
    setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (config.isProd) setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    next();
  };
}
