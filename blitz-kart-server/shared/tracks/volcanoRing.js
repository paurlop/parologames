// VOLCÁN ÍGNEO — a ring around an erupting crater: two barrier-less edges over the
// lava sea, an ash shortcut on the inside and a jump across a lava channel.
export default {
  id: 'volcano-ring', name: 'Volcán Ígneo', theme: 'volcano', laps: 3, halfWidth: 11, shoulder: 5,
  points: [
    [0, -150, 3, 12], [100, -132, 5, 11.5], [170, -62, 8, 11], [182, 40, 10, 11], [122, 122, 9, 11],
    [30, 152, 7, 11.5], [-62, 140, 5, 11.5], [-140, 90, 4, 11], [-172, 0, 4, 11], [-132, -92, 3, 11.5], [-62, -150, 3, 12],
  ],
  zones: [
    { type: 'open', from: 2.4, to: 3.4, side: 'outer' }, { type: 'open', from: 7.4, to: 8.3, side: 'outer' },
    { type: 'sand', from: 8.6, to: 9.8, side: 'inner', width: 16 },
    { type: 'ramp', at: 5.5, len: 6, power: 10.5, w: 10 },
    { type: 'boost', at: 0.5, d: 0, len: 7 }, { type: 'boost', at: 6.6, d: -3, len: 7 },
    { type: 'items', at: 1.3, count: 5 }, { type: 'items', at: 4.6, count: 4 }, { type: 'items', at: 9.4, count: 5 },
  ],
};
