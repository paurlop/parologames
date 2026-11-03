// CASTILLO ENCANTADO — moonlit castle: a cannon over the moat, corridors inside the castle with crushing pillars, a drawbridge with no rail, a fork in the courtyard, floating ghosts.
export default {
  id: 'haunted-castle', name: 'Castillo Encantado', theme: 'castle', laps: 3, halfWidth: 11, shoulder: 4,
  points: [
    [0, 0, 4, 12], [100, -30, 6, 11], [190, -80, 10, 10.5], [270, -50, 14, 10.5], [300, 30, 18, 10.5], [260, 110, 20, 10.5], [180, 140, 17, 10.5], [110, 110, 13, 10], [40, 160, 10, 10.5], [-50, 180, 9, 11], [-140, 150, 8, 11], [-210, 90, 7, 11], [-230, 0, 6, 11], [-180, -60, 5, 11.5], [-90, -60, 4, 12],
  ],
  complex: { chicanes: [[0.5, 10, 80], [11.6, 9, 70]], crests: [[9.4, 3.5, 40]], narrow: [[7.2, 8.2, 7.5]] },
  zones: [
    { type: 'tunnel', from: 4.3, to: 6.4 },
    { type: 'split', from: 9.6, to: 11.3, width: 21 },
    { type: 'mud', at: 10.0, len: 32, d: -9, w: 5 },
    { type: 'boost', at: 10.3, d: 9, len: 7 },
    { type: 'cannon', at: 2.5, power: 13 },
    { type: 'gap', from: 2.7, to: 3.05 },
    { type: 'bridge', from: 7.3, to: 8.1 },
    { type: 'open', from: 7.3, to: 8.1, side: 'outer' },
    { type: 'obstacle', kind: 'stomper', at: 4.9, d: -3.5, period: 2.8, r: 2.4 },
    { type: 'obstacle', kind: 'stomper', at: 5.6, d: 3.5, period: 2.8, phase: 0.5, r: 2.4 },
    { type: 'obstacle', kind: 'slider', at: 12.6, amp: 7, period: 3 },
    { type: 'obstacle', kind: 'stomper', at: 13.4, d: 0, period: 3.2, r: 2.4, finalLap: true },
    { type: 'boost', at: 0.2, d: 0, len: 7 },
    { type: 'boost', at: 13.8, d: 3, len: 7, finalLap: true },
    { type: 'items', at: 1.4, count: 5 },
    { type: 'items', at: 6.8, count: 4 },
    { type: 'items', at: 11.8, count: 5 },
  ],
};
