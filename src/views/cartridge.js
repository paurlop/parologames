import { html, safeUrl } from './_html.js';

// Each label is printed in one of four inks, picked from the game id so it never changes between visits.
const INKS = ['sun', 'brick', 'cobalt', 'fern'];
export function labelInk(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return INKS[h % INKS.length];
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} MB`;
}

export function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

// Without cover art the label prints the first letter of the title (skipping a "Demo:" prefix).
function monogram(title) {
  const clean = String(title).replace(/^demo:\s*/i, '');
  return [...clean.trim()][0] ?? '?';
}

const TITLE_TAGS = {
  h1: (t) => html`<h1 class="label-title">${t}</h1>`,
  h2: (t) => html`<h2 class="label-title">${t}</h2>`,
  h3: (t) => html`<h3 class="label-title">${t}</h3>`,
  span: (t) => html`<span class="label-title">${t}</span>`,
};

/** The printed label: cover art plus the title band. Shared by the shelf and the game page. */
export function label(game, { eager = false, large = false, titleAs = 'span' } = {}) {
  return html`<div class="label ink-${labelInk(game.id)}${large ? ' label-lg' : ''}">
  <div class="label-art">
    ${game.coverUrl
      ? html`<img src="${safeUrl(game.coverUrl)}" alt="" width="600" height="800" ${eager ? html`fetchpriority="high"` : html`loading="lazy"`} decoding="async">`
      : html`<span class="label-noart" aria-hidden="true">${monogram(game.title)}</span>`}
  </div>
  <div class="label-band">
    ${(TITLE_TAGS[titleAs] ?? TITLE_TAGS.span)(game.title)}
  </div>
</div>`;
}

/** One cartridge on the shelf. The whole cartridge is the link; its label title is the heading. */
export function cartridge(game, { eager = false, headingLevel = 3 } = {}) {
  return html`<li class="cart-slot">
  <a class="cart" href="/juegos/${encodeURIComponent(game.slug)}" data-cart="${game.id}">
    <span class="cart-grip" aria-hidden="true"></span>
    ${label(game, { eager, titleAs: headingLevel === 2 ? 'h2' : 'h3' })}
    <span class="cart-foot" aria-hidden="true">parolo</span>
  </a>
  <span class="cart-ledge" aria-hidden="true"></span>
  ${game.tagline ? html`<p class="cart-tag">${game.tagline}</p>` : ''}
</li>`;
}

export function shelf(games, { eagerCount = 0, headingLevel = 3 } = {}) {
  return html`<ul class="shelf" role="list">
  ${games.map((g, i) => cartridge(g, { eager: i < eagerCount, headingLevel }))}
</ul>`;
}

export function emptyShelf({ admin = false } = {}) {
  return html`<div class="empty">
  <div class="empty-slot" aria-hidden="true"><span></span></div>
  <div class="empty-copy">
    <h2 class="empty-title">La estantería está vacía</h2>
    <p>${admin
      ? 'Sube tu primer juego y aparecerá aquí como un cartucho nuevo.'
      : 'Todavía no hay juegos publicados. Vuelve pronto.'}</p>
  </div>
</div>`;
}
