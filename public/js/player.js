// Game page: the game only loads when the player presses Jugar, inside a sandboxed frame on the games origin.
// Without JavaScript the Jugar button opens the game in a new tab instead.
(() => {
  'use strict';

  const play = document.querySelector('[data-play]');
  const screen = document.querySelector('[data-screen]');
  const off = document.querySelector('[data-off]');
  const bezel = document.querySelector('[data-player]');
  const status = document.querySelector('[data-status]');
  const led = document.querySelector('[data-led]');
  const fsButton = document.querySelector('[data-fullscreen]');
  if (!play || !screen || !off || !bezel) return;

  const say = (text) => { if (status) status.textContent = text; };
  let frame = null;

  function start() {
    if (frame) return;
    if (navigator.onLine === false) {
      say('Sin conexión. Comprueba tu red y vuelve a pulsar Jugar.');
      return;
    }
    let src;
    try {
      src = new URL(play.dataset.play, location.href);
    } catch {
      return;
    }
    if (src.protocol !== 'https:' && src.protocol !== 'http:') return;

    frame = document.createElement('iframe');
    frame.src = src.href;
    frame.title = `Juego: ${play.dataset.title || ''}`.trim();
    // Separate origin + sandbox: the game can run scripts and keep its own saves, but can never reach this page.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-orientation-lock allow-modals');
    frame.setAttribute('allow', 'fullscreen; gamepad; autoplay');
    frame.setAttribute('referrerpolicy', 'strict-origin');
    frame.setAttribute('loading', 'eager');

    say('Cargando el juego…');
    const slow = setTimeout(() => say('Sigue cargando… los juegos grandes tardan un poco la primera vez.'), 8000);
    frame.addEventListener('load', () => {
      clearTimeout(slow);
      say('');
      frame.focus();
    }, { once: true });

    off.hidden = true;
    screen.classList.add('is-on');
    led?.classList.add('is-on');
    screen.append(frame);
    if (fsButton && document.fullscreenEnabled) fsButton.hidden = false;
  }

  play.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    start();
  });

  // In fullscreen the browser takes Esc for itself, so games that open their menu with Esc kicked you out.
  // Chrome and Edge let the page keep Esc (holding it still leaves fullscreen); elsewhere we explain how to come back.
  const canLockKeys = !!(navigator.keyboard && typeof navigator.keyboard.lock === 'function');
  const fsLabel = fsButton?.lastChild;
  let wantFs = false;

  function refocus() {
    if (frame && document.activeElement !== frame) frame.focus();
  }

  fsButton?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) {
        wantFs = false;
        await document.exitFullscreen();
      } else {
        wantFs = true;
        await bezel.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      wantFs = false;
      say('Tu navegador no ha permitido la pantalla completa.');
    }
    refocus();
  });

  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === bezel;
    if (fsLabel && fsLabel.nodeType === Node.TEXT_NODE) fsLabel.textContent = on ? 'Salir de pantalla completa' : 'Pantalla completa';
    if (on) {
      if (canLockKeys) {
        navigator.keyboard.lock(['Escape']).then(
          () => say('Pantalla completa: mantén pulsado Esc para salir.'),
          () => say('Pulsa Esc para salir de la pantalla completa.'),
        );
      } else {
        say('Pulsa Esc para salir de la pantalla completa.');
      }
    } else {
      if (canLockKeys) navigator.keyboard.unlock();
      // Left by Esc instead of the button: the game keeps the keyboard, and one click brings fullscreen back.
      say(wantFs ? 'Has salido de la pantalla completa. Pulsa «Pantalla completa» para volver.' : '');
      wantFs = false;
    }
    setTimeout(refocus, 0);
  });

  // Keys that scroll the page while the game has lost focus go back to the game instead.
  const GAME_KEYS = new Set([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
  document.addEventListener('keydown', (e) => {
    if (!frame || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName))) return;
    if (!GAME_KEYS.has(e.key)) return;
    e.preventDefault();
    refocus();
  });
})();
