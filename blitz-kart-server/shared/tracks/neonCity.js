// NEÓN NOCTURNA — night city circuit: long avenues, an S-chicane between towers,
// a raised highway section and a tight hairpin by the docks.
export default {
  id: 'neon-city', name: 'Neón Nocturna', theme: 'neon', laps: 3, halfWidth: 11, shoulder: 4,
  points: [
    [-200, -120, 1, 12], [-60, -132, 1, 12], [60, -130, 2, 11.5], [140, -110, 4, 11], [190, -50, 6, 11],
    [196, 30, 7, 11], [160, 92, 6, 11], [100, 112, 4, 11], [40, 82, 3, 10.5], [0, 40, 3, 10.5],
    [-40, 70, 2, 10.5], [-90, 122, 1.5, 11], [-170, 122, 1, 11.5], [-232, 62, 1, 12], [-244, -30, 1, 12],
  ],
  zones: [
    { type: 'boost', at: 1.4, d: 0, len: 7 }, { type: 'boost', at: 11.6, d: -3, len: 7 },
    { type: 'ramp', at: 4.4, len: 6, power: 9.5, w: 10 },
    { type: 'items', at: 0.6, count: 5 }, { type: 'items', at: 6.4, count: 4 }, { type: 'items', at: 12.5, count: 5 },
    { type: 'sand', from: 8.3, to: 10.2, side: 'inner', width: 10 },
  ],
};
