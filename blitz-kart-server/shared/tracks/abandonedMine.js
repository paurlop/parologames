// MINA ABANDONADA — ~1.5 km, most of it underground: three long galleries lit by
// lanterns and glowing crystals, runaway mine carts crossing, a cannon (blasting
// charge) over a collapsed shaft and a fork between the rail route and the flooded one.
export default {
  id: 'abandoned-mine', name: 'Mina Abandonada', theme: 'mine', laps: 3, halfWidth: 10, shoulder: 3,
  points: [
    [0, 0, 6, 11.5], [90, -30, 4, 10.5], [170, -80, 1, 10], [250, -70, -2, 10], [300, 0, -4, 10],
    [290, 90, -3, 10], [220, 140, 0, 10.5], [140, 130, 3, 10.5], [70, 180, 5, 10], [-20, 200, 4, 10],
    [-110, 170, 2, 10.5], [-190, 190, 3, 10.5], [-250, 120, 5, 10.5], [-250, 30, 6, 11], [-190, -40, 7, 11],
    [-100, -50, 7, 11.5],
  ],
  complex: { chicanes: [[8.6, 9, 70], [14.5, 9, 70]], crests: [[0.6, 3, 40], [7.4, 3, 40]], narrow: [[2.2, 3.2, 7.5]] },
  zones: [
    { type: 'tunnel', from: 1.6, to: 5.6 }, { type: 'tunnel', from: 8.3, to: 9.8 }, { type: 'tunnel', from: 11.4, to: 12.8 },
    { type: 'cannon', at: 6.2, power: 13 }, { type: 'gap', from: 6.4, to: 6.75 },
    { type: 'split', from: 9.9, to: 11.3, width: 20 },
    { type: 'mud', at: 10.2, len: 34, d: -8.5, w: 5 }, { type: 'boost', at: 10.5, d: 8.5, len: 7 },
    { type: 'obstacle', kind: 'slider', at: 3.0, amp: 7, period: 2.8 }, { type: 'obstacle', kind: 'slider', at: 4.6, amp: 7, period: 3.2, phase: 0.4 },
    { type: 'obstacle', kind: 'stomper', at: 12.0, d: 3, period: 3.0, r: 2.4 }, { type: 'obstacle', kind: 'slider', at: 13.6, amp: 7, period: 2.6, finalLap: true },
    { type: 'conveyor', at: 7.6, len: 30, d: 0, w: 10, push: 7 },
    { type: 'boost', at: 0.3, d: 0, len: 7 }, { type: 'boost', at: 5.8, d: 0, len: 7 }, { type: 'boost', at: 14.8, d: -3, len: 7, finalLap: true },
    { type: 'items', at: 1.2, count: 5 }, { type: 'items', at: 4.0, count: 4 }, { type: 'items', at: 9.0, count: 4 }, { type: 'items', at: 13.2, count: 5 },
  ],
};
