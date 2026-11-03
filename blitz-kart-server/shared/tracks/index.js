// Track registry. Adding a track = adding a definition file and listing it here;
// physics, AI, items, minimap and the mesh builder all work from the same data.
import amberCoast from './amberCoast.js';
import neonCity from './neonCity.js';
import alpinePass from './alpinePass.js';
import volcanoRing from './volcanoRing.js';
import prismOrbit from './prismOrbit.js';
import lumenForest from './lumenForest.js';
import coralIsland from './coralIsland.js';
import cloudRoad from './cloudRoad.js';
import jungleTemple from './jungleTemple.js';
import goldenDunes from './goldenDunes.js';
import toyFactory from './toyFactory.js';
import candyTown from './candyTown.js';
import abandonedMine from './abandonedMine.js';
import pirateBay from './pirateBay.js';
import hauntedCastle from './hauntedCastle.js';
import underseaStation from './underseaStation.js';
import rainbowHighway from './rainbowHighway.js';
import starFair from './starFair.js';

export const TRACKS = Object.fromEntries([amberCoast, neonCity, alpinePass, volcanoRing, prismOrbit, lumenForest, coralIsland, cloudRoad, jungleTemple, goldenDunes, toyFactory, candyTown, abandonedMine, pirateBay, hauntedCastle, underseaStation, rainbowHighway, starFair].map((t) => [t.id, t]));

export const DEFAULT_TRACK = amberCoast.id;
