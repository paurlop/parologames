// Public pages: boot screen interactions and the cartridge → console transition. Everything here is optional sugar;
// every page works without JavaScript.
(() => {
  'use strict';

  const store = {
    get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* private mode: ignore */ } },
  };
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---- Splash ----
  const enter = document.querySelector('[data-enter]');
  if (enter) {
    const root = document.documentElement;
    const screen = document.querySelector('[data-boot]');
    const bezel = document.querySelector('.bezel-boot');
    const logo = document.querySelector('[data-logo]');
    const dpad = document.querySelector('[data-dpad]');
    const markBooted = () => store.set('parolo:booted', '1');
    setTimeout(markBooted, 2000);

    // A tap on the screen skips the boot sequence.
    screen?.addEventListener('click', () => {
      root.classList.add('booted');
      markBooted();
    });

    // Intro presses the A button; the arrows press the d-pad and nudge the logo one pixel step.
    const DIRS = { ArrowUp: ['up', 0, -1], ArrowDown: ['down', 0, 1], ArrowLeft: ['left', -1, 0], ArrowRight: ['right', 1, 0] };
    let nudge = [0, 0];
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest('a, button, input, textarea, select')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        enter.click();
        return;
      }
      const dir = DIRS[e.key];
      if (!dir || !dpad || window.scrollY > 40) return;
      e.preventDefault();
      dpad.classList.add(`is-${dir[0]}`);
      if (logo && !calm.matches) {
        nudge = [Math.max(-3, Math.min(3, nudge[0] + dir[1])), Math.max(-3, Math.min(3, nudge[1] + dir[2]))];
        logo.style.setProperty('--nx', `${nudge[0] * 4}px`);
        logo.style.setProperty('--ny', `${nudge[1] * 4}px`);
      }
    });
    document.addEventListener('keyup', (e) => {
      const dir = DIRS[e.key];
      if (dir && dpad) dpad.classList.remove(`is-${dir[0]}`);
    });

    // Pointer: the screen glass catches the light and the console turns a degree or two.
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (bezel && screen && finePointer.matches) {
      let frame = 0;
      let last = null;
      const apply = () => {
        frame = 0;
        if (!last) return;
        const x = last.clientX / window.innerWidth - 0.5;
        const y = last.clientY / window.innerHeight - 0.5;
        screen.style.setProperty('--gx', `${Math.round(30 + x * 50)}%`);
        if (!calm.matches) {
          bezel.style.setProperty('--ry', `${(x * 3).toFixed(2)}deg`);
          bezel.style.setProperty('--rx', `${(-y * 2.4).toFixed(2)}deg`);
        }
      };
      window.addEventListener('pointermove', (e) => {
        last = e;
        if (!frame) frame = requestAnimationFrame(apply);
      }, { passive: true });
      document.addEventListener('pointerleave', () => {
        bezel.style.setProperty('--rx', '0deg');
        bezel.style.setProperty('--ry', '0deg');
      });
    }
  }

  // ---- Shelf → game page: the clicked cartridge is pushed in, and its label morphs into the console's label. ----
  document.addEventListener('click', (e) => {
    const cart = e.target instanceof Element ? e.target.closest('a.cart') : null;
    if (!cart || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    cart.classList.add('is-inserting');
    const lbl = cart.querySelector('.label');
    if (lbl) lbl.style.viewTransitionName = 'cart-label';
  });
  // Back/forward cache: undo the press and the name so two labels never share it.
  window.addEventListener('pageshow', () => {
    document.querySelectorAll('a.cart').forEach((c) => {
      c.classList.remove('is-inserting');
      const l = c.querySelector('.label');
      if (l) l.style.viewTransitionName = '';
    });
  });
})();
