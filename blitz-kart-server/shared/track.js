// Track builder: turns a compact authoring format (control points + zones keyed
// by control-point index) into evenly spaced samples that both physics and the
// renderer use. Pure JS, no Three.js, so the server can load the same tracks.
//
// Coordinates: x/z ground plane, y up. Kart forward = (sin h, cos h),
// right = (-fz, fx). Lateral offset d > 0 means "right of the centre line".

export const STEP = 2; // metres between samples

export const F_WALL_R = 1, F_WALL_L = 2, F_BRIDGE = 4, F_OPEN_R = 8, F_OPEN_L = 16, F_ICE = 32;

function centripetal(p0, p1, p2, p3, t, out) {
  const dist = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-4, 0.5);
  const t0 = 0, t1 = t0 + dist(p0, p1), t2 = t1 + dist(p1, p2), t3 = t2 + dist(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  for (let c = 0; c < p1.length; c++) {
    const a1 = ((t1 - tt) * p0[c] + (tt - t0) * p1[c]) / (t1 - t0);
    const a2 = ((t2 - tt) * p1[c] + (tt - t1) * p2[c]) / (t2 - t1);
    const a3 = ((t3 - tt) * p2[c] + (tt - t2) * p3[c]) / (t3 - t2);
    const b1 = ((t2 - tt) * a1 + (tt - t0) * a2) / (t2 - t0);
    const b2 = ((t3 - tt) * a2 + (tt - t1) * a3) / (t3 - t1);
    out[c] = ((t2 - tt) * b1 + (tt - t1) * b2) / (t2 - t1);
  }
  return out;
}

export function buildTrack(def) {
  const P = def.points.map(([x, z, y, hw]) => [x, y, z, hw ?? def.halfWidth ?? 11]);
  const m = P.length;
  const SUB = 48;
  // Dense polyline, remembering where each control point lands in arc length.
  const dense = [];
  const cpDense = [];
  for (let i = 0; i < m; i++) {
    cpDense.push(dense.length);
    const p0 = P[(i - 1 + m) % m], p1 = P[i], p2 = P[(i + 1) % m], p3 = P[(i + 2) % m];
    for (let j = 0; j < SUB; j++) dense.push(centripetal(p0, p1, p2, p3, j / SUB, new Array(4)));
  }
  const cum = new Float64Array(dense.length + 1);
  for (let i = 0; i < dense.length; i++) {
    const a = dense[i], b = dense[(i + 1) % dense.length];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const length = cum[dense.length];
  const n = Math.round(length / STEP);
  const step = length / n;
  const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n), HW = new Float32Array(n);
  let di = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step;
    while (cum[di + 1] < s) di++;
    const a = dense[di], b = dense[(di + 1) % dense.length];
    const t = (s - cum[di]) / (cum[di + 1] - cum[di] || 1);
    X[i] = a[0] + (b[0] - a[0]) * t; Y[i] = a[1] + (b[1] - a[1]) * t;
    Z[i] = a[2] + (b[2] - a[2]) * t; HW[i] = a[3] + (b[3] - a[3]) * t;
  }
  const cpS = cpDense.map((d) => cum[d]);
  // control-point index (fractional) -> arc length
  const cpToS = (u) => {
    const i = Math.floor(u), f = u - i;
    const a = cpS[((i % m) + m) % m], b = i + 1 >= m ? length : cpS[(i + 1) % m];
    return a + (b - a) * f;
  };

  const TX = new Float32Array(n), TZ = new Float32Array(n), GRADE = new Float32Array(n), CURV = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const dx = X[b] - X[a], dz = Z[b] - Z[a], l = Math.hypot(dx, dz) || 1;
    TX[i] = dx / l; TZ[i] = dz / l;
    GRADE[i] = (Y[b] - Y[a]) / (2 * step);
  }
  for (let i = 0; i < n; i++) {
    const a = (i - 2 + n) % n, b = (i + 2) % n;
    const ha = Math.atan2(TX[a], TZ[a]), hb = Math.atan2(TX[b], TZ[b]);
    let dh = hb - ha;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    CURV[i] = dh / (4 * step); // rad per metre, + = turning left (heading increases)
  }

  // centroid for "inner"/"outer" side resolution
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += X[i]; cz += Z[i]; }
  cx /= n; cz /= n;

  const FLAGS = new Uint8Array(n).fill(F_WALL_L | F_WALL_R);
  const SHL = new Float32Array(n).fill(def.shoulder ?? 5);
  const SHR = new Float32Array(n).fill(def.shoulder ?? 5);
  const inRange = (i, from, to) => {
    const s = i * step, a = cpToS(from), b = cpToS(to);
    return a <= b ? s >= a && s <= b : s >= a || s <= b;
  };
  // side 'L'|'R'|'outer'|'inner' -> 'L' or 'R' at sample i
  const sideAt = (i, side) => {
    if (side === 'L' || side === 'R') return side;
    // right normal = (-tz, tx); outer = pointing away from the local loop centre.
    // Use curvature: turning left (+) means the left side is inner.
    const c = CURV[i];
    let rightIsOuter;
    if (Math.abs(c) > 0.002) rightIsOuter = c > 0;
    else rightIsOuter = (-TZ[i]) * (X[i] - cx) + TX[i] * (Z[i] - cz) > 0;
    const outer = rightIsOuter ? 'R' : 'L';
    return side === 'outer' ? outer : outer === 'R' ? 'L' : 'R';
  };

  const zones = { boost: [], ramp: [], items: [], open: [], bridge: [], sand: [], ice: [] };
  for (const z of def.zones || []) {
    if (z.type === 'open' || z.type === 'sand' || z.type === 'bridge' || z.type === 'ice') {
      // Resolve side once at the middle of the range so it does not flip mid-zone.
      const mid = Math.round(((cpToS(z.from) + (z.to < z.from ? cpToS(z.to) + length : cpToS(z.to))) / 2 % length) / step) % n;
      const side = z.side ? sideAt(mid, z.side) : null;
      for (let i = 0; i < n; i++) {
        if (!inRange(i, z.from, z.to)) continue;
        if (z.type === 'bridge') FLAGS[i] |= F_BRIDGE;
        if (z.type === 'ice') FLAGS[i] |= F_ICE;
        if (z.type === 'open') {
          if (side === 'R') { FLAGS[i] &= ~F_WALL_R; FLAGS[i] |= F_OPEN_R; }
          else { FLAGS[i] &= ~F_WALL_L; FLAGS[i] |= F_OPEN_L; }
        }
        if (z.type === 'sand') {
          if (side === 'R') SHR[i] = Math.max(SHR[i], z.width); else SHL[i] = Math.max(SHL[i], z.width);
        }
      }
      zones[z.type].push({ from: cpToS(z.from), to: cpToS(z.to), side });
    } else if (z.type === 'boost') {
      zones.boost.push({ s: cpToS(z.at), d: z.d ?? 0, len: z.len ?? 7, w: z.w ?? 4.5 });
    } else if (z.type === 'ramp') {
      zones.ramp.push({ s: cpToS(z.at), len: z.len ?? 6, power: z.power ?? 11, w: z.w ?? 9 });
    } else if (z.type === 'items') {
      zones.items.push({ s: cpToS(z.at), count: z.count ?? 5 });
    }
  }
  // Smooth shoulder widths so sand areas blend in instead of stepping.
  for (const SH of [SHL, SHR]) {
    const copy = SH.slice();
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let o = -6; o <= 6; o++) acc += copy[(i + o + n) % n];
      SH[i] = Math.max(copy[i] * 0.5, acc / 13);
    }
  }

  const track = {
    def, id: def.id, name: def.name, laps: def.laps ?? 3,
    n, step, length, X, Y, Z, HW, TX, TZ, GRADE, CURV, FLAGS, SHL, SHR, zones, cpToS,
  };
  track.sampleAtS = (s) => ((Math.floor(((s % length) + length) % length / step)) % n);
  return track;
}

const _q = { seg: 0, s: 0, d: 0, t: 0, y: 0, hw: 0, edgeL: 0, edgeR: 0, tx: 0, tz: 0, flags: 0, grade: 0 };

// Project a point onto the track near hint index `seg` (windowed search keeps
// overpasses unambiguous). Pass seg = -1 for a global search.
export function queryTrack(track, x, y, z, seg, out = _q, window = 32) {
  const { n, X, Y, Z } = track;
  let best = 0, bd = Infinity;
  const from = seg < 0 ? 0 : -window, to = seg < 0 ? n - 1 : window;
  for (let o = from; o <= to; o++) {
    const i = seg < 0 ? o : (seg + o + n) % n;
    const dx = x - X[i], dz = z - Z[i], dy = y - Y[i];
    let d2 = dx * dx + dz * dz;
    const ady = Math.abs(dy);
    if (ady > 4) d2 += (ady - 4) * (ady - 4) * 6;
    if (d2 < bd) { bd = d2; best = i; }
  }
  // refine on the neighbouring segment
  let i = best, j = (best + 1) % n;
  let ex = X[j] - X[i], ez = Z[j] - Z[i];
  let t = ((x - X[i]) * ex + (z - Z[i]) * ez) / (ex * ex + ez * ez || 1);
  if (t < 0) {
    j = i; i = (best - 1 + n) % n;
    ex = X[j] - X[i]; ez = Z[j] - Z[i];
    t = ((x - X[i]) * ex + (z - Z[i]) * ez) / (ex * ex + ez * ez || 1);
  }
  t = Math.min(1, Math.max(0, t));
  const px = X[i] + ex * t, pz = Z[i] + ez * t;
  const tx = track.TX[i] + (track.TX[j] - track.TX[i]) * t;
  const tz = track.TZ[i] + (track.TZ[j] - track.TZ[i]) * t;
  const tl = Math.hypot(tx, tz) || 1;
  out.tx = tx / tl; out.tz = tz / tl;
  out.seg = best;
  out.t = t;
  out.s = i * track.step + t * track.step;
  out.d = (x - px) * (-out.tz) + (z - pz) * out.tx;
  out.y = Y[i] + (Y[j] - Y[i]) * t;
  out.hw = track.HW[i] + (track.HW[j] - track.HW[i]) * t;
  out.edgeL = out.hw + track.SHL[best];
  out.edgeR = out.hw + track.SHR[best];
  out.flags = track.FLAGS[best];
  out.grade = track.GRADE[best];
  return out;
}

// Ground height at a lateral offset (open edges fall away towards the sea).
export function groundAt(q, d) {
  if (d > q.edgeR && (q.flags & 8)) return q.y - (d - q.edgeR) * 1.4;
  if (d < -q.edgeL && (q.flags & 16)) return q.y - (-q.edgeL - d) * 1.4;
  return q.y;
}

export function gridSlot(track, index) {
  // Two columns, staggered, behind the start line (s = 0).
  const row = Math.floor(index / 2), col = index % 2;
  const s = track.length - 8 - row * 6.5 - col * 3;
  const i = track.sampleAtS(s);
  const hw = track.HW[i];
  const d = (col === 0 ? -1 : 1) * hw * 0.42;
  const tx = track.TX[i], tz = track.TZ[i];
  return {
    x: track.X[i] + (-tz) * d,
    z: track.Z[i] + tx * d,
    y: track.Y[i],
    heading: Math.atan2(tx, tz),
    seg: i,
  };
}
