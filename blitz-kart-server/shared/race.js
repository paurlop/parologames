// Race simulation: karts, laps/checkpoints, placings, items and hazards.
// Runs locally for solo races and on the server for online races. The renderer
// only reads from it (karts, projectiles, hazards, boxes, phase, time, events).

import { DT, RACE, ITEMS, ITEM_ODDS, PHYSICS, kartStats } from './config.js';
import { gridSlot, queryTrack } from './track.js';
import { createKart, stepKart, hitKart } from './kart.js';

// Split a collision velocity change into forward speed (damped) and sideways knock-back.
function applyBump(k, dvx, dvz) {
  if (k.respawnT > 0) return;
  const fx = Math.sin(k.vh), fz = Math.cos(k.vh);
  const along = dvx * fx + dvz * fz;
  k.speed += Math.min(0, along) * 0.6; // a hit can slow you down, never speed you up
  let lx = dvx - along * fx, lz = dvz - along * fz;
  k.bvx += lx; k.bvz += lz;
  const m = Math.hypot(k.bvx, k.bvz), cap = PHYSICS.bumpLateralMax;
  if (m > cap) { k.bvx *= cap / m; k.bvz *= cap / m; }
}
import { createBrain, botInput, steerAlongTrack } from './bot.js';

export const ITEM_KEYS = ['turbo', 'triturbo', 'shield', 'orb', 'seeker', 'mine', 'frost', 'comet'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NO_INPUT = { throttle: 0, brake: 0, steer: 0, drift: 0, item: 0 };
const q = {};

export class RaceSim {
  /**
   * @param {object} o
   * @param {object} o.track      built track (buildTrack)
   * @param {Array}  o.entrants   [{id, name, driver, body, wheels, bot: null|'easy'|'normal'|'hard', human: bool}]
   * @param {number} [o.laps]
   * @param {number} [o.seed]
   * @param {boolean} [o.items]   item boxes enabled
   */
  constructor({ track, entrants, laps, seed = 1, items = true }) {
    this.track = track;
    this.laps = laps ?? track.laps ?? RACE.laps;
    this.rng = mulberry32(seed);
    this.itemsOn = items;
    this.phase = 'countdown';
    this.time = -RACE.countdown;
    this.tick = 0;
    this.events = [];
    this.firstHumanFinish = null;
    this.nextEntityId = 1;
    this.projectiles = [];
    this.hazards = [];
    this.C = RACE.checkpoints;
    this.karts = entrants.map((e, i) => {
      const k = createKart(e.id, gridSlot(track, i), kartStats(e.body, e.wheels));
      Object.assign(k, {
        name: e.name, driver: e.driver, body: e.body, wheels: e.wheels, look: e.look || null,
        isBot: !!e.bot, human: !!e.human,
        lap: 0, nextCp: this.C, sec: this.C - 1, progress: 0, place: i + 1,
        finished: 0, finishTime: 0, lapTimes: [], lapStart: 0, bestLap: 0,
        item: null, itemUses: 0, roulette: 0, itemHeld: 0, prevItem: 0,
        startCharge: 0, connected: 1,
      });
      queryTrack(track, k.x, k.y, k.z, k.seg, q);
      k.s = q.s; k.d = q.d;
      if (e.bot) k.brain = createBrain(e.bot, this.rng);
      return k;
    });
    this.boxes = [];
    for (const row of track.zones.items) {
      const i = track.sampleAtS(row.s);
      const hw = track.HW[i] * 0.7;
      for (let b = 0; b < row.count; b++) {
        const d = row.count === 1 ? 0 : -hw + (2 * hw * b) / (row.count - 1);
        this.boxes.push({
          id: this.boxes.length,
          x: track.X[i] + (-track.TZ[i]) * d, y: track.Y[i] + 1.1, z: track.Z[i] + track.TX[i] * d,
          active: 1, t: 0,
        });
      }
    }
  }

  kartById(id) { return this.karts.find((k) => k.id === id); }

  /** Advance one fixed step. inputs: Map/obj id -> input for human karts. */
  step(inputs) {
    const dt = DT;
    this.events.length = 0;
    this.tick++;
    this.time += dt;
    const get = (id) => (inputs instanceof Map ? inputs.get(id) : inputs?.[id]) || NO_INPUT;

    if (this.phase === 'countdown') {
      for (const k of this.karts) {
        const inp = k.brain ? { throttle: this.time > -0.75 ? 1 : 0 } : get(k.id);
        // start boost: hold throttle in the final ~0.8s (holding too early wastes it)
        if (inp.throttle) k.startCharge += dt; else k.startCharge = 0;
      }
      if (this.time >= 0) {
        this.phase = 'racing';
        this.events.push({ type: 'go' });
        for (const k of this.karts) {
          if (k.startCharge > 0.15 && k.startCharge < 0.95) {
            k.boostT = 1.1; this.events.push({ type: 'boost', id: k.id, tier: 0, start: 1 });
          }
        }
      }
      return;
    }
    if (this.phase === 'finished') return;

    for (const k of this.karts) {
      let input;
      if (k.cometT > 0) {
        input = { throttle: 1, brake: 0, drift: 0, item: 0, steer: steerAlongTrack(this.track, k, 0, 1.3).steer };
      } else if (k.brain) {
        input = botInput(this, k, k.brain, dt);
      } else if (k.finished || !k.connected) {
        // finished or disconnected humans are driven by a calm autopilot
        k.brain = k.brain || null;
        input = { throttle: k.connected ? 1 : 0, brake: 0, drift: 0, item: 0, steer: steerAlongTrack(this.track, k, 0, 1.1).steer };
      } else {
        input = get(k.id);
      }
      stepKart(k, input, this.track, dt, this.events);
      this.updateItemsFor(k, input, dt);
      this.updateLap(k);
    }
    this.collideKarts();
    this.updateDraft(dt);
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updateBoxes(dt);
    this.updatePlaces();
    this.checkEnd();
  }

  updateLap(k) {
    if (k.finished) return;
    const sec = Math.floor((k.s / this.track.length) * this.C) % this.C;
    if (sec === k.sec) return;
    if (k.nextCp < this.C && sec === k.nextCp) {
      k.nextCp++;
    } else if (k.nextCp === this.C && k.sec === this.C - 1 && sec === 0) {
      k.lap++;
      k.nextCp = 1;
      if (k.lap > 1) {
        const lt = this.time - k.lapStart;
        k.lapTimes.push(lt);
        if (!k.bestLap || lt < k.bestLap) k.bestLap = lt;
      }
      k.lapStart = this.time;
      if (k.lap > this.laps) {
        k.finished = 1; k.finishTime = this.time;
        this.events.push({ type: 'finish', id: k.id, time: this.time });
        if (k.human && this.firstHumanFinish === null) this.firstHumanFinish = this.time;
      } else if (k.lap > 1) {
        this.events.push({ type: 'lap', id: k.id, lap: k.lap });
      }
    }
    k.sec = sec;
  }

  progressOf(k) {
    if (k.finished) return 1e9 - k.finishTime;
    const L = this.track.length;
    // before reaching checkpoint 1 a kart sitting in the last sector is still on the previous lap
    let s = k.s;
    if (k.nextCp <= 1 && k.sec === this.C - 1) s -= L;
    return (k.lap - 1) * L + s;
  }

  updatePlaces() {
    const sorted = [...this.karts].sort((a, b) => this.progressOf(b) - this.progressOf(a));
    sorted.forEach((k, i) => { k.place = i + 1; k.progress = this.progressOf(k); });
  }

  collideKarts() {
    const R = PHYSICS.kartRadius * 2;
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++) {
      const a = ks[i];
      if (a.respawnT > 0) continue;
      for (let j = i + 1; j < ks.length; j++) {
        const b = ks[j];
        if (b.respawnT > 0) continue;
        const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R || Math.abs(dy) > 1.6) continue;
        const d = Math.sqrt(d2) || 0.01, nx = dx / d, nz = dz / d, over = R - d;
        const wa = b.stats.weight / (a.stats.weight + b.stats.weight);
        a.x -= nx * over * wa; a.z -= nz * over * wa;
        b.x += nx * over * (1 - wa); b.z += nz * over * (1 - wa);
        if (a.cometT > 0 && b.cometT <= 0) { hitKart(b, this.events, 'comet'); continue; }
        if (b.cometT > 0 && a.cometT <= 0) { hitKart(a, this.events, 'comet'); continue; }
        // impulse along the contact normal, shared by weight (heavier karts shove lighter ones)
        const avx = Math.sin(a.vh) * a.speed + a.bvx, avz = Math.cos(a.vh) * a.speed + a.bvz;
        const bvx = Math.sin(b.vh) * b.speed + b.bvx, bvz = Math.cos(b.vh) * b.speed + b.bvz;
        const closing = (avx - bvx) * nx + (avz - bvz) * nz; // > 0: approaching each other
        if (closing <= 0.2) continue;
        const ma = a.stats.weight, mb = b.stats.weight;
        const J = (closing * (1 + PHYSICS.bumpRestitution)) / (1 / ma + 1 / mb);
        applyBump(a, -nx * J / ma, -nz * J / ma);
        applyBump(b, nx * J / mb, nz * J / mb);
        if (closing > 1.5) this.events.push({ type: 'bump', id: a.id, other: b.id, power: closing, x: (a.x + b.x) / 2, y: a.y + 0.5, z: (a.z + b.z) / 2 });
      }
    }
  }

  // Slipstream: following closely behind another kart charges a short boost.
  updateDraft(dt) {
    const D = PHYSICS.draft, cosCone = Math.cos(D.cone);
    for (const k of this.karts) {
      if (k.respawnT > 0 || !k.grounded || k.speed < D.minSpeed || k.boostT > 0 || k.cometT > 0 || k.finished) { k.draft = Math.max(0, k.draft - dt * 2); continue; }
      const fx = Math.sin(k.vh), fz = Math.cos(k.vh);
      let behind = false;
      for (const o of this.karts) {
        if (o === k || o.respawnT > 0) continue;
        const dx = o.x - k.x, dz = o.z - k.z, dist = Math.hypot(dx, dz);
        if (dist < D.minRange || dist > D.range || Math.abs(o.y - k.y) > 2) continue;
        if ((dx * fx + dz * fz) / dist < cosCone) continue;
        // the leader must be going roughly our way
        if (Math.sin(o.vh) * fx + Math.cos(o.vh) * fz < 0.8) continue;
        behind = true; break;
      }
      if (behind) {
        k.draft = Math.min(1, k.draft + dt / D.charge);
        if (k.draft >= 1) {
          k.boostT = Math.max(k.boostT, D.boost); k.draft = 0;
          this.events.push({ type: 'boost', id: k.id, tier: 0, draft: 1 });
        }
      } else k.draft = Math.max(0, k.draft - dt * 1.5);
    }
  }

  // ---------------- items ----------------
  rollItem(k) {
    const n = this.karts.length;
    const frac = n > 1 ? (k.place - 1) / (n - 1) : 0;
    const bucket = k.place === 1 || frac < 0.2 ? 'front' : frac >= 0.65 ? 'back' : 'mid';
    const table = ITEM_ODDS[bucket];
    let total = 0;
    for (const w of Object.values(table)) total += w;
    let r = this.rng() * total;
    let pick = 'turbo';
    for (const [key, w] of Object.entries(table)) { r -= w; if (r <= 0) { pick = key; break; } }
    // anti-chaining: Comet Drive has a per-kart cooldown
    if (pick === 'comet') {
      if (this.time - (k.lastComet ?? -1e9) < ITEMS.comet.cooldown) pick = 'turbo';
      else k.lastComet = this.time;
    }
    return pick;
  }

  updateItemsFor(k, input, dt) {
    if (k.roulette > 0) {
      k.roulette -= dt;
      if (k.roulette <= 0) {
        k.item = this.rollItem(k);
        k.itemUses = k.item === 'triturbo' ? 3 : 1;
        k.itemHeld = 0;
        this.events.push({ type: 'itemGet', id: k.id, item: k.item });
      }
    }
    if (k.item && k.roulette <= 0) k.itemHeld += dt;
    const pressed = input.item && !k.prevItem;
    k.prevItem = input.item ? 1 : 0;
    if (!pressed || !k.item || k.roulette > 0 || k.spinT > 0 || k.respawnT > 0) return;
    this.useItem(k, input);
  }

  useItem(k, input) {
    const it = k.item;
    const fx = Math.sin(k.vh), fz = Math.cos(k.vh);
    const back = input.brake && (it === 'orb');
    switch (it) {
      case 'turbo':
      case 'triturbo':
        k.boostT = Math.max(k.boostT, ITEMS.turbo.time);
        break;
      case 'shield':
        k.shieldT = ITEMS.shield.time;
        break;
      case 'orb': {
        const dir = back ? -1 : 1;
        this.projectiles.push({
          id: this.nextEntityId++, type: 'orb', owner: k.id,
          x: k.x + fx * 2.6 * dir, y: k.y + 0.7, z: k.z + fz * 2.6 * dir,
          vh: back ? k.vh + Math.PI : k.vh, speed: Math.max(ITEMS.orb.speed, k.speed * dir + 18),
          life: ITEMS.orb.life, age: 0, seg: k.seg, bounces: ITEMS.orb.bounces, target: null,
        });
        break;
      }
      case 'seeker': {
        const target = this.karts.find((o) => o.place === k.place - 1);
        this.projectiles.push({
          id: this.nextEntityId++, type: 'seeker', owner: k.id,
          x: k.x + fx * 2.6, y: k.y + 0.9, z: k.z + fz * 2.6, vh: k.vh, speed: ITEMS.seeker.speed,
          life: ITEMS.seeker.life, age: 0, seg: k.seg, bounces: 0, target: target ? target.id : null,
        });
        break;
      }
      case 'mine':
        this.hazards.push({
          id: this.nextEntityId++, type: 'mine', owner: k.id, age: 0,
          x: k.x - fx * ITEMS.mine.drop, z: k.z - fz * ITEMS.mine.drop, y: k.y,
          r: ITEMS.mine.radius, life: ITEMS.mine.life,
        });
        break;
      case 'frost':
        this.hazards.push({
          id: this.nextEntityId++, type: 'frost', owner: k.id, age: 0,
          x: k.x - fx * ITEMS.frost.drop, z: k.z - fz * ITEMS.frost.drop, y: k.y,
          r: ITEMS.frost.radius, life: ITEMS.frost.life,
        });
        break;
      case 'comet':
        k.cometT = ITEMS.comet.time;
        k.drift = 0; k.driftT = 0; k.tier = 0;
        break;
    }
    this.events.push({ type: 'itemUse', id: k.id, item: it });
    k.itemUses--;
    if (k.itemUses <= 0) { k.item = null; k.itemUses = 0; }
    else k.item = 'triturbo';
  }

  updateBoxes(dt) {
    if (!this.itemsOn) return;
    const r2 = ITEMS.pickupRadius * ITEMS.pickupRadius;
    for (const b of this.boxes) {
      if (!b.active) { b.t -= dt; if (b.t <= 0) b.active = 1; continue; }
      for (const k of this.karts) {
        if (k.respawnT > 0) continue;
        const dx = k.x - b.x, dz = k.z - b.z, dy = k.y + 0.6 - b.y;
        if (dx * dx + dz * dz < r2 && Math.abs(dy) < 2.2) {
          b.active = 0; b.t = ITEMS.boxRespawn;
          this.events.push({ type: 'box', id: k.id, box: b.id });
          // only one item at a time: holding an item means the box is simply broken
          if (!k.item && k.roulette <= 0 && !k.finished) k.roulette = ITEMS.rouletteTime;
          break;
        }
      }
    }
  }

  updateProjectiles(dt) {
    const tr = this.track;
    const keep = [];
    for (const p of this.projectiles) {
      p.age += dt; p.life -= dt;
      let alive = p.life > 0;
      if (p.type === 'seeker') {
        const t = p.target != null ? this.kartById(p.target) : null;
        let aim;
        if (t && !t.finished && Math.hypot(t.x - p.x, t.z - p.z) < 28) aim = Math.atan2(t.x - p.x, t.z - p.z);
        else {
          const i = (p.seg + 8) % tr.n;
          aim = Math.atan2(tr.X[i] - p.x, tr.Z[i] - p.z);
        }
        let d = aim - p.vh; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        p.vh += Math.max(-1, Math.min(1, d)) * ITEMS.seeker.turn * dt;
      }
      p.x += Math.sin(p.vh) * p.speed * dt;
      p.z += Math.cos(p.vh) * p.speed * dt;
      queryTrack(tr, p.x, p.y, p.z, p.seg, q);
      p.seg = q.seg;
      p.y += (q.y + 0.7 - p.y) * Math.min(1, 12 * dt);
      const lim = q.d > 0 ? q.edgeR - 0.6 : q.edgeL - 0.6;
      if (Math.abs(q.d) > lim) {
        const open = q.d > 0 ? q.flags & 8 : q.flags & 16;
        if (open) alive = false;
        else if (p.type === 'orb') {
          // reflect off the barrier
          const nx = -q.tz * Math.sign(q.d), nz = q.tx * Math.sign(q.d);
          let vx = Math.sin(p.vh), vz = Math.cos(p.vh);
          const dot = vx * nx + vz * nz;
          vx -= 2 * dot * nx; vz -= 2 * dot * nz;
          p.vh = Math.atan2(vx, vz);
          const push = Math.abs(q.d) - lim;
          p.x -= nx * push; p.z -= nz * push;
          p.bounces--;
          if (p.bounces < 0) alive = false;
          else this.events.push({ type: 'orbBounce', x: p.x, z: p.z });
        } else {
          const push = Math.abs(q.d) - lim, nx = -q.tz * Math.sign(q.d), nz = q.tx * Math.sign(q.d);
          p.x -= nx * push; p.z -= nz * push;
        }
      }
      if (alive) {
        for (const k of this.karts) {
          if (k.respawnT > 0 || (k.id === p.owner && p.age < 0.8)) continue;
          const dx = k.x - p.x, dz = k.z - p.z;
          if (dx * dx + dz * dz < (ITEMS.orb.radius + 0.9) ** 2 && Math.abs(k.y + 0.6 - p.y) < 2) {
            hitKart(k, this.events, p.type);
            this.events.push({ type: 'explode', x: p.x, y: p.y, z: p.z, kind: p.type });
            alive = false;
            break;
          }
        }
      }
      if (alive) {
        for (const h of this.hazards) {
          if (h.type !== 'mine' || h.life <= 0) continue;
          if ((h.x - p.x) ** 2 + (h.z - p.z) ** 2 < 4) {
            h.life = 0; alive = false;
            this.events.push({ type: 'explode', x: p.x, y: p.y, z: p.z, kind: 'mine' });
            break;
          }
        }
      }
      if (alive) keep.push(p);
      else if (p.life <= 0) this.events.push({ type: 'fizzle', x: p.x, y: p.y, z: p.z });
    }
    this.projectiles = keep;
  }

  updateHazards(dt) {
    const keep = [];
    for (const h of this.hazards) {
      h.life -= dt; h.age += dt;
      if (h.life <= 0) continue;
      let alive = true;
      for (const k of this.karts) {
        if (k.respawnT > 0) continue;
        const dx = k.x - h.x, dz = k.z - h.z;
        const d2 = dx * dx + dz * dz;
        if (h.type === 'mine') {
          if (h.age < 0.5 && k.id === h.owner) continue;
          if (d2 < (h.r + 0.8) ** 2 && Math.abs(k.y - h.y) < 2) {
            hitKart(k, this.events, 'mine');
            this.events.push({ type: 'explode', x: h.x, y: h.y + 0.5, z: h.z, kind: 'mine' });
            alive = false; break;
          }
        } else if (h.type === 'frost' && d2 < h.r * h.r && k.grounded && k.cometT <= 0) {
          if (k.iceT <= 0) this.events.push({ type: 'ice', id: k.id });
          k.iceT = 0.35;
        }
      }
      if (alive) keep.push(h);
    }
    this.hazards = keep;
  }

  checkEnd() {
    const humans = this.karts.filter((k) => k.human);
    const pool = humans.length ? humans : this.karts;
    const allDone = pool.every((k) => k.finished || !k.connected) && pool.some((k) => k.finished);
    const graceOver = this.firstHumanFinish !== null && this.time - this.firstHumanFinish > RACE.finishGrace;
    if (allDone || graceOver || this.karts.every((k) => k.finished)) {
      this.phase = 'finished';
      this.events.push({ type: 'raceEnd' });
    }
  }

  /** Final standings. Unfinished karts get an estimated time from their remaining distance. */
  results() {
    const L = this.track.length;
    return [...this.karts].sort((a, b) => a.place - b.place).map((k) => {
      let time = k.finishTime, estimated = false;
      if (!k.finished) {
        const remaining = Math.max(0, this.laps * L - this.progressOf(k));
        const avg = Math.max(8, this.progressOf(k) / Math.max(1, this.time));
        time = this.time + remaining / avg; estimated = true;
      }
      return { id: k.id, name: k.name, driver: k.driver, place: k.place, time, estimated, bestLap: k.bestLap, human: k.human, isBot: k.isBot, connected: k.connected };
    });
  }
}
