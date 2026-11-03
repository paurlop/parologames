// FÁBRICA DE JUGUETES (rediseño) — ~1.6 km. Through the inside of a giant toy box
// (tunnel), shot by a cannon across the assembly gap, then the line forks into two
// conveyor lanes that push in opposite directions. Presses, bouncing balls, springs.
export default {
  id: 'toy-factory', name: 'Fábrica de Juguetes', theme: 'toy', laps: 3, halfWidth: 10.5, shoulder: 3,
  points: [
    [0, 0, 2, 12], [100, -10, 2, 11], [180, -60, 4, 10.5], [260, -40, 8, 10.5], [290, 40, 12, 10.5],
    [250, 110, 12, 10.5], [170, 120, 9, 10], [120, 180, 6, 10.5], [40, 200, 4, 11], [-50, 190, 3, 11],
    [-130, 150, 3, 11], [-200, 170, 5, 11], [-260, 110, 6, 11], [-260, 20, 4, 11], [-200, -50, 2, 11.5],
    [-110, -60, 2, 12], [-50, -30, 2, 12],
  ],
  complex: { chicanes: [[0.5, 10, 80], [9.5, 9, 80]], crests: [[3.4, 3, 40]], narrow: [[6.2, 7.0, 7.5]] },
  zones: [
    { type: 'tunnel', from: 7.2, to: 8.6 },
    { type: 'cannon', at: 4.45, power: 13 }, { type: 'gap', from: 4.65, to: 5.0 },
    { type: 'split', from: 11.2, to: 13.3, width: 21 },
    { type: 'conveyor', at: 11.7, len: 50, d: -9, w: 6, push: 8 }, { type: 'conveyor', at: 11.7, len: 50, d: 9, w: 6, push: -8 },
    { type: 'conveyor', at: 1.2, len: 40, d: 0, w: 10, push: 9 },
    { type: 'obstacle', kind: 'stomper', at: 6.3, d: -4, period: 2.8, r: 2.4 }, { type: 'obstacle', kind: 'stomper', at: 6.8, d: 4, period: 2.8, phase: 0.5, r: 2.4 },
    { type: 'obstacle', kind: 'slider', at: 14.2, amp: 7, period: 3.0 }, { type: 'obstacle', kind: 'slider', at: 9.6, amp: 7, period: 2.7 },
    { type: 'obstacle', kind: 'stomper', at: 2.6, d: 0, period: 3.0, r: 2.4, finalLap: true },
    { type: 'spring', at: 3.0, d: -4, w: 4 }, { type: 'spring', at: 15.2, d: 4, w: 4 },
    { type: 'boost', at: 0.2, d: 0, len: 7 }, { type: 'boost', at: 9.0, d: 3, len: 7 }, { type: 'boost', at: 15.6, d: -3, len: 7, finalLap: true },
    { type: 'items', at: 0.9, count: 5 }, { type: 'items', at: 5.8, count: 4 }, { type: 'items', at: 10.4, count: 5 }, { type: 'items', at: 14.6, count: 4 },
  ],
};
