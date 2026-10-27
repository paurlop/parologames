// Servicios compartidos por la app del sitio y la del origen de juegos (misma BD, misma caché).
import { createGameService } from './services/games.js';
import { createAudit, hashIp, hashUa } from './services/audit.js';
import { createSessionStore } from './security/sessions.js';
import { createPreSessionCsrf } from './security/csrf.js';
import { logger as defaultLogger, createLogger } from './log.js';

const contexts = new WeakMap();

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any, logger?: any }} deps
 */
export function getContext({ db, config, logger }) {
  let ctx = contexts.get(db);
  if (ctx) return ctx;
  const log = logger ?? (config.logLevel ? createLogger({ level: config.logLevel }) : defaultLogger);
  ctx = {
    db,
    config,
    logger: log,
    state: { shuttingDown: false },
    games: createGameService({ db, config, logger: log }),
    sessions: createSessionStore({ db, config }),
    audit: createAudit({ db, logger: log }),
    preCsrf: createPreSessionCsrf(config),
    hashIp: (ip) => hashIp(ip, config.ipHashSalt),
    hashUa: (ua) => hashUa(ua, config.ipHashSalt),
  };
  contexts.set(db, ctx);
  return ctx;
}
