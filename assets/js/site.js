/* Squishrot — squishrot.com
   The app's page backdrop and its moving light behind everything, the hero jelly pile (the app's
   own, from jelly-pit.js), live phone demos that only play while their phone is on screen, the
   jelly showcase and the usual scroll reveals. */
(() => {
  'use strict';

  const S = window.SQUISH;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const sleep = ms => new Promise(done => setTimeout(done, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const byId = Object.fromEntries(S.jellies.map(j => [j.id, j]));
  let useAvif = true;

  const has = (id, finish) => !!byId[id] && byId[id].finishes.includes(finish);
  const finishFor = (id, finish) => (has(id, finish) ? finish : byId[id].finishes[0]);
  function jellySrc(id, finish, size) {
    const f = finishFor(id, finish);
    if (!useAvif) return `assets/img/jellies/${id}-${f}-sm.png`;
    return `assets/img/jellies/${id}-${f}${size === 'sm' ? '-sm' : ''}.avif`;
  }

  function hydrateJellies(root = document) {
    $$('img[data-jelly]', root).forEach(img => {
      if (!img.closest('.hero')) img.loading = 'lazy';
      img.decoding = 'async';
      img.src = jellySrc(img.dataset.jelly, img.dataset.finish || 'common', img.dataset.size);
    });
  }

  /* ---------------- backdrop ---------------- */
  /* The light that moves over the painted backdrop, laid out as the app lays it out
     (PageBackdropView): the same numbers, the same noise for where each speck sits, so the site and
     the app stand on the same sky. Three slow glows wander and breathe, three shafts of light lean
     in from the top left, dust rises at three depths, a few stars flare and two fall. All of it is
     moved by CSS (site.css, "Backdrop"). */
  function initBackdrop() {
    const box = $('.backdrop-light');
    if (!box) return;
    const noise = n => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
    const TAU = Math.PI * 2;
    const f = (v, d = 2) => (+v).toFixed(d);
    const lights = ['140, 255, 230', '153, 199, 255', '255, 168, 235'];
    /* A sine swing as an alternating animation: half a turn each way, begun part-way round. */
    const half = omega => f(Math.PI / omega) + 's';
    const begun = (omega, theta) => f(-(((theta % TAU) + TAU) % TAU) / omega) + 's';

    /* Glows and shafts are small canvases stretched large: soft light needs few pixels. */
    const glows = [['0, 191, 158', .2, .24, .4, .15, .13, 0], ['26, 102, 255', .78, .5, .44, .16, .1, 2], ['204, 31, 184', .3, .76, .4, .11, .115, 4]]
      .map(([c, x, y, r, op, speed, phase]) => {
        const cv = document.createElement('canvas'), g = cv.getContext('2d');
        cv.width = cv.height = 192; cv.className = 'bd-glow';
        const paint = g.createRadialGradient(96, 96, 0, 96, 96, 96);
        paint.addColorStop(0, `rgba(${c}, ${op})`); paint.addColorStop(.45, `rgba(${c}, ${op * .45})`); paint.addColorStop(1, `rgba(${c}, 0)`);
        g.fillStyle = paint; g.fillRect(0, 0, 192, 192);
        return { cv, x, y, r, speed, phase };
      });
    const shafts = [[.06, -.3, 1.25, .13, .05, 23, 0], [.4, -.42, .9, .11, .065, 31, 2.1], [-.16, -.6, 1.05, .095, .045, 27, 4.2]]
      .map(([x, lean, width, op, sway, period, phase], i) => {
        const cv = document.createElement('canvas'), g = cv.getContext('2d'), W = 96, H = 360;
        cv.width = W; cv.height = H; cv.className = 'bd-shaft';
        for (let row = 0; row < H; row++) {
          const along = (row + .5) / H, reach = (16 + 79 * along) / 190 * W, s = Math.min(1, along / .08) * Math.pow(1 - along, 1.5);
          const paint = g.createLinearGradient(W / 2 - reach, 0, W / 2 + reach, 0);
          [[0, 0], [.3, .55], [.5, 1], [.7, .55], [1, 0]].forEach(([at, a]) => paint.addColorStop(at, `rgba(${lights[i]}, ${f(a * s, 4)})`));
          g.fillStyle = paint; g.fillRect(0, row, W, 1);
        }
        return { cv, x, lean, width, op, sway, period, phase };
      });

    let lastW = 0, lastH = 0;
    function lay() {
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h || (w === lastW && Math.abs(h - lastH) < 120)) return;
      lastW = w; lastH = h;
      /* The app's counts are for a phone; a bigger screen gets more, up to two and a half times. */
      const more = clamp(w * h / (400 * 870), 1, 2.5), count = n => Math.round(n * more);
      box.textContent = '';
      let out = '';

      const frag = document.createDocumentFragment();
      glows.forEach(({ cv, x, y, r, speed, phase }) => {
        const side = Math.max(w, h) * r * 2, gx = document.createElement('i'), gy = document.createElement('i');
        gx.className = 'bd-gx'; gy.className = 'bd-gy';
        gx.style.cssText = `left:${x * 100}%;top:${y * 100}%;--dx:${f(w * .2, 1)}px;animation-duration:${half(speed)};animation-delay:${begun(speed, phase + Math.PI / 2)}`;
        gy.style.cssText = `--dy:${f(h * .09, 1)}px;animation-duration:${half(speed * 1.3)};animation-delay:${begun(speed * 1.3, phase + Math.PI)}`;
        cv.style.cssText = `width:${f(side, 0)}px;height:${f(side, 0)}px;margin:${f(-side / 2, 0)}px;animation-duration:${half(speed * 1.7)},${half(speed * 2.3)};animation-delay:${begun(speed * 1.7, phase + Math.PI / 2)},${begun(speed * 2.3, phase * 1.7 + Math.PI / 2)}`;
        gy.appendChild(cv); gx.appendChild(gy); frag.appendChild(gx);
      });
      shafts.forEach(({ cv, x, lean, width, op, sway, period, phase }) => {
        const length = h * 1.25, across = 190 * width * (length / 720), turn = TAU / period, breath = TAU / (period * .62);
        cv.style.cssText = `left:${f(w * x, 1)}px;top:${f(-h * .12, 1)}px;width:${f(across, 1)}px;height:${f(length, 1)}px;margin-left:${f(-across / 2, 1)}px;` +
          `--r:${lean}rad;--r0:${f(lean - sway, 3)}rad;--r1:${f(lean + sway, 3)}rad;--o:${f(op * .62, 3)};--o0:${f(op * .24, 3)};--o1:${op};` +
          `animation-duration:${half(turn)},${half(breath)};animation-delay:${begun(turn, phase + Math.PI / 2)},${begun(breath, phase * 1.9 + Math.PI / 2)}`;
        frag.appendChild(cv);
      });

      /* Dust: far (small, slow, faint), middle, and a few big soft hazes close to the glass. */
      const mote = (n, i, side, x, speed, o0, o1, paint, haze) => {
        const margin = side / 2 + 14, travel = h + margin * 2, from = noise(n + 5) * travel;
        const glint = haze ? 3.5 + noise(n + 9) * 3 : Math.PI / (1.4 + noise(n + 9) * 2.2);
        out += `<i class="bd-mote${haze ? ' bd-haze' : ''}" style="left:${f(x * 100)}%;width:${f(side)}px;height:${f(side)}px;margin:${f(-side / 2)}px;background:${paint};` +
          `--y:${f(h + margin - from, 1)}px;--y0:${f(h + margin, 1)}px;--y1:${f(-margin, 1)}px;--o0:${o0};--o1:${o1};` + (haze ? '' : '--s0:.7;--s1:1.2;') +
          `animation-duration:${f(travel / speed)}s,${f(glint)}s${haze ? `,${f((6 + noise(n + 5) * 5) / 2)}s` : ''};animation-delay:${f(-from / speed)}s,${f(-noise(n + 11) * glint * 2)}s${haze ? `,${f(-noise(n + 13) * 8)}s` : ''}"></i>`;
      };
      const dot = a => `radial-gradient(closest-side,rgba(255,255,255,${a}) 35%,rgba(255,255,255,0))`;
      for (let i = 0; i < count(24); i++) { const n = i + 200; mote(n, i, 1.4 + noise(n + 7) * 1.4, noise(n), 2.2 + noise(n + 2) * 3, .1, .5, dot(.45)); }
      for (let i = 0; i < count(32); i++) mote(i, i, 2 + noise(i + 7) * 3.5, noise(i), (10 + noise(i + 2) * 20) * .45, .15, .75, dot([1, .7, .45][i % 3]));
      for (let i = 0; i < count(7); i++) {
        const n = i + 400, c = [...lights, '255, 255, 255'][i % 4];
        mote(n, i, 22 + noise(n + 7) * 30, .04 + noise(n) * .92, 17 + noise(n + 2) * 16, .16, .34,
          `radial-gradient(closest-side,rgba(${c},.5),rgba(${c},.36) 35%,rgba(${c},.12) 70%,rgba(${c},0))`, true);
      }
      /* Stars that flare now and then. */
      for (let i = 0; i < count(7); i++) {
        const n = i + 600, side = 11 + noise(n + 3) * 10, period = 6.5 + noise(n + 2) * 7;
        out += `<i class="bd-flare" style="left:${f((.06 + noise(n) * .88) * 100)}%;top:${f((.08 + noise(n + 1) * .8) * 100)}%;width:${f(side)}px;height:${f(side)}px;margin:${f(-side / 2)}px;` +
          `--c:${lights[i % 3]};animation-duration:${f(period)}s;animation-delay:${f(-noise(n + 4) * period)}s"></i>`;
      }
      /* Two falling stars, each on its own long clock. */
      [[-.1, .1, .82, .38, 1, 'a'], [.3, .52, 1.12, .78, .8, 'b']].forEach(([x0, y0, x1, y1, k, name]) => {
        out += `<i class="bd-fall bd-fall--${name}" style="--k:${k};--x0:${f(w * x0, 1)}px;--y0:${f(h * y0, 1)}px;--x1:${f(w * x1, 1)}px;--y1:${f(h * y1, 1)}px;--r:${f(Math.atan2(h * (y1 - y0), w * (x1 - x0)), 3)}rad"></i>`;
      });
      box.appendChild(frag);
      box.insertAdjacentHTML('beforeend', out);
    }
    lay();
    let wait = 0;
    addEventListener('resize', () => { clearTimeout(wait); wait = setTimeout(lay, 250); });
  }

  /* ---------------- header ---------------- */
  function initNav() {
    const nav = $('#nav');
    const onScroll = () => nav.classList.toggle('is-scrolled', scrollY > 20);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    const links = $$('.nav-links a');
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) links.forEach(a => a.classList.toggle('is-active', a.hash === `#${e.target.id}`));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('main > section[id]').forEach(s => io.observe(s));
  }

  /* ---------------- reveal + split headings ---------------- */
  function splitWords(el) {
    let k = 0;
    const walk = node => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span');
            const wi = document.createElement('span');
            w.className = 'w';
            wi.className = 'wi';
            wi.style.setProperty('--k', k++);
            wi.textContent = part;
            w.appendChild(wi);
            frag.appendChild(w);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1) {
          walk(child);
        }
      });
    };
    walk(el);
  }

  function initReveal() {
    $$('.split').forEach(splitWords);
    $$('.reveal').forEach(el => {
      const group = [...el.parentElement.children].filter(c => c.classList.contains('reveal'));
      if (group.length > 1) el.style.setProperty('--rd', `${group.indexOf(el) * 70}ms`);
    });
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
    $$('.reveal, .split, .set-card').forEach(el => io.observe(el));
  }

  function initCounts() {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        if (reduceMotion) return;
        const el = e.target;
        const end = +el.dataset.count;
        const t0 = performance.now();
        const tick = now => {
          const p = Math.min(1, (now - t0) / 1400);
          el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(tick);
        };
        el.textContent = '0';
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.6 });
    $$('[data-count]').forEach(el => io.observe(el));
  }

  function initStore() {
    const url = (($('meta[name="app-store-url"]') || {}).content || '').trim();
    if (!url) return;
    $$('[data-store]').forEach(a => {
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      const top = $('[data-store-top]', a);
      if (top) top.textContent = 'Download on the';
    });
  }

  /* ---------------- hero: the inventory's jelly pile ---------------- */
  // The app's own jellies, moving exactly as they do in its inventory: its soft bodies, their
  // pile, their lives and its face shader, ported in assets/js/jelly-pit.js.
  function initPit(holdUntil) {
    const hero = $('.hero'), pit = $('#pit');
    if (!hero || !pit || !window.SquishPit) return;
    window.SquishPit.start({
      hero, pit, hint: $('.hero-hint'), jellies: S.jellies, faces: S.faces || {}, reduceMotion, holdUntil,
      srcFor: (id, finish, big) => jellySrc(id, finish, big ? 'full' : 'sm'),
    });
  }

  /* ---------------- opening: the app's first screen ---------------- */
  // The site opens as the app does (OnboardingView): the logo pops out of a star, and a tap pours
  // every jelly down the screen until it's full (jelly-pit.js); then the floor gives way and the
  // heap falls out of the bottom, live, the site showing from the top down as it goes. `idle`
  // resolves while the pour is built and nobody has asked for it yet (a quiet moment to build the
  // hero's pile); `revealed` once the site has taken over; `cleared` once the opening has gone
  // altogether (the hero's own jellies drop in then, fresh, in plain sight).
  function initOpening() {
    const html = document.documentElement, root = $('#opening'), now = Promise.resolve();
    if (!root || !html.classList.contains('opening-on')) return { idle: now, revealed: now, cleared: now };
    const page = [$('.skip'), $('#nav'), $('#main')].filter(Boolean);
    page.forEach(el => { el.inert = true; });
    scrollTo(0, 0);
    try { root.focus({ preventScroll: true }); } catch (e) { /* focus is a courtesy */ }
    const opened = window.openingStart || performance.now();
    const heap = !reduceMotion && window.SquishPit && window.SquishPit.pour
      ? window.SquishPit.pour({ host: $('.opening-pour', root), jellies: S.jellies, faces: S.faces || {},
          srcFor: (id, finish, big) => jellySrc(id, finish, big ? 'full' : 'sm') })
      : null;
    const logo = initOpeningLogo(root);
    let going = false, finished = false, revealSite, idleNow, clearNow;
    const revealed = new Promise(resolve => { revealSite = resolve; });
    const idle = new Promise(resolve => { idleNow = resolve; });
    const cleared = new Promise(resolve => { clearNow = resolve; });
    if (heap) heap.ready.then(() => { if (!going) idleNow(); });

    // The site takes over: under the heap as it drops away, or straight away.
    const reveal = () => {
      if (finished) return;
      finished = true;
      html.classList.remove('opening-lock');
      page.forEach(el => { el.inert = false; });
      revealSite();
    };
    const cleanUp = () => {
      logo.stop();
      if (heap) heap.destroy();
      root.remove();
      html.classList.remove('opening-on');
      removeEventListener('keydown', onKey);
      toSection();
    };
    // Arrived by a link to a section: there, once the opening is over.
    const toSection = () => {
      let target = null;
      try { target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) { /* not an id */ }
      if (target && target.id !== 'top') target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    };
    const skip = () => {
      if (finished) return;
      root.classList.add('is-leaving');
      reveal();
      setTimeout(() => { cleanUp(); clearNow(); }, reduceMotion ? 0 : 400);
    };
    const go = async () => {
      if (going || finished) return;
      going = true;
      root.classList.add('is-going');
      if (!heap || !(await heap.ready)) { skip(); return; }
      // Not before the logo has popped out of the star.
      const wait = opened + 900 - performance.now();
      if (wait > 0) await sleep(wait);
      if (finished) return;
      root.classList.add('is-pouring');
      await heap.start();
      if (finished) return;
      // Full: the site is underneath now. A moment, then the floor gives way and the heap falls
      // out of the bottom, live; the site shows round and above the jellies as they go, top first.
      root.classList.add('is-covered');
      await sleep(150);
      if (finished) return;
      root.classList.add('is-dropping');
      const gone = heap.drop();
      reveal();
      await Promise.race([gone, sleep(2600)]);
      cleanUp();
      // The screen clear, a beat, then the hero's own jellies drop in.
      await sleep(180);
      clearNow();
    };
    const onKey = ev => {
      if (finished) return;
      if (ev.key === 'Escape') { ev.preventDefault(); skip(); }
      else if (['Enter', ' ', 'ArrowDown', 'PageDown'].includes(ev.key) && !ev.target.closest('.opening-skip')) { ev.preventDefault(); go(); }
    };
    addEventListener('keydown', onKey);
    // A tap anywhere (a pull on the logo is only play), or a scroll, starts it.
    root.addEventListener('pointerup', ev => {
      if (ev.button > 0 || ev.target.closest('.opening-skip') || logo.pulled()) return;
      go();
    });
    root.addEventListener('wheel', ev => { if (Math.abs(ev.deltaY) > 2) go(); }, { passive: true });
    $('.opening-skip', root).addEventListener('click', skip);
    if (window.openingTap === 'skip') skip();
    else if (window.openingTap) go();
    return { idle, revealed, cleared };
  }

  // The logo is jelly too (SquishyLogo). A press squashes it under the finger, pulling stretches
  // it and leans it after you, and letting go springs it back with a jiggle. With a mouse it turns
  // toward the pointer, a gloss sliding over it, as it turns when the phone tilts in the app.
  function initOpeningLogo(root) {
    const box = $('.opening-logo', root), poke = $('.opening-poke', root), tilt = $('.opening-tilt', root);
    let pulled = false;
    if (!box || !poke || !tilt || reduceMotion) return { stop() {}, pulled: () => false };
    const lean = [0, 0], leanTo = [0, 0];
    let raf = 0, live = true, held = null, release = null;
    const wobble = (s, amount, frequency, damping) => (s > 0 ? amount * Math.exp(-damping * s) * Math.cos(frequency * s) : 0);
    // Pressed flat, pulled tall (or pushed down) and leaning after the finger; `amount` takes it
    // all back toward rest.
    const shape = (x, dx, dy, press, amount) => {
      const up = clamp(-dy, -50, 110);
      const sx = 1 + 0.16 * press - up / 600, sy = clamp(1 - 0.14 * press + up / 260, 0.72, 1.45);
      return { x, sx: 1 + (sx - 1) * amount, sy: 1 + (sy - 1) * amount, lean: clamp(dx / 180, -0.35, 0.35) * amount };
    };
    const frame = now => {
      raf = 0;
      if (!live) return;
      let moving = false;
      for (let i = 0; i < 2; i++) {
        lean[i] += (leanTo[i] - lean[i]) * 0.12;
        if (Math.abs(leanTo[i] - lean[i]) > 0.001) moving = true;
      }
      tilt.style.transform = `perspective(1100px) rotateY(${(lean[0] * 14).toFixed(2)}deg) rotateX(${(-lean[1] * 10).toFixed(2)}deg)`;
      tilt.style.setProperty('--gloss', Math.min(1, (Math.abs(lean[0]) + Math.abs(lean[1])) * 1.4).toFixed(3));
      tilt.style.setProperty('--lx', lean[0].toFixed(3));
      tilt.style.setProperty('--ly', lean[1].toFixed(3));
      let s = null;
      if (held) {
        s = shape(held.x, held.dx, held.dy, Math.min(1, (now - held.at) / 120), 1);
        moving = true;
      } else if (release) {
        const since = (now - release.at) / 1000, jiggle = wobble(since, 1, 11, 4);
        s = shape(release.x, release.dx, release.dy, 1, jiggle);
        // A little bounce of its own even after a plain tap.
        s.sx += 0.06 * jiggle;
        s.sy -= 0.08 * jiggle;
        if (since > 1.4) { release = null; s = null; } else moving = true;
      }
      // Bent about the press, on the line the letters stand on (four fifths of the way down).
      poke.style.transformOrigin = s ? `${s.x.toFixed(1)}px 80%` : '';
      poke.style.transform = s ? `skewX(${(-Math.atan(s.lean) * 180 / Math.PI).toFixed(2)}deg) scale(${s.sx.toFixed(4)}, ${s.sy.toFixed(4)})` : '';
      if (moving) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf && live) raf = requestAnimationFrame(frame); };
    root.addEventListener('pointerdown', ev => {
      pulled = false;
      if (held || ev.button > 0 || !ev.target.closest('.opening-logo')) return;
      const r = box.getBoundingClientRect();
      held = { id: ev.pointerId, x: ev.clientX - r.left, cx: ev.clientX, cy: ev.clientY, dx: 0, dy: 0, at: performance.now() };
      release = null;
      kick();
    });
    root.addEventListener('pointermove', ev => {
      if (held && ev.pointerId === held.id) {
        held.dx = ev.clientX - held.cx;
        held.dy = ev.clientY - held.cy;
        if (Math.hypot(held.dx, held.dy) > 12) pulled = true;
      }
      if (ev.pointerType === 'mouse') {
        leanTo[0] = clamp((ev.clientX / innerWidth) * 2 - 1, -1, 1);
        leanTo[1] = clamp((ev.clientY / innerHeight) * 2 - 1, -1, 1);
      }
      kick();
    });
    const letGo = ev => {
      if (!held || ev.pointerId !== held.id) return;
      release = { x: held.x, dx: held.dx, dy: held.dy, at: performance.now() };
      held = null;
      kick();
    };
    root.addEventListener('pointerup', letGo);
    root.addEventListener('pointercancel', letGo);
    root.addEventListener('pointerleave', ev => {
      if (ev.pointerType === 'mouse') { leanTo[0] = leanTo[1] = 0; kick(); }
    });
    return {
      stop() { live = false; cancelAnimationFrame(raf); },
      pulled: () => pulled,
    };
  }

  /* ---------------- app recordings ---------------- */
  // Each phone plays a screen recording of the app itself, only while it's on screen. A
  // fingertip shows every tap and hold at the moment the recording has it: points on the
  // 402 x 874 screen, seconds into the clip, and how long a hold lasts.
  const TOUCHES = {
    map: [{ t: 2.12, x: 247, y: 333 }, { t: 4.45, x: 201, y: 780 }, { t: 7.95, x: 201, y: 440, hold: 1.8 }],
    den: [{ t: 7.6, x: 201, y: 312 }],
    trade: [{ t: 2.95, x: 295, y: 603 }, { t: 5.8, x: 253, y: 801 }, { t: 9.05, x: 106, y: 669 }],
    blender: [
      { t: 0.9, x: 51, y: 671, hold: 0.06 }, { t: 1.1, x: 126, y: 671, hold: 0.06 }, { t: 1.35, x: 201, y: 671 },
      { t: 3.8, x: 199, y: 533 }, { t: 11.35, x: 201, y: 440, hold: 1.75 }, { t: 15.55, x: 201, y: 803 },
    ],
  };
  const LABELS = { map: 'opening a drop', den: 'the Den', trade: 'making an offer', blender: 'the Blender' };

  // Where the fingertip is at time t: gliding in to a touch (from the last one if they come
  // close together, else from below), pressed for it, then fading where it lifted.
  function fingerAt(touches, t) {
    for (let i = 0; i < touches.length; i++) {
      const c = touches[i], lift = c.t + (c.hold || 0.12);
      const prev = touches[i - 1], next = touches[i + 1];
      const prevLift = prev ? prev.t + (prev.hold || 0.12) : -Infinity;
      const fromPrev = prev && c.t - 0.6 < prevLift + 0.3;
      const toNext = next && next.t - 0.6 < lift + 0.3;
      const begin = fromPrev ? prevLift : c.t - 0.6;
      if (t < begin) return null;
      if (t > (toNext ? lift : lift + 0.3)) continue;
      const from = fromPrev ? prev : { x: c.x + 30, y: c.y + 150 };
      const k = clamp((t - begin) / Math.max(0.01, c.t - 0.05 - begin), 0, 1);
      const e = k * k * (3 - 2 * k);
      return {
        x: from.x + (c.x - from.x) * e, y: from.y + (c.y - from.y) * e,
        on: toNext || t <= lift + 0.05, down: t >= c.t - 0.04 && t <= lift,
      };
    }
    return null;
  }

  function initClips() {
    const clips = $$('.phone video.clip').map(video => ({
      video, name: video.dataset.clip, screen: video.closest('.screen'), finger: $('.finger', video.closest('.phone')),
      touches: TOUCHES[video.dataset.clip] || [], seen: false, wasDown: false,
    }));
    if (!clips.length) return;
    const byVideo = new Map(clips.map(c => [c.video, c]));
    const pos = (x, y) => ({ left: `${(x / 402) * 100}%`, top: `${(y / 874) * 100}%` });
    const load = c => { if (!c.video.getAttribute('src')) c.video.src = `assets/clips/${c.name}.mp4`; };
    const ring = (c, x, y) => {
      const r = document.createElement('i');
      r.className = 'tap-ring';
      Object.assign(r.style, pos(x, y));
      c.screen.appendChild(r);
      setTimeout(() => r.remove(), 700);
    };

    let ticking = false;
    const tick = () => {
      ticking = false;
      for (const c of clips) {
        if (c.video.paused) continue;
        ticking = true;
        if (!c.finger || !c.touches.length) continue;
        const f = fingerAt(c.touches, c.video.currentTime);
        if (!f) {
          c.finger.classList.remove('is-on', 'is-down');
          c.wasDown = false;
          continue;
        }
        Object.assign(c.finger.style, pos(f.x, f.y));
        c.finger.classList.toggle('is-on', f.on);
        c.finger.classList.toggle('is-down', f.down);
        if (f.down && !c.wasDown) ring(c, f.x, f.y);
        c.wasDown = f.down;
      }
      if (ticking) requestAnimationFrame(tick);
    };
    const wake = () => { if (!ticking) { ticking = true; requestAnimationFrame(tick); } };
    const play = c => { load(c); const p = c.video.play(); if (p) p.catch(() => {}); };
    clips.forEach(c => {
      c.video.addEventListener('play', wake);
      c.video.addEventListener('ended', () => {
        if (c.finger) c.finger.classList.remove('is-on', 'is-down');
        if (c.button) c.button.hidden = false;
      });
    });

    // Fetch a clip a little before its phone arrives, and play it only while it's on screen.
    const near = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) load(byVideo.get(e.target)); });
    }, { rootMargin: '600px 0px' });
    clips.forEach(c => near.observe(c.video));

    if (reduceMotion) {
      // Still, on the clip's most telling frame, until asked to play (once).
      clips.forEach(c => {
        // The fan's quiet loops simply stay on their still.
        if (c.video.hasAttribute('data-ambient')) return;
        c.video.loop = false;
        c.video.poster = `assets/clips/${c.name}-still.jpg`;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'clip-play';
        b.setAttribute('aria-label', `Play the recording of ${LABELS[c.name] || 'the app'}`);
        b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg>';
        b.addEventListener('click', () => { b.hidden = true; play(c); });
        c.video.closest('.phone-slot').appendChild(b);
        c.button = b;
      });
      return;
    }

    const view = new IntersectionObserver(entries => {
      entries.forEach(e => {
        const c = byVideo.get(e.target);
        c.seen = e.isIntersecting;
        if (c.seen && !document.hidden) play(c); else c.video.pause();
      });
    }, { threshold: 0.35 });
    clips.forEach(c => view.observe(c.video));
    document.addEventListener('visibilitychange', () => {
      clips.forEach(c => { if (document.hidden) c.video.pause(); else if (c.seen) play(c); });
    });
  }

  /* ---------------- every jelly ---------------- */
  const GLOW = {
    common: 'rgba(153, 204, 255, .3)', rare: 'rgba(255, 140, 26, .32)', sketch: 'rgba(255, 255, 255, .2)',
    shiny: 'rgba(255, 92, 184, .36)', diamond: 'rgba(173, 237, 255, .4)',
  };

  function initJellies() {
    const showcase = $('.showcase');
    const img = $('#showcase-jelly');
    if (!showcase || !img) return;
    const nameEl = $('#showcase-name');
    const chip = $('#showcase-chip');
    const rate = $('#showcase-rate');
    const lore = $('#showcase-lore');
    const fin = $('#finishes');
    let cur = { id: 'tralalero-tralala', finish: 'diamond' };

    function renderFinishes(j) {
      fin.textContent = '';
      j.finishes.forEach(f => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `chip chip--${f}${f === cur.finish ? ' is-active' : ''}`;
        b.textContent = S.finishes[f].label;
        b.setAttribute('aria-pressed', String(f === cur.finish));
        b.addEventListener('click', () => show(j.id, f));
        fin.appendChild(b);
      });
    }

    function show(id, finish, animate = true) {
      const j = byId[id];
      const f = finishFor(id, finish);
      cur = { id, finish: f };
      const F = S.finishes[f];
      const src = jellySrc(id, f, 'lg');
      const apply = () => {
        img.src = src;
        img.alt = `${j.name} in its ${F.label} finish`;
        nameEl.textContent = j.name;
        chip.className = `chip chip--${f}`;
        chip.textContent = F.label;
        rate.lastChild.textContent = `+${F.rate}/hr`;
        lore.textContent = j.lore;
        showcase.style.setProperty('--glow', GLOW[f]);
        if (animate && !reduceMotion) {
          img.classList.remove('is-swapping');
          void img.offsetWidth;
          img.classList.add('is-swapping');
        }
        renderFinishes(j);
      };
      const pre = new Image();
      pre.src = src;
      (pre.decode ? pre.decode() : Promise.resolve()).then(apply, apply);
    }

    img.addEventListener('click', () => {
      const j = byId[cur.id];
      const i = j.finishes.indexOf(cur.finish);
      show(j.id, j.finishes[(i + 1) % j.finishes.length]);
    });

    const cycle = ['diamond', 'shiny', 'common', 'sketch', 'rare'];
    const list = S.jellies.map((j, i) => [j.id, finishFor(j.id, cycle[i % cycle.length])]);
    const rows = $$('.marquee-row');
    const halves = [list.slice(0, Math.ceil(list.length / 2)), list.slice(Math.ceil(list.length / 2))];
    rows.forEach((row, r) => {
      const make = ([id, f], copy) => {
        const j = byId[id];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'jchip';
        b.style.setProperty('--tint', GLOW[f]);
        if (copy) { b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); }
        b.innerHTML = `<img alt="" width="54" height="54" loading="lazy" decoding="async"><span><b></b><small><i class="dot dot--${f}"></i></small></span>`;
        $('img', b).src = jellySrc(id, f, 'sm');
        $('b', b).textContent = j.name;
        $('small', b).append(`${S.finishes[f].label} · +${S.finishes[f].rate}/hr`);
        b.setAttribute('aria-label', copy ? '' : `Show ${j.name}, ${S.finishes[f].label}`);
        b.addEventListener('click', () => {
          show(id, f);
          if (innerWidth < 900) showcase.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        });
        return b;
      };
      halves[r].forEach(item => row.appendChild(make(item, false)));
      if (!reduceMotion) halves[r].forEach(item => row.appendChild(make(item, true)));
      row.style.setProperty('--dur', `${halves[r].length * 4.4}s`);
    });

    show(cur.id, cur.finish, false);
  }

  /* ---------------- start ---------------- */
  function start(avif) {
    useAvif = avif !== false;
    if (!useAvif) {
      $$('img[src$=".avif"]').forEach(im => { im.src = im.src.replace(/(-sm)?\.avif$/, '-sm.png'); });
    }
    initBackdrop();
    hydrateJellies();
    initNav();
    initCounts();
    initStore();
    // The hero waits for the opening: its pile builds in a quiet moment while the opening waits
    // for a tap; its headline rises as the opening's heap falls away, and its own jellies drop in
    // once that has gone.
    const opening = initOpening();
    Promise.race([opening.idle, opening.revealed]).then(() => initPit(opening.cleared));
    opening.revealed.then(initReveal);
    initClips();
    initJellies();
    window.siteReady = true;
  }

  Promise.race([window.avifReady || Promise.resolve(true), sleep(1500).then(() => true)]).then(start, () => start(true));
})();
