/* Squishrot — squishrot.com
   Hero jelly pile (the app's own, from jelly-pit.js), live phone demos that only play while
   their phone is on screen, the jelly showcase and the usual scroll reveals. */
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

  function fillSpecks() {
    $$('.specks').forEach(box => {
      const frag = document.createDocumentFragment();
      const n = +box.dataset.specks || 30;
      for (let i = 0; i < n; i++) {
        const s = document.createElement('i');
        s.style.cssText = `left:${rand(0, 100).toFixed(2)}%;top:${rand(0, 100).toFixed(2)}%;--s:${rand(1, 2.6).toFixed(1)}px;--o:${rand(.3, .85).toFixed(2)};--t:${rand(2.5, 6.5).toFixed(1)}s;--d:${(-rand(0, 6)).toFixed(1)}s`;
        frag.appendChild(s);
      }
      box.appendChild(frag);
    });
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
  function initPit() {
    const hero = $('.hero'), pit = $('#pit');
    if (!hero || !pit || !window.SquishPit) return;
    window.SquishPit.start({
      hero, pit, hint: $('.hero-hint'), jellies: S.jellies, faces: S.faces || {}, reduceMotion,
      srcFor: (id, finish, big) => jellySrc(id, finish, big ? 'full' : 'sm'),
    });
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
    fillSpecks();
    hydrateJellies();
    initNav();
    initReveal();
    initCounts();
    initStore();
    initPit();
    initClips();
    initJellies();
    window.siteReady = true;
  }

  Promise.race([window.avifReady || Promise.resolve(true), sleep(1500).then(() => true)]).then(start, () => start(true));
})();
