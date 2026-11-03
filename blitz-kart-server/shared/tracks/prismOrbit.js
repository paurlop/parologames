// ÓRBITA PRISMA — a road floating in space: climbs 32 m on a spiral, two stretches
// with no rails over the void, and a launch pad at the top of the descent.
export default {
  id: 'prism-orbit', name: 'Órbita Prisma', theme: 'space', laps: 3, halfWidth: 11, shoulder: 3,
  points: [
    [0, 0, 40, 12], [90, -30, 44, 12], [170, -10, 50, 11], [220, 60, 58, 11], [190, 140, 66, 11],
    [110, 170, 72, 11], [30, 140, 70, 11], [-30, 90, 62, 11], [-90, 110, 55, 11], [-160, 80, 48, 11],
    [-190, 0, 44, 12], [-140, -70, 41, 12], [-70, -60, 40, 12],
  ],
  complex: { chicanes: [[1.2, 9.6, 80], [9.8, 9.6, 80]], crests: [[4.0, 4.2, 50]], narrow: [[7.5, 8.6, 7.5]] },
  zones: [
    { type: 'conveyor', at: 3.0, len: 40, d: 0, w: 10, push: -9 },
    { type: 'obstacle', kind: 'stomper', at: 5.8, d: 3, period: 3.2, r: 2.4 },
    { type: 'obstacle', kind: 'slider', at: 2.4, amp: 6, period: 3 }, { type: 'obstacle', kind: 'slider', at: 8.4, amp: 6, period: 2.6, phase: 0.3, finalLap: true },
    { type: 'boost', at: 11.8, d: 0, len: 7, finalLap: true },
    { type: 'bridge', from: 0, to: 12.99 },
    { type: 'open', from: 5.3, to: 6.6, side: 'outer' }, { type: 'open', from: 10.3, to: 11.3, side: 'outer' },
    { type: 'ramp', at: 6.9, len: 6, power: 11, w: 10 },
    { type: 'boost', at: 0.6, d: 0, len: 7 }, { type: 'boost', at: 3.4, d: 3, len: 7 }, { type: 'boost', at: 9.2, d: -3, len: 7 },
    { type: 'items', at: 1.5, count: 5 }, { type: 'items', at: 5.0, count: 4 }, { type: 'items', at: 9.8, count: 5 },
  ],
};
