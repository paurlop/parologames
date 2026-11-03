// TEMPLO DE LA JUNGLA (rediseño) — ~1.6 km. The road dives into the temple's
// mountain through a torch-lit tunnel, a cannon fires you across the river gorge,
// then the track forks around a ruined island: the left route is a muddy shortcut
// with rolling boulders, the right one is longer but has boost pads.
export default {
  id: 'jungle-temple', name: 'Templo de la Jungla', theme: 'jungle', laps: 3, halfWidth: 10.5, shoulder: 5,
  points: [
    [0, 0, 3, 12], [90, -30, 5, 11], [160, -90, 9, 10.5], [230, -110, 13, 10.5], [300, -60, 16, 10.5],
    [310, 20, 18, 10.5], [260, 80, 17, 11], [190, 90, 14, 11], [150, 150, 11, 10.5], [90, 200, 8, 10.5],
    [10, 210, 6, 11], [-70, 180, 5, 11], [-140, 200, 6, 11], [-210, 150, 5, 11], [-240, 70, 4, 11],
    [-210, -10, 3, 11], [-150, -60, 3, 11.5], [-70, -50, 3, 12],
  ],
  complex: { chicanes: [[0.5, 11, 80], [16.4, 10, 70]], crests: [[2.4, 4, 40], [12.5, 3.5, 40]], narrow: [[7.4, 8.3, 7.5]] },
  zones: [
    { type: 'tunnel', from: 3.4, to: 4.7 },
    { type: 'cannon', at: 6.55, power: 13 }, { type: 'gap', from: 6.75, to: 7.15 },
    { type: 'split', from: 9.4, to: 11.4, width: 21 },
    { type: 'mud', at: 9.9, len: 40, d: -9, w: 5 }, { type: 'obstacle', kind: 'roller', at: 10.5, d: -9, amp: 4, period: 2.6, r: 2.2 },
    { type: 'boost', at: 9.9, d: 9, len: 7 }, { type: 'boost', at: 10.8, d: 9, len: 7 },
    { type: 'spring', at: 13.5, d: 4, w: 4 },
    { type: 'obstacle', kind: 'roller', at: 5.4, amp: 8, period: 3.4, r: 2.2 }, { type: 'obstacle', kind: 'stomper', at: 4.1, d: -3, period: 3.2, r: 2.4 },
    { type: 'obstacle', kind: 'stomper', at: 14.6, d: 3, period: 3.0, r: 2.4, finalLap: true },
    { type: 'ramp', at: 15.2, len: 6, power: 10, w: 10 },
    { type: 'boost', at: 0.3, d: 0, len: 7 }, { type: 'boost', at: 8.0, d: 0, len: 7 }, { type: 'boost', at: 16.8, d: 3, len: 7, finalLap: true },
    { type: 'items', at: 1.4, count: 5 }, { type: 'items', at: 5.9, count: 4 }, { type: 'items', at: 12.2, count: 5 }, { type: 'items', at: 15.8, count: 4 },
  ],
};
