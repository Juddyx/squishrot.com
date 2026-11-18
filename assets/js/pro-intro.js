/* The Pro page's opening, as the app's Get Pro opens (ProPopScene): "Something special is
   inside", a green-and-purple Pro jelly ball to hold until it pops; then a flash with PRO
   stamped on it, a flood of jelly, and Pro's six perks flying out to "Unlock Squishrot Pro".
   Plays the first time the page opens in a visit (the inline script before it decides), can be
   skipped, and comes back with any [data-pro-intro] button. Reduced motion opens on the perks. */
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

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function set(name) { root.dataset.stage = name; }
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
