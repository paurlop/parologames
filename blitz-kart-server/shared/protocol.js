// Blitz Kart wire protocol. Shared by the Node server (server/**) and the browser
// client (src/net/**). Everything is JSON text frames; every frame is an object
// with a short `t` (type) field.
//
// Clients only ever send intentions (lobby actions and encoded inputs). The server
// owns positions, speeds, laps, items and results; nothing else is accepted.

import { KART_FIELDS } from './kart.js';
import { ITEM_KEYS } from './race.js';
import { RACE, sanitizeLook } from './config.js';
import { TRACKS } from './tracks/index.js';

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 1024;
export const SNAPSHOT_HZ = 20;

// ---------------------------------------------------------------- message types
/** client → server */
export const C2S = {
  CREATE: 'create',   // { t, name, look }
  JOIN: 'join',       // { t, code, name, look }
  REJOIN: 'rejoin',   // { t, code, token }
  READY: 'ready',     // { t, ready: bool }
  OPTIONS: 'opts',    // { t, track?, laps?, items?, bots?, botLevel? }   (host only)
  START: 'start',     // { t }                                            (host only)
  LEAVE: 'leave',     // { t }
  INPUT: 'in',        // { t, q: [seq, bits, steerQ] }
  PING: 'ping',       // { t, c: clientTimeMs }
};

/** server → client */
export const S2C = {
  JOINED: 'joined',       // { t, code, id, token, rejoin }
  LOBBY: 'lobby',         // { t, code, hostId, state, players[], bots[], opts, maxPlayers }
  RACE_START: 'raceStart',// { t, raceId, track, laps, items, localId, roster[], rejoin }
  SNAPSHOT: 'snap',       // { t, a: ack, k: tick, tm: time, ph: phaseIdx, ka[], pr[], hz[], bx[], ev[] }
  RESULTS: 'results',     // { t, raceId, track, laps, results[] }
  LEFT: 'left',           // { t, reason }  you are no longer in a room
  ERROR: 'error',         // { t, code, msg? }
  PONG: 'pong',           // { t, c, s }
};

export const ERR = {
  BAD_MESSAGE: 'BAD_MESSAGE',
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  RACE_IN_PROGRESS: 'RACE_IN_PROGRESS',
  NOT_HOST: 'NOT_HOST',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  ALREADY_IN_ROOM: 'ALREADY_IN_ROOM',
  NOT_READY: 'NOT_READY',
  SERVER_FULL: 'SERVER_FULL',
  REJOIN_FAILED: 'REJOIN_FAILED',
  ROOM_CLOSED: 'ROOM_CLOSED',
  NOT_RACING: 'NOT_RACING',
};

export const PHASES = ['countdown', 'racing', 'finished'];
export const PROJECTILE_TYPES = ['orb', 'seeker'];
export const HAZARD_TYPES = ['mine', 'frost'];
export const BOT_LEVELS = ['easy', 'normal', 'hard'];

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const ROOM_CODE_LENGTH = 5;
export const NAME_MAX = 16;
export const LAPS_MIN = 1, LAPS_MAX = 5;

// ---------------------------------------------------------------- names / codes
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g;

export function sanitizeName(name) {
  if (typeof name !== 'string') return 'Racer';
  const s = Array.from(name.replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim()).slice(0, NAME_MAX).join('').trim();
  return s || 'Racer';
}

export function normalizeCode(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase();
  if (c.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of c) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return c;
}

// ---------------------------------------------------------------- inputs
export const IN_THROTTLE = 1, IN_BRAKE = 2, IN_DRIFT = 4, IN_ITEM = 8;
export const STEER_Q = 127;

/** input struct → [bits, steerQ] */
export function encodeInput(input) {
  const i = input || {};
  const bits = (i.throttle ? IN_THROTTLE : 0) | (i.brake ? IN_BRAKE : 0) | (i.drift ? IN_DRIFT : 0) | (i.item ? IN_ITEM : 0);
  let st = Number(i.steer) || 0;
  st = Math.max(-1, Math.min(1, st));
  return [bits, Math.round(st * STEER_Q)];
}

/** [bits, steerQ] → input struct (exactly what the server feeds the simulation) */
export function decodeInput(bits, steerQ, out = {}) {
  out.throttle = bits & IN_THROTTLE ? 1 : 0;
  out.brake = bits & IN_BRAKE ? 1 : 0;
  out.drift = bits & IN_DRIFT ? 1 : 0;
  out.item = bits & IN_ITEM ? 1 : 0;
  out.steer = Math.max(-1, Math.min(1, steerQ / STEER_Q));
  return out;
}

// ---------------------------------------------------------------- snapshots
// Kart array layout: [id, ...SNAP_KART_FIELDS]
export const RACE_FIELDS = ['lap', 'nextCp', 'sec', 'place', 'finished', 'finishTime', 'bestLap', 'item', 'itemUses',
  'roulette', 's', 'd', 'offroad', 'wrongT', 'connected', 'startCharge'];
export const SNAP_KART_FIELDS = [...KART_FIELDS, ...RACE_FIELDS];

const r4 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : 0);
const r2 = (v) => Math.round(v * 100) / 100;

export function encodeKart(k) {
  const a = new Array(SNAP_KART_FIELDS.length + 1);
  a[0] = k.id;
  for (let i = 0; i < SNAP_KART_FIELDS.length; i++) {
    const f = SNAP_KART_FIELDS[i];
    let v = k[f];
    if (f === 'item') v = v ? ITEM_KEYS.indexOf(v) : -1;
    else if (typeof v === 'boolean') v = v ? 1 : 0;
    a[i + 1] = r4(v ?? 0);
  }
  return a;
}

export function decodeKart(a, out = {}) {
  out.id = a[0];
  for (let i = 0; i < SNAP_KART_FIELDS.length; i++) {
    const f = SNAP_KART_FIELDS[i];
    const v = a[i + 1];
    out[f] = f === 'item' ? (v >= 0 ? ITEM_KEYS[v] ?? null : null) : v;
  }
  return out;
}

export function encodeProjectile(p) {
  return [p.id, PROJECTILE_TYPES.indexOf(p.type), r2(p.x), r2(p.y), r2(p.z), r4(p.vh), r2(p.speed)];
}
export function decodeProjectile(a, out = {}) {
  out.id = a[0]; out.type = PROJECTILE_TYPES[a[1]] || 'orb';
  out.x = a[2]; out.y = a[3]; out.z = a[4]; out.vh = a[5]; out.speed = a[6];
  return out;
}

export function encodeHazard(h) {
  return [h.id, HAZARD_TYPES.indexOf(h.type), r2(h.x), r2(h.y), r2(h.z), r2(h.r), r2(h.life)];
}
export function decodeHazard(a, out = {}) {
  out.id = a[0]; out.type = HAZARD_TYPES[a[1]] || 'mine';
  out.x = a[2]; out.y = a[3]; out.z = a[4]; out.r = a[5]; out.life = a[6];
  return out;
}

/** active flags of item boxes → array of 30-bit integers */
export function encodeBoxes(boxes) {
  const out = new Array(Math.ceil(boxes.length / 30)).fill(0);
  boxes.forEach((b, i) => { if (b.active) out[(i / 30) | 0] |= 1 << (i % 30); });
  return out;
}
export function boxActive(mask, i) {
  return (mask[(i / 30) | 0] >> (i % 30)) & 1;
}

/** Copy an event with rounded numbers so snapshots stay small. */
export function encodeEvent(e) {
  const o = {};
  for (const key in e) {
    const v = e[key];
    o[key] = typeof v === 'number' ? r2(v) : v;
  }
  return o;
}

// ---------------------------------------------------------------- validation
const LOOK_KEYS = ['body', 'wheels', 'paint', 'accent', 'finish', 'spoiler', 'driver'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function validLook(look) {
  if (look === undefined) return true;
  if (!isObj(look)) return false;
  const keys = Object.keys(look);
  if (keys.length > LOOK_KEYS.length) return false;
  for (const k of keys) {
    if (!LOOK_KEYS.includes(k)) return false;
    const v = look[k];
    if (typeof v === 'string') { if (v.length > 24) return false; }
    else if (!isInt(v, 0, 0xffffff)) return false;
  }
  return true;
}
const validName = (n) => n === undefined || (typeof n === 'string' && n.length <= 64);

// type → { allowed keys (besides t), check(msg) }
const SCHEMAS = {
  [C2S.CREATE]: { keys: ['name', 'look'], check: (m) => validName(m.name) && validLook(m.look) },
  [C2S.JOIN]: { keys: ['code', 'name', 'look'], check: (m) => typeof m.code === 'string' && m.code.length <= 8 && validName(m.name) && validLook(m.look) },
  [C2S.REJOIN]: { keys: ['code', 'token'], check: (m) => typeof m.code === 'string' && m.code.length <= 8 && typeof m.token === 'string' && /^[0-9a-f]{32}$/.test(m.token) },
  [C2S.READY]: { keys: ['ready'], check: (m) => typeof m.ready === 'boolean' },
  [C2S.OPTIONS]: {
    keys: ['track', 'laps', 'items', 'bots', 'botLevel'],
    check: (m) => (m.track === undefined || (typeof m.track === 'string' && m.track.length <= 40 && Object.hasOwn(TRACKS, m.track)))
      && (m.laps === undefined || isInt(m.laps, LAPS_MIN, LAPS_MAX))
      && (m.items === undefined || typeof m.items === 'boolean')
      && (m.bots === undefined || isInt(m.bots, 0, RACE.maxKarts - 1))
      && (m.botLevel === undefined || BOT_LEVELS.includes(m.botLevel)),
  },
  [C2S.START]: { keys: [], check: () => true },
  [C2S.LEAVE]: { keys: [], check: () => true },
  [C2S.INPUT]: {
    keys: ['q'],
    check: (m) => Array.isArray(m.q) && m.q.length === 3 && isInt(m.q[0], 0, 0x7fffffff) && isInt(m.q[1], 0, 15) && isInt(m.q[2], -STEER_Q, STEER_Q),
  },
  [C2S.PING]: { keys: ['c'], check: (m) => typeof m.c === 'number' && Number.isFinite(m.c) },
};

/**
 * Parse and strictly validate one client frame.
 * @param {string|Buffer} data
 * @returns {{ok: true, msg: object} | {ok: false, reason: string}}
 */
export function parseClientMessage(data) {
  const len = typeof data === 'string' ? data.length : data?.length ?? 0;
  if (len === 0 || len > MAX_MESSAGE_BYTES) return { ok: false, reason: 'size' };
  let msg;
  try { msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8')); } catch { return { ok: false, reason: 'json' }; }
  return validateClientMessage(msg);
}

export function validateClientMessage(msg) {
  if (!isObj(msg)) return { ok: false, reason: 'not an object' };
  if (typeof msg.t !== 'string' || !Object.hasOwn(SCHEMAS, msg.t)) return { ok: false, reason: 'unknown type' };
  const schema = SCHEMAS[msg.t];
  for (const k of Object.keys(msg)) {
    if (k !== 't' && !schema.keys.includes(k)) return { ok: false, reason: `unexpected field ${k.slice(0, 20)}` };
  }
  if (!schema.check(msg)) return { ok: false, reason: `invalid ${msg.t}` };
  return { ok: true, msg };
}

/** look from a client → whitelisted look */
export function cleanLook(look) {
  return sanitizeLook(isObj(look) ? look : {});
}
