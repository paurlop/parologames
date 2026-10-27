---
version: 1
slug: "src-views"
primary_target: "src/views"
related_targets: ["public"]
---

# Surface brief: public site (splash, shelf, game page) + admin panel

Scope: the whole web surface of parologames. Splash `/`, catalogue `/juegos`, game page `/juegos/:slug` are **Experience** mode; the admin panel under ADMIN_PATH is **Operate** mode and inherits the tokens soberly.

Audience: anonymous players arriving from shared links, often on phones; the owner (Pau) publishing from a desktop. Job: get from a link to playing a game in seconds; download it if they want to keep it.

Pinned by the user: the site opens on the parolo logo with an «Entrar» option. Must not feel corporate.

Memorable moment: the boot — the parolo logo drops down the screen and stops with a click; «Entrar» is a real round A-button.

## Direction contract

THESIS: Every game is a physical cartridge with its own printed label, and parologames is the handheld it plugs into: the site boots, shows a shelf of cartridges, and a chosen cartridge clicks into the console to play. Refuses the category default of a dark thumbnail grid with hover glows.

OWN-WORLD: Light-grey moulded plastic body as the ground (a charcoal "special edition" body in dark mode), charcoal screen bezel, a four-tone screen palette of its own (ink, moss, lichen, pale), printed cartridge labels with a yellow stripe and heavy extended italic titles, ridged grip lines, a notched top corner on every cartridge. Plum A-button colour is reserved for actions only (Entrar, Jugar, Descargar). Archivo (variable width) for labels and UI, Silkscreen only on screen text.

STORY: The visitor understands this is one creator's own label of games, believes each game is a finished object worth keeping, and plays one immediately or downloads it.

FIRST VIEWPORT: The screen bezel fills the viewport; inside, the lowercase parolo wordmark sits large in the upper half after its boot drop; under the screen, «Entrar» as a round plum A-button with a keyboard hint (Enter). Nothing else competes. Below the fold the shelf begins: newest cartridge first.

FORM: Cartridge shelf / handheld console (IMPECCABLE'S PICK, position 1 on the ordered list), chosen by the user over the rolled pinball direction. seed:678d7188c2b7c6a5. Kept disciplines: mechanical motion (snaps with one overshoot, nothing floats), fixed stations (boot → shelf → slot), one action colour, high-contrast reading.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction and motion grammar

- Boot: wordmark translates from above the screen to rest in ~700 ms with one overshoot and a "click" settle; then the Entrar button lamp lights. Skippable, and static under `prefers-reduced-motion`.
- Insert: cross-document View Transition — the cartridge on the shelf morphs into the cartridge label on the game page; the screen powers on (scanline wipe) before the game frame shows.
- Hover/focus on a cartridge: it lifts out of its slot 6px with a snap, no glow.

## Unresolved

- No real games, covers or logo file yet: demo cartridges are labelled as demo and removable.
