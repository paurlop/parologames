// CPU driver. Bots produce the same input struct a human does and go through the
// same physics: no teleporting, no speed cheats. Difficulty only changes how well
// they drive (line accuracy, drift use, reaction, throttle discipline).

import { BOT_SKILL, PHYSICS } from './config.js';

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

export function createBrain(skillName, rng) {
  const skill = BOT_SKILL[skillName] || BOT_SKILL.normal;
  return {
    skill, rng,
    lane: (rng() - 0.5) * 4,      // personal lateral preference
    wobble: rng() * 100,
    stuckT: 0, reverseT: 0,
    itemT: 0,
    driftPlan: 0,
  };
}

// Steering towards the track ahead. Used by bots and by Comet Drive autopilot.
export function steerAlongTrack(track, k, lateral, lookMul = 1) {
  const n = track.n;
  const la = (9 + Math.abs(k.speed) * 0.55) * lookMul;
  const i = (k.seg + Math.round(la / track.step)) % n;
  const tx = track.TX[i], tz = track.TZ[i];
  const hw = track.HW[i];
  const d = Math.max(-hw + 1.5, Math.min(hw - 1.5, lateral));
  const px = track.X[i] + (-tz) * d, pz = track.Z[i] + tx * d;
  const desired = Math.atan2(px - k.x, pz - k.z);
  const diff = angDiff(desired, k.heading);
  return { steer: Math.max(-1, Math.min(1, -diff * 2.4)), diff };
}

export function botInput(sim, k, brain, dt) {
  const tr = sim.track, n = tr.n, skill = brain.skill;
  const input = { throttle: 1, brake: 0, steer: 0, drift: 0, item: 0 };

  // curvature over the next stretch decides the racing line and drifting
  const ahead = Math.round((6 + Math.abs(k.speed) * 0.5) / tr.step);
  let cNear = 0, cFar = 0;
  for (let j = 0; j < 10; j++) cNear += tr.CURV[(k.seg + ahead + j) % n];
  for (let j = 10; j < 26; j++) cFar += tr.CURV[(k.seg + ahead + j) % n];
  cNear /= 10; cFar /= 16;
  const c = (cNear + cFar) / 2;
  const hw = tr.HW[k.seg];

  // inside line on corners (left turn: c>0 → inner side is negative d)
  let lateral = -Math.sign(c) * Math.min(hw * 0.6, Math.abs(c) * hw * 30) * skill.line + brain.lane;
  lateral += Math.sin(sim.time * 0.7 + brain.wobble) * skill.noise * 6;

  // avoid hazards and karts directly ahead
  for (const h of sim.hazards) {
    if (h.type !== 'mine') continue;
    const dx = h.x - k.x, dz = h.z - k.z, dist = Math.hypot(dx, dz);
    if (dist > 30) continue;
    const fwd = (dx * Math.sin(k.vh) + dz * Math.cos(k.vh)) / (dist || 1);
    if (fwd < 0.6) continue;
    const side = dx * -Math.cos(k.vh) + dz * Math.sin(k.vh); // >0: hazard on the right
    if (Math.abs(side) < 3) lateral += side > 0 ? -4 : 4;
  }
  for (const o of sim.karts) {
    if (o === k) continue;
    const dx = o.x - k.x, dz = o.z - k.z, dist = Math.hypot(dx, dz);
    if (dist > 9 || dist < 0.1) continue;
    const fwd = (dx * Math.sin(k.vh) + dz * Math.cos(k.vh)) / dist;
    if (fwd < 0.7 || o.speed > k.speed) continue;
    const side = dx * -Math.cos(k.vh) + dz * Math.sin(k.vh);
    lateral += side > 0 ? -3 : 3;
  }

  const { steer, diff } = steerAlongTrack(tr, k, lateral, skill.lookahead);
  input.steer = steer;

  // throttle discipline: easier bots lift on their own target speed
  const cap = PHYSICS.maxSpeed * k.stats.speed * skill.speed;
  if (k.speed > cap && k.boostT <= 0) input.throttle = 0;
  if (Math.abs(diff) > 1.1 && k.speed > 12) { input.throttle = 0; input.brake = 1; }

  // Drift only where the corner needs at least the drift's minimum yaw rate,
  // otherwise the kart over-rotates into the outside wall.
  const yawFar = Math.abs(cFar) * k.speed, yawNear = Math.abs(cNear) * k.speed;
  const corner = yawFar > PHYSICS.driftTurnMin * 1.25 && yawNear > PHYSICS.driftTurnMin * 0.8 && Math.sign(cFar) === Math.sign(cNear);
  if (k.drift === 0) {
    if (corner && k.speed > PHYSICS.driftMinSpeed + 4 && brain.driftPlan === 0) {
      brain.driftPlan = brain.rng() < skill.drift ? 1 : -1; // decide once per corner
    }
    if (!corner && yawFar < PHYSICS.driftTurnMin) brain.driftPlan = 0;
    if (brain.driftPlan === 1 && corner) {
      input.drift = 1;
      input.steer = -Math.sign(c) || steer; // commit to the corner direction to start
    }
  } else {
    const sameDir = Math.sign(cNear) === -k.drift;
    const needed = sameDir ? yawNear : 0;
    input.drift = needed > PHYSICS.driftTurnMin * 0.75 && Math.abs(diff) < 0.8 ? 1 : 0;
    if (!input.drift) brain.driftPlan = 0;
  }

  // unstick: reverse out if pinned against a wall
  if (sim.phase === 'racing' && k.respawnT <= 0) {
    brain.stuckT = Math.abs(k.speed) < 2 ? brain.stuckT + dt : 0;
    if (brain.stuckT > 1.2) { brain.reverseT = 0.9; brain.stuckT = 0; }
  }
  if (brain.reverseT > 0) {
    brain.reverseT -= dt;
    input.throttle = 0; input.brake = 1; input.drift = 0;
    input.steer = -steer;
  }

  // items
  if (k.item && k.roulette <= 0) {
    brain.itemT += dt;
    if (brain.itemT > skill.itemDelay) {
      if (wantsToUse(sim, k)) { input.item = 1; brain.itemT = 0; }
    }
  } else brain.itemT = 0;
  return input;
}

function wantsToUse(sim, k) {
  const it = k.item;
  if (it === 'turbo' || it === 'triturbo') return Math.abs(sim.track.CURV[(k.seg + 10) % sim.track.n]) < 0.01;
  if (it === 'shield' || it === 'comet' || it === 'seeker') return true;
  if (it === 'mine' || it === 'frost') {
    // drop when someone is close behind, or after holding it a while
    for (const o of sim.karts) {
      if (o === k) continue;
      const dx = o.x - k.x, dz = o.z - k.z, dist = Math.hypot(dx, dz);
      if (dist < 25 && dx * Math.sin(k.vh) + dz * Math.cos(k.vh) < 0) return true;
    }
    return k.itemHeld > 6;
  }
  if (it === 'orb') {
    for (const o of sim.karts) {
      if (o === k) continue;
      const dx = o.x - k.x, dz = o.z - k.z, dist = Math.hypot(dx, dz);
      if (dist < 45 && (dx * Math.sin(k.vh) + dz * Math.cos(k.vh)) / (dist || 1) > 0.94) return true;
    }
    return k.itemHeld > 8;
  }
  return true;
}
