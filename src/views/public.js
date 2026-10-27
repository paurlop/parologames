import { html, safeUrl } from './_html.js';
import { layout } from './layout.js';
import { icon } from './icons.js';
import { shelf, emptyShelf, label, formatSize, formatDate } from './cartridge.js';

/** GET / — the console boots: parolo wordmark on the screen, «Entrar» as the A button. */
export function renderSplash({ featured = null, latest = [], assetVersion, csp } = {}) {
  const newest = dedupe([featured, ...latest]).slice(0, 6);
  const [lead, ...rest] = newest;
  const body = html`<main id="main">
  <div class="console">
    <div class="console-wing console-wing-l" aria-hidden="true">
      <span class="power"><span class="led led-on"></span>POWER</span>
      <span class="dpad" data-dpad><span></span></span>
    </div>
    <section class="bezel bezel-boot" aria-labelledby="boot-title">
      <p class="bezel-print" aria-hidden="true"><span class="bezel-line"></span>PAROLO · PANTALLA DE JUEGO<span class="bezel-line"></span></p>
      <div class="screen screen-boot" data-boot>
        <span class="screen-gloss" aria-hidden="true"></span>
        <h1 class="boot-logo" id="boot-title" data-logo><span class="boot-parolo">parolo</span><span class="boot-games">games</span></h1>
        <p class="boot-press" aria-hidden="true">PULSA ENTRAR</p>
      </div>
    </section>
    <div class="console-wing console-wing-r">
      <a class="abtn abtn-xl" href="/juegos" data-enter>
        <span class="abtn-cap" aria-hidden="true">A</span>
        <span class="abtn-label">Entrar</span>
      </a>
      <p class="hint" aria-hidden="true">o pulsa <kbd>Intro</kbd></p>
    </div>
    <div class="grille" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
    <aside class="console-note" aria-label="En la estantería">
      <p class="console-note-title">En la estantería</p>
      ${lead
        ? html`<p>Último cartucho: <a href="/juegos/${encodeURIComponent(lead.slug)}">${lead.title}</a></p>`
        : html`<p>Los primeros juegos llegan pronto.</p>`}
      <p>Se juegan en el navegador y se descargan gratis.</p>
    </aside>
  </div>

  <section class="intro" aria-labelledby="intro-title">
    <h2 class="section-title section-title-center" id="intro-title">Juegos hechos para jugar ya</h2>
    <p class="intro-copy">parologames es la estantería de mis juegos. Cada uno se juega aquí mismo, en el navegador, sin instalar nada ni crear cuentas. Si te gusta, te lo llevas: todos se pueden descargar.</p>
    <p class="intro-actions"><a class="btn btn-action btn-lg" href="/juegos">${icon('play')}Ver los juegos</a></p>
  </section>

  ${lead
    ? html`<section class="arrivals" aria-labelledby="arrivals-title">
    <div class="arrivals-backdrop" aria-hidden="true">
      ${lead.coverUrl ? html`<img src="${safeUrl(lead.coverUrl)}" alt="" loading="lazy" decoding="async">` : html`<span class="arrivals-pattern"></span>`}
    </div>
    <h2 class="section-title section-title-center section-title-light" id="arrivals-title">Recién llegados</h2>
    <ol class="arrivals-list" role="list">
      ${newest.slice(0, 3).map((g, i) => arrivalCard(g, i))}
    </ol>
  </section>`
    : html`<section class="page">${emptyShelf()}</section>`}

  ${rest.length > 2
    ? html`<section class="page carta" aria-labelledby="carta-title">
    <h2 class="section-title section-title-center" id="carta-title">También en la estantería</h2>
    <ul class="carta-list" role="list">
      ${rest.slice(2).map((g) => html`<li class="carta-row">
        <a class="carta-link" href="/juegos/${encodeURIComponent(g.slug)}">
          <span class="carta-name">${g.title}</span>
          <span class="carta-size">${formatSize(g.downloadSize || g.webSize)}</span>
        </a>
        ${g.tagline ? html`<p class="carta-desc">${g.tagline}</p>` : ''}
      </li>`)}
    </ul>
    <p class="intro-actions"><a class="textlink" href="/juegos">Ver la estantería completa ${icon('right')}</a></p>
  </section>`
    : ''}
</main>`;
  return layout({
    title: '',
    description: 'parologames: juegos para jugar gratis en el navegador o descargar.',
    variant: 'splash',
    scripts: ['site.js'],
    assetVersion,
    csp,
    body,
  }).toString();
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((g) => g && !seen.has(g.id) && seen.add(g.id));
}

/** One "featured dish": a printed card floating over the fixed backdrop, offset left/right in turn. */
function arrivalCard(game, i) {
  const href = `/juegos/${encodeURIComponent(game.slug)}`;
  const size = formatSize(game.webSize);
  return html`<li class="arrival${i % 2 ? ' arrival-right' : ''}">
  <a class="arrival-art" href="${href}" tabindex="-1" aria-hidden="true">${label(game)}</a>
  <div class="arrival-body">
    <h3 class="arrival-title"><a href="${href}">${game.title}</a></h3>
    ${game.tagline ? html`<p class="arrival-tag">${game.tagline}</p>` : ''}
    <div class="arrival-foot">
      <span class="arrival-size">${size ? html`${size}<small> para jugar</small>` : 'Gratis'}</span>
      <a class="btn btn-action" href="${href}">${icon('play')}Jugar</a>
    </div>
  </div>
</li>`;
}

/** GET /juegos — the full shelf, newest first, paginated. */
export function renderCatalog({ games = [], page = 1, totalPages = 1, total, assetVersion, csp } = {}) {
  const count = Number.isFinite(total) ? total : games.length;
  const featured = page === 1 ? games.find((g) => g.featured) : null;
  const body = html`<main id="main" class="page">
  <header class="page-head page-head-shelf">
    <div>
      <h1 class="display">Juegos</h1>
      <p class="page-sub">Elige un cartucho para jugar en el navegador o descargarlo.</p>
    </div>
    <p class="lcd-badge"><span class="lcd-badge-num">${String(count).padStart(2, '0')}</span> ${count === 1 ? 'cartucho' : 'cartuchos'}</p>
  </header>
  ${featured ? featureSlot(featured) : ''}
  ${games.length ? shelf(games, { eagerCount: 4, headingLevel: 2 }) : emptyShelf()}
  ${totalPages > 1 ? pager(page, totalPages) : ''}
</main>`;
  return layout({
    title: page > 1 ? `Juegos, página ${page}` : 'Juegos',
    description: 'Todos los juegos de parologames, para jugar en el navegador o descargar.',
    scripts: ['site.js'],
    assetVersion,
    csp,
    body,
  }).toString();
}

/** The featured game rises out of a cartridge slot cut into the console body. */
function featureSlot(game) {
  const href = `/juegos/${encodeURIComponent(game.slug)}`;
  return html`<section class="feature" aria-labelledby="feature-title">
  <div class="feature-slot" aria-hidden="true">
    <div class="feature-cart">
      <span class="cart-grip"></span>
      ${label(game, { eager: true, large: true })}
    </div>
    <span class="feature-mouth"></span>
  </div>
  <div class="feature-copy">
    <h2 class="feature-title" id="feature-title">${game.title}</h2>
    ${game.tagline ? html`<p class="feature-tag">${game.tagline}</p>` : ''}
    <p class="feature-actions">
      <a class="btn btn-action btn-lg" href="${href}">${icon('play')}Jugar ahora</a>
      ${game.hasDownload || game.webSize ? html`<a class="textlink" href="${href}/descargar" download>${icon('download')}Descargar</a>` : ''}
    </p>
  </div>
</section>`;
}

function pager(page, totalPages) {
  const link = (p) => (p === 1 ? '/juegos' : `/juegos?pagina=${p}`);
  return html`<nav class="pager" aria-label="Páginas">
  ${page > 1
    ? html`<a class="btn" href="${link(page - 1)}" rel="prev">${icon('left')}Anterior</a>`
    : html`<span class="btn is-disabled" aria-disabled="true">${icon('left')}Anterior</span>`}
  <span class="pager-pos">Página ${page} de ${totalPages}</span>
  ${page < totalPages
    ? html`<a class="btn" href="${link(page + 1)}" rel="next">Siguiente${icon('right')}</a>`
    : html`<span class="btn is-disabled" aria-disabled="true">Siguiente${icon('right')}</span>`}
</nav>`;
}

/** GET /juegos/:slug — the cartridge goes into the console. */
export function renderGame({ game, playUrl, assetVersion, csp } = {}) {
  const dl = `/juegos/${encodeURIComponent(game.slug)}/descargar`;
  const size = formatSize(game.downloadSize || game.webSize);
  const paragraphs = String(game.description || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const body = html`<main id="main" class="page game">
  <a class="textlink back" href="/juegos">${icon('back')}Volver a la estantería</a>
  <header class="game-head">
    <div>
      <h1 class="display display-game">${game.title}</h1>
      ${game.tagline ? html`<p class="page-sub">${game.tagline}</p>` : ''}
    </div>
  </header>

  <section class="player" aria-label="Jugar a ${game.title}">
    <div class="bezel bezel-game" data-player>
      <p class="bezel-print" aria-hidden="true"><span class="led" data-led></span><span class="bezel-line"></span>PAROLO<span class="bezel-line"></span></p>
      <div class="screen screen-game" data-screen>
        <div class="screen-off" data-off>
          ${game.coverUrl ? html`<img class="screen-cover" src="${safeUrl(game.coverUrl)}" alt="" width="600" height="800" fetchpriority="high" decoding="async">` : ''}
          <a class="abtn abtn-lg" href="${safeUrl(playUrl)}" target="_blank" rel="noopener" data-play="${safeUrl(playUrl)}" data-title="${game.title}">
            <span class="abtn-cap" aria-hidden="true">${icon('play')}</span>
            <span class="abtn-label">Jugar</span>
          </a>
          <p class="screen-note" data-note>Se carga al pulsar Jugar${game.webSize ? ` · ${formatSize(game.webSize)}` : ''}</p>
        </div>
      </div>
    </div>
    <div class="player-bar">
      <button class="btn" type="button" data-fullscreen hidden>${icon('fullscreen')}Pantalla completa</button>
      <span class="player-status" role="status" aria-live="polite" data-status></span>
      <a class="btn btn-action" href="${dl}" download>${icon('download')}Descargar${size ? html` <span class="btn-meta">${size}</span>` : ''}</a>
    </div>
  </section>

  <section class="game-info" aria-label="Sobre el juego">
    <div class="game-cart" data-cart-target="${game.id}">
      <span class="cart-grip" aria-hidden="true"></span>
      ${label(game, { large: true })}
      <span class="cart-foot" aria-hidden="true">parolo</span>
    </div>
    <div class="game-copy">
      ${paragraphs.length ? paragraphs.map((p) => html`<p>${p}</p>`) : html`<p class="muted">Este juego todavía no tiene descripción.</p>`}
      <dl class="facts">
        <div><dt>Se juega en</dt><dd>El navegador, sin instalar nada</dd></div>
        <div><dt>Descarga</dt><dd>${game.hasDownload ? 'Versión para descargar' : 'Versión web en ZIP'}${size ? ` · ${size}` : ''}</dd></div>
        ${game.updatedAt ? html`<div><dt>Actualizado</dt><dd><time datetime="${new Date(game.updatedAt).toISOString()}">${formatDate(game.updatedAt)}</time></dd></div>` : ''}
      </dl>
    </div>
  </section>
</main>`;
  return layout({
    title: game.title,
    description: game.tagline || `Juega a ${game.title} en parologames.`,
    scripts: ['site.js', 'player.js'],
    assetVersion,
    csp,
    body,
  }).toString();
}

const ERRORS = {
  400: ['Petición no válida', 'Algo en la petición no cuadra. Vuelve atrás e inténtalo de nuevo.'],
  403: ['Acceso denegado', 'No tienes permiso para ver esto. Si la sesión ha caducado, vuelve a entrar.'],
  404: ['Este cartucho no existe', 'La página que buscas no está en la estantería. Puede que el juego se haya retirado o que el enlace esté mal escrito.'],
  413: ['Archivo demasiado grande', 'El archivo supera el tamaño permitido. Reduce su tamaño e inténtalo de nuevo.'],
  429: ['Demasiadas peticiones', 'Has hecho muchas peticiones seguidas. Espera un minuto y vuelve a intentarlo.'],
  500: ['Algo ha fallado', 'Ha ocurrido un error en el servidor. Ya ha quedado registrado; prueba otra vez en unos minutos.'],
  503: ['En mantenimiento', 'La web está ocupada o en mantenimiento. Vuelve a intentarlo en unos minutos.'],
};

/** Any error page. Never receives internal details. */
export function renderError({ status = 500, assetVersion, csp } = {}) {
  const [title, text] = ERRORS[status] ?? ERRORS[status >= 500 ? 500 : 400];
  const body = html`<main id="main" class="page error-page">
  <div class="bezel bezel-error">
    <div class="screen screen-error">
      <p class="error-code" aria-hidden="true">${String(status)}</p>
      <p class="error-glitch" aria-hidden="true">ERROR DE CARTUCHO</p>
    </div>
  </div>
  <div class="error-copy">
    <h1 class="display display-sm">${title}</h1>
    <p>${text}</p>
    <p class="error-actions"><a class="btn btn-action" href="/juegos">Ir a la estantería</a><a class="textlink" href="/">Volver al inicio</a></p>
  </div>
</main>`;
  return layout({ title, scripts: [], noindex: true, assetVersion, csp, body }).toString();
}
