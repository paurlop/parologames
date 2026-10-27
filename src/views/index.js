// View layer: pure functions from plain data to HTML strings. No database or filesystem access here.
export { renderSplash, renderCatalog, renderGame, renderError } from './public.js';
export { renderLogin, renderAdminList, renderAdminForm } from './admin.js';
export { escapeHtml } from './_html.js';
