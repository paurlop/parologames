// AUTOPISTA ARCOÍRIS — the final exam: a rainbow road floating among the stars, railless edges, two flying gaps (a cannon and a launch pad), a fork with opposing currents.
export default {
  id: 'rainbow-highway', name: 'Autopista Arcoíris', theme: 'rainbow', laps: 3, halfWidth: 11, shoulder: 4,
  points: [
    [0, 0, 80, 12], [110, -40, 84, 11], [200, -20, 90, 10.5], [260, 50, 96, 10], [240, 140, 92, 10], [160, 180, 86, 10.5], [80, 150, 92, 10], [20, 200, 98, 10], [-70, 210, 92, 10.5], [-150, 170, 84, 10.5], [-210, 100, 88, 10], [-220, 10, 92, 10], [-160, -60, 86, 11], [-80, -60, 82, 11.5],
  ],
  complex: { chicanes: [[0.6, 9, 80], [7.4, 9, 70], [12.4, 8, 70]], crests: [[2.4, 3, 40]], narrow: [[3.2, 4.2, 7.5], [10.2, 11.0, 7.5]] },
  zones: [
    { type: 'bridge', from: 0, to: 13.99 },
    { type: 'open', from: 3.2, to: 4.4, side: 'outer' },
    { type: 'open', from: 9.1, to: 10.0, side: 'outer' },
    { type: 'cannon', at: 4.7, power: 13 },
    { type: 'gap', from: 4.9, to: 5.3 },
    { type: 'gap', from: 8.3, to: 8.65 },
    { type: 'boost', at: 8.05, d: 0, len: 6, w: 10 },
    { type: 'split', from: 10.9, to: 12.2, width: 20 },
    { type: 'boost', at: 11.2, d: 8.5, len: 7 },
    { type: 'conveyor', at: 11.2, len: 30, d: -8.5, w: 5, push: -6 },
    { type: 'obstacle', kind: 'slider', at: 1.6, amp: 6, period: 2.8 },
    { type: 'obstacle', kind: 'slider', at: 6.6, amp: 6, period: 2.6, phase: 0.4 },
    { type: 'obstacle', kind: 'stomper', at: 13.0, d: 0, period: 3.0, r: 2.4, finalLap: true },
    { type: 'boost', at: 0.2, d: 0, len: 7 },
    { type: 'items', at: 1.0, count: 5 },
    { type: 'items', at: 6.0, count: 4 },
    { type: 'items', at: 9.8, count: 4 },
    { type: 'items', at: 12.8, count: 4 },
  ],
};
