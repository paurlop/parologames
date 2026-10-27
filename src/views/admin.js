import { html, safeUrl } from './_html.js';
import { layout } from './layout.js';
import { icon } from './icons.js';
import { emptyShelf, formatDate, formatSize, labelInk } from './cartridge.js';

function adminBar(adminPath, csrf) {
  return html`<header class="topbar topbar-admin">
  <a class="wordmark" href="${adminPath}" aria-label="Panel de parologames"><span class="wm-parolo">parolo</span><span class="wm-games">panel</span></a>
  <nav aria-label="Panel" class="topbar-nav">
    <a class="topbar-link" href="/" target="_blank" rel="noopener">Ver la web</a>
    <form method="post" action="${adminPath}/salir" class="inline-form">
      <input type="hidden" name="_csrf" value="${csrf}">
      <button class="topbar-link topbar-btn" type="submit">${icon('logout')}Salir</button>
    </form>
  </nav>
</header>`;
}

/** GET {adminPath}/entrar */
export function renderLogin({ csrf, error, adminPath = '/panel', assetVersion, csp } = {}) {
  const body = html`<main id="main" class="login">
  <div class="login-card">
    <p class="login-mark"><span class="wm-parolo">parolo</span><span class="wm-games">panel</span></p>
    <h1 class="login-title">Entrar al panel</h1>
    <p class="muted">Solo para quien publica los juegos.</p>
    ${error ? html`<div class="notice notice-error" role="alert">${icon('alert')}<p>${error}</p></div>` : ''}
    <form method="post" action="${adminPath}/entrar" class="form" data-once novalidate>
      <input type="hidden" name="_csrf" value="${csrf}">
      <div class="field">
        <label for="password">Contraseña</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="200" autofocus>
      </div>
      <div class="field">
        <label for="totp">Código de verificación</label>
        <input id="totp" name="totp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-describedby="totp-help">
        <p class="help" id="totp-help">Los 6 dígitos de tu app de autenticación.</p>
      </div>
      <button class="btn btn-action btn-block" type="submit" data-busy-label="Comprobando…">${icon('lock')}Entrar</button>
    </form>
  </div>
</main>`;
  return layout({ title: 'Entrar al panel', variant: 'admin', header: false, noindex: true, scripts: ['admin.js'], assetVersion, csp, body }).toString();
}

/** GET {adminPath} */
export function renderAdminList({ games = [], csrf, flash, adminPath = '/panel', assetVersion, csp } = {}) {
  const published = games.filter((g) => g.status === 'published').length;
  const body = html`${adminBar(adminPath, csrf)}
<main id="main" class="page admin">
  <header class="admin-head">
    <div>
      <h1 class="display display-sm">Tus juegos</h1>
      <p class="page-sub">${games.length ? `${published} publicados de ${games.length}` : 'Aún no has subido ningún juego.'}</p>
    </div>
    <a class="btn btn-action" href="${adminPath}/nuevo">${icon('plus')}Subir juego</a>
  </header>
  ${flash ? html`<div class="notice notice-ok" role="status">${icon('check')}<p>${flash}</p></div>` : ''}
  ${games.length
    ? html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col"><span class="sr">Portada</span></th><th scope="col">Juego</th><th scope="col">Estado</th><th scope="col">Actualizado</th><th scope="col"><span class="sr">Acciones</span></th></tr></thead>
    <tbody>
    ${games.map((g) => html`<tr>
      <td class="t-thumb">${g.coverUrl
        ? html`<img src="${safeUrl(g.coverUrl)}" alt="" width="48" height="64" loading="lazy">`
        : html`<span class="thumb-blank ink-${labelInk(g.id)}" aria-hidden="true"></span>`}</td>
      <td class="t-title"><strong>${g.title}</strong>${g.featured ? html` <span class="tag tag-star">${icon('star')}Portada</span>` : ''}<span class="t-slug">/juegos/${g.slug}${g.webSize ? ` · ${formatSize(g.webSize)}` : ''}</span></td>
      <td>${g.status === 'published' ? html`<span class="tag tag-on">Publicado</span>` : html`<span class="tag tag-off">Oculto</span>`}</td>
      <td class="t-date">${formatDate(g.updatedAt)}</td>
      <td class="t-actions">
        ${g.status === 'published' ? html`<a class="iconbtn" href="/juegos/${encodeURIComponent(g.slug)}" target="_blank" rel="noopener" aria-label="Ver ${g.title} en la web">${icon('eye')}</a>` : ''}
        <a class="iconbtn" href="${adminPath}/juegos/${encodeURIComponent(g.id)}/editar" aria-label="Editar ${g.title}">${icon('edit')}</a>
        <form method="post" action="${adminPath}/juegos/${encodeURIComponent(g.id)}/estado" class="inline-form" data-once>
          <input type="hidden" name="_csrf" value="${csrf}">
          <input type="hidden" name="status" value="${g.status === 'published' ? 'hidden' : 'published'}">
          <button class="btn btn-sm" type="submit">${g.status === 'published' ? html`${icon('eyeOff')}Ocultar` : html`${icon('eye')}Publicar`}</button>
        </form>
      </td>
    </tr>`)}
    </tbody></table></div>`
    : emptyShelf({ admin: true })}
</main>`;
  return layout({ title: 'Panel', variant: 'admin', header: false, noindex: true, scripts: ['admin.js'], assetVersion, csp, body }).toString();
}

function fieldError(errors, name) {
  return errors[name] ? html`<p class="field-error" id="${name}-error">${icon('alert')}${errors[name]}</p>` : '';
}
const describedBy = (errors, name, help) => [help ? `${name}-help` : '', errors[name] ? `${name}-error` : ''].filter(Boolean).join(' ');

/** GET {adminPath}/nuevo and {adminPath}/juegos/:id/editar */
export function renderAdminForm({ game = null, csrf, errors = {}, values = {}, limits = {}, adminPath = '/panel', assetVersion, csp } = {}) {
  const editing = Boolean(game);
  const v = { title: '', tagline: '', description: '', status: 'published', featured: false, ...(game ?? {}), ...values };
  const action = editing ? `${adminPath}/juegos/${encodeURIComponent(game.id)}` : `${adminPath}/juegos`;
  const errorList = Object.entries(errors).filter(([k]) => k !== '_form');
  const inv = (name) => (errors[name] ? html`aria-invalid="true"` : '');
  const body = html`${adminBar(adminPath, csrf)}
<main id="main" class="page admin admin-form">
  <a class="textlink back" href="${adminPath}">${icon('back')}Volver a tus juegos</a>
  <h1 class="display display-sm">${editing ? html`Editar «${game.title}»` : 'Subir un juego'}</h1>
  ${errors._form || errorList.length
    ? html`<div class="notice notice-error" role="alert" tabindex="-1" data-error-summary>${icon('alert')}<div>
      <p><strong>${errors._form || 'Revisa estos campos antes de continuar:'}</strong></p>
      ${errorList.length ? html`<ul>${errorList.map(([k, msg]) => html`<li><a href="#${k}">${msg}</a></li>`)}</ul>` : ''}
    </div></div>`
    : ''}
  <form class="form form-wide" method="post" action="${action}" enctype="multipart/form-data" data-upload novalidate>
    <input type="hidden" name="_csrf" value="${csrf}">
    <input type="hidden" name="idempotency_key" value="${v.idempotencyKey ?? ''}">

    <fieldset class="group">
      <legend>Ficha del juego</legend>
      <div class="field">
        <label for="title">Título</label>
        <input id="title" name="title" type="text" required maxlength="80" value="${v.title}" ${inv('title')} aria-describedby="${describedBy(errors, 'title')}">
        ${fieldError(errors, 'title')}
      </div>
      <div class="field">
        <label for="tagline">Frase corta <span class="optional">opcional</span></label>
        <input id="tagline" name="tagline" type="text" maxlength="140" value="${v.tagline}" ${inv('tagline')} aria-describedby="${describedBy(errors, 'tagline', true)}">
        <p class="help" id="tagline-help">Aparece bajo el cartucho en la estantería. Máximo 140 caracteres.</p>
        ${fieldError(errors, 'tagline')}
      </div>
      <div class="field">
        <label for="description">Descripción <span class="optional">opcional</span></label>
        <textarea id="description" name="description" rows="7" maxlength="4000" ${inv('description')} aria-describedby="${describedBy(errors, 'description', true)}">${v.description}</textarea>
        <p class="help" id="description-help">Controles, de qué va, créditos. Deja una línea en blanco para separar párrafos.</p>
        ${fieldError(errors, 'description')}
      </div>
    </fieldset>

    <fieldset class="group">
      <legend>Archivos</legend>
      <div class="field">
        <label for="build">Juego para la web (ZIP) ${editing ? html`<span class="optional">solo si lo cambias</span>` : ''}</label>
        <input id="build" name="build" type="file" accept=".zip,application/zip" ${editing ? '' : 'required'} data-max-mb="${limits.buildMb ?? ''}" ${inv('build')} aria-describedby="${describedBy(errors, 'build', true)}">
        <p class="help" id="build-help">Un ZIP con <code>index.html</code> en la raíz (exportación HTML5 de Unity, Godot, Phaser…). Máximo ${limits.buildMb ?? '—'} MB.${editing && game.webSize ? ` Ahora: ${formatSize(game.webSize)}.` : ''}</p>
        ${fieldError(errors, 'build')}
      </div>
      <div class="field">
        <label for="cover">Portada <span class="optional">opcional</span></label>
        <input id="cover" name="cover" type="file" accept="image/png,image/jpeg,image/webp" data-max-mb="${limits.coverMb ?? ''}" ${inv('cover')} aria-describedby="${describedBy(errors, 'cover', true)}">
        <p class="help" id="cover-help">PNG, JPG o WebP en vertical (3:4, por ejemplo 600 × 800). Máximo ${limits.coverMb ?? '—'} MB.</p>
        ${fieldError(errors, 'cover')}
      </div>
      <div class="field">
        <label for="download">Descarga aparte (ZIP) <span class="optional">opcional</span></label>
        <input id="download" name="download" type="file" accept=".zip,application/zip" data-max-mb="${limits.downloadMb ?? ''}" ${inv('download')} aria-describedby="${describedBy(errors, 'download', true)}">
        <p class="help" id="download-help">Por ejemplo, la versión de escritorio. Si no subes nada, se descarga la versión web. Máximo ${limits.downloadMb ?? '—'} MB.</p>
        ${fieldError(errors, 'download')}
        ${editing && game.hasDownload ? html`<label class="check"><input type="checkbox" name="remove_download" value="1"> Quitar la descarga aparte actual (${formatSize(game.downloadSize)})</label>` : ''}
      </div>
    </fieldset>

    <fieldset class="group">
      <legend>Publicación</legend>
      <div class="segmented" role="radiogroup" aria-label="Estado">
        <label><input type="radio" name="status" value="published" ${v.status !== 'hidden' ? 'checked' : ''}><span>${icon('eye')}Publicado</span></label>
        <label><input type="radio" name="status" value="hidden" ${v.status === 'hidden' ? 'checked' : ''}><span>${icon('eyeOff')}Oculto</span></label>
      </div>
      ${fieldError(errors, 'status')}
      <label class="check"><input type="checkbox" name="featured" value="1" ${v.featured ? 'checked' : ''}> Destacarlo en la portada</label>
    </fieldset>

    <div class="upload-progress" data-progress hidden>
      <div class="meter" role="progressbar" aria-label="Subida" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span data-bar></span></div>
      <p class="help" data-progress-text aria-live="polite">Preparando la subida…</p>
    </div>

    <div class="form-actions">
      <button class="btn btn-action" type="submit" data-busy-label="Subiendo…">${icon('upload')}${editing ? 'Guardar cambios' : 'Publicar juego'}</button>
      <a class="textlink" href="${adminPath}">Cancelar</a>
    </div>
  </form>

  ${editing
    ? html`<section class="danger" aria-labelledby="danger-title">
    <h2 id="danger-title" class="danger-title">Eliminar el juego</h2>
    <p>Se borran el juego, su portada y sus descargas. No se puede deshacer, salvo restaurando una copia de seguridad.</p>
    <form method="post" action="${adminPath}/juegos/${encodeURIComponent(game.id)}/eliminar" class="form" data-once>
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="check"><input type="checkbox" name="confirm" value="1" required> Sí, quiero eliminar «${game.title}»</label>
      <button class="btn btn-danger" type="submit" data-busy-label="Eliminando…">${icon('trash')}Eliminar definitivamente</button>
    </form>
  </section>`
    : ''}
</main>`;
  return layout({ title: editing ? `Editar ${game.title}` : 'Subir un juego', variant: 'admin', header: false, noindex: true, scripts: ['admin.js'], assetVersion, csp, body }).toString();
}
