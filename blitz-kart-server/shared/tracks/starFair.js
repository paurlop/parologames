// FERIA ESTELAR — night carnival: a cannon fires you over the bumper cars, the funhouse tunnel, a fork by the carousel, Ferris wheel, roller coaster, fireworks.
export default {
  id: 'star-fair', name: 'Feria Estelar', theme: 'fair', laps: 3, halfWidth: 11, shoulder: 4,
  points: [
    [0, 0, 3, 12], [100, -30, 4, 11], [190, -70, 7, 10.5], [270, -40, 11, 10.5], [300, 40, 15, 10.5], [250, 120, 13, 10.5], [170, 150, 9, 11], [90, 110, 6, 10.5], [20, 160, 5, 10.5], [-60, 190, 7, 11], [-150, 160, 9, 11], [-220, 100, 6, 11], [-240, 10, 4, 11.5], [-180, -60, 3, 12], [-90, -60, 3, 12],
  ],
  complex: { chicanes: [[0.5, 10, 80], [7.6, 9, 70]], crests: [[2.4, 3.5, 40], [9.4, 3.5, 40], [9.9, 3, 30]], narrow: [[6.2, 7.0, 7.5]] },
  zones: [
    { type: 'split', from: 11.0, to: 12.6, width: 21 },
    { type: 'spring', at: 11.5, d: -9, w: 4 },
    { type: 'boost', at: 11.4, d: 9, len: 7 },
    { type: 'tunnel', from: 4.6, to: 5.8 },
    { type: 'cannon', at: 3.4, power: 13 },
    { type: 'gap', from: 3.6, to: 3.95 },
    { type: 'conveyor', at: 8.2, len: 30, d: 0, w: 10, push: 8 },
    { type: 'obstacle', kind: 'roller', at: 6.6, amp: 7, period: 2.8, r: 2.2 },
    { type: 'obstacle', kind: 'slider', at: 13.2, amp: 7, period: 3.0 },
    { type: 'obstacle', kind: 'stomper', at: 5.2, d: 0, period: 3.0, r: 2.4 },
    { type: 'obstacle', kind: 'roller', at: 1.6, amp: 7, period: 2.6, r: 2.2, finalLap: true },
    { type: 'boost', at: 0.2, d: 0, len: 7 },
    { type: 'boost', at: 13.8, d: -3, len: 7, finalLap: true },
    { type: 'items', at: 1.2, count: 5 },
    { type: 'items', at: 6.0, count: 4 },
    { type: 'items', at: 10.4, count: 5 },
  ],
};
