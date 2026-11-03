// CUMBRE HELADA — alpine pass: climbs 22 m through switchbacks, a cliff edge with
// no barrier, a jump on the descent and a frozen lake where grip disappears.
export default {
  id: 'alpine-pass', name: 'Cumbre Helada', theme: 'alpine', laps: 3, halfWidth: 11, shoulder: 5,
  points: [
    [0, 0, 2, 12], [80, -40, 6, 11.5], [150, -30, 11, 11], [200, 30, 16, 11], [180, 100, 20, 11],
    [110, 130, 23, 11], [40, 110, 22, 11], [-20, 140, 18, 11], [-90, 150, 14, 11.5], [-160, 110, 10, 12],
    [-190, 40, 7, 12], [-170, -40, 4, 12], [-110, -80, 2.5, 12], [-50, -60, 2, 12],
  ],
  complex: { chicanes: [[0.8, 9.6, 80], [8.6, 11.2, 80]], crests: [[2.5, 4.2, 50], [11.6, 3.5, 50]], narrow: [[5.6, 7.2, 7.5]] },
  zones: [
    { type: 'conveyor', at: 12.0, len: 30, d: 0, w: 10, push: 7 },
    { type: 'obstacle', kind: 'stomper', at: 6.4, d: 0, period: 3.6, r: 2.2 },
    { type: 'obstacle', kind: 'slider', at: 2.6, amp: 6, period: 3.6 }, { type: 'obstacle', kind: 'stomper', at: 11.2, d: 3, period: 3.4, r: 2.4, finalLap: true },
    { type: 'boost', at: 3.6, d: -3, len: 7, finalLap: true },
    { type: 'open', from: 4.3, to: 5.6, side: 'outer' },
    { type: 'ice', from: 10.6, to: 12.4 },
    { type: 'ramp', at: 7.6, len: 6, power: 11, w: 10 },
    { type: 'boost', at: 0.5, d: 0, len: 7 }, { type: 'boost', at: 9.2, d: 3, len: 7 },
    { type: 'items', at: 1.6, count: 5 }, { type: 'items', at: 6.3, count: 4 }, { type: 'items', at: 12.8, count: 5 },
  ],
};
