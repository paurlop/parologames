// Central tuning for Blitz Kart. Every gameplay number lives here so physics,
// items and race rules can be balanced without touching the systems that use them.
// Shared by the browser client and the authoritative Node server.

export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

export const PHYSICS = {
  maxSpeed: 31,            // m/s at stat speed 1.0 (~112 km/h)
  accel: 17,               // m/s² at standstill, tapers near top speed
  brakeDecel: 34,
  reverseMax: 9,
  coastDrag: 5.5,
  overspeedDecay: 2.2,     // 1/s pull back towards max when above it (off-road, end of boost)
  offroadMaxMul: 0.48,     // max speed multiplier on grass/sand
  slopeGravity: 0.38,      // how much hills slow you down / speed you up
  turnRate: 2.25,          // rad/s peak
  turnLowSpeed: 6,         // below this speed steering fades out
  turnHighSpeedMul: 0.62,  // fraction of turnRate kept at top speed
  grip: 14,                // how fast velocity heading follows kart heading (1/s)
  driftGrip: 4.2,
  iceGrip: 1.1,
  driftMinSpeed: 11,
  driftTurnMin: 0.55,      // rad/s when counter-steering in a drift
  driftTurnMax: 2.45,      // rad/s when steering into a drift
  driftVisualAngle: 0.42,  // body yaw offset while drifting (rad)
  driftTiers: [0.75, 1.55, 2.5],      // seconds of charge for blue / orange / purple sparks
  driftBoost: [0.55, 1.0, 1.55],      // boost seconds awarded per tier
  hopVelocity: 3.6,
  gravity: 32,
  boostMaxMul: 1.38,
  boostAccel: 42,
  trickBoost: 0.6,
  wallSpeedKeep: 0.55,     // fraction kept on a head-on wall hit (glancing hits keep more)
  kartRadius: 1.15,
  bumpRestitution: 1.0,
  bumpLateralMax: 17,      // m/s cap on sideways knock-back
  bumpDecay: 4.5,          // 1/s how fast the knock-back fades
  draft: { range: 22, minRange: 2.5, cone: 0.3, charge: 1.1, boost: 0.8, speedMul: 1.04, minSpeed: 18 }, // slipstream
  waterY: -1.5,            // falling below this means a recovery
  fallBelowRoad: 7,        // or this far below the road
  respawnTime: 1.6,
  spinTime: 1.15,
  spinSpeedKeep: 0.32,
};

// Kart bodies: stats are multipliers around 1.0 and always sum-balanced
// (a faster body pays in acceleration or handling).
export const BODIES = {
  striker: { name: 'Striker', speed: 1.0, accel: 1.0, handling: 1.0, weight: 1.0, desc: 'Balanced all-rounder.' },
  comet: { name: 'Comet', speed: 1.045, accel: 0.88, handling: 0.94, weight: 1.12, desc: 'High top speed, slow to get there.' },
  dart: { name: 'Dart', speed: 0.965, accel: 1.16, handling: 1.1, weight: 0.86, desc: 'Nimble and quick off the line.' },
};

export const WHEELS = {
  street: { name: 'Street', speed: 0, accel: 0, handling: 0 },
  slick: { name: 'Slick', speed: 0.015, accel: -0.03, handling: -0.02 },
  grip: { name: 'Grip Pro', speed: -0.015, accel: 0.02, handling: 0.04 },
};

export function kartStats(body = 'striker', wheels = 'street') {
  const b = BODIES[body] || BODIES.striker;
  const w = WHEELS[wheels] || WHEELS.street;
  return {
    speed: b.speed + w.speed,
    accel: b.accel + w.accel,
    handling: b.handling + w.handling,
    weight: b.weight,
  };
}

export const RACE = {
  laps: 3,
  countdown: 3.6,          // seconds before GO (last 3 shown as 3-2-1)
  maxKarts: 8,
  finishGrace: 25,         // seconds the race keeps running after the first human finishes
  checkpoints: 12,
};

export const ITEMS = {
  boxRespawn: 2.6,
  rouletteTime: 1.1,
  pickupRadius: 2.4,
  turbo: { time: 1.25 },
  shield: { time: 9 },
  orb: { speed: 52, life: 5.5, radius: 1.6, bounces: 3 },
  seeker: { speed: 47, life: 8, radius: 1.8, turn: 3.2 },
  mine: { life: 30, radius: 1.7, drop: 3.4 },
  frost: { life: 9, radius: 7, drop: 5 },
  comet: { time: 3.6, speedMul: 1.32, cooldown: 35 },
};

// Original item set. `kind` is what the HUD and audio key on.
export const ITEM_DEFS = {
  turbo: { name: 'Turbo Cell', desc: 'Short burst of speed.' },
  triturbo: { name: 'Triple Turbo', desc: 'Three Turbo Cells.' },
  shield: { name: 'Prism Shield', desc: 'Blocks one hit.' },
  orb: { name: 'Pulse Orb', desc: 'Fires straight ahead, bounces off walls.' },
  seeker: { name: 'Seeker Orb', desc: 'Homes in on the kart ahead of you.' },
  mine: { name: 'Goo Mine', desc: 'Drop it behind you.' },
  frost: { name: 'Frost Field', desc: 'Freezes the road behind you — karts slide.' },
  comet: { name: 'Comet Drive', desc: 'Autopilot rush, knocks karts aside.' },
};

// Weights by race position bucket. The leader never gets speed items;
// the back of the pack gets the catch-up tools. Tuned by headless bot races (tests/).
export const ITEM_ODDS = {
  front: { orb: 30, mine: 30, shield: 25, frost: 15 },
  mid: { turbo: 22, orb: 20, mine: 14, shield: 12, seeker: 12, frost: 12, triturbo: 8 },
  back: { triturbo: 24, turbo: 18, seeker: 20, comet: 16, shield: 12, orb: 10 },
};

export const BOT_SKILL = {
  easy: { speed: 0.84, line: 0.4, noise: 0.22, drift: 0.25, itemDelay: 2.5, lookahead: 1.0 },
  normal: { speed: 0.93, line: 0.75, noise: 0.1, drift: 0.65, itemDelay: 1.2, lookahead: 1.1 },
  hard: { speed: 0.995, line: 1.0, noise: 0.04, drift: 1.0, itemDelay: 0.5, lookahead: 1.2 },
};

export const DRIVERS = [
  { id: 'volt', name: 'Volt', color: 0xffc928, accent: 0x1b1e28 },
  { id: 'coral', name: 'Coral', color: 0xff5f8f, accent: 0xfff1e8 },
  { id: 'nimbus', name: 'Nimbus', color: 0x5fc8ff, accent: 0xffffff },
  { id: 'juniper', name: 'Juniper', color: 0x52d273, accent: 0x14301f },
  { id: 'blaze', name: 'Blaze', color: 0xff5a2a, accent: 0x2a1410 },
  { id: 'indigo', name: 'Indigo', color: 0x7a6cff, accent: 0xe8e4ff },
  { id: 'rook', name: 'Rook', color: 0x2b2f3a, accent: 0xff3b5c },
  { id: 'sol', name: 'Sol', color: 0xffa23a, accent: 0x3a1f6e },
];

// Cosmetics (garage). Whitelists so the server can validate what clients send.
export const PAINTS = [0xff3b4e, 0xff7a2f, 0xffc928, 0x52d273, 0x19c3b0, 0x3d8bff, 0x7a6cff, 0xff5fbf, 0xf4f1ea, 0x2b2f3a];
export const FINISHES = ['gloss', 'metallic', 'matte', 'pearl'];
export const SPOILERS = ['none', 'wing', 'twin'];

export function sanitizeLook(look = {}) {
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  return {
    body: pick(look.body, Object.keys(BODIES), 'striker'),
    wheels: pick(look.wheels, Object.keys(WHEELS), 'street'),
    paint: look.paint === -1 ? -1 : pick(look.paint, PAINTS, -1), // -1 = the character kart's original colours
    accent: pick(look.accent, PAINTS, PAINTS[9]),
    finish: pick(look.finish, FINISHES, 'gloss'),
    spoiler: pick(look.spoiler, SPOILERS, 'wing'),
    driver: pick(look.driver, DRIVERS.map((d) => d.id), 'volt'),
  };
}
