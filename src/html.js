// Plantillas etiquetadas que escapan por defecto.
//   html`<p>${userText}</p>`   → escapa userText
//   raw(trustedHtml)            → inserta sin escapar (solo HTML de confianza)
//   attr(value)                 → valor seguro para un atributo entre comillas
// `html` devuelve un SafeHtml (anidable sin doble escape); usa String(x) para obtener el texto.

export class SafeHtml {
  /** @param {string} value */
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** Escapa texto para contenido HTML o atributos entre comillas. */
export function escapeHtml(value) {
  if (value === null || value === undefined || value === false) return '';
  return String(value).replace(/[&<>"'`]/g, (c) => MAP[c]);
}

/** Marca HTML como confiable (no se escapa). */
export function raw(value) {
  return value instanceof SafeHtml ? value : new SafeHtml(String(value ?? ''));
}

/** Escapa un valor para usarlo dentro de un atributo entre comillas. Elimina caracteres de control. */
export function attr(value) {
  // eslint-disable-next-line no-control-regex
  return new SafeHtml(escapeHtml(value === null || value === undefined ? '' : String(value).replace(/[\u0000-\u001f\u007f]/g, '')));
}

function render(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(v);
}

/** Plantilla etiquetada que escapa todas las interpolaciones. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}
