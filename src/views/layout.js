import { html } from './_html.js';
import { icon } from './icons.js';

export const SITE_NAME = 'parologames';

const asset = (path, v) => `/static/${path}${v ? `?v=${encodeURIComponent(v)}` : ''}`;

/**
 * Full document shell shared by every page.
 * @param {object} o
 * @param {string} o.title            page title (already human text, escaped here)
 * @param {string} [o.description]
 * @param {'splash'|'site'|'admin'} [o.variant]
 * @param {string[]} [o.scripts]      file names under public/js
 * @param {boolean} [o.noindex]
 * @param {string} [o.assetVersion]
 * @param {{nonce?: string}} [o.csp]
 * @param {*} o.body                  SafeHtml for <body> content
 */
export function layout({ title, description, variant = 'site', scripts = [], noindex = false, assetVersion, csp = {}, body, header = true }) {
  const v = assetVersion;
  const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  return html`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${fullTitle}</title>
${description ? html`<meta name="description" content="${description}">` : ''}
${noindex ? html`<meta name="robots" content="noindex, nofollow">` : ''}
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#c9cacd" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#25272c" media="(prefers-color-scheme: dark)">
<link rel="preload" href="${asset('fonts/archivo.woff2')}" as="font" type="font/woff2" crossorigin>
${variant === 'splash' ? html`<link rel="preload" href="${asset('fonts/archivo-italic.woff2')}" as="font" type="font/woff2" crossorigin>` : ''}
${variant === 'splash' && csp.nonce
  ? html`<script nonce="${csp.nonce}">try{if(sessionStorage.getItem('parolo:booted'))document.documentElement.classList.add('booted')}catch(e){}</script>`
  : ''}
<link rel="stylesheet" href="${asset('css/site.css', v)}">
<link rel="icon" href="${asset('favicon.svg', v)}" type="image/svg+xml">
${description ? html`<meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${description}"><meta property="og:type" content="website">` : ''}
</head>
<body class="v-${variant}">
<a class="skip" href="#main">Saltar al contenido</a>
${variant !== 'admin' ? strip() : ''}
${header && variant !== 'splash' ? siteHeader(variant) : ''}
${body}
${variant !== 'admin' ? siteFooter() : ''}
${scripts.map((s) => html`<script src="${asset(`js/${s}`, v)}" nonce="${csp.nonce ?? ''}" defer></script>`)}
</body>
</html>`;
}

// The dark band across the top of every public page.
function strip() {
  return html`<div class="strip">
  <p class="strip-text">Juegos para jugar en el navegador y descargar gratis</p>
  <a class="strip-link" href="/juegos">Ver los juegos<span class="strip-arrow">${icon('right')}</span></a>
</div>`;
}

function siteHeader(variant) {
  return html`<header class="topbar">
  <a class="wordmark" href="/" aria-label="parologames, inicio"><span class="wm-parolo">parolo</span><span class="wm-games">games</span></a>
  ${variant === 'site'
    ? html`<nav aria-label="Principal"><a class="topbar-link" href="/juegos">Juegos</a></nav>`
    : ''}
  <span class="led" aria-hidden="true"></span>
</header>`;
}

function siteFooter() {
  return html`<footer class="foot">
  <p class="foot-mark"><span class="wm-parolo">parolo</span><span class="wm-games">games</span></p>
  <p>Juegos para jugar en el navegador o descargar. Sin cuentas, sin anuncios.</p>
  <p class="foot-small">© ${new Date().getFullYear()} parologames</p>
</footer>`;
}
