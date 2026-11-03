// NUBE CELESTE — a road resting on clouds high in the sky. Three times the road simply
// ends: the launch pad fires, the glider opens by itself and you land on the road
// further ahead and lower down. Climbs between the drops bring you back up.
export default {
  id: 'cloud-road', name: 'Nube Celeste', theme: 'sky', laps: 3, halfWidth: 11, shoulder: 3,
  points: [
    [0, 0, 90, 12], [90, -30, 92, 12], [170, 0, 95, 11], [215, 70, 96, 11], [195, 150, 86, 11],
    [120, 185, 84, 11], [40, 172, 87, 11], [-35, 140, 76, 11], [-105, 150, 77, 11], [-172, 95, 81, 11],
    [-205, 15, 85, 11], [-150, -62, 74, 11.5], [-70, -62, 82, 12],
  ],
  complex: { chicanes: [[1.2, 9.6, 80], [8.7, 9.6, 70]], crests: [[5.2, 3.5, 40]], narrow: [[11.2, 12.5, 7.5]] },
  zones: [
    { type: 'spring', at: 2.1, d: -4, w: 4 }, { type: 'spring', at: 9.4, d: 4, w: 4 },
    { type: 'obstacle', kind: 'slider', at: 12.2, amp: 5, period: 2.8, phase: 0.6 },
    { type: 'bridge', from: 0, to: 12.99 },
    { type: 'gap', from: 3.3, to: 3.8 }, { type: 'gap', from: 6.35, to: 6.8 }, { type: 'gap', from: 10.3, to: 10.75 },
    { type: 'boost', at: 3.05, d: 0, len: 6, w: 10 }, { type: 'boost', at: 6.1, d: 0, len: 6, w: 10 }, { type: 'boost', at: 10.05, d: 0, len: 6, w: 10 },
    { type: 'open', from: 8.2, to: 9.0, side: 'outer' },
    { type: 'obstacle', kind: 'slider', at: 1.5, amp: 6, period: 3.2 }, { type: 'obstacle', kind: 'slider', at: 8.6, amp: 5, period: 2.8, finalLap: true },
    { type: 'obstacle', kind: 'stomper', at: 11.6, d: 3, period: 3.2, r: 2.4, finalLap: true },
    { type: 'items', at: 0.8, count: 5 }, { type: 'items', at: 5.0, count: 4 }, { type: 'items', at: 9.3, count: 5 },
  ],
};
