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

  fsButton?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await bezel.requestFullscreen({ navigationUI: 'hide' });
      frame?.focus();
    } catch {
      say('Tu navegador no ha permitido la pantalla completa.');
    }
  });
})();
