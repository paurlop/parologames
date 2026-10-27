// Lee y valida la configuración desde variables de entorno. Falla al arrancar con un
// mensaje claro si algo está mal, sin imprimir nunca valores secretos.
import path from 'node:path';

export class ConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`Configuración inválida:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const DEV_IP_HASH_SALT = 'dev-only-insecure-ip-hash-salt-change-me-0000';
const RESERVED_PREFIXES = ['/juegos', '/static', '/media', '/healthz', '/readyz', '/robots.txt', '/favicon.ico', '/play'];

/** Rutas de datos dentro de DATA_DIR (absolutas). */
export function dataPaths(dataDir) {
  const root = path.resolve(dataDir);
  return {
    root,
    db: path.join(root, 'parolo.db'),
    games: path.join(root, 'games'),
    covers: path.join(root, 'covers'),
    downloads: path.join(root, 'downloads'),
    tmp: path.join(root, 'tmp'),
  };
}

/** DATA_DIR sin validar el resto (para scripts que solo necesitan la BD). */
export function resolveDataDir(env = process.env) {
  return path.resolve(env.DATA_DIR || './data');
}

/**
 * @param {Record<string,string|undefined>} env
 */
export function loadConfig(env = process.env) {
  const problems = [];
  const warnings = [];
  const nodeEnv = (env.NODE_ENV || 'development').trim();
  if (!['production', 'development', 'test'].includes(nodeEnv)) problems.push('NODE_ENV debe ser production, development o test');
  const isProd = nodeEnv === 'production';

  const int = (name, def, min, max) => {
    const v = env[name];
    if (v === undefined || v === '') return def;
    if (!/^\d+$/.test(v.trim())) { problems.push(`${name} debe ser un entero`); return def; }
    const n = Number(v);
    if (n < min || n > max) { problems.push(`${name} debe estar entre ${min} y ${max}`); return def; }
    return n;
  };

  const port = int('PORT', 3000, 0, 65535);
  const gamesPort = int('GAMES_PORT', 3001, 0, 65535);

  const origin = (name, devDefault) => {
    let v = env[name]?.trim();
    // A bare host (what Render's blueprint hands over) means https://host.
    if (v && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
      // On Render a blueprint's fromService "host" is the internal service name (no dots); its public host adds .onrender.com.
      v = `https://${v}${env.RENDER && !v.includes('.') ? '.onrender.com' : ''}`;
    }
    if (!v) {
      if (isProd) { problems.push(`${name} es obligatoria en producción`); return ''; }
      v = devDefault;
    }
    let u;
    try { u = new URL(v); } catch { problems.push(`${name} no es una URL válida`); return ''; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') problems.push(`${name} debe ser http(s)`);
    if (isProd && u.protocol !== 'https:') problems.push(`${name} debe usar https en producción`);
    if ((u.pathname && u.pathname !== '/') || u.search || u.hash || u.username || u.password) {
      problems.push(`${name} debe ser solo un origen (esquema://host[:puerto]), sin ruta`);
    }
    return u.origin;
  };
  const siteOrigin = origin('SITE_ORIGIN', `http://localhost:${port || 3000}`);
  const gamesOrigin = origin('GAMES_ORIGIN', `http://127.0.0.1:${gamesPort || 3001}`);
  if (siteOrigin && gamesOrigin && siteOrigin === gamesOrigin) problems.push('SITE_ORIGIN y GAMES_ORIGIN deben ser orígenes distintos');
  if (isProd && siteOrigin && gamesOrigin) {
    const h1 = new URL(siteOrigin).hostname; const h2 = new URL(gamesOrigin).hostname;
    if (h1 === h2) problems.push('En producción GAMES_ORIGIN debe tener otro host (subdominio o dominio) distinto de SITE_ORIGIN');
  }

  let adminPath = (env.ADMIN_PATH || '/panel').trim();
  if (adminPath.length > 1 && adminPath.endsWith('/')) adminPath = adminPath.slice(0, -1);
  if (!/^\/[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64})*$/.test(adminPath)) {
    problems.push('ADMIN_PATH debe empezar por / y contener solo letras, números, _ o - (p. ej. /panel)');
  } else if (RESERVED_PREFIXES.some((p) => adminPath === p || adminPath.startsWith(p + '/'))) {
    problems.push('ADMIN_PATH choca con una ruta pública reservada');
  }

  const dataDir = resolveDataDir(env);

  let trustProxy = false;
  const tp = (env.TRUST_PROXY ?? '').trim();
  if (tp === '' ) trustProxy = isProd ? 1 : false;
  else if (/^\d+$/.test(tp)) trustProxy = Number(tp);
  else if (tp === 'false') trustProxy = false;
  else if (/^[A-Za-z0-9.:/,\s]+$/.test(tp)) trustProxy = tp; // 'loopback', lista de IPs/CIDR
  else problems.push('TRUST_PROXY debe ser un número de saltos, false o una lista de IPs/subredes');

  let ipHashSalt = env.IP_HASH_SALT || '';
  if (!ipHashSalt) {
    if (isProd) problems.push('IP_HASH_SALT es obligatoria en producción (32+ caracteres aleatorios)');
    else { ipHashSalt = DEV_IP_HASH_SALT; warnings.push('IP_HASH_SALT no definida: usando un valor de DESARROLLO inseguro. Nunca en producción.'); }
  } else if (ipHashSalt.length < 32) {
    problems.push('IP_HASH_SALT debe tener al menos 32 caracteres');
  } else if (isProd && ipHashSalt === DEV_IP_HASH_SALT) {
    problems.push('IP_HASH_SALT no puede ser el valor de desarrollo en producción');
  }

  const logLevel = (env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info')).trim();
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(logLevel)) problems.push('LOG_LEVEL debe ser debug, info, warn, error o silent');

  const host = (env.HOST || '').trim() || undefined;

  // Hosts externos que los juegos pueden consultar (connect-src) o mostrar como imagen (img-src).
  // Solo orígenes https exactos separados por espacios; vacío = los juegos no salen de su origen.
  const originList = (name) => {
    const raw = (env[name] || '').trim();
    if (!raw) return [];
    const out = [];
    for (const item of raw.split(/\s+/)) {
      let u;
      try { u = new URL(item); } catch { problems.push(`${name}: «${item}» no es una URL válida`); continue; }
      if (u.protocol !== 'https:' || u.origin !== item.replace(/\/$/, '')) problems.push(`${name}: «${item}» debe ser un origen https sin ruta`);
      else out.push(u.origin);
    }
    return out;
  };
  // ROLE: 'all' (both origins in one process), 'site' or 'games' (one origin per process, e.g. Render).
  const role = (env.ROLE || 'all').trim();
  if (!['all', 'site', 'games'].includes(role)) problems.push('ROLE debe ser all, site o games');
  // ADMIN_ENABLED=false removes the panel entirely (read-only deployments such as Render free).
  const adminEnabled = !/^(false|0|no)$/i.test((env.ADMIN_ENABLED || 'true').trim());
  const gamesConnectSrc = originList('GAMES_CONNECT_SRC');
  const gamesImgSrc = originList('GAMES_IMG_SRC');

  const config = {
    env: nodeEnv,
    isProd,
    host,
    port,
    gamesPort,
    siteOrigin,
    gamesOrigin,
    gamesConnectSrc,
    role,
    adminEnabled,
    gamesImgSrc,
    adminPath,
    dataDir,
    paths: dataPaths(dataDir),
    trustProxy,
    sessionTtlHours: int('SESSION_TTL_HOURS', 8, 1, 24 * 30),
    sessionIdleMinutes: int('SESSION_IDLE_MINUTES', 60, 5, 24 * 60),
    maxBuildMb: int('MAX_BUILD_MB', 90, 1, 4096),
    maxDownloadMb: int('MAX_DOWNLOAD_MB', 95, 1, 4096),
    maxCoverMb: int('MAX_COVER_MB', 5, 1, 50),
    ipHashSalt,
    logLevel,
    rate: {
      globalPerMin: int('RATE_GLOBAL_PER_MIN', 300, 1, 1e6),
      gamesPerMin: int('RATE_GAMES_PER_MIN', 1500, 1, 1e6),
      loginPer15Min: int('RATE_LOGIN_PER_15MIN', 5, 1, 1e6),
      downloadsPer10Min: int('RATE_DOWNLOAD_PER_10MIN', 20, 1, 1e6),
      uploadsPerHour: int('RATE_UPLOAD_PER_HOUR', 30, 1, 1e6),
    },
    lockout: {
      threshold: int('LOGIN_LOCK_THRESHOLD', 10, 1, 1000),
      baseMinutes: int('LOGIN_LOCK_MINUTES', 15, 1, 24 * 60),
    },
    cacheTtlMs: int('CACHE_TTL_SECONDS', 30, 0, 3600) * 1000,
    warnings,
  };

  if (problems.length) throw new ConfigError(problems);
  return Object.freeze(config);
}
