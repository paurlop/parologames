// BAHÍA PIRATA — ~1.6 km on a stormy evening: wooden docks with no rail over the
// sea, a sea cave tunnel, a fork around a shipwreck (deck route vs. rocky route),
// a ship's cannon that fires you to the next island, lightning and cannonballs.
export default {
  id: 'pirate-bay', name: 'Bahía Pirata', theme: 'pirate', laps: 3, halfWidth: 11, shoulder: 4,
  points: [
    [0, 0, 3, 12], [100, -20, 3, 11], [190, -70, 5, 11], [270, -40, 7, 10.5], [300, 50, 6, 10.5],
    [250, 130, 3, 11], [170, 160, 2, 11], [90, 140, 3, 11], [20, 190, 4, 10.5], [-70, 210, 5, 10.5],
    [-160, 180, 4, 11], [-240, 120, 3, 11], [-270, 30, 3, 11], [-220, -50, 2, 11.5], [-130, -70, 2, 12],
    [-50, -40, 3, 12],
  ],
  complex: { chicanes: [[0.5, 10, 80], [12.6, 9, 70]], crests: [[3.4, 3.5, 40]], narrow: [[8.3, 9.2, 7.5]] },
  zones: [
    { type: 'bridge', from: 5.3, to: 6.6 }, { type: 'open', from: 5.3, to: 6.6, side: 'outer' },
    { type: 'tunnel', from: 2.2, to: 3.2 },
    { type: 'split', from: 10.0, to: 11.6, width: 21 },
    { type: 'boost', at: 10.4, d: -9, len: 7 }, { type: 'obstacle', kind: 'roller', at: 10.9, d: -9, amp: 4, period: 2.6, r: 2.2 },
    { type: 'mud', at: 10.4, len: 30, d: 9, w: 5 }, { type: 'spring', at: 11.2, d: 9, w: 4 },
    { type: 'cannon', at: 7.4, power: 13 }, { type: 'gap', from: 7.6, to: 7.95 },
    { type: 'obstacle', kind: 'stomper', at: 4.2, d: -3, period: 3.0, r: 2.4 }, { type: 'obstacle', kind: 'slider', at: 13.6, amp: 7, period: 3.0 },
    { type: 'obstacle', kind: 'stomper', at: 9.6, d: 3, period: 2.8, r: 2.4, finalLap: true },
    { type: 'boost', at: 0.2, d: 0, len: 7 }, { type: 'boost', at: 6.9, d: 0, len: 7 }, { type: 'boost', at: 14.6, d: 3, len: 7, finalLap: true },
    { type: 'items', at: 1.3, count: 5 }, { type: 'items', at: 4.8, count: 4 }, { type: 'items', at: 9.2, count: 5 }, { type: 'items', at: 13.0, count: 4 },
  ],
};
