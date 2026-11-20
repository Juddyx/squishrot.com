/* The Pro page's opening, as the app's Get Pro opens (ProPopScene): "Something special is
   inside", a green-and-purple Pro jelly ball to hold until it pops; then a flash with PRO
   stamped on it, a flood of jelly, and Pro's six perks flying out to "Unlock Squishrot Pro".
   Plays the first time the page opens in a visit (the inline script before it decides), can be
   skipped, and comes back with any [data-pro-intro] button. Reduced motion opens on the perks.
   Its words are jelly: gummy letters on springs that drop, ripple and wobble (see `jelly`). */
(function () {
  var html = document.documentElement, root = document.getElementById('pro-intro');
  if (!root) return;
  window.proIntroReady = true;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ball = root.querySelector('.pi-ball-button'), ring = root.querySelector('.pi-ring-fill');
  var stage = root.querySelector('.pi-stage'), burst = root.querySelector('.pi-burst');
  var go = root.querySelector('.pi-go'), skip = root.querySelector('.pi-skip');
  var HOLD = 1.4, EASE = 0.6, RING = 2 * Math.PI * 47;
  var charge = 0, holding = false, last = 0, raf = 0, timers = [], opener = null;
  ring.style.strokeDasharray = RING.toFixed(1);

  /* Jelly lettering: every word of the intro is cut into gummy letters that hang on springs.
     They drop in and land with a squash, ripple in a slow wave, tremble and stretch toward
     the ball as it charges, get blown off it when it pops, and wobble when a finger or the
     pointer brushes past. Reduced motion keeps the gummy look and leaves them still. */
  var jelly = (function () {
    var groups = [], letters = [], running = 0, lastT = 0, clock = 0, pointer = null, stageName = '';
    var STEP = 1 / 120;

    function cut(el, delay, gap) {
      var words = [], shown = document.createElement('span'), said = document.createElement('span');
      said.className = 'sr-only'; said.textContent = el.textContent.replace(/\s+/g, ' ').trim();
      shown.className = 'jt'; shown.setAttribute('aria-hidden', 'true');
      (function walk(node, green) {
        [].forEach.call(node.childNodes, function (child) {
          if (child.nodeType === 3) {
            child.textContent.split(/(\s+)/).forEach(function (part) {
              if (!part) return;
              if (/^\s+$/.test(part)) { shown.appendChild(document.createTextNode(' ')); return; }
              var word = document.createElement('span');
              word.className = 'jw' + (green ? ' jw--green' : '');
              Array.from(part).forEach(function (ch) {
                var l = document.createElement('span');
                l.className = 'jl'; l.textContent = ch;
                word.appendChild(l);
              });
              shown.appendChild(word); words.push(word);
            });
          } else if (child.nodeType === 1) walk(child, green || child.tagName === 'EM');
        });
      })(el, false);
      el.textContent = '';
      el.appendChild(said); el.appendChild(shown);
      var group = { el: el, delay: delay, gap: gap || 0.032, letters: [] };
      shown.querySelectorAll('.jl').forEach(function (node, n) {
        var l = { node: node, group: group, n: n, x: 0, cy: 0, run: 0, y: 0, vy: 0, a: 0, va: 0, s: 0, vs: 0, at: Infinity, shown: false, landed: false };
        group.letters.push(l); letters.push(l);
      });
      groups.push(group);
      return group;
    }

    var ballScene = root.querySelector('.pi-scene--ball'), perksScene = root.querySelector('.pi-scene--perks');
    var title = cut(root.querySelector('.pi-title'), 0.15), hint = cut(root.querySelector('.pi-hint'), 0.75, 0.045);
    title.scene = hint.scene = ballScene;
    var perkLabels = [].map.call(root.querySelectorAll('.pi-perks li span'), function (span, i) {
      var g = cut(span, 0.42 + i * 0.07, 0.022); g.scene = perksScene; return g;
    });
    var unlock = cut(root.querySelector('.pi-unlock'), 0.55); unlock.scene = perksScene;
    var go = cut(root.querySelector('.pi-go'), 0.72, 0.04); go.scene = perksScene;

    function measure() {
      letters.forEach(function (l) {
        var node = l.node, box = l.group.scene.getBoundingClientRect();
        l.x = box.left + node.offsetLeft + node.offsetWidth / 2;
        l.cy = box.top + node.offsetTop + node.offsetHeight / 2;
      });
    }
    function paint(l) {
      var s = Math.max(-0.42, Math.min(0.42, l.s));
      l.node.style.transform = 'translate3d(0,' + l.y.toFixed(2) + 'px,0) rotate(' + l.a.toFixed(2) + 'deg) scale(' + (1 + s).toFixed(3) + ',' + (1 - s).toFixed(3) + ')';
    }
    function hideAll(list) {
      list.forEach(function (l) { l.shown = false; l.landed = false; l.at = Infinity; l.node.style.opacity = '0'; });
    }
    function drop(gs) {
      gs.forEach(function (g) {
        g.letters.forEach(function (l, i) {
          l.at = clock + g.delay + i * g.gap;
          l.y = -46 - (i % 3) * 6; l.vy = 0; l.a = (i % 2 ? 1 : -1) * 14; l.va = 0; l.s = -0.3; l.vs = 0;
          l.shown = false; l.landed = false; l.node.style.opacity = '0';
          paint(l);
        });
      });
    }

    function stage(name) {
      stageName = name;
      if (reduce) return;
      if (name === 'ball') { hideAll(letters); requestAnimationFrame(measure); drop([title, hint]); start(); }
      else if (name === 'pop') blast();
      else if (name === 'perks') { requestAnimationFrame(measure); drop(perkLabels.concat([unlock, go])); start(); }
      else if (name === '') stop();
    }
    // The pop throws the ball's words off it: away from the ball's middle, squashed flat, spinning.
    function blast() {
      var wrap = root.querySelector('.pi-ball-wrap').getBoundingClientRect();
      var mx = wrap.left + wrap.width / 2, my = wrap.top + wrap.height / 2;
      title.letters.concat(hint.letters).forEach(function (l) {
        var dx = l.x - mx, dy = l.cy - my, d = Math.max(60, Math.hypot(dx, dy));
        l.vy += dy / d * 1500; l.va += dx / d * 1100 + (l.n % 2 ? 260 : -260); l.vs += 12;
      });
    }

    function step(l, dt, charge) {
      if (!l.shown) {
        if (clock < l.at) return;
        l.shown = true; l.node.style.opacity = '1';
      }
      var p = clock * 2.3 - l.n * 0.55 - l.group.delay * 4;
      var yT = -2.6 * Math.sin(p), aT = 3.6 * Math.sin(p * 0.8 + 1), sT = 0.08 * Math.sin(p * 1.3 + 0.6);
      // Every few seconds a boing runs along the line: each letter in turn is squashed and hops.
      var run = ((clock + l.group.delay * 1.7) % 3.4) * 15;
      if (l.landed && clock > l.at + 0.9 && l.run < l.n && run >= l.n) { l.vs += 4.2; l.vy -= 95; l.va += (l.n % 2 ? 1 : -1) * 60; }
      l.run = run;
      if (charge > 0 && l.group.scene === ballScene) {
        // Charging: the words lean in and stretch toward the ball, and shake harder the fuller it gets.
        var below = l.group === hint ? -1 : 1, mid = l.group.letters.length / 2;
        sT -= charge * 0.16; yT += below * charge * 7;
        aT += (l.n < mid ? 1 : -1) * below * charge * 7;
        l.va += (Math.random() - 0.5) * charge * charge * 26000 * dt;
        l.vs += (Math.random() - 0.5) * charge * charge * 260 * dt;
      }
      if (pointer) {
        var dx = l.x - pointer.x, dy = l.cy + l.y - pointer.y, d2 = dx * dx + dy * dy;
        if (d2 < 4900) {
          var f = 1 - Math.sqrt(d2) / 70;
          l.va += pointer.vx * f * 0.9 * dt * 60; l.vy += pointer.vy * f * 0.5 * dt * 60;
          l.vs += Math.min(4, Math.hypot(pointer.vx, pointer.vy) * 0.004) * f * dt * 60;
        }
      }
      var before = l.y;
      l.vy += ((yT - l.y) * 190 - l.vy * 9) * dt; l.y += l.vy * dt;
      l.va += ((aT - l.a) * 150 - l.va * 6.5) * dt; l.a += l.va * dt;
      l.vs += ((sT - l.s) * 280 - l.vs * 7) * dt; l.s += l.vs * dt;
      // Landing from the drop: a squash as it first comes through its line.
      if (!l.landed && before < 0 && l.y >= 0) { l.landed = true; l.vs += Math.min(10, l.vy * 0.022); }
    }
    function tick(now) {
      advance(Math.min(0.05, (now - lastT) / 1000));
      lastT = now;
      running = requestAnimationFrame(tick);
    }
    function advance(dt) {
      var steps = Math.max(1, Math.round(dt / STEP)), h = dt / steps;
      for (var k = 0; k < steps; k++) {
        clock += h;
        for (var i = 0; i < letters.length; i++) {
          var l = letters[i];
          if (l.group.scene === ballScene ? (stageName === 'ball' || stageName === 'pop') : (stageName === 'perks' || stageName === 'leaving')) step(l, h, charge);
        }
      }
      if (pointer) { pointer.vx *= 0.6; pointer.vy *= 0.6; }
      for (var j = 0; j < letters.length; j++) if (letters[j].shown) paint(letters[j]);
    }
    function start() { if (!running) { lastT = performance.now(); running = requestAnimationFrame(tick); } }
    function stop() { if (running) cancelAnimationFrame(running); running = 0; pointer = null; }

    function track(e) {
      var now = performance.now();
      if (pointer && now - pointer.t < 100) {
        var k = 1000 / Math.max(8, now - pointer.t);
        pointer.vx = (e.clientX - pointer.x) * k * 0.06; pointer.vy = (e.clientY - pointer.y) * k * 0.06;
      } else pointer = { vx: 0, vy: 0 };
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.t = now;
    }
    root.addEventListener('pointermove', track);
    root.addEventListener('pointerleave', function () { pointer = null; });
    // A tap on a word squashes the letters under it and ripples out to its neighbours.
    root.addEventListener('pointerdown', function (e) {
      letters.forEach(function (l) {
        if (!l.shown) return;
        var d = Math.hypot(l.x - e.clientX, l.cy + l.y - e.clientY);
        if (d < 90) { var f = 1 - d / 90; l.vs += 8 * f; l.vy += 160 * f; l.va += (l.x < e.clientX ? -1 : 1) * 220 * f; }
      });
    });
    addEventListener('resize', function () { if (running) measure(); });
    return { stage: stage, advance: advance };
  })();

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  window.proIntroJelly = jelly; // for stepping it by hand when testing
  function set(name) { root.dataset.stage = name; jelly.stage(name); }
  function paint() {
    ring.style.strokeDashoffset = (RING * (1 - charge)).toFixed(1);
    stage.style.setProperty('--charge', charge.toFixed(3));
  }
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    charge = Math.max(0, Math.min(1, charge + (holding ? dt / HOLD : -dt / EASE)));
    paint();
    if (charge >= 1) { raf = 0; pop(); return; }
    if (holding || charge > 0) raf = requestAnimationFrame(frame); else raf = 0;
  }
  function press(on) {
    if (root.dataset.stage !== 'ball') return;
    holding = on;
    if (on && navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  function spray() {
    var colours = ['#fff', '#00cc45', '#00abcc', '#006ef5', '#cc00a6', '#d6c7ff'], out = '';
    for (var k = 0; k < 30; k++) {
      var angle = k / 30 * 2 * Math.PI + Math.sin(k * 7.3) * 0.4, reach = 150 + 90 * ((k * 37) % 10) / 10;
      out += '<i style="--x:' + (Math.cos(angle) * reach).toFixed(1) + 'px;--y:' + (Math.sin(angle) * reach).toFixed(1) +
        'px;--c:' + colours[k % 6] + ';--s:' + (0.6 + ((k * 13) % 7) / 10).toFixed(2) + '"></i>';
    }
    burst.innerHTML = out;
  }
  function pop() {
    holding = false;
    spray();
    if (navigator.vibrate) { try { navigator.vibrate([20, 30, 40]); } catch (e) {} }
    set('pop');
    later(function () { set('flood'); }, 950);
    later(function () { set('perks'); go.focus({ preventScroll: true }); }, 2050);
  }

  function open(fromButton) {
    timers.forEach(clearTimeout); timers = [];
    opener = fromButton || null;
    charge = 0; holding = false; paint();
    burst.innerHTML = '';
    root.hidden = false;
    html.classList.add('pro-intro-on');
    if (reduce) { set('perks'); go.focus({ preventScroll: true }); return; }
    set('ball');
    ball.focus({ preventScroll: true });
  }
  function close() {
    timers.forEach(clearTimeout); timers = [];
    holding = false;
    try { sessionStorage.setItem('squishrot.proIntro', '1'); } catch (e) {}
    set('leaving');
    later(function () {
      root.hidden = true;
      html.classList.remove('pro-intro-on');
      set('');
      var to = opener || document.getElementById('pro-title');
      if (to) { if (!opener) to.setAttribute('tabindex', '-1'); to.focus({ preventScroll: true }); }
    }, reduce ? 0 : 650);
  }

  ball.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    try { ball.setPointerCapture(e.pointerId); } catch (err) {}
    press(true);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) { ball.addEventListener(t, function () { press(false); }); });
  ball.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  ball.addEventListener('keydown', function (e) {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(true); }
  });
  ball.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') press(false); });
  go.addEventListener('click', close);
  skip.addEventListener('click', close);
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      // Keep focus inside while it's open.
      var items = [].filter.call(root.querySelectorAll('button'), function (b) { return b.offsetParent !== null; });
      if (!items.length) return;
      var first = items[0], lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastItem.focus(); }
      else if (!e.shiftKey && document.activeElement === lastItem) { e.preventDefault(); first.focus(); }
    }
  });
  document.querySelectorAll('[data-pro-intro]').forEach(function (b) {
    b.addEventListener('click', function () { open(b); });
  });

  if (html.classList.contains('pro-intro-on')) open(); else root.hidden = true;
})();
