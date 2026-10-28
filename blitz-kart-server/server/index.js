// Blitz Kart server: HTTP (static Vite build from ./dist) + WebSocket game
// server on /ws, in one process. The race simulation runs here authoritatively;
// clients only send lobby actions and inputs.
//
//   PORT=8787 node server/index.js
//   ALLOWED_ORIGINS=https://kart.example.com,https://www.kart.example.com
//   TRUST_PROXY=1   (use X-Forwarded-For for the per-IP cap behind a reverse proxy)

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './rooms.js';
import { createStaticHandler, sendText } from './static.js';
import { C2S, S2C, ERR, MAX_MESSAGE_BYTES, parseClientMessage, normalizeCode } from '../shared/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULTS = {
  port: 8787,
  host: undefined,
  distDir: path.resolve(__dirname, '..', 'dist'),
  allowedOrigins: null,          // array of exact origins, or null = allow all
  trustProxy: false,
  maxRooms: 200,
  maxConnections: 2000,
  maxPerIp: 6,
  inputRate: 75,                 // inputs per second (token bucket refill)
  inputBurst: 90,
  msgRate: 10,                   // other messages per second
  msgBurst: 20,
  strikeLimit: 100,              // dropped/invalid messages before the socket is closed
  heartbeatMs: 5000,
  reconnectGraceMs: 30000,
  lobbyIdleMs: 15 * 60 * 1000,
  maxRaceSeconds: 15 * 60,
  timeScale: 1,                  // tests only: run the simulation faster than real time
  loopIntervalMs: 4,
  log: true,
};

class TokenBucket {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.tokens = burst; this.last = Date.now(); }
  take() {
    const t = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

class Conn {
  constructor(ws, ip, server) {
    this.ws = ws;
    this.ip = ip;
    this.srv = server;
    this.alive = true;
    this.player = null;
    this.room = null;
    const o = server.opts;
    this.inputs = new TokenBucket(o.inputRate, o.inputBurst);
    this.msgs = new TokenBucket(o.msgRate, o.msgBurst);
    this.strikes = 0;
    this.strikeT = Date.now();
    this.lastRateWarn = 0;
  }

  sendRaw(s) {
    const ws = this.ws;
    if (ws.readyState !== WebSocket.OPEN) return;
    // slow consumer: skip frames rather than buffering without bound
    if (ws.bufferedAmount > 512 * 1024) {
      if (ws.bufferedAmount > 4 * 1024 * 1024) ws.terminate();
      return;
    }
    ws.send(s);
  }
  send(obj) { this.sendRaw(JSON.stringify(obj)); }
  error(code, msg) { this.send(msg ? { t: S2C.ERROR, code, msg } : { t: S2C.ERROR, code }); }
  close(code, reason) { try { this.ws.close(code, reason); } catch { this.ws.terminate(); } }

  strike(n) {
    const t = Date.now();
    this.strikes = Math.max(0, this.strikes - ((t - this.strikeT) / 1000) * 2); // strikes fade at 2/s
    this.strikeT = t;
    this.strikes += n;
    if (this.strikes >= this.srv.opts.strikeLimit) {
      this.srv.log(`conn ${this.ip}: closed for abuse`);
      this.close(1008, 'rate limit');
      return true;
    }
    return false;
  }
}

function parseOrigins(s) {
  if (!s) return null;
  const list = s.split(',').map((x) => x.trim()).filter(Boolean);
  return list.length ? list : null;
}

/**
 * Start the HTTP + WebSocket server.
 * @returns {Promise<{port:number, close:() => Promise<void>, stats:() => object, manager: RoomManager}>}
 */
export function startServer(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const log = opts.log === false ? () => {} : typeof opts.log === 'function' ? opts.log : (m) => console.log(`[${new Date().toISOString()}] ${m}`);
  const manager = new RoomManager(opts, log);
  const serveStatic = createStaticHandler(opts.distDir);
  const conns = new Set();
  const perIp = new Map();

  const httpServer = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return sendText(res, 400, 'Bad Request'); }
    if (url.pathname === '/health') {
      return sendText(res, 200, JSON.stringify({ ok: true, ...manager.stats(), connections: conns.size }), 'application/json; charset=utf-8');
    }
    if (serveStatic) return serveStatic(req, res, url.pathname);
    if (url.pathname === '/') return sendText(res, 200, 'Blitz Kart game server is running. WebSocket endpoint: /ws\n');
    return sendText(res, 404, 'Not Found');
  });
  httpServer.headersTimeout = 15000;
  httpServer.requestTimeout = 30000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false, clientTracking: false });

  const clientIp = (req) => {
    if (opts.trustProxy) {
      const xf = req.headers['x-forwarded-for'];
      if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  };

  const reject = (socket, status, text) => {
    try { socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* ignore */ }
    socket.destroy();
  };

  httpServer.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return reject(socket, 400, 'Bad Request'); }
    if (pathname !== '/ws') return reject(socket, 404, 'Not Found');
    const origin = req.headers.origin;
    if (opts.allowedOrigins && origin && !opts.allowedOrigins.includes(origin)) {
      log(`rejected origin ${String(origin).slice(0, 80)}`);
      return reject(socket, 403, 'Forbidden');
    }
    if (conns.size >= opts.maxConnections) return reject(socket, 503, 'Service Unavailable');
    const ip = clientIp(req);
    if ((perIp.get(ip) || 0) >= opts.maxPerIp) return reject(socket, 429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip));
  });

  function onConnection(ws, ip) {
    const conn = new Conn(ws, ip, server);
    conns.add(conn);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    ws.on('pong', () => { conn.alive = true; });
    ws.on('message', (data, isBinary) => {
      conn.alive = true;
      try { onMessage(conn, data, isBinary); } catch (err) {
        log(`message handler error: ${err?.stack || err}`);
        conn.error(ERR.BAD_MESSAGE);
      }
    });
    ws.on('error', (err) => {
      // maxPayload violations and protocol errors land here; ws closes the socket itself
      log(`socket error from ${ip}: ${err?.code || err?.message || err}`);
    });
    ws.on('close', () => {
      conns.delete(conn);
      const n = (perIp.get(ip) || 1) - 1;
      if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
      const { room, player } = conn;
      conn.room = null; conn.player = null;
      if (room && player && player.conn === conn) room.disconnected(player);
    });
  }

  function onMessage(conn, data, isBinary) {
    if (isBinary) { conn.error(ERR.BAD_MESSAGE, 'binary'); conn.strike(10); return; }
    const parsed = parseClientMessage(data);
    if (!parsed.ok) {
      if (!conn.strike(10)) conn.error(ERR.BAD_MESSAGE, parsed.reason);
      return;
    }
    const msg = parsed.msg;
    const bucket = msg.t === C2S.INPUT ? conn.inputs : conn.msgs;
    if (!bucket.take()) {
      if (conn.strike(1)) return;
      const t = Date.now();
      if (t - conn.lastRateWarn > 1000) { conn.lastRateWarn = t; conn.error(ERR.RATE_LIMITED); }
      return;
    }
    const { room, player } = conn;
    switch (msg.t) {
      case C2S.PING:
        conn.send({ t: S2C.PONG, c: msg.c, s: Date.now() });
        return;
      case C2S.CREATE: {
        if (player) return conn.error(ERR.ALREADY_IN_ROOM);
        const r = manager.createRoom();
        if (r.error) return conn.error(r.error);
        r.room.addPlayer(conn, msg.name, msg.look);
        return;
      }
      case C2S.JOIN: {
        if (player) return conn.error(ERR.ALREADY_IN_ROOM);
        const code = normalizeCode(msg.code);
        const target = code && manager.get(code);
        if (!target) return conn.error(ERR.ROOM_NOT_FOUND);
        const r = target.addPlayer(conn, msg.name, msg.look);
        if (r.error) conn.error(r.error);
        return;
      }
      case C2S.REJOIN: {
        if (player) return conn.error(ERR.ALREADY_IN_ROOM);
        const code = normalizeCode(msg.code);
        const target = code && manager.get(code);
        if (!target) return conn.error(ERR.ROOM_NOT_FOUND);
        const r = target.rejoin(conn, msg.token);
        if (r.error) conn.error(r.error);
        return;
      }
      case C2S.LEAVE:
        if (!player) return;
        room.removePlayer(player, 'leave');
        conn.send({ t: S2C.LEFT, reason: 'leave' });
        return;
      default:
        if (!player || !room) { if (msg.t !== C2S.INPUT) conn.error(ERR.NOT_IN_ROOM); return; }
        room.handle(player, msg);
    }
  }

  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) { conn.ws.terminate(); continue; }
      conn.alive = false;
      try { conn.ws.ping(); } catch { /* closed */ }
    }
  }, opts.heartbeatMs);
  heartbeat.unref?.();

  const server = {
    opts,
    log,
    manager,
    port: 0,
    stats: () => ({ ...manager.stats(), connections: conns.size }),
    close: () => new Promise((resolve) => {
      clearInterval(heartbeat);
      manager.dispose();
      for (const c of conns) c.ws.terminate();
      conns.clear();
      wss.close();
      httpServer.close(() => resolve());
      httpServer.closeAllConnections?.();
    }),
  };

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port, opts.host, () => {
      httpServer.off('error', reject);
      server.port = httpServer.address().port;
      log(`Blitz Kart server listening on :${server.port} (ws path /ws, static ${serveStatic ? opts.distDir : 'disabled: no dist/'})`);
      resolve(server);
    });
  });
}

// Auto-start only when executed directly (node server/index.js), not when imported by tests.
const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const env = process.env;
  const server = await startServer({
    port: env.PORT ? Number(env.PORT) : DEFAULTS.port,
    host: env.HOST || undefined,
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  });
  const shutdown = (sig) => {
    server.log(`${sig} received, shutting down`);
    server.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
