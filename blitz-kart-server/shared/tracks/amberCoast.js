// AMBER COAST — sunset seaside figure-eight.
// Lower straight runs under a stone bridge, climbs the eastern headland in a long
// right-hand sweep with a sandy inside shortcut, crosses the bridge at +13 m, then
// dives down the western cliffs (open sea edge, no barrier) to a jump and the
// final beach sweep onto the main straight.
//
// points: [x, z, y, halfWidth]. Zones reference control-point indices
// (fractional allowed), so editing a point keeps zones attached to it.

export default {
  id: 'amber-coast',
  name: 'Amber Coast',
  theme: 'coast',
  laps: 3,
  halfWidth: 11,
  shoulder: 5,
  points: [
    [-90, 90, 1.0, 12],   // 0  start / finish
    [-35, 35, 0.5, 11.5],
    [0, 0, 0.5, 11],      // 2  under the bridge
    [45, -45, 1.0, 11],
    [95, -100, 2.5, 11],
    [150, -135, 4.0, 11],
    [215, -125, 5.5, 11.5],
    [255, -70, 7.0, 11.5],
    [262, 5, 8.5, 12],
    [228, 70, 10.0, 12],  // 9  headland hairpin
    [160, 102, 12.0, 12],
    [95, 86, 13.0, 11],
    [40, 40, 13.2, 10.5],
    [0, 0, 13.2, 10.5],   // 13 bridge deck
    [-40, -40, 13.0, 10.5],
    [-90, -95, 11.0, 11],
    [-150, -130, 8.0, 11],
    [-215, -122, 5.0, 11.5],
    [-256, -62, 3.2, 12],  // 18 cliff run (open sea edge)
    [-264, 15, 2.2, 12],
    [-232, 82, 1.6, 12],
    [-172, 116, 1.2, 11.5],
    [-126, 116, 1.0, 12],
  ],
  zones: [
    { type: 'bridge', from: 12.35, to: 13.65 },
    { type: 'open', from: 17.7, to: 19.6, side: 'outer' },
    { type: 'sand', from: 8.6, to: 10.6, side: 'inner', width: 22 },
    { type: 'sand', from: 20.2, to: 21.4, side: 'inner', width: 12 },
    { type: 'boost', at: 3.4, d: 0, len: 7 },
    { type: 'boost', at: 10.7, d: -4, len: 7 },
    { type: 'boost', at: 21.6, d: 3, len: 7 },
    { type: 'ramp', at: 16.45, len: 6, power: 10.5, w: 10 },
    { type: 'items', at: 1.35, count: 5 },
    { type: 'items', at: 7.4, count: 5 },
    { type: 'items', at: 14.6, count: 4 },
    { type: 'items', at: 19.9, count: 5 },
  ],
  palette: {
    sky: 0xffb27a, fog: 0xf3a37a, sea: 0x1d5a7a, sand: 0xe9c48f, grass: 0x6fae4a,
    road: 0x3a3c44, curbA: 0xf04a3a, curbB: 0xf6efe6, accent: 0xff7a2f,
  },
};
