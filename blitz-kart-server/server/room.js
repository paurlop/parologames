// One private room: lobby state, the authoritative race simulation and the
// per-player input queues. The RoomManager (rooms.js) owns the rooms, the
// fixed-step clock and the cleanup timers; a Room never schedules its own ticks.

import crypto from 'node:crypto';
import { RACE, DRIVERS, PAINTS, FINISHES, SPOILERS, BODIES, WHEELS, DT } from '../shared/config.js';
import { buildTrack } from '../shared/track.js';
import { RaceSim } from '../shared/race.js';
import { TRACKS, DEFAULT_TRACK } from '../shared/tracks/index.js';
import {
  S2C, ERR, PHASES, SNAPSHOT_HZ, decodeInput, encodeKart, encodeProjectile, encodeHazard, encodeBoxes, encodeEvent,
  sanitizeName, cleanLook,
} from '../shared/protocol.js';

const INPUT_QUEUE_MAX = 8;
const NO_INPUT = Object.freeze({ throttle: 0, brake: 0, steer: 0, drift: 0, item: 0 });
const MAX_EVENTS_PER_SNAPSHOT = 96;

const trackCache = new Map();
function getTrack(id) {
  let t = trackCache.get(id);
  if (!t) { t = buildTrack(TRACKS[id]); trackCache.set(id, t); }
  return t;
}

export class Room {
  constructor(manager, code) {
    this.mgr = manager;
    this.code = code;
    this.players = [];        // humans, join order
    this.hostId = null;
    this.state = 'lobby';     // 'lobby' | 'race'
    this.options = { track: DEFAULT_TRACK, laps: TRACKS[DEFAULT_TRACK].laps ?? RACE.laps, items: true, bots: 0, botLevel: 'normal' };
    this.botSlots = [];       // lobby preview of CPU entrants
    this.race = null;
    this.lastActivity = Date.now();
    this.closed = false;
  }

  get log() { return this.mgr.log; }
  connectedPlayers() { return this.players.filter((p) => p.connected); }
  playerById(id) { return this.players.find((p) => p.id === id); }

  // ------------------------------------------------------------ membership
  addPlayer(conn, name, look) {
    if (this.state !== 'lobby') return { error: ERR.RACE_IN_PROGRESS };
    if (this.players.length >= RACE.maxKarts) return { error: ERR.ROOM_FULL };
    const p = {
      id: this.mgr.nextId('p'),
      token: crypto.randomBytes(16).toString('hex'),
      name: sanitizeName(name),
      look: cleanLook(look),
      ready: false,
      conn,
      connected: true,
      discTimer: null,
      // race input state
      queue: [], lastSeq: -1, ack: -1, lastInput: NO_INPUT,
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    this.trimBots();
    conn.player = p; conn.room = this;
    this.touch();
    this.log(`room ${this.code}: ${p.id} "${p.name}" joined (${this.players.length} players)`);
    conn.send({ t: S2C.JOINED, code: this.code, id: p.id, token: p.token, rejoin: false });
    this.broadcastLobby();
    return { player: p };
  }

  rejoin(conn, token) {
    const p = this.players.find((x) => x.token === token);
    if (!p) return { error: ERR.REJOIN_FAILED };
    if (p.conn && p.conn !== conn) {
      // a stale socket for the same player (e.g. duplicate tab): replace it
      const old = p.conn;
      old.player = null; old.room = null;
      old.send({ t: S2C.LEFT, reason: 'replaced' });
      old.close(4000, 'replaced');
    }
    clearTimeout(p.discTimer); p.discTimer = null;
    p.conn = conn; p.connected = true;
    conn.player = p; conn.room = this;
    // fresh input stream: the client restarts its history after a reconnect
    p.queue = []; p.lastSeq = -1; p.ack = -1; p.lastInput = NO_INPUT;
    if (!this.playerById(this.hostId)?.connected) this.hostId = p.id;
    if (this.race) {
      const k = this.race.sim.kartById(p.id);
      if (k && !k.left) k.connected = 1;
    }
    this.touch();
    this.log(`room ${this.code}: ${p.id} rejoined`);
    conn.send({ t: S2C.JOINED, code: this.code, id: p.id, token: p.token, rejoin: true });
    this.broadcastLobby();
    if (this.race) conn.send(this.raceStartMsg(p.id, true));
    return { player: p };
  }

  /** Socket closed without an explicit leave: keep the slot for a while. */
  disconnected(p) {
    if (!this.players.includes(p)) return;
    p.conn = null; p.connected = false; p.ready = false;
    p.queue = []; p.lastInput = NO_INPUT;
    if (this.race) {
      const k = this.race.sim.kartById(p.id);
      if (k) k.connected = 0;
    }
    clearTimeout(p.discTimer);
    p.discTimer = setTimeout(() => this.removePlayer(p, 'timeout'), this.mgr.opts.reconnectGraceMs);
    p.discTimer.unref?.();
    this.migrateHost();
    this.log(`room ${this.code}: ${p.id} disconnected (slot kept ${Math.round(this.mgr.opts.reconnectGraceMs / 1000)}s)`);
    this.broadcastLobby();
    this.checkAbandoned();
  }

  removePlayer(p, reason) {
    const i = this.players.indexOf(p);
    if (i < 0) return;
    this.players.splice(i, 1);
    clearTimeout(p.discTimer); p.discTimer = null;
    if (p.conn) { p.conn.player = null; p.conn.room = null; }
    p.conn = null; p.connected = false;
    if (this.race) {
      const k = this.race.sim.kartById(p.id);
      if (k) { k.connected = 0; k.left = 1; }
    }
    this.log(`room ${this.code}: ${p.id} left (${reason})`);
    if (this.players.length === 0) { this.mgr.closeRoom(this, 'empty'); return; }
    this.migrateHost();
    this.trimBots();
    this.broadcastLobby();
    this.checkAbandoned();
  }

  migrateHost() {
    const host = this.playerById(this.hostId);
    if (host && host.connected) return;
    const next = this.players.find((p) => p.connected) || host || this.players[0];
    if (next && next.id !== this.hostId) {
      this.hostId = next.id;
      this.log(`room ${this.code}: host is now ${next.id}`);
    }
  }

  /** A race with no connected humans left must not run forever. */
  checkAbandoned() {
    if (!this.race) return;
    if (this.players.length === 0) this.endRace('abandoned');
  }

  touch() { this.lastActivity = Date.now(); }

  // ------------------------------------------------------------ lobby
  trimBots() {
    const max = Math.max(0, RACE.maxKarts - this.players.length);
    if (this.options.bots > max) this.options.bots = max;
    this.syncBotSlots();
  }

  syncBotSlots() {
    while (this.botSlots.length > this.options.bots) this.botSlots.pop();
    while (this.botSlots.length < this.options.bots) {
      const i = this.botSlots.length;
      const used = new Set(this.players.map((p) => p.look.driver));
      const free = DRIVERS.filter((d) => !used.has(d.id) && !this.botSlots.some((b) => b.look.driver === d.id));
      const drv = free[i % Math.max(1, free.length)] || DRIVERS[i % DRIVERS.length];
      const bodies = Object.keys(BODIES), wheels = Object.keys(WHEELS);
      this.botSlots.push({
        id: this.mgr.nextId('cpu'),
        name: `CPU ${drv.name}`,
        isBot: true,
        look: {
          body: bodies[i % bodies.length], wheels: wheels[i % wheels.length],
          paint: PAINTS[(i * 3 + 1) % PAINTS.length], accent: PAINTS[(i * 7 + 9) % PAINTS.length],
          finish: FINISHES[i % FINISHES.length], spoiler: SPOILERS[(i + 1) % SPOILERS.length], driver: drv.id,
        },
      });
    }
  }

  lobbyMsg() {
    return {
      t: S2C.LOBBY,
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      maxPlayers: RACE.maxKarts,
      opts: { ...this.options },
      tracks: Object.values(TRACKS).map((d) => ({ id: d.id, name: d.name })),
      players: this.players.map((p) => ({
        id: p.id, name: p.name, look: p.look, ready: p.ready, host: p.id === this.hostId, connected: p.connected, isBot: false,
      })),
      bots: this.botSlots.map((b) => ({ id: b.id, name: b.name, look: b.look, isBot: true, ready: true, connected: true })),
    };
  }

  broadcastLobby() {
    if (this.closed) return;
    const s = JSON.stringify(this.lobbyMsg());
    for (const p of this.players) p.conn?.sendRaw(s);
  }

  handle(p, msg) {
    switch (msg.t) {
      case 'ready':
        if (this.state !== 'lobby') return;
        p.ready = msg.ready;
        this.touch();
        this.broadcastLobby();
        return;
      case 'opts': {
        if (p.id !== this.hostId) return p.conn?.error(ERR.NOT_HOST);
        if (this.state !== 'lobby') return p.conn?.error(ERR.RACE_IN_PROGRESS);
        const o = this.options;
        if (msg.track !== undefined) o.track = msg.track;
        if (msg.laps !== undefined) o.laps = msg.laps;
        if (msg.items !== undefined) o.items = msg.items;
        if (msg.botLevel !== undefined) o.botLevel = msg.botLevel;
        if (msg.bots !== undefined) o.bots = Math.min(msg.bots, RACE.maxKarts - this.players.length);
        this.syncBotSlots();
        this.touch();
        this.broadcastLobby();
        return;
      }
      case 'start': {
        if (p.id !== this.hostId) return p.conn?.error(ERR.NOT_HOST);
        if (this.state !== 'lobby') return p.conn?.error(ERR.RACE_IN_PROGRESS);
        const live = this.connectedPlayers();
        if (!live.length || !live.every((x) => x.ready)) return p.conn?.error(ERR.NOT_READY);
        this.startRace();
        return;
      }
      case 'in':
        this.queueInput(p, msg.q);
        return;
    }
  }

  // ------------------------------------------------------------ race
  startRace() {
    // players still disconnected in the lobby do not take part
    for (const p of [...this.players]) if (!p.connected) this.removePlayer(p, 'not connected at start');
    if (this.closed || !this.players.length) return;
    this.trimBots();
    const o = this.options;
    const track = getTrack(o.track);
    const entrants = this.players.map((p) => ({
      id: p.id, name: p.name, driver: p.look.driver, body: p.look.body, wheels: p.look.wheels, look: p.look,
      bot: null, human: true,
    }));
    for (const b of this.botSlots) {
      entrants.push({ id: b.id, name: b.name, driver: b.look.driver, body: b.look.body, wheels: b.look.wheels, look: b.look, bot: o.botLevel, human: false });
    }
    const seed = crypto.randomBytes(4).readUInt32LE(0);
    const sim = new RaceSim({ track, entrants, laps: o.laps, seed, items: o.items });
    this.race = {
      raceId: this.mgr.nextId('r'),
      sim, entrants,
      pendingEvents: [],
      startedAt: Date.now(),
      acc: 0,
      lastNow: this.mgr.now(),
      ticksPerSnapshot: Math.max(1, Math.round(1 / DT / SNAPSHOT_HZ)),
    };
    for (const p of this.players) { p.queue = []; p.lastSeq = -1; p.ack = -1; p.lastInput = NO_INPUT; }
    this.state = 'race';
    this.touch();
    this.log(`room ${this.code}: race ${this.race.raceId} started (${track.id}, ${o.laps} laps, ${this.players.length} humans, ${this.botSlots.length} bots, items ${o.items ? 'on' : 'off'})`);
    this.broadcastLobby();
    for (const p of this.players) p.conn?.send(this.raceStartMsg(p.id, false));
    this.mgr.raceStarted(this);
  }

  raceStartMsg(localId, rejoin) {
    const r = this.race;
    return {
      t: S2C.RACE_START,
      raceId: r.raceId,
      track: this.options.track,
      laps: r.sim.laps,
      items: r.sim.itemsOn,
      localId,
      rejoin,
      tick: r.sim.tick,
      time: r.sim.time,
      roster: r.sim.karts.map((k) => ({
        id: k.id, name: k.name, driver: k.driver, body: k.body, wheels: k.wheels, look: k.look,
        human: k.human, isBot: k.isBot, connected: k.connected,
      })),
    };
  }

  queueInput(p, q) {
    if (!this.race || !p.connected) return;
    const [seq, bits, steer] = q;
    if (seq <= p.lastSeq) return; // duplicate / out of order
    p.lastSeq = seq;
    p.queue.push({ seq, input: decodeInput(bits, steer) });
    while (p.queue.length > INPUT_QUEUE_MAX) p.queue.shift();
  }

  /** Advance the authoritative clock. Called by the manager's loop. */
  update(now) {
    const r = this.race;
    if (!r) return;
    const opts = this.mgr.opts;
    let elapsed = (now - r.lastNow) / 1000;
    r.lastNow = now;
    if (elapsed < 0) elapsed = 0;
    r.acc += elapsed * opts.timeScale;
    const maxSteps = Math.ceil(0.25 * opts.timeScale / DT);
    let steps = 0;
    while (r.acc >= DT && this.race === r) {
      r.acc -= DT;
      this.tickOnce();
      if (++steps >= maxSteps) { r.acc = 0; break; } // hopelessly behind: drop time instead of spiralling
    }
  }

  tickOnce() {
    const r = this.race;
    const sim = r.sim;
    const inputs = new Map();
    for (const p of this.players) {
      if (!p.connected) continue;
      const next = p.queue.shift();
      if (next) { p.lastInput = next.input; p.ack = next.seq; p.starved = 0; }
      else p.starved = (p.starved || 0) + 1;
      // A client that stops sending (background tab, frozen page) coasts with neutral
      // input after ~250 ms instead of holding its last throttle/steer into a wall.
      inputs.set(p.id, p.starved > 15 ? NO_INPUT : p.lastInput);
    }
    sim.step(inputs);
    for (const e of sim.events) {
      if (r.pendingEvents.length < MAX_EVENTS_PER_SNAPSHOT || e.type === 'finish' || e.type === 'raceEnd' || e.type === 'lap') r.pendingEvents.push(encodeEvent(e));
    }
    if (sim.phase !== 'finished' && sim.time > this.mgr.opts.maxRaceSeconds) {
      this.log(`room ${this.code}: race ${r.raceId} hit the time cap`);
      sim.phase = 'finished';
      r.pendingEvents.push({ type: 'raceEnd' });
    }
    if (sim.phase === 'finished' || sim.tick % r.ticksPerSnapshot === 0) this.sendSnapshot();
    if (sim.phase === 'finished') this.endRace('finished');
  }

  sendSnapshot() {
    const r = this.race, sim = r.sim;
    const body = JSON.stringify({
      k: sim.tick,
      tm: Math.round(sim.time * 1e6) / 1e6,
      ph: PHASES.indexOf(sim.phase),
      ka: sim.karts.map(encodeKart),
      pr: sim.projectiles.map(encodeProjectile),
      hz: sim.hazards.map(encodeHazard),
      bx: encodeBoxes(sim.boxes),
      ev: r.pendingEvents,
    });
    r.pendingEvents = [];
    const tail = body.slice(1);
    for (const p of this.players) {
      if (p.conn) p.conn.sendRaw(`{"t":"${S2C.SNAPSHOT}","a":${p.ack},${tail}`);
    }
  }

  endRace(reason) {
    const r = this.race;
    if (!r) return;
    const sim = r.sim;
    this.race = null;
    this.state = 'lobby';
    this.mgr.raceEnded(this);
    const results = sim.results().map((x) => {
      const k = sim.kartById(x.id);
      return { ...x, dnf: !k.finished && (!k.connected || !!k.left) };
    });
    this.log(`room ${this.code}: race ${r.raceId} ended (${reason}); winner ${results[0]?.name ?? '-'} ${results[0]?.time?.toFixed(2) ?? ''}s`);
    for (const p of this.players) p.ready = false;
    this.touch();
    if (this.closed) return;
    const msg = JSON.stringify({ t: S2C.RESULTS, raceId: r.raceId, reason, track: this.options.track, laps: sim.laps, results });
    for (const p of this.players) p.conn?.sendRaw(msg);
    this.broadcastLobby();
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    if (this.race) { this.race = null; this.mgr.raceEnded(this); }
    for (const p of this.players) {
      clearTimeout(p.discTimer); p.discTimer = null;
      if (p.conn) {
        p.conn.error(ERR.ROOM_CLOSED, reason);
        p.conn.send({ t: S2C.LEFT, reason });
        p.conn.player = null; p.conn.room = null;
      }
    }
    this.players = [];
  }
}
