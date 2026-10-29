// Track registry. Adding a track = adding a definition file and listing it here;
// physics, AI, items, minimap and the mesh builder all work from the same data.
import { buildTrack } from '../track.js';
import amberCoast from './amberCoast.js';
import neonCity from './neonCity.js';
import alpinePass from './alpinePass.js';
import volcanoRing from './volcanoRing.js';
import prismOrbit from './prismOrbit.js';
import lumenForest from './lumenForest.js';

// Atajos secretos y saltos extra calculados a partir de la propia pista (igual en cliente y servidor):
// en las dos curvas más cerradas se abre un arcén de arena interior para cortar la curva, con un turbo
// escondido a la salida; en la recta más larga se añade un salto.
function withSecrets(def) {
  const t = buildTrack(def), n = def.points.length;
  const curv = (c) => { const i = Math.round(t.cpToS(c) / t.step) % t.n; let k = 0; for (let j = -6; j <= 6; j++) k += Math.abs(t.CURV[(i + j + t.n) % t.n]); return k; };
  const zones = def.zones || [];
  const near = (c, type, pad) => zones.some((z) => z.type === type && (z.at != null ? Math.abs(z.at - c) < pad : c >= z.from - pad && c <= z.to + pad));
  const cps = [];
  for (let c = 1; c < n - 1; c++) cps.push([c, curv(c)]);
  const extra = [], picked = [];
  for (const [c] of cps.slice().sort((a, b) => b[1] - a[1])) {
    if (picked.length >= 2) break;
    if (near(c, 'sand', 1.5) || near(c, 'bridge', 1.2) || near(c, 'ramp', 1.6) || near(c, 'open', 1.2) || picked.some((p) => Math.abs(p - c) < 2.5)) continue;
    picked.push(c);
    extra.push({ type: 'sand', from: c - 0.85, to: c + 0.85, side: 'inner', width: 24 });
    extra.push({ type: 'boost', at: c + 1.05, d: 0, len: 6 });
  }
  const straight = cps.filter(([c]) => !picked.some((p) => Math.abs(p - c) < 1.5) && !near(c, 'ramp', 2) && !near(c, 'bridge', 1.5)).sort((a, b) => a[1] - b[1])[0];
  if (straight) extra.push({ type: 'ramp', at: straight[0] + 0.5, len: 6, power: 10, w: 10 });
  return { ...def, zones: [...zones, ...extra] };
}

export const TRACKS = Object.fromEntries([amberCoast, neonCity, alpinePass, volcanoRing, prismOrbit, lumenForest].map((t) => [t.id, withSecrets(t)]));

export const DEFAULT_TRACK = amberCoast.id;
