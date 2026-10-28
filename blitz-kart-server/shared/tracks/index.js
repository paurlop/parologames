// Track registry. Adding a track = adding a definition file and listing it here;
// physics, AI, items, minimap and the mesh builder all work from the same data.
import amberCoast from './amberCoast.js';
import neonCity from './neonCity.js';
import alpinePass from './alpinePass.js';
import volcanoRing from './volcanoRing.js';
import prismOrbit from './prismOrbit.js';
import lumenForest from './lumenForest.js';

export const TRACKS = Object.fromEntries([amberCoast, neonCity, alpinePass, volcanoRing, prismOrbit, lumenForest].map((t) => [t.id, t]));

export const DEFAULT_TRACK = amberCoast.id;
