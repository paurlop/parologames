// Arcade kart physics. stepKart() is a pure function of (state, input, track, dt)
// so the client can predict its own kart and replay inputs after a server
// correction, while the server runs the exact same code authoritatively.

import { PHYSICS as P, ITEMS } from './config.js';
const ITEMS_MAGNET_MUL = ITEMS.magnet.speedMul;
import { queryTrack, groundAt, F_WALL_L, F_WALL_R } from './track.js';

export function createKart(id, slot, stats) {
  return {
    id,
    x: slot.x, y: slot.y, z: slot.z,
    heading: slot.heading, vh: slot.heading, speed: 0, vy: 0,
    grounded: 1, air: 0,
    seg: slot.seg, s: 0, d: 0,
    drift: 0, driftT: 0, tier: 0, hop: 0,
    boostT: 0, spinT: 0, shieldT: 0, cometT: 0, iceT: 0,
    respawnT: 0, safeSeg: slot.seg,
    trick: 0, offroad: 0, wrongT: 0,
    bvx: 0, bvz: 0, draft: 0, glide: 0, water: 0, magnetT: 0, pull: 0, phaseT: 0, mudT: 0,
    stats,
    prevDrift: 0,
  };
}

// Fields that fully describe a kart's physical state (used for network snapshots
// and client-side reconciliation).
export const KART_FIELDS = ['x', 'y', 'z', 'heading', 'vh', 'speed', 'vy', 'grounded', 'air', 'seg',
  'drift', 'driftT', 'tier', 'hop', 'boostT', 'spinT', 'shieldT', 'cometT', 'iceT', 'respawnT', 'safeSeg',
  'trick', 'prevDrift', 'bvx', 'bvz', 'draft', 'glide', 'water', 'magnetT', 'pull', 'phaseT', 'mudT'];

const q = {};
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// input: { throttle 0|1, brake 0|1, steer -1..1, drift 0|1 }
// events: optional array; pushes {type, ...} for audio/vfx.
export function stepKart(k, input, track, dt, events, env) {
  const st = k.stats;
  if (k.respawnT > 0) {
    k.respawnT -= dt;
    if (k.respawnT <= 0) respawn(k, track, events);
    return;
  }
  queryTrack(track, k.x, k.y, k.z, k.seg, q);
  k.seg = q.seg; k.s = q.s; k.d = q.d;

  const control = k.spinT <= 0;
  const throttle = control ? input.throttle : 0;
  const brake = control ? input.brake : 0;
  let steer = control ? Math.max(-1, Math.min(1, input.steer || 0)) : 0;

  // --- target speed ---
  const edgeOff = q.d > q.hw + 0.6 || q.d < -q.hw - 0.6;
  k.offroad = edgeOff && k.grounded ? 1 : 0;
  let maxV = P.maxSpeed * st.speed;
  if (k.offroad && k.boostT <= 0 && k.cometT <= 0) maxV *= P.offroadMaxMul;
  if (k.boostT > 0) maxV = P.maxSpeed * st.speed * P.boostMaxMul;
  if (k.cometT > 0) maxV = P.maxSpeed * st.speed * 1.32;
  if (k.water) maxV *= 0.93;
  if (k.mudT > 0 && k.boostT <= 0 && k.cometT <= 0) maxV *= 0.58; // mud bogs you down
  if (k.magnetT > 0 && k.pull) maxV *= ITEMS_MAGNET_MUL;
  if (k.draft > 0.15 && k.boostT <= 0) maxV *= P.draft.speedMul; // in the slipstream

  if (k.grounded) {
    if (k.boostT > 0 || k.cometT > 0) {
      // boosts accelerate hard but never past the boost ceiling
      if (k.speed < maxV) k.speed = Math.min(maxV, k.speed + P.boostAccel * dt);
    } else if (throttle && !brake) {
      if (k.speed < 0) k.speed += P.brakeDecel * dt;
      else k.speed += P.accel * st.accel * Math.max(0.05, 1 - k.speed / maxV) * dt;
    } else if (brake) {
      if (k.speed > 0.5) k.speed -= P.brakeDecel * dt;
      else k.speed = Math.max(-P.reverseMax, k.speed - P.accel * 0.6 * dt);
    } else {
      const c = P.coastDrag * dt;
      k.speed = Math.abs(k.speed) <= c ? 0 : k.speed - Math.sign(k.speed) * c;
    }
    if (k.speed > maxV) k.speed -= (k.speed - maxV) * Math.min(1, P.overspeedDecay * dt);
    k.speed -= q.grade * P.gravity * P.slopeGravity * dt * Math.sign(k.speed || 1);
  }
  if (k.spinT > 0) {
    k.spinT -= dt;
    k.speed *= Math.pow(0.25, dt);
  }

  // --- drift ---
  const driftHeld = control && input.drift;
  if (driftHeld && !k.prevDrift && k.grounded && k.drift === 0) {
    k.vy = P.hopVelocity; k.grounded = 0; k.hop = 1;
    if (events) events.push({ type: 'hop', id: k.id });
  }
  if (!k.grounded && driftHeld && !k.prevDrift && k.hop === 0) k.trick = 1; // trick on ramps
  k.prevDrift = driftHeld ? 1 : 0;

  if (k.drift === 0 && driftHeld && Math.abs(steer) > 0.35 && k.speed > P.driftMinSpeed && (k.grounded || k.hop)) {
    k.drift = steer > 0 ? 1 : -1; k.driftT = 0; k.tier = 0;
    if (events) events.push({ type: 'driftStart', id: k.id });
  }
  if (k.drift !== 0) {
    if (!driftHeld || k.speed < P.driftMinSpeed * 0.7 || !control) {
      if (control && k.tier > 0) {
        k.boostT = Math.max(k.boostT, P.driftBoost[k.tier - 1]);
        if (events) events.push({ type: 'boost', id: k.id, tier: k.tier });
      }
      k.drift = 0; k.driftT = 0; k.tier = 0;
    } else if (k.grounded) {
      const into = steer * k.drift; // -1 (counter) .. 1 (into the turn)
      k.driftT += dt * (0.7 + 0.5 * Math.max(0, into));
      const prevTier = k.tier;
      k.tier = k.driftT >= P.driftTiers[2] ? 3 : k.driftT >= P.driftTiers[1] ? 2 : k.driftT >= P.driftTiers[0] ? 1 : 0;
      if (k.tier !== prevTier && events) events.push({ type: 'driftTier', id: k.id, tier: k.tier });
    }
  }

  // --- steering ---
  const sp = Math.abs(k.speed);
  if (k.drift !== 0) {
    const into = (steer * k.drift + 1) / 2;
    const rate = (P.driftTurnMin + (P.driftTurnMax - P.driftTurnMin) * into) * st.handling;
    k.heading -= k.drift * rate * dt;
  } else {
    const low = Math.min(1, sp / P.turnLowSpeed);
    const high = 1 - (1 - P.turnHighSpeedMul) * Math.min(1, sp / (P.maxSpeed * 1.1));
    const rate = P.turnRate * st.handling * low * high * (k.grounded ? (k.water ? 0.9 : 1) : k.glide ? 0.8 : 0.35);
    k.heading -= steer * rate * dt * Math.sign(k.speed || 1);
  }

  // velocity heading follows kart heading with surface-dependent grip
  const grip = k.iceT > 0 ? P.iceGrip : k.drift !== 0 ? P.driftGrip : P.grip;
  if (k.grounded) k.vh += angDiff(k.heading, k.vh) * Math.min(1, grip * dt);
  // keep angles bounded (heading stays within ±π of the velocity heading)
  k.vh = angDiff(k.vh, 0);
  k.heading = k.vh + angDiff(k.heading, k.vh);

  // --- integrate ---
  const px = k.x, pz = k.z, py = k.y;
  // sideways knock-back from kart collisions fades out quickly
  if (k.bvx || k.bvz) {
    k.x += k.bvx * dt; k.z += k.bvz * dt;
    const f = Math.exp(-P.bumpDecay * dt);
    k.bvx *= f; k.bvz *= f;
    if (Math.abs(k.bvx) + Math.abs(k.bvz) < 0.05) { k.bvx = 0; k.bvz = 0; }
  }
  k.x += Math.sin(k.vh) * k.speed * dt;
  k.z += Math.cos(k.vh) * k.speed * dt;

  queryTrack(track, k.x, k.y, k.z, k.seg, q);
  k.seg = q.seg; k.s = q.s; k.d = q.d;

  // walls (barriers are infinitely tall for physics; jumps never skip them)
  const r = P.kartRadius;
  const limR = q.edgeR - r, limL = -(q.edgeL - r);
  let wallHit = 0;
  if ((q.flags & F_WALL_R) && q.d > limR) { wallHit = 1; }
  else if ((q.flags & F_WALL_L) && q.d < limL) { wallHit = -1; }
  // split routes: a central divider island acts as a wall on both of its faces
  for (const sp of track.zones.split) {
    if (q.s < sp.from + 6 || q.s > sp.to - 6) continue;
    const lim = sp.div + r;
    if (Math.abs(q.d) >= lim) continue;
    const side = q.d >= 0 ? 1 : -1, push = side * lim - q.d;
    k.x += -q.tz * push; k.z += q.tx * push;
    const nx = q.tz * side, nz = -q.tx * side; // normal pointing into the divider
    const vx = Math.sin(k.vh), vz = Math.cos(k.vh), into = Math.max(0, vx * nx + vz * nz);
    if (into > 0.05) {
      k.speed *= 1 - (1 - P.wallSpeedKeep) * Math.min(1, into * 1.6);
      const tvx = vx - nx * (vx * nx + vz * nz), tvz = vz - nz * (vx * nx + vz * nz);
      if (Math.hypot(tvx, tvz) > 0.05) k.vh = Math.atan2(tvx, tvz);
      if (into > 0.25 && events) events.push({ type: 'wall', id: k.id, power: into * Math.abs(k.speed) });
    }
    k.d = side * lim;
  }
  if (wallHit) {
    const lim = wallHit > 0 ? limR : limL;
    const push = q.d - lim;
    k.x -= (-q.tz) * push; k.z -= q.tx * push;
    // impact strength: how much the velocity points into the wall
    const nx = -q.tz * wallHit, nz = q.tx * wallHit;
    const vx = Math.sin(k.vh), vz = Math.cos(k.vh);
    const into = Math.max(0, vx * nx + vz * nz) * Math.sign(k.speed || 1);
    if (into > 0.05) {
      k.speed *= 1 - (1 - P.wallSpeedKeep) * Math.min(1, into * 1.6);
      // slide along the wall: remove the inward component from the heading
      const tvx = vx - nx * (vx * nx + vz * nz), tvz = vz - nz * (vx * nx + vz * nz);
      if (Math.hypot(tvx, tvz) > 0.05) {
        k.vh = Math.atan2(tvx, tvz);
        k.heading = k.vh + angDiff(k.heading, k.vh) * 0.5;
      }
      if (into > 0.25 && events) events.push({ type: 'wall', id: k.id, power: into * Math.abs(k.speed) });
      if (k.drift && into > 0.5) { k.drift = 0; k.driftT = 0; k.tier = 0; }
    }
    k.d = lim;
  }

  // --- vertical ---
  const ground = groundAt(q, k.d);
  if (k.grounded) {
    // follow the road; leave the ground if it drops away faster than gravity would
    const dropRate = (py - ground) / dt;
    if (ground < py - 0.05 && dropRate > 6 && sp > 8) {
      k.grounded = 0; k.vy = 0;
    } else {
      k.y = ground;
    }
    // ramps launch
    for (const rp of track.zones.ramp) {
      let ds = q.s - rp.s; if (ds < -track.length / 2) ds += track.length;
      if (ds >= 0 && ds < rp.len && Math.abs(k.d - (rp.d || 0)) < rp.w && (k.speed > 6 || rp.spring) && k.grounded) {
        if (rp.cannon) { k.grounded = 0; k.vy = rp.power; k.hop = 0; k.glide = 1; k.boostT = Math.max(k.boostT, 1.6); if (events) events.push({ type: 'ramp', id: k.id, cannon: 1 }); continue; }
        if (rp.spring) { k.grounded = 0; k.vy = rp.power; k.hop = 0; if (events) events.push({ type: 'ramp', id: k.id, spring: 1 }); continue; }
        k.grounded = 0; k.vy = rp.power * Math.min(1.1, Math.max(0.55, k.speed / P.maxSpeed)); k.hop = 0;
        if (rp.glide) { k.glide = 1; if (events) events.push({ type: 'glide', id: k.id }); }
        if (events) events.push({ type: 'ramp', id: k.id });
      }
    }
  }
  // reaching a gap: launch pad fires and the glider opens automatically
  if ((q.flags & 128) && !k.glide && k.respawnT <= 0) {
    k.glide = 1; k.grounded = 0; k.vy = Math.max(k.vy, 5); k.hop = 0;
    k.speed = Math.max(k.speed, 27);
    if (events) events.push({ type: 'glide', id: k.id, gap: 1 });
  }
  // under the sea (water-flagged road below sea level): floaty, a little slower
  k.water = (q.flags & 64) && k.y < P.seaLevel ? 1 : 0;
  if (!k.grounded) {
    if (k.glide) {
      // glider: slow sink, keep speed; brake = dive (faster, steeper)
      k.vy = Math.max(k.vy - P.gravity * (input.brake ? 0.75 : 0.28) * dt, input.brake ? -14 : -4.5);
      if (input.brake) k.speed += 5 * dt;
    } else k.vy -= P.gravity * (k.water ? 0.45 : 1) * dt;
    k.y += k.vy * dt;
    k.air += dt;
    if (k.y <= ground && k.vy <= 0) {
      k.y = ground; k.grounded = 1;
      if (k.trick && k.air > 0.35) {
        k.boostT = Math.max(k.boostT, P.trickBoost);
        if (events) events.push({ type: 'boost', id: k.id, tier: 0, trick: 1 });
      }
      if (events && k.air > 0.25) events.push({ type: 'land', id: k.id, power: -k.vy });
      k.vy = 0; k.air = 0; k.hop = 0; k.trick = 0; k.glide = 0;
    }
  }

  // frozen surfaces: no grip while on them
  if (k.grounded && (q.flags & 32) && k.cometT <= 0) k.iceT = Math.max(k.iceT, 0.15);

  // boost pads
  if (k.grounded) {
    // mud patches and conveyor belts
    for (const m of track.zones.mud) {
      let ds = q.s - m.s; if (ds < -track.length / 2) ds += track.length;
      if (ds >= 0 && ds < m.len && Math.abs(k.d - m.d) < m.w) k.mudT = 0.15;
    }
    for (const c of track.zones.conveyor) {
      let ds = q.s - c.s; if (ds < -track.length / 2) ds += track.length;
      if (ds >= 0 && ds < c.len && Math.abs(k.d - c.d) < c.w) { k.bvx += -q.tz * c.push * dt; k.bvz += q.tx * c.push * dt; }
    }
    for (const bp of track.zones.boost) {
      if (bp.finalLap && !env?.finalLap) continue;
      let ds = q.s - bp.s; if (ds < -track.length / 2) ds += track.length;
      if (ds >= 0 && ds < bp.len && Math.abs(k.d - bp.d) < bp.w) {
        if (k.boostT < 0.9 && events) events.push({ type: 'boost', id: k.id, tier: 0, pad: 1 });
        k.boostT = Math.max(k.boostT, 1.0);
      }
    }
  }

  // timers
  if (k.boostT > 0) k.boostT -= dt;
  if (k.shieldT > 0) k.shieldT -= dt;
  if (k.cometT > 0) k.cometT -= dt;
  if (k.magnetT > 0) k.magnetT -= dt;
  if (k.phaseT > 0) k.phaseT -= dt;
  if (k.mudT > 0) k.mudT -= dt;
  if (k.iceT > 0) k.iceT -= dt;

  // wrong way detection (HUD only)
  const fwd = Math.sin(k.vh) * q.tx + Math.cos(k.vh) * q.tz;
  k.wrongT = fwd * Math.sign(k.speed) < -0.3 && sp > 4 ? k.wrongT + dt : 0;

  // safety: remember a recovery point, fall into the sea / off the world
  if (k.grounded && Math.abs(k.d) < q.hw - 1) k.safeSeg = k.seg;
  if ((k.y < P.waterY && k.y < q.y - 0.5) || k.y < q.y - P.fallBelowRoad || !Number.isFinite(k.x + k.z + k.y)) {
    if (Number.isFinite(k.x + k.z + k.y) && events) events.push({ type: 'fall', id: k.id, x: k.x, y: Math.max(k.y, P.waterY), z: k.z });
    k.respawnT = P.respawnTime; k.speed = 0; k.vy = 0; k.drift = 0; k.boostT = 0;
    if (!Number.isFinite(k.x + k.z + k.y)) { k.x = px; k.z = pz; k.y = py; }
  }
}

export function respawn(k, track, events) {
  // Back off a few samples from the last safe point so you re-enter the road straight.
  const i = (k.safeSeg - 4 + track.n) % track.n;
  k.x = track.X[i]; k.z = track.Z[i]; k.y = track.Y[i] + 0.2;
  k.heading = k.vh = Math.atan2(track.TX[i], track.TZ[i]);
  k.seg = i; k.speed = 0; k.vy = 0; k.grounded = 1; k.air = 0;
  k.drift = 0; k.driftT = 0; k.tier = 0; k.spinT = 0; k.respawnT = 0;
  k.shieldT = Math.max(k.shieldT, 1.5); // brief grace period
  if (events) events.push({ type: 'respawn', id: k.id });
}

export function hitKart(k, events, cause) {
  if (k.respawnT > 0 || k.cometT > 0 || k.phaseT > 0) return false;
  if (k.shieldT > 0) {
    k.shieldT = 0;
    if (events) events.push({ type: 'shieldBreak', id: k.id });
    return false;
  }
  k.spinT = P.spinTime;
  k.speed *= P.spinSpeedKeep;
  k.drift = 0; k.driftT = 0; k.tier = 0; k.boostT = 0;
  if (events) events.push({ type: 'spin', id: k.id, cause });
  return true;
}
