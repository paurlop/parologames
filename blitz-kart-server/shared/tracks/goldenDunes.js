// DUNAS DORADAS (rediseño) — ~1.7 km. A sandstone tunnel lit by torches under the
// dunes, a catapult that throws you over the dune sea, and a fork at the oasis: the
// inner route crosses the oasis sand (slow, but with a spring), the outer one has
// a boost and a sand vortex.
export default {
  id: 'golden-dunes', name: 'Dunas Doradas', theme: 'desert', laps: 3, halfWidth: 11, shoulder: 6,
  points: [
    [0, 0, 3, 12], [110, -30, 5, 12], [210, -20, 8, 11], [290, 40, 10, 11], [300, 130, 9, 11],
    [250, 200, 7, 11], [160, 220, 6, 10.5], [90, 180, 5, 10.5], [30, 220, 6, 11], [-60, 240, 7, 11],
    [-150, 220, 6, 11], [-230, 170, 5, 11], [-270, 90, 4, 11], [-260, 0, 3, 11.5], [-200, -60, 3, 12],
    [-120, -70, 3, 12],
  ],
  complex: { chicanes: [[0.5, 11, 90], [7.4, 9, 70]], crests: [[1.6, 4.5, 40], [3.4, 4, 40], [12.4, 4, 40], [13.6, 3.5, 40]], narrow: [[5.4, 6.6, 7.5]] },
  zones: [
    { type: 'tunnel', from: 4.2, to: 5.4 },
    { type: 'cannon', at: 8.6, power: 14 }, { type: 'gap', from: 8.8, to: 9.15 },
    { type: 'split', from: 9.9, to: 11.6, width: 21 },
    { type: 'mud', at: 10.3, len: 30, d: -9, w: 5 },
    { type: 'boost', at: 10.4, d: 9, len: 7 }, { type: 'obstacle', kind: 'roller', at: 11.1, d: 9, amp: 4, period: 2.8, r: 2.4 },
    { type: 'obstacle', kind: 'roller', at: 1.0, amp: 8, period: 3.6, r: 2.6 }, { type: 'obstacle', kind: 'roller', at: 13.0, amp: 7, period: 3.0, r: 2.6 },
    { type: 'obstacle', kind: 'roller', at: 6.4, amp: 6, period: 2.6, phase: 0.3, r: 2.6, finalLap: true },
    { type: 'boost', at: 0.2, d: 0, len: 7 }, { type: 'boost', at: 3.8, d: -3, len: 7 }, { type: 'boost', at: 14.4, d: 0, len: 7, finalLap: true },
    { type: 'items', at: 1.4, count: 5 }, { type: 'items', at: 6.2, count: 4 }, { type: 'items', at: 12.3, count: 5 }, { type: 'items', at: 14.9, count: 4 },
  ],
};
