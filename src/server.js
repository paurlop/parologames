// Arranque: valida config, abre BD, crea las dos apps, escucha y apaga de forma ordenada.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createGamesApp } from './games-app.js';
import { getContext } from './context.js';
import { createLogger } from './log.js';

const SHUTDOWN_GRACE_MS = 10_000;

/** Crea los directorios de datos y vacía tmp/ de restos de arranques anteriores. */
export async function prepareDataDir(paths, logger) {
  for (const d of [paths.root, paths.games, paths.covers, paths.downloads, paths.tmp]) {
    await fs.promises.mkdir(d, { recursive: true });
  }
  let removed = 0;
  for (const name of await fs.promises.readdir(paths.tmp)) {
    await fs.promises.rm(path.join(paths.tmp, name), { recursive: true, force: true }).catch(() => {});
    removed++;
  }
  if (removed) logger.info('startup.tmp_cleaned', { removed });
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
  });
}

function tuneServer(server, { requestTimeoutMs, maxRequestsPerSocket }) {
  server.headersTimeout = 20_000;      // cabeceras completas en 20 s (slowloris)
  server.requestTimeout = requestTimeoutMs; // petición completa (subidas grandes en el sitio)
  server.keepAliveTimeout = 15_000;
  server.timeout = 120_000;            // inactividad del socket
  server.maxRequestsPerSocket = maxRequestsPerSocket;
  server.maxHeadersCount = 100;
}

/**
 * Arranca ambos servidores.
 * @param {{ env?: Record<string,string|undefined>, config?: any, logger?: any }} [opts]
 */
export async function startServer({ env = process.env, config: givenConfig, logger: givenLogger } = {}) {
  const config = givenConfig ?? loadConfig(env);
  const logger = givenLogger ?? createLogger({ level: config.logLevel });
  for (const w of config.warnings) logger.warn('config.warning', { warning: w });

  await prepareDataDir(config.paths, logger);
  const db = openDb(config.paths.db);
  const ctx = getContext({ db, config, logger });

  const removed = await ctx.games.sweepOrphans().catch((err) => { logger.warn('startup.sweep_failed', { err }); return 0; });
  if (removed) logger.info('startup.orphans_removed', { removed });

  const siteServer = http.createServer({ requestTimeout: 30 * 60_000 }, createApp({ db, config, logger }));
  const gamesServer = http.createServer({ requestTimeout: 60_000 }, createGamesApp({ db, config, logger }));
  tuneServer(siteServer, { requestTimeoutMs: 30 * 60_000, maxRequestsPerSocket: 1000 });
  tuneServer(gamesServer, { requestTimeoutMs: 60_000, maxRequestsPerSocket: 10_000 });
  // Durante el apagado, pedir al cliente que no reutilice la conexión.
  for (const s of [siteServer, gamesServer]) s.prependListener('request', (req, res) => {
    if (ctx.state.shuttingDown) res.setHeader('Connection', 'close');
  });
  for (const s of [siteServer, gamesServer]) s.on('clientError', (err, socket) => {
    if (socket.writable && !socket.headersSent) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });

  // ROLE=games serves only the games origin, on PORT (one public port per service on hosts like Render).
  const siteAddr = config.role === 'games' ? {} : await listen(siteServer, config.port, config.host);
  const gamesAddr = config.role === 'site' ? {} : await listen(gamesServer, config.role === 'games' ? config.port : config.gamesPort, config.host);
  logger.info('server.listening', {
    role: config.role, site: config.siteOrigin, games: config.gamesOrigin, sitePort: siteAddr.port, gamesPort: gamesAddr.port, env: config.env,
  });

  // Mantenimiento periódico
  const maintenance = () => {
    try {
      const s = ctx.sessions.purgeExpired();
      const a = ctx.audit.purgeOld();
      const u = ctx.games.purgeRequests();
      if (s || a || u) logger.info('maintenance.purged', { sessions: s, audit: a, uploadRequests: u });
    } catch (err) { logger.error('maintenance.failed', { err }); }
  };
  maintenance();
  const timer = setInterval(maintenance, 10 * 60_000);
  timer.unref();

  let shuttingDown = null;
  /** Deja de aceptar conexiones, espera a las peticiones en curso (máx. 10 s) y cierra la BD. */
  function shutdown(reason = 'shutdown') {
    if (shuttingDown) return shuttingDown;
    ctx.state.shuttingDown = true;
    logger.info('server.shutting_down', { reason });
    clearInterval(timer);
    const closeOne = (server) => new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
      server.closeIdleConnections();
    });
    shuttingDown = (async () => {
      const force = setTimeout(() => {
        logger.warn('server.forcing_close');
        siteServer.closeAllConnections();
        gamesServer.closeAllConnections();
      }, SHUTDOWN_GRACE_MS);
      force.unref();
      // Las conexiones keep-alive que quedan ociosas tras responder se cierran en cuanto lo están.
      const idle = setInterval(() => { siteServer.closeIdleConnections(); gamesServer.closeIdleConnections(); }, 100);
      idle.unref();
      await Promise.all([closeOne(siteServer), closeOne(gamesServer)]);
      clearInterval(idle);
      clearTimeout(force);
      try { db.close(); } catch (err) { logger.error('db.close_failed', { err }); }
      logger.info('server.stopped');
    })();
    return shuttingDown;
  }

  return { config, db, ctx, siteServer, gamesServer, sitePort: siteAddr.port, gamesPort: gamesAddr.port, shutdown };
}

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const log = createLogger({ level: config.logLevel });
  process.on('unhandledRejection', (reason) => {
    log.error('process.unhandled_rejection', { err: reason instanceof Error ? reason : { message: String(reason) } });
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    log.error('process.uncaught_exception', { err });
    process.exit(1);
  });
  let handle;
  try {
    handle = await startServer({ config, logger: log });
  } catch (err) {
    log.error('server.start_failed', { err });
    process.exit(1);
  }
  const stop = (signal) => {
    handle.shutdown(signal).then(() => process.exit(0), (err) => { log.error('server.shutdown_failed', { err }); process.exit(1); });
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS + 2000).unref();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

const isMain = import.meta.main ?? (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMain) main();
