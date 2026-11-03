// ESTACIÓN SUBMARINA — the road dives to −12 m below the sea: glass tunnels, a research base, floaty underwater physics the whole lap, a fork between a current (conveyor) and a boost lane.
export default {
  id: 'undersea-station', name: 'Estación Submarina', theme: 'undersea', laps: 3, halfWidth: 11, shoulder: 4,
  points: [
    [0, 0, 3, 12], [90, -40, 0, 11], [170, -90, -6, 11], [250, -70, -10, 10.5], [290, 10, -12, 10.5], [250, 90, -12, 10.5], [170, 120, -10, 11], [100, 90, -8, 11], [30, 140, -10, 10.5], [-50, 170, -12, 10.5], [-130, 140, -10, 11], [-190, 80, -6, 11], [-200, 0, -2, 11.5], [-140, -60, 1, 12], [-60, -50, 3, 12],
  ],
  complex: { chicanes: [[4.6, 9, 70], [9.6, 9, 70]], crests: [[6.8, 3, 40]], narrow: [[7.6, 8.4, 7.5]] },
  zones: [
    { type: 'water', from: 1.4, to: 12.3 },
    { type: 'tunnel', from: 2.6, to: 4.2 },
    { type: 'tunnel', from: 10.2, to: 11.4 },
    { type: 'split', from: 5.0, to: 6.7, width: 21 },
    { type: 'conveyor', at: 5.5, len: 40, d: -9, w: 5, push: 6 },
    { type: 'boost', at: 5.7, d: 9, len: 7 },
    { type: 'spring', at: 8.9, d: 4, w: 4 },
    { type: 'obstacle', kind: 'slider', at: 7.4, amp: 7, period: 3.2 },
    { type: 'obstacle', kind: 'roller', at: 9.2, amp: 7, period: 3.0, r: 2.2 },
    { type: 'obstacle', kind: 'stomper', at: 3.4, d: 0, period: 3.0, r: 2.4, finalLap: true },
    { type: 'boost', at: 0.3, d: 0, len: 7 },
    { type: 'boost', at: 12.6, d: 0, len: 7, finalLap: true },
    { type: 'items', at: 1.0, count: 5 },
    { type: 'items', at: 4.6, count: 4 },
    { type: 'items', at: 8.0, count: 5 },
    { type: 'items', at: 12.0, count: 4 },
  ],
};
