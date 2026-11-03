// ISLA CORALINA — tropical noon: a beach sweep, a glider jump off the headland, then
// the road dives under the bay through a coral reef (floaty underwater physics)
// before climbing back onto the sand.
export default {
  id: 'coral-island', name: 'Isla Coralina', theme: 'tropic', laps: 3, halfWidth: 11, shoulder: 5,
  points: [
    [0, 0, 2, 12], [90, -20, 4, 12], [170, 10, 9, 11], [220, 80, 6, 11], [205, 150, 0, 11],
    [140, 192, -6, 11.5], [60, 205, -9, 12], [-20, 185, -6, 11.5], [-80, 140, 0, 11],
    [-140, 90, 3, 11], [-170, 10, 4, 11], [-130, -60, 3, 11.5], [-60, -50, 2, 12],
  ],
  complex: { chicanes: [[0.7, 11.2, 80], [9.6, 9.6, 80]], crests: [[3.4, 3.5, 50]], narrow: [[11.3, 12.6, 7.5]] },
  zones: [
    { type: 'mud', at: 9.0, len: 24, d: 0, w: 5 }, { type: 'spring', at: 12.2, d: -4, w: 4 },
    { type: 'obstacle', kind: 'stomper', at: 1.6, d: -3, period: 3.4, r: 2.4 },
    { type: 'water', from: 4.4, to: 8.3 },
    { type: 'ramp', at: 2.3, len: 6, power: 11, w: 10 },
    { type: 'sand', from: 9.5, to: 11.2, side: 'inner', width: 12 },
    { type: 'obstacle', kind: 'slider', at: 10.3, amp: 6, period: 3.2 }, { type: 'obstacle', kind: 'slider', at: 6.2, amp: 7, period: 3.6, finalLap: true },
    { type: 'boost', at: 0.6, d: 0, len: 7 }, { type: 'boost', at: 7.4, d: -3, len: 7 }, { type: 'boost', at: 11.6, d: 3, len: 7, finalLap: true },
    { type: 'items', at: 1.5, count: 5 }, { type: 'items', at: 6.8, count: 4 }, { type: 'items', at: 10.8, count: 5 },
  ],
};
