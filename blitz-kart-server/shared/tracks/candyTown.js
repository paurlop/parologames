// CIUDAD PASTELERA (rediseño) — ~1.5 km. The route forks at the chocolate river
// (caramel shortcut vs. gummy springs), a gummy cannon launches you over the river,
// and the road burrows through a giant cookie-and-cream tunnel.
export default {
  id: 'candy-town', name: 'Ciudad Pastelera', theme: 'candy', laps: 3, halfWidth: 11, shoulder: 4,
  points: [
    [0, 0, 3, 12], [90, -40, 5, 11], [180, -40, 8, 11], [250, 20, 10, 11], [270, 110, 9, 10.5],
    [210, 180, 7, 10.5], [130, 190, 8, 10.5], [60, 150, 9, 10.5], [-10, 190, 12, 11], [-90, 210, 10, 11],
    [-170, 180, 7, 11], [-230, 110, 5, 11], [-240, 20, 4, 11.5], [-190, -50, 3, 12], [-110, -60, 3, 12],
    [-40, -40, 3, 12],
  ],
  complex: { chicanes: [[1.0, 10, 80], [12.4, 9, 80]], crests: [[2.4, 3.5, 40], [7.6, 3, 40]], narrow: [[11.2, 12.0, 7.5]] },
  zones: [
    { type: 'split', from: 3.3, to: 5.0, width: 21 },
    { type: 'mud', at: 3.7, len: 40, d: -9, w: 5 }, { type: 'spring', at: 4.2, d: 9, w: 4 }, { type: 'boost', at: 4.5, d: 9, len: 7 },
    { type: 'cannon', at: 6.4, power: 13 }, { type: 'gap', from: 6.6, to: 6.95 },
    { type: 'tunnel', from: 9.3, to: 10.6 },
    { type: 'mud', at: 13.4, len: 22, d: 0, w: 4 }, { type: 'spring', at: 1.8, d: 4, w: 4 },
    { type: 'obstacle', kind: 'roller', at: 8.4, amp: 7, period: 3.2, r: 2.2 }, { type: 'obstacle', kind: 'slider', at: 14.4, amp: 6, period: 2.8 },
    { type: 'obstacle', kind: 'slider', at: 11.6, amp: 6, period: 2.6, finalLap: true },
    { type: 'boost', at: 0.3, d: 0, len: 7 }, { type: 'boost', at: 7.2, d: -3, len: 7 }, { type: 'boost', at: 13.0, d: 3, len: 7, finalLap: true },
    { type: 'items', at: 1.2, count: 5 }, { type: 'items', at: 5.6, count: 4 }, { type: 'items', at: 8.9, count: 5 }, { type: 'items', at: 12.8, count: 4 },
  ],
};
