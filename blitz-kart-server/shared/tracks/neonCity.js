// NEÓN NOCTURNA — night city circuit: long avenues, an S-chicane between towers,
// a raised highway section and a tight hairpin by the docks.
export default {
  id: 'neon-city', name: 'Neón Nocturna', theme: 'neon', laps: 3, halfWidth: 11, shoulder: 4,
  points: [
    [-200, -120, 1, 12], [-60, -132, 1, 12], [60, -130, 2, 11.5], [140, -110, 4, 11], [190, -50, 6, 11],
    [196, 30, 7, 11], [160, 92, 6, 11], [100, 112, 4, 11], [40, 82, 3, 10.5], [0, 40, 3, 10.5],
    [-40, 70, 2, 10.5], [-90, 122, 1.5, 11], [-170, 122, 1, 11.5], [-232, 62, 1, 12], [-244, -30, 1, 12],
  ],
  complex: { chicanes: [[0.5, 11.2, 90], [3.0, 11.2, 80], [12.6, 11.2, 90]], crests: [[5.5, 3.5, 50]], narrow: [[8.2, 10.2, 7.5]] },
  zones: [
    { type: 'conveyor', at: 10.6, len: 34, d: 0, w: 10, push: 8 }, { type: 'spring', at: 4.0, d: 5, w: 4 },
    { type: 'obstacle', kind: 'slider', at: 7.3, amp: 6, period: 2.9, phase: 0.2 },
    { type: 'obstacle', kind: 'slider', at: 2.5, amp: 7, period: 3.2 }, { type: 'obstacle', kind: 'slider', at: 12.2, amp: 7, period: 3, phase: 0.4 },
    { type: 'obstacle', kind: 'stomper', at: 6.0, d: -4, period: 3.2, r: 2.4, finalLap: true }, { type: 'boost', at: 13.5, d: 3, len: 7, finalLap: true },
    { type: 'boost', at: 1.4, d: 0, len: 7 }, { type: 'boost', at: 11.6, d: -3, len: 7 },
    { type: 'ramp', at: 4.4, len: 6, power: 9.5, w: 10 },
    { type: 'items', at: 0.6, count: 5 }, { type: 'items', at: 6.4, count: 4 }, { type: 'items', at: 12.5, count: 5 },
    { type: 'sand', from: 8.3, to: 10.2, side: 'inner', width: 10 },
  ],
};
