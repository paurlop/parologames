// Admin panel: prevent double submits, validate before uploading, and show upload progress.
// The server validates everything again; this only saves the owner a wasted upload.
(() => {
  'use strict';

  function busy(form, on) {
    form.querySelectorAll('button[type="submit"]').forEach((b) => {
      if (on) {
        b.dataset.idleHtml ??= b.innerHTML;
        b.disabled = true;
        b.setAttribute('aria-busy', 'true');
        if (b.dataset.busyLabel) b.textContent = b.dataset.busyLabel;
      } else {
        b.disabled = false;
        b.removeAttribute('aria-busy');
        if (b.dataset.idleHtml) b.innerHTML = b.dataset.idleHtml;
      }
    });
  }

  function bind(scope) {
    scope.querySelector('[data-error-summary]')?.focus();

    const totp = scope.querySelector('#totp');
    totp?.addEventListener('input', () => { totp.value = totp.value.replace(/\D/g, '').slice(0, 6); });

    scope.querySelectorAll('form[data-once]').forEach((form) => {
      form.addEventListener('submit', (e) => {
        if (form.dataset.sent) { e.preventDefault(); return; }
        if (!form.checkValidity()) { e.preventDefault(); form.reportValidity(); return; }
        form.dataset.sent = '1';
        busy(form, true);
      });
    });

    scope.querySelectorAll('form[data-upload]').forEach(bindUpload);
  }

  // ---- client-side checks mirroring the server rules ----
  const rules = {
    title: (f) => (!f.value.trim() ? 'Escribe un título.' : f.value.length > 80 ? 'El título no puede pasar de 80 caracteres.' : ''),
    tagline: (f) => (f.value.length > 140 ? 'La frase corta no puede pasar de 140 caracteres.' : ''),
    description: (f) => (f.value.length > 4000 ? 'La descripción no puede pasar de 4000 caracteres.' : ''),
  };
  const fileRules = {
    build: { ext: /\.zip$/i, msg: 'El juego tiene que ser un archivo .zip.' },
    download: { ext: /\.zip$/i, msg: 'La descarga tiene que ser un archivo .zip.' },
    cover: { ext: /\.(png|jpe?g|webp)$/i, msg: 'La portada tiene que ser PNG, JPG o WebP.' },
  };

  function setError(input, msg) {
    const id = `${input.id}-error`;
    let el = document.getElementById(id);
    if (!msg) {
      el?.remove();
      input.removeAttribute('aria-invalid');
      input.setAttribute('aria-describedby', (input.getAttribute('aria-describedby') || '').replace(id, '').trim());
      return;
    }
    if (!el) {
      el = document.createElement('p');
      el.className = 'field-error';
      el.id = id;
      input.closest('.field')?.append(el);
      const by = (input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
      if (!by.includes(id)) input.setAttribute('aria-describedby', [...by, id].join(' '));
    }
    el.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
  }

  function validate(form) {
    let first = null;
    for (const [name, check] of Object.entries(rules)) {
      const f = form.elements.namedItem(name);
      if (!f) continue;
      const msg = check(f);
      setError(f, msg);
      if (msg && !first) first = f;
    }
    for (const [name, rule] of Object.entries(fileRules)) {
      const f = form.elements.namedItem(name);
      if (!f) continue;
      const file = f.files?.[0];
      let msg = '';
      if (!file && f.required) msg = 'Elige el ZIP del juego.';
      else if (file && !rule.ext.test(file.name)) msg = rule.msg;
      else if (file && f.dataset.maxMb && file.size > Number(f.dataset.maxMb) * 1024 * 1024) msg = `Pesa demasiado: el máximo es ${f.dataset.maxMb} MB.`;
      setError(f, msg);
      if (msg && !first) first = f;
    }
    first?.focus();
    return !first;
  }

  function bindUpload(form) {
    const progress = form.querySelector('[data-progress]');
    const bar = form.querySelector('[data-bar]');
    const meter = form.querySelector('[role="progressbar"]');
    const text = form.querySelector('[data-progress-text]');
    let inFlight = false;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (inFlight) return;
      if (!validate(form)) return;
      if (typeof XMLHttpRequest === 'undefined') { form.submit(); return; }

      inFlight = true;
      busy(form, true);
      if (progress) progress.hidden = false;

      const xhr = new XMLHttpRequest();
      xhr.open('POST', form.action);
      xhr.timeout = 60 * 60 * 1000;
      xhr.setRequestHeader('X-Requested-With', 'fetch');
      const csrf = form.elements.namedItem('_csrf');
      if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf.value);

      xhr.upload.addEventListener('progress', (ev) => {
        if (!ev.lengthComputable) return;
        const pct = Math.round((ev.loaded / ev.total) * 100);
        if (bar) bar.style.width = `${pct}%`;
        meter?.setAttribute('aria-valuenow', String(pct));
        if (text) text.textContent = pct < 100 ? `Subiendo… ${pct} %` : 'Comprobando y descomprimiendo el juego…';
      });

      const fail = (msg) => {
        inFlight = false;
        busy(form, false);
        if (progress) progress.hidden = true;
        let notice = form.querySelector('[data-net-error]');
        if (!notice) {
          notice = document.createElement('div');
          notice.className = 'notice notice-error';
          notice.setAttribute('role', 'alert');
          notice.dataset.netError = '';
          form.prepend(notice);
        }
        notice.textContent = msg;
      };

      xhr.addEventListener('load', () => {
        const url = new URL(xhr.responseURL || form.action, location.href);
        const ok = xhr.status >= 200 && xhr.status < 300;
        if (ok && url.pathname !== new URL(form.action, location.href).pathname) {
          location.assign(url.href);
          return;
        }
        const type = xhr.getResponseHeader('Content-Type') || '';
        if (!type.includes('text/html')) {
          fail(`El servidor respondió con un error (${xhr.status}). Vuelve a intentarlo.`);
          return;
        }
        // Validation error: the server re-rendered the form. Swap it in and keep going.
        const doc = new DOMParser().parseFromString(xhr.responseText, 'text/html');
        const next = doc.querySelector('main');
        const current = document.querySelector('main');
        if (!next || !current) { fail('Respuesta inesperada del servidor. Recarga la página.'); return; }
        current.replaceWith(next);
        document.title = doc.title;
        bind(next);
        next.querySelector('[data-error-summary]')?.focus();
      });
      xhr.addEventListener('error', () => fail('Se ha cortado la conexión durante la subida. Tus datos siguen en el formulario: vuelve a intentarlo.'));
      xhr.addEventListener('timeout', () => fail('La subida ha tardado demasiado. Comprueba tu conexión y vuelve a intentarlo.'));
      xhr.send(new FormData(form));
    });
  }

  bind(document);
})();
