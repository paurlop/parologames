// BOSQUE LUMEN — night run through a giant forest lit by glowing mushrooms: a mossy
// inside shortcut, a log jump and an edge with no barrier over the luminous pond.
export default {
  id: 'lumen-forest', name: 'Bosque Lumen', theme: 'forest', laps: 3, halfWidth: 11, shoulder: 5,
  points: [
    [0, 0, 2, 11], [70, -50, 4, 11], [150, -60, 6, 11], [210, -10, 7, 11], [220, 70, 8, 11],
    [160, 120, 9, 11], [90, 100, 7, 10.5], [50, 140, 6, 10.5], [-20, 160, 5, 11], [-100, 130, 4, 11],
    [-150, 60, 3, 11], [-140, -20, 2, 11.5], [-80, -60, 2, 11.5],
  ],
  zones: [
    { type: 'sand', from: 5.4, to: 7.0, side: 'inner', width: 14 },
    { type: 'open', from: 10.3, to: 11.2, side: 'outer' },
    { type: 'ramp', at: 8.5, len: 6, power: 10, w: 10 },
    { type: 'boost', at: 0.6, d: 0, len: 7 }, { type: 'boost', at: 3.5, d: -3, len: 7 },
    { type: 'items', at: 1.6, count: 5 }, { type: 'items', at: 6.4, count: 4 }, { type: 'items', at: 11.8, count: 5 },
  ],
};
