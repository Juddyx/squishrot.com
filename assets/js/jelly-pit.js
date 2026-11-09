/* Squishrot — the hero's jelly pile, as the app's inventory has it.
   A port of the app's own code, number for number:
   - each jelly is its soft body (JellyScene): a ring of 40 particles round the character,
     pulled toward its shape (shape matching) while XPBD edge and area constraints keep it
     plump, with a strain spring for cartoon squash and stretch; the ring bends the picture
     through a Coons patch, with finger dents on top;
   - they share one world at 480 steps a second (JellyPileScene), their skins pressing into
     each other through the app's contact kernel (JellyContactKernel.c), and rest one by one;
   - they live their own lives (JellyPileLife): habits in each one's temperament, its
     signature move, glances, flinches and squints;
   - they're drawn with WebGL through the app's face shader (JellyFaceShader): lids that close
     with each jelly's own skin, eyes that look about, a sheen, a holographic Shiny's moving
     foil and a Diamond's ice and gem light, with the app's glows, glints, shadows and smears. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = v => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
  const unit = () => Math.random() * 2 - 1;               // the app's randomUnit: -1...1

  // ---------------------------------------------------------------------------------------
  // The body: JellyScene.Tuning, distances in body heights.
  const N = 10, RING = N * 4, COLS = N + 1, GRID = COLS * COLS;
  const T = {
    substep: 1 / 480, gravity: 12.4, airDrag: 0.12, maxSpeed: 22.7, wallFriction: 0.42, floorStick: 14,
    edgeK: 22000, areaK: 3800, crushStart: 0.16, crushStiffen: 18, shapeK: 800, shapeKRescue: 9000,
    restFirmness: 7, wobbleDamping: 2.8, angularDamping: 0.35,
    uprightLean: 0.4, uprightGain: 0.65, uprightDamp: 0.16, uprightDone: 0.05, settleDamp: 4, settleSpeed: 0.43,
    squashK: 300, squashDamping: 7, impactGain: 0.7, maxImpactKick: 6.5, impactMinSpeed: 1.24, impactCooldown: 0.09,
    maxCompress: 0.5, maxStretch: 0.55, bulge: 0.85,
    flightStretchFrom: 1.62, flightStretchPerSpeed: 0.03, flightStretchMax: 0.2,
    squeezeRamp: 0.28, squeezeCompress: 0.3, squeezeBulge: 0.22, squeezeAreaLoss: 0.1, reboundKick: 2.5, hop: 3,
    dragThreshold: 10, grabNearK: 52000, grabFarK: 520, grabReach: 0.75, grabDamping: 26, grabGravity: 0.85,
    dentRestK: 260, dentNeighbourK: 420, dentDamping: 4.6, dentTouchK: 900, pressRadius: 0.34, pressDepth: 0.075,
    renderSmoothing: 3, breathAmount: 0.008, breathPeriod: 3.4,
    trailFrom: 7, trailCount: 4, trailDuration: 0.03,
  };
  const FLOOR = 1, CEILING = 2, LEFT = 4, RIGHT = 8, GROUND = 16;

  // Which column and row of the artwork grid each ring particle sits on: counter-clockwise
  // from the bottom-left corner.
  const RING_COL = new Int32Array(RING), RING_ROW = new Int32Array(RING);
  for (let i = 0; i < RING; i++) {
    let c, r;
    if (i < N) { c = i; r = 0; } else if (i < 2 * N) { c = N; r = i - N; }
    else if (i < 3 * N) { c = N - (i - 2 * N); r = N; } else { c = 0; r = N - (i - 3 * N); }
    RING_COL[i] = c; RING_ROW[i] = r;
  }

  function ringArea(p) {
    let a = 0;
    for (let i = 0; i < RING; i++) {
      const j = i + 1 === RING ? 0 : i + 1;
      a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
    }
    return a * 0.5;
  }

  // A jelly's face: its eyes, skin samples and personality (JellyFace), on its 768px picture.
  function expression(face, time) {
    const p = face.personality, period = 4.2 + p * 2.1, clock = Math.max(0, time) + p * 2.4;
    const cycle = Math.floor(clock / period), local = clock - cycle * period;
    const first = blinkAt(local - 1.8), second = cycle % 3 === 1 ? blinkAt(local - 2.15) : 0;
    return {
      blink: Math.max(first, second),
      breath: 0.014 * Math.sin((time * TAU) / (3.3 + p) + p * Math.PI),
      sway: 0.009 * Math.sin((time * TAU) / (5.1 + p * 2) + p * 4),
    };
  }
  function blinkAt(t) {
    if (t < 0 || t > 0.26) return 0;
    if (t < 0.075) return smooth(t / 0.075);
    if (t < 0.115) return 1;
    return 1 - smooth((t - 0.115) / 0.145);
  }

  class Body {
    constructor(face) {
      const f = () => new Float64Array(RING * 2), g = () => new Float64Array(GRID * 2);
      this.rest = f(); this.pos = f(); this.prev = f(); this.vel = f(); this.goals = f(); this.grad = f();
      this.shaped = f(); this.wob = f(); this.smo = f(); this.heldPos = f(); this.heldPrev = f();
      this.dent = g(); this.dentVel = g(); this.dest = g();
      this.bottom = new Float64Array(COLS * 2); this.top = new Float64Array(COLS * 2);
      this.left = new Float64Array(COLS * 2); this.right = new Float64Array(COLS * 2);
      this.face = face;
      this.sx = 0; this.sy = 0; this.sz = 0; this.svx = 0; this.svy = 0; this.svz = 0;   // strain: exx, eyy, exy
      this.cx = 0; this.cy = 0; this.theta = 0; this.omega = 0;
      this.rvx = 0; this.rvy = 0; this.rcx = 0; this.rcy = 0;
      this.righting = false; this.onFloor = false;
      this.restArea = 1; this.targetArea = 1; this.gradSumRest = 1;
      this.contacts = 0; this.contactsNext = 0;
      this.hitSpeed = 0; this.hitRigid = 0; this.hitNx = 0; this.hitNy = 1; this.impactCooldown = 0;
      this.impactFrom = null; this.impactClosing = 0; this.lastImpact = null;
      this.squeeze = 0; this.firmness = 0; this.touch = null; this.grab = null; this.isTouching = false;
      this.bodyW = 1; this.bodyH = 1; this.overhang = 1;
      this.supported = false; this.supportNext = false; this.huddle = null;
      // `ground`: a shape it lands on besides the floor (the opening's logo), and its last hard landing there.
      this.ground = null; this.groundHit = 0; this.groundHitX = 0;
      this.floorY = 0; this.ceilingY = 0; this.leftX = 0; this.rightX = 0; this.ceilingActive = false;
      this.dentsSettled = true; this.elapsed = 0;
      this.pressExpression = 0; this.reactionRemaining = 0;
      this.mood = { gx: 0, gy: 0, lean: 0, lids: 0, sx: 0, sy: 0, sz: 0, pull: 0, glossX: 0, glossY: 0, glossZ: 0 };
      this.gazeX = 0; this.gazeY = 0; this.leanNow = 0;
      this.lastPose = null; this.bodyDrift = 1;
      // What's drawn: its middle, outline box, lids, gaze and sheen.
      this.minX = 0; this.minY = 0; this.maxX = 0; this.maxY = 0;
      this.blink = 0; this.lookX = 0; this.lookY = 0; this.glossU = 0.36; this.glossV = 0.74; this.glossK = 0;
    }

    // configureSharedStage + layoutBody: the body's solid middle; the picture is `overhang` wider.
    configure(width, height, bodyW, bodyH, floor, inset, overhang) {
      this.bodyW = bodyW; this.bodyH = bodyH; this.overhang = overhang;
      this.floorY = floor; this.ceilingY = height; this.leftX = inset; this.rightX = width - inset;
      const rest = this.rest;
      for (let i = 0; i < RING; i++) {
        rest[2 * i] = (RING_COL[i] / N - 0.5) * bodyW;
        rest[2 * i + 1] = (RING_ROW[i] / N - 0.5) * bodyH;
      }
      this.restArea = ringArea(rest);
      this.targetArea = this.restArea;
      let sum = 0;
      for (let i = 0; i < RING; i++) {
        const p = i === 0 ? RING - 1 : i - 1, n = i + 1 === RING ? 0 : i + 1;
        const gx = 0.5 * (rest[2 * n + 1] - rest[2 * p + 1]), gy = 0.5 * (rest[2 * p] - rest[2 * n]);
        sum += gx * gx + gy * gy;
      }
      this.gradSumRest = sum;
    }

    // Moves the walls without rebuilding it, for a resized page.
    setWalls(width, height, floor, inset) {
      this.floorY = floor; this.ceilingY = height; this.leftX = inset; this.rightX = width - inset;
    }

    // placeShared: in at `x, y`, moving, tilted and turning.
    place(x, y, vx, vy, tilt, spin) {
      this.sx = this.sy = this.sz = this.svx = this.svy = this.svz = 0;
      this.squeeze = 0; this.grab = null; this.touch = null; this.isTouching = false;
      this.targetArea = this.restArea;
      this.lastPose = null; this.bodyDrift = 1;
      const c = Math.cos(tilt), s = Math.sin(tilt), rest = this.rest, pos = this.pos, prev = this.prev, goals = this.goals, vel = this.vel;
      for (let i = 0; i < RING; i++) {
        const rx = c * rest[2 * i] - s * rest[2 * i + 1], ry = s * rest[2 * i] + c * rest[2 * i + 1];
        pos[2 * i] = prev[2 * i] = goals[2 * i] = x + rx;
        pos[2 * i + 1] = prev[2 * i + 1] = goals[2 * i + 1] = y + ry;
        vel[2 * i] = vx - spin * ry;
        vel[2 * i + 1] = vy + spin * rx;
      }
      this.cx = this.rcx = x; this.cy = this.rcy = y;
      this.rvx = vx; this.rvy = vy; this.theta = tilt; this.omega = spin;
      this.contacts = 0; this.contactsNext = 0; this.onFloor = false; this.righting = false;
      this.supported = false; this.ceilingActive = false; this.impactCooldown = 0; this.firmness = 0;
    }

    // ---- touch (scene points, y up) ----
    // Maps a point back onto the undeformed body (0...1 on each axis).
    restCoordinate(x, y) {
      const a = 1 + this.sx, o = this.sz, d = 1 + this.sy, det = a * d - o * o;
      let ox = x - this.cx, oy = y - this.cy;
      if (det > 0.05) { const nx = (d * ox - o * oy) / det, ny = (a * oy - o * ox) / det; ox = nx; oy = ny; }
      const c = Math.cos(this.theta), s = Math.sin(this.theta);
      return [(c * ox + s * oy) / this.bodyW + 0.5, (-s * ox + c * oy) / this.bodyH + 0.5];
    }
    contains(x, y) {
      const [u, v] = this.restCoordinate(x, y), reach = 0.56 * this.overhang;
      return u >= 0.5 - reach && u <= 0.5 + reach && v >= -0.06 && v <= 1.06;
    }
    beginTouch(x, y) {
      const [u, v] = this.restCoordinate(x, y);
      if (u < -0.08 || u > 1.08 || v < -0.08 || v > 1.08) return;
      this.isTouching = true;
      this.touch = { x0: x, y0: y, x, y, held: 0, grabbing: false };
    }
    moveTouch(x, y) {
      const t = this.touch;
      if (!t) return;
      t.x = x; t.y = y;
      if (!t.grabbing && Math.hypot(x - t.x0, y - t.y0) > T.dragThreshold) {
        t.grabbing = true;
        this.squeeze = 0;
        this.startGrab(t.x0, t.y0);
      }
      if (t.grabbing && this.grab) { this.grab.tx = x; this.grab.ty = y; }
    }
    endTouch() {
      this.isTouching = false;
      const t = this.touch;
      if (!t) return;
      this.touch = null;
      if (t.grabbing) this.grab = null;   // whatever speed the finger gave it carries on as a throw
      else this.releaseSqueeze();
    }
    cancelTouch() { this.touch = null; this.grab = null; this.isTouching = false; this.squeeze = 0; }
    releaseSqueeze() {
      const amount = this.squeeze;
      this.squeeze = 0;
      if (amount <= 0.04) return;
      // Letting go of a squeeze springs it up off the floor.
      this.kick(0, 1, -amount * T.reboundKick);
      const up = T.hop * this.bodyH * amount, vel = this.vel;
      for (let i = 0; i < RING; i++) vel[2 * i + 1] += up;
    }
    startGrab(px, py) {
      const reach = T.grabReach * Math.max(this.bodyW, this.bodyH), c = Math.cos(this.theta), s = Math.sin(this.theta);
      const stiffness = new Float64Array(RING), anchors = new Float64Array(RING * 2), pos = this.pos;
      for (let i = 0; i < RING; i++) {
        const ox = pos[2 * i] - px, oy = pos[2 * i + 1] - py, t = Math.max(0, 1 - Math.hypot(ox, oy) / reach);
        stiffness[i] = T.grabFarK + (T.grabNearK - T.grabFarK) * t * t;
        anchors[2 * i] = c * ox + s * oy;
        anchors[2 * i + 1] = -s * ox + c * oy;
      }
      this.grab = { stiffness, anchors, tx: px, ty: py, lx: px, ly: py, tvx: 0, tvy: 0 };
    }
    updateTouch(frame) {
      const t = this.touch;
      if (t && !t.grabbing) {
        t.held += frame;
        const target = Math.min(1, t.held / T.squeezeRamp);
        if (target > this.squeeze) this.squeeze += (target - this.squeeze) * Math.min(1, frame * 14);
      }
      const g = this.grab;
      if (g && frame > 0) {
        g.tvx += ((g.tx - g.lx) / frame - g.tvx) * 0.5;
        g.tvy += ((g.ty - g.ly) / frame - g.tvy) * 0.5;
        g.lx = g.tx; g.ly = g.ty;
      }
    }

    // ---- squash ----
    // Compresses along a direction and bulges across it.
    kick(nx, ny, amount) {
      const bulge = amount * T.bulge;
      this.svx += -amount * nx * nx + bulge * ny * ny;
      this.svy += -amount * ny * ny + bulge * nx * nx;
      this.svz += -amount * nx * ny - bulge * nx * ny;
    }
    updateStrain(dt) {
      const m = this.mood;
      let tx = m.sx, ty = m.sy, tz = m.sz;
      if (this.squeeze > 0) { tx += this.squeeze * T.squeezeBulge; ty -= this.squeeze * T.squeezeCompress; }
      if (!this.onFloor && !this.grab) {
        // Stretched along its way while flying.
        const speed = Math.hypot(this.rvx, this.rvy), rel = speed / this.bodyH;
        if (rel > T.flightStretchFrom) {
          const w = Math.min(T.flightStretchMax, (rel - T.flightStretchFrom) * T.flightStretchPerSpeed);
          const dx = this.rvx / speed, dy = this.rvy / speed;
          tx += w * dx * dx - 0.6 * w * dy * dy;
          ty += w * dy * dy - 0.6 * w * dx * dx;
          tz += w * dx * dy + 0.6 * w * dx * dy;
        }
      }
      this.svx += (-T.squashK * (this.sx - tx) - T.squashDamping * this.svx) * dt;
      this.svy += (-T.squashK * (this.sy - ty) - T.squashDamping * this.svy) * dt;
      this.svz += (-T.squashK * (this.sz - tz) - T.squashDamping * this.svz) * dt;
      this.sx += this.svx * dt; this.sy += this.svy * dt; this.sz += this.svz * dt;
      const mean = (this.sx + this.sy) / 2, radius = Math.hypot((this.sx - this.sy) / 2, this.sz);
      let scale = 1;
      if (mean + radius > T.maxStretch) scale = Math.min(scale, T.maxStretch / (mean + radius));
      if (mean - radius < -T.maxCompress) scale = Math.min(scale, T.maxCompress / -(mean - radius));
      if (scale < 1) {
        this.sx *= scale; this.sy *= scale; this.sz *= scale;
        this.svx *= 0.5; this.svy *= 0.5; this.svz *= 0.5;
      }
      const det = (1 + this.sx) * (1 + this.sy) - this.sz * this.sz;
      this.targetArea = this.restArea * det * (1 - this.squeeze * T.squeezeAreaLoss);
    }

    // ---- one substep of the XPBD body ----
    integrate(dt) {
      // `fall` makes it heavier (a heap dropping through the floor).
      const gravity = -T.gravity * this.bodyH * (this.grab ? T.grabGravity : 1) * (this.fall || 1);
      const pull = this.grab ? 0 : (this.mood.pull + (this.huddle || 0)) * T.gravity * this.bodyH;
      const maxSpeed = T.maxSpeed * this.bodyH, pos = this.pos, prev = this.prev, vel = this.vel;
      for (let i = 0; i < RING * 2; i += 2) {
        prev[i] = pos[i]; prev[i + 1] = pos[i + 1];
        let vx = vel[i] + pull * dt, vy = vel[i + 1] + gravity * dt;
        const speed = Math.hypot(vx, vy);
        if (speed > maxSpeed) { vx *= maxSpeed / speed; vy *= maxSpeed / speed; }
        vel[i] = vx; vel[i + 1] = vy;
        pos[i] += vx * dt; pos[i + 1] += vy * dt;
      }
    }
    // Shape matching: the best-fit rotation of the rest shape, squashed by the strain, on the
    // particles' middle; resting on something, the goal leans back toward upright.
    computeGoals() {
      const pos = this.pos, rest = this.rest, goals = this.goals;
      let cx = 0, cy = 0;
      for (let i = 0; i < RING * 2; i += 2) { cx += pos[i]; cy += pos[i + 1]; }
      cx /= RING; cy /= RING;
      const a = 1 + this.sx, o = this.sz, d = 1 + this.sy, inv = a * d - o * o > 0.05;
      let cross = 0, dot = 0;
      for (let i = 0; i < RING * 2; i += 2) {
        const px = pos[i] - cx, py = pos[i + 1] - cy;
        const x = inv ? d * px - o * py : px, y = inv ? a * py - o * px : py, tx = rest[i], ty = rest[i + 1];
        cross += tx * y - ty * x;
        dot += tx * x + ty * y;
      }
      this.cx = cx; this.cy = cy;
      this.theta = Math.atan2(cross, dot);
      let angle = this.theta;
      if (this.righting) angle -= clamp(this.theta * T.uprightGain + this.omega * T.uprightDamp, -T.uprightLean, T.uprightLean);
      const c = Math.cos(angle), s = Math.sin(angle);
      for (let i = 0; i < RING * 2; i += 2) {
        const rx = c * rest[i] - s * rest[i + 1], ry = s * rest[i] + c * rest[i + 1];
        goals[i] = cx + a * rx + o * ry;
        goals[i + 1] = cy + o * rx + d * ry;
      }
    }
    solve(dt) {
      const s = dt * dt, pos = this.pos, goals = this.goals, grad = this.grad;
      this.computeGoals();
      // Edges follow the goal shape, so squash and stretch reshape them too.
      const edgeCompliance = 1 / (T.edgeK * s);
      for (let i = 0; i < RING; i++) {
        const j = i + 1 === RING ? 0 : i + 1;
        const restLength = Math.hypot(goals[2 * j] - goals[2 * i], goals[2 * j + 1] - goals[2 * i + 1]);
        const dx = pos[2 * j] - pos[2 * i], dy = pos[2 * j + 1] - pos[2 * i + 1], length = Math.hypot(dx, dy);
        if (length <= 1e-6) continue;
        const k = -(length - restLength) / (2 + edgeCompliance) / length;
        pos[2 * i] -= dx * k; pos[2 * i + 1] -= dy * k;
        pos[2 * j] += dx * k; pos[2 * j + 1] += dy * k;
      }
      // Area pressure keeps it plump, stiffening when crushed.
      const area = ringArea(pos);
      let norm = 0;
      for (let i = 0; i < RING; i++) {
        const p = i === 0 ? RING - 1 : i - 1, n = i + 1 === RING ? 0 : i + 1;
        const gx = 0.5 * (pos[2 * n + 1] - pos[2 * p + 1]), gy = 0.5 * (pos[2 * p] - pos[2 * n]);
        grad[2 * i] = gx; grad[2 * i + 1] = gy;
        norm += gx * gx + gy * gy;
      }
      const crush = Math.max(0, 1 - area / Math.max(1e-6, this.targetArea) - T.crushStart);
      const areaCompliance = this.gradSumRest / (T.areaK * (1 + crush * T.crushStiffen) * s);
      const lambda = -(area - this.targetArea) / (norm + areaCompliance);
      for (let i = 0; i < RING * 2; i++) pos[i] += grad[i] * lambda;
      // Pulled toward its shape, firmer once it's calm.
      const f = this.firmness, firm = f * f * (3 - 2 * f);
      const stiffness = area < this.targetArea * 0.35 ? T.shapeKRescue : T.shapeK * (1 + T.restFirmness * firm);
      const pull = 1 / (1 + 1 / (stiffness * s));
      for (let i = 0; i < RING * 2; i++) pos[i] += (goals[i] - pos[i]) * pull;
      const g = this.grab;
      if (g) {
        const c = Math.cos(this.theta), sn = Math.sin(this.theta);
        for (let i = 0; i < RING; i++) {
          const ax = g.anchors[2 * i], ay = g.anchors[2 * i + 1];
          const tx = g.tx + c * ax - sn * ay, ty = g.ty + sn * ax + c * ay;
          const follow = 1 / (1 + 1 / (g.stiffness[i] * s));
          pos[2 * i] += (tx - pos[2 * i]) * follow;
          pos[2 * i + 1] += (ty - pos[2 * i + 1]) * follow;
        }
      }
    }
    // The floor, ceiling and walls, with Coulomb friction: a splat grips the floor but a
    // resting jelly can relax.
    collideWalls(dt) {
      const pos = this.pos, prev = this.prev, friction = T.wallFriction, slides = this.huddle === null;
      let touched = 0, bestSpeed = 0, bestNx = 0, bestNy = 1, bestWall = 0, bestIndex = 0;
      const slide = (current, last, depth) => {
        const move = current - last, grip = depth * friction;
        return Math.abs(move) <= grip ? last : current - (move > 0 ? grip : -grip);
      };
      for (let i = 0; i < RING; i++) {
        let x = pos[2 * i], y = pos[2 * i + 1];
        const lx = prev[2 * i], ly = prev[2 * i + 1];
        if (y < this.floorY) {
          const v = (ly - y) / dt;
          if (v > bestSpeed) { bestSpeed = v; bestNx = 0; bestNy = 1; bestWall = FLOOR; bestIndex = i; }
          if (slides) x = slide(x, lx, this.floorY - y);
          y = this.floorY;
          touched |= FLOOR;
        } else if (this.ceilingActive && y > this.ceilingY) {
          const v = (y - ly) / dt;
          if (v > bestSpeed) { bestSpeed = v; bestNx = 0; bestNy = -1; bestWall = CEILING; bestIndex = i; }
          x = slide(x, lx, y - this.ceilingY);
          y = this.ceilingY;
          touched |= CEILING;
        }
        // The ground shape: out through the nearer of its top and bottom, the top along its slope.
        const g = this.ground;
        if (g && x > g.x0 && x < g.x1 && y > g.y0 && y < g.y1) {
          const c = Math.min(g.n - 1, ((x - g.x0) / g.dx) | 0), top = g.top[c], bottom = g.bottom[c];
          if (top > bottom && y < top && y > bottom) {
            if (top - y <= y - bottom) {
              const nx = g.nx[c], ny = g.ny[c], v = ((lx - x) * nx + (ly - y) * ny) / dt;
              if (v > bestSpeed) { bestSpeed = v; bestNx = nx; bestNy = ny; bestWall = GROUND; bestIndex = i; }
              x = slide(x, lx, top - y);
              y = top;
              this.supportNext = true;
            } else {
              const v = (y - ly) / dt;
              if (v > bestSpeed) { bestSpeed = v; bestNx = 0; bestNy = -1; bestWall = GROUND; bestIndex = i; }
              x = slide(x, lx, y - bottom);
              y = bottom;
            }
            touched |= GROUND;
          }
        }
        if (x < this.leftX) {
          const v = (lx - x) / dt;
          if (v > bestSpeed) { bestSpeed = v; bestNx = 1; bestNy = 0; bestWall = LEFT; bestIndex = i; }
          y = slide(y, ly, this.leftX - x);
          x = this.leftX;
          touched |= LEFT;
        } else if (x > this.rightX) {
          const v = (x - lx) / dt;
          if (v > bestSpeed) { bestSpeed = v; bestNx = -1; bestNy = 0; bestWall = RIGHT; bestIndex = i; }
          y = slide(y, ly, x - this.rightX);
          x = this.rightX;
          touched |= RIGHT;
        }
        pos[2 * i] = x; pos[2 * i + 1] = y;
      }
      this.contactsNext |= touched;
      if (bestWall === GROUND && (this.contacts & GROUND) === 0 && bestSpeed > this.groundHit) {
        this.groundHit = bestSpeed;
        this.groundHitX = pos[2 * bestIndex];
      }
      // Only a fresh contact counts as an impact.
      if (bestSpeed > this.hitSpeed && (this.contacts & bestWall) === 0) {
        this.hitSpeed = bestSpeed; this.hitNx = bestNx; this.hitNy = bestNy; this.impactFrom = null;
        const px = prev[2 * bestIndex] - this.rcx, py = prev[2 * bestIndex + 1] - this.rcy;
        const rx = this.rvx - this.omega * py, ry = this.rvy + this.omega * px;
        this.hitRigid = -(rx * bestNx + ry * bestNy);
        this.impactClosing = this.hitRigid;
      }
    }
    // Splits the motion into a rigid part and a wobble and damps each on its own, so the
    // jiggle settles without slowing a throw.
    finishSubstep(dt) {
      const pos = this.pos, prev = this.prev, vel = this.vel;
      let mx = 0, my = 0, cx = 0, cy = 0;
      for (let i = 0; i < RING * 2; i += 2) {
        vel[i] = (pos[i] - prev[i]) / dt; vel[i + 1] = (pos[i + 1] - prev[i + 1]) / dt;
        mx += vel[i]; my += vel[i + 1]; cx += pos[i]; cy += pos[i + 1];
      }
      mx /= RING; my /= RING; cx /= RING; cy /= RING;
      let angular = 0, inertia = 0;
      for (let i = 0; i < RING * 2; i += 2) {
        const rx = pos[i] - cx, ry = pos[i + 1] - cy;
        angular += rx * (vel[i + 1] - my) - ry * (vel[i] - mx);
        inertia += rx * rx + ry * ry;
      }
      const spin = inertia > 1e-9 ? angular / inertia : 0;
      const wobble = Math.exp(-T.wobbleDamping * dt);
      let linear = Math.exp(-T.airDrag * dt), keptSpin = spin * Math.exp(-T.angularDamping * dt);
      if ((this.onFloor || this.supported) && !this.righting && !this.grab && this.squeeze === 0
          && Math.hypot(mx, my) < T.settleSpeed * this.bodyH && Math.abs(this.theta) < 0.1) {
        const settle = Math.exp(-T.settleDamp * dt);
        linear *= settle;
        keptSpin *= settle;
      }
      const kx = mx * linear;
      let ky = my * linear;
      if (this.onFloor && !this.grab && this.squeeze === 0 && ky > 0) ky *= Math.exp(-T.floorStick * dt);
      this.rvx = kx; this.rvy = ky; this.rcx = cx; this.rcy = cy; this.omega = keptSpin;
      for (let i = 0; i < RING * 2; i += 2) {
        const rx = pos[i] - cx, ry = pos[i + 1] - cy;
        const dx = (vel[i] - (mx - spin * ry)) * wobble, dy = (vel[i + 1] - (my + spin * rx)) * wobble;
        vel[i] = kx - keptSpin * ry + dx;
        vel[i + 1] = ky + keptSpin * rx + dy;
      }
      const g = this.grab;
      if (g) {
        for (let i = 0; i < RING; i++) {
          const weight = g.stiffness[i] / T.grabNearK;
          if (weight < 0.002) continue;
          const follow = 1 - Math.exp(-T.grabDamping * weight * dt);
          vel[2 * i] += (g.tvx - vel[2 * i]) * follow;
          vel[2 * i + 1] += (g.tvy - vel[2 * i + 1]) * follow;
        }
      }
    }
    resolveImpacts(dt) {
      this.onFloor = (this.contactsNext & FLOOR) !== 0;
      this.contacts = this.contactsNext;
      this.contactsNext = 0;
      this.impactCooldown -= dt;
      const minSpeed = T.impactMinSpeed * this.bodyH;
      if (this.hitSpeed > minSpeed && this.hitRigid > minSpeed && this.impactCooldown <= 0) {
        this.impactCooldown = T.impactCooldown;
        const speed = Math.min(this.hitSpeed, this.hitRigid) / this.bodyH;
        this.kick(this.hitNx, this.hitNy, Math.min(T.maxImpactKick, speed * T.impactGain));
        const felt = this.impactClosing / this.bodyH;
        if (felt > (this.lastImpact ? this.lastImpact.speed : 0)) this.lastImpact = { speed: felt, from: this.impactFrom };
      }
      this.hitSpeed = 0; this.hitRigid = 0; this.impactFrom = null; this.impactClosing = 0;
      this.righting = (this.onFloor || this.supported) && !this.grab && Math.abs(this.theta) > T.uprightDone;
      if (!this.ceilingActive) {
        let below = true;
        for (let i = 1; i < RING * 2; i += 2) if (this.pos[i] >= this.ceilingY) { below = false; break; }
        if (below) this.ceilingActive = true;
      }
    }
    placeAtRest() {
      const x = (this.leftX + this.rightX) / 2, y = this.floorY + this.bodyH / 2;
      this.place(x, y, 0, 0, 0, 0);
      this.onFloor = true; this.contacts = FLOOR; this.ceilingActive = true;
    }

    // ---- the shared world (JellyPileScene's calls) ----
    beginFrame(frame) {
      this.elapsed += frame;
      this.updateTouch(frame);
      this.pressExpression += ((this.isTouching ? 0.78 : 0) - this.pressExpression) * (1 - Math.exp(-frame * 16));
      this.reactionRemaining = Math.max(0, this.reactionRemaining - frame);
      // Eyes dart quickly; the body leans more lazily.
      const m = this.mood, eyes = 1 - Math.exp(-frame * 14);
      this.gazeX += (m.gx - this.gazeX) * eyes;
      this.gazeY += (m.gy - this.gazeY) * eyes;
      this.leanNow += (m.lean - this.leanNow) * (1 - Math.exp(-frame * 4));
      if (this.face) {
        this.blink = clamp(Math.max(expression(this.face, this.elapsed).blink, this.pressExpression,
          Math.sin((this.reactionRemaining / 0.3) * Math.PI), m.lids), 0, 1);
        // Look and light come from the room, so both turn into the picture's own axes as it rolls.
        const c = Math.cos(this.theta), s = Math.sin(this.theta);
        let lx = c * this.gazeX + s * this.gazeY, ly = -s * this.gazeX + c * this.gazeY;
        const length = Math.hypot(lx, ly);
        if (length > 1) { lx /= length; ly /= length; }
        this.lookX = lx; this.lookY = ly;
        const gx = -0.15 + m.glossX, gy = 0.24 + m.glossY;
        this.glossU = 0.5 + c * gx + s * gy;
        this.glossV = 0.5 - s * gx + c * gy;
        this.glossK = clamp(m.glossZ, 0, 0.5);
      }
      // Soft under its neighbours rather than locked into its exact resting pose.
      const calm = (this.onFloor || this.supported) && !this.touch
        && Math.hypot(this.rvx, this.rvy) < 0.5 * this.bodyH && Math.hypot(this.svx, this.svy, this.svz) < 0.3;
      this.firmness = calm ? Math.min(0.35, this.firmness + frame * 0.8) : 0;
    }
    prepareStep(dt) {
      this.supportNext = false;
      this.updateStrain(dt);
      this.integrate(dt);
      this.solve(dt);
    }
    finishStep(dt) {
      this.finishSubstep(dt);
      this.supported = this.supportNext;
      this.resolveImpacts(dt);
      for (let i = 0; i < RING * 2; i++) if (!Number.isFinite(this.pos[i])) { this.placeAtRest(); break; }
    }
    renderFrame(frame) {
      this.computeGoals();
      this.sampleDrift(frame);
      this.stepDents(frame);
      this.render();
    }
    sampleDrift(frame) {
      const last = this.lastPose;
      if (last && frame > 0) {
        const speed = Math.hypot(this.cx - last[0], this.cy - last[1]) / frame / Math.max(1, this.bodyH)
          + (Math.abs(this.theta - last[2]) / frame) * 0.5;
        this.bodyDrift += (speed - this.bodyDrift) * Math.min(1, frame * 4);
      }
      this.lastPose = [this.cx, this.cy, this.theta];
    }
    get bounds() {
      const p = this.pos;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < RING * 2; i += 2) {
        const x = p[i], y = p[i + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return [x0, y0, x1, y1];
    }
    get quiet() { return !this.isTouching && (this.onFloor || this.supported) && this.bodyDrift < 0.05; }
    get slow() {
      return !this.isTouching && (this.onFloor || this.supported) && Math.hypot(this.rvx, this.rvy) < 0.25 * this.bodyH && Math.abs(this.omega) < 0.3;
    }
    get canSleep() {
      if (this.isTouching || !(this.onFloor || this.supported) || Math.hypot(this.svx, this.svy, this.svz) >= 0.08 || Math.abs(this.omega) >= 0.08) return false;
      const limit = (this.bodyH * 0.045) ** 2, vel = this.vel;
      for (let i = 0; i < RING * 2; i += 2) if (vel[i] * vel[i] + vel[i + 1] * vel[i + 1] >= limit) return false;
      return true;
    }
    get settled() {
      return !this.grab && !this.isTouching && (this.onFloor || this.supported)
        && Math.hypot(this.rvx, this.rvy) < 0.4 * this.bodyH && Math.abs(this.theta) < 0.3;
    }
    freeze() {
      this.vel.fill(0);
      this.svx = this.svy = this.svz = 0;
      this.rvx = this.rvy = 0;
      this.omega = 0;
    }
    takeImpact() { const i = this.lastImpact; this.lastImpact = null; return i; }
    // A jump of its own, in body heights a second, stretching on the way.
    hop(vx, vy, stretch = 0) {
      if (this.grab || this.isTouching) return;
      const vel = this.vel;
      for (let i = 0; i < RING * 2; i += 2) { vel[i] += vx * this.bodyH; vel[i + 1] += vy * this.bodyH; }
      if (stretch > 0) this.kick(0, 1, -stretch);
      this.firmness = 0;
    }
    squishSideways(amount) {
      if (this.grab || this.isTouching) return;
      this.kick(1, 0, amount);
      this.firmness = 0;
    }
    spin(spin) {
      if (this.grab || this.isTouching) return;
      const pos = this.pos, vel = this.vel;
      for (let i = 0; i < RING * 2; i += 2) {
        vel[i] -= (pos[i + 1] - this.cy) * spin;
        vel[i + 1] += (pos[i] - this.cx) * spin;
      }
      this.firmness = 0;
    }
    // Ducks and leans away from a nearby crash, blinking.
    flinch(dx, strength) {
      if (this.grab || this.isTouching || !(strength > 0)) return;
      const push = dx < 0 ? -1 : 1, vel = this.vel;
      for (let i = 0; i < RING * 2; i += 2) vel[i] += push * strength * 0.5 * this.bodyH;
      this.svz += push * strength * 1.2;
      this.svy -= strength * 0.8;
      this.reactionRemaining = Math.max(this.reactionRemaining, 0.3);
      this.firmness = 0;
    }
    recordImpact(speed, nx, ny, fromX, fromY, closing) {
      if (this.impactCooldown > 0 || speed <= this.hitSpeed) return;
      this.hitSpeed = speed; this.hitRigid = speed; this.hitNx = nx; this.hitNy = ny;
      this.impactFrom = [fromX, fromY]; this.impactClosing = closing;
      if (speed > this.bodyH * 2) this.reactionRemaining = 0.3;
    }
    holdPose() { this.heldPos.set(this.pos); this.heldPrev.set(this.prev); }
    // Puts the skin back and returns how far the contact had moved it.
    releaseHeldPose() {
      let furthest = 0;
      const pos = this.pos, held = this.heldPos;
      for (let i = 0; i < RING * 2; i += 2) {
        const dx = pos[i] - held[i], dy = pos[i + 1] - held[i + 1], d = dx * dx + dy * dy;
        if (d > furthest) furthest = d;
      }
      pos.set(held);
      this.prev.set(this.heldPrev);
      this.hitSpeed = 0; this.hitRigid = 0; this.impactFrom = null; this.impactClosing = 0;
      return Math.sqrt(furthest);
    }

    // ---- finger dents, on an 11 x 11 grid over the picture ----
    stepDents(frame) {
      let px = 0, py = 0, depth = 0, pressing = false;
      if (this.touch && !this.touch.grabbing) {
        [px, py] = this.restCoordinate(this.touch.x, this.touch.y);
        depth = T.pressDepth * this.squeeze;
        pressing = true;
      }
      if (!pressing && this.dentsSettled) return;
      const o = this.dent, w = this.dentVel, steps = Math.max(1, Math.ceil(frame * 240)), dt = frame / steps;
      let largest = 0;
      for (let s = 0; s < steps; s++) {
        for (let r = 0; r < COLS; r++) {
          for (let c = 0; c < COLS; c++) {
            const i = (r * COLS + c) * 2;
            let nx = 0, ny = 0, count = 0;
            if (c > 0) { nx += o[i - 2]; ny += o[i - 1]; count++; }
            if (c < N) { nx += o[i + 2]; ny += o[i + 3]; count++; }
            if (r > 0) { nx += o[i - 2 * COLS]; ny += o[i - 2 * COLS + 1]; count++; }
            if (r < N) { nx += o[i + 2 * COLS]; ny += o[i + 2 * COLS + 1]; count++; }
            let fx = -T.dentRestK * o[i] + T.dentNeighbourK * (nx / count - o[i]) - T.dentDamping * w[i];
            let fy = -T.dentRestK * o[i + 1] + T.dentNeighbourK * (ny / count - o[i + 1]) - T.dentDamping * w[i + 1];
            if (pressing) {
              // The material under the finger bulges outward.
              const dx = c / N - px, dy = r / N - py, distance = Math.hypot(dx, dy);
              if (distance < T.pressRadius && distance > 0.0001) {
                const q = 1 - (distance / T.pressRadius) ** 2, fall = q * q;
                fx += T.dentTouchK * fall * ((dx / distance) * depth * fall - o[i]);
                fy += T.dentTouchK * fall * ((dy / distance) * depth * fall - o[i + 1]);
              }
            }
            w[i] += fx * dt; w[i + 1] += fy * dt;
          }
        }
        for (let i = 0; i < GRID * 2; i += 2) {
          o[i] += w[i] * dt; o[i + 1] += w[i + 1] * dt;
          largest = Math.max(largest, Math.hypot(o[i], o[i + 1]), Math.hypot(w[i], w[i + 1]) * 0.1);
        }
      }
      this.dentsSettled = !pressing && largest < 0.0002;
      if (this.dentsSettled) { o.fill(0); w.fill(0); }
    }

    // ---- the picture's warp ----
    // The particles less their goal shape are the wobble; smoothed along the ring it keeps the
    // splat and rebound without one pinned particle kinking an arm or a foot.
    smoothShape() {
      const pos = this.pos, goals = this.goals;
      let wob = this.wob, smo = this.smo;
      for (let i = 0; i < RING * 2; i++) wob[i] = pos[i] - goals[i];
      for (let pass = 0; pass < T.renderSmoothing; pass++) {
        for (let i = 0; i < RING; i++) {
          const p = i === 0 ? RING - 1 : i - 1, n = i + 1 === RING ? 0 : i + 1;
          smo[2 * i] = 0.25 * wob[2 * p] + 0.5 * wob[2 * i] + 0.25 * wob[2 * n];
          smo[2 * i + 1] = 0.25 * wob[2 * p + 1] + 0.5 * wob[2 * i + 1] + 0.25 * wob[2 * n + 1];
        }
        const t = wob; wob = smo; smo = t;
      }
      this.wob = wob; this.smo = smo;
      const shaped = this.shaped;
      for (let i = 0; i < RING * 2; i++) shaped[i] = goals[i] + wob[i];
      constrainOutline(shaped, goals);
      // Lift the smoothed outline together onto the floor.
      let minimum = this.floorY;
      for (let i = 1; i < RING * 2; i += 2) if (shaped[i] < minimum) minimum = shaped[i];
      const lift = this.floorY - minimum;
      if (lift > 0) for (let i = 1; i < RING * 2; i += 2) shaped[i] += lift;
    }
    render() {
      this.smoothShape();
      const sh = this.shaped, b = this.bottom, t = this.top, l = this.left, r = this.right;
      for (let k = 0; k <= N; k++) {
        b[2 * k] = sh[2 * k]; b[2 * k + 1] = sh[2 * k + 1];
        r[2 * k] = sh[2 * (N + k)]; r[2 * k + 1] = sh[2 * (N + k) + 1];
        const ti = (3 * N - k) % RING, li = (4 * N - k) % RING;
        t[2 * k] = sh[2 * ti]; t[2 * k + 1] = sh[2 * ti + 1];
        l[2 * k] = sh[2 * li]; l[2 * k + 1] = sh[2 * li + 1];
      }
      const p00x = b[0], p00y = b[1], p10x = b[2 * N], p10y = b[2 * N + 1];
      const p01x = t[0], p01y = t[1], p11x = t[2 * N], p11y = t[2 * N + 1];
      let cx = 0, cy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < RING * 2; i += 2) {
        const x = sh[i], y = sh[i + 1];
        cx += x; cy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      cx /= RING; cy /= RING;
      this.drawX = cx; this.drawY = cy;
      this.minX = x0; this.maxX = x1; this.minY = y0; this.maxY = y1;
      // Calm (resting on the floor or a neighbour), it breathes up from its own base and sways.
      const calm = (this.onFloor || this.supported) && !this.grab && !this.touch;
      const life = this.face ? expression(this.face, this.elapsed) : null;
      const breath = calm ? (life ? life.breath : T.breathAmount * Math.sin((this.elapsed * TAU) / T.breathPeriod)) : 0;
      const sway = calm ? (life ? life.sway : 0) + this.leanNow * 0.05 : 0;
      const base = y0, bw = this.bodyW, bh = this.bodyH, dest = this.dest, dent = this.dent;
      // A Coons patch fills the ring so the picture bends smoothly.
      for (let row = 0; row <= N; row++) {
        const v = row / N;
        for (let col = 0; col <= N; col++) {
          const u = col / N;
          let px = (1 - v) * b[2 * col] + v * t[2 * col] + (1 - u) * l[2 * row] + u * r[2 * row]
            - ((1 - u) * (1 - v) * p00x + u * (1 - v) * p10x + (1 - u) * v * p01x + u * v * p11x);
          let py = (1 - v) * b[2 * col + 1] + v * t[2 * col + 1] + (1 - u) * l[2 * row + 1] + u * r[2 * row + 1]
            - ((1 - u) * (1 - v) * p00y + u * (1 - v) * p10y + (1 - u) * v * p01y + u * v * p11y);
          px = cx + (px - cx) * (1 - 0.6 * breath);
          py = base + (py - base) * (1 + breath);
          px += sway * bw * v * v;
          const i = (row * COLS + col) * 2;
          dest[i] = (px - cx) / bw + 0.5 + dent[i];
          dest[i + 1] = (py - cy) / bh + 0.5 + dent[i + 1];
        }
      }
      // Never folded through itself: an extreme drag eases back toward the plain shape.
      const g = this.goals;
      const ox = (g[0] - cx) / bw + 0.5;
      const goalFloor = Math.min(g[1], g[2 * N + 1], g[4 * N + 1], g[6 * N + 1]);
      const oy = (g[1] - cy) / bh + 0.5 + Math.max(0, this.floorY - goalFloor) / bh;
      constrainWarp(dest, ox, oy, (g[2 * N] - g[0]) / bw, (g[2 * N + 1] - g[1]) / bh,
        (g[6 * N] - g[0]) / bw, (g[6 * N + 1] - g[1]) / bh);
    }
  }

  // ---- JellyContactKernel.c ----
  function centerOf(p) {
    let x = 0, y = 0;
    for (let i = 0; i < RING * 2; i += 2) { x += p[i]; y += p[i + 1]; }
    return [x / RING, y / RING];
  }

  // Keeps the drawn wobble within bounds of the goal shape, without adding any bounce.
  function constrainOutline(points, goals) {
    const pc = centerOf(points), gc = centerOf(goals), ox = pc[0] - gc[0], oy = pc[1] - gc[1];
    const q = RING / 4, h = (RING * 3) / 4;
    const widthLength = Math.hypot(goals[2 * q] - goals[0], goals[2 * q + 1] - goals[1]);
    const heightLength = Math.hypot(goals[2 * h] - goals[0], goals[2 * h + 1] - goals[1]);
    const limit = 0.2 * Math.min(widthLength, heightLength);
    let scale = 1;
    for (let i = 0; i < RING; i++) {
      const j = i + 1 === RING ? 0 : i + 1;
      const wx = points[2 * i] - goals[2 * i] - ox, wy = points[2 * i + 1] - goals[2 * i + 1] - oy;
      const distance = Math.hypot(wx, wy);
      if (distance > limit) scale = Math.min(scale, limit / distance);
      const ex = goals[2 * j] - goals[2 * i], ey = goals[2 * j + 1] - goals[2 * i + 1];
      const chx = points[2 * j] - points[2 * i] - ex, chy = points[2 * j + 1] - points[2 * i + 1] - ey;
      const change = Math.hypot(chx, chy), edgeLimit = 0.55 * Math.hypot(ex, ey);
      if (change > edgeLimit) scale = Math.min(scale, edgeLimit / change);
    }
    if (scale >= 1) return;
    for (let i = 0; i < RING * 2; i += 2) {
      points[i] += (goals[i] + ox - points[i]) * (1 - scale);
      points[i + 1] += (goals[i + 1] + oy - points[i + 1]) * (1 - scale);
    }
  }

  function validWarp(p) {
    const minimumArea = 0.04 / (N * N);
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const i = (row * COLS + col) * 2, j = i + 2, k = i + 2 * COLS, m = k + 2;
        const ax = p[i], ay = p[i + 1], bx = p[j], by = p[j + 1], cx = p[k], cy = p[k + 1], dx = p[m], dy = p[m + 1];
        // All four corners keep their winding, along either diagonal.
        if (!((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > minimumArea
          && (dx - bx) * (ay - by) - (dy - by) * (ax - bx) > minimumArea
          && (cx - dx) * (by - dy) - (cy - dy) * (bx - dx) > minimumArea
          && (ax - cx) * (dy - cy) - (ay - cy) * (dx - cx) > minimumArea)) return false;
      }
    }
    return true;
  }
  function constrainWarp(p, ox, oy, hx, hy, vx, vy) {
    for (let attempt = 0; attempt <= 8; attempt++) {
      if (validWarp(p)) return;
      for (let row = 0; row < COLS; row++) {
        for (let col = 0; col < COLS; col++) {
          const i = (row * COLS + col) * 2, u = col / N, v = row / N;
          const gx = ox + hx * u + vx * v, gy = oy + hy * u + vy * v;
          const bad = !Number.isFinite(p[i]) || !Number.isFinite(p[i + 1]);
          p[i] = attempt === 8 || bad ? gx : (p[i] + gx) * 0.5;
          p[i + 1] = attempt === 8 || bad ? gy : (p[i + 1] + gy) * 0.5;
        }
      }
    }
  }

  // Their middles can't pass through each other: separated along the least overlap of the two
  // goal shapes' cores (70% of each), as boxes turned with each body.
  const cornersA = new Float64Array(8), cornersB = new Float64Array(8);
  function separateCores(A, B, out) {
    out.touched = false; out.supportsA = false; out.supportsB = false;
    const [cax, cay] = centerOf(A.pos), [cbx, cby] = centerOf(B.pos);
    const [gax, gay] = centerOf(A.goals), [gbx, gby] = centerOf(B.goals);
    for (let i = 0; i < 4; i++) {
      const ia = i * (RING / 4) * 2;
      cornersA[2 * i] = (A.goals[ia] - gax) * 0.7; cornersA[2 * i + 1] = (A.goals[ia + 1] - gay) * 0.7;
      cornersB[2 * i] = (B.goals[ia] - gbx) * 0.7; cornersB[2 * i + 1] = (B.goals[ia + 1] - gby) * 0.7;
    }
    let minimum = Infinity, nx = 1, ny = 0;
    for (let axis = 0; axis < 4; axis++) {
      const corners = axis < 2 ? cornersA : cornersB, e = axis % 2;
      const ex = corners[2 * (e + 1)] - corners[2 * e], ey = corners[2 * (e + 1) + 1] - corners[2 * e + 1];
      const length = Math.hypot(ex, ey);
      if (length < 1e-5) return out;
      const dx = ey / length, dy = -ex / length;
      let ra = 0, rb = 0;
      for (let i = 0; i < 4; i++) {
        ra = Math.max(ra, Math.abs(cornersA[2 * i] * dx + cornersA[2 * i + 1] * dy));
        rb = Math.max(rb, Math.abs(cornersB[2 * i] * dx + cornersB[2 * i + 1] * dy));
      }
      const separation = (cax - cbx) * dx + (cay - cby) * dy, overlap = ra + rb - Math.abs(separation);
      if (overlap <= 0) return out;
      if (overlap < minimum) { minimum = overlap; nx = separation >= 0 ? dx : -dx; ny = separation >= 0 ? dy : -dy; }
    }
    const kx = nx * minimum * 0.5, ky = ny * minimum * 0.5;
    const [pax, pay] = centerOf(A.prev), [pbx, pby] = centerOf(B.prev);
    const closing = Math.min(0, (cax - pax - (cbx - pbx)) * nx + (cay - pay - (cby - pby)) * ny) * 0.5;
    const sx = nx * closing, sy = ny * closing;
    const ap = A.pos, aq = A.prev, bp = B.pos, bq = B.prev;
    for (let i = 0; i < RING * 2; i += 2) {
      ap[i] += kx; ap[i + 1] += ky; aq[i] += kx + sx; aq[i + 1] += ky + sy;
      bp[i] -= kx; bp[i + 1] -= ky; bq[i] -= kx + sx; bq[i + 1] -= ky + sy;
    }
    out.touched = true;
    out.supportsA = ny > 0.45;
    out.supportsB = ny < -0.45;
    return out;
  }

  // Each skin particle of A inside (or within a hair of) B's outline is pushed out along the
  // nearest edge, the edge's two ends taking the reaction, with a little grip.
  function resolveContacts(A, B, minX, minY, maxX, maxY, rvx, rvy, out) {
    out.touched = false; out.supportsA = false; out.supportsB = false; out.speed = 0; out.nx = 0; out.ny = 1;
    const skin = 1.2, pa = A.pos, pb = B.pos, qa = A.prev, qb = B.prev;
    for (let index = 0; index < RING; index++) {
      const px = pa[2 * index], py = pa[2 * index + 1];
      if (px < minX || px > maxX || py < minY || py > maxY) continue;
      let inside = false, nearX = 0, nearY = 0, best = Infinity, bestEdge = 0, bestT = 0;
      for (let edge = 0; edge < RING; edge++) {
        const next = edge + 1 === RING ? 0 : edge + 1;
        const sx = pb[2 * edge], sy = pb[2 * edge + 1], ex = pb[2 * next], ey = pb[2 * next + 1];
        if ((sy > py) !== (ey > py) && px < ((ex - sx) * (py - sy)) / (ey - sy) + sx) inside = !inside;
        const dx = ex - sx, dy = ey - sy, ls = dx * dx + dy * dy;
        const t = ls > 1e-8 ? Math.min(1, Math.max(0, ((px - sx) * dx + (py - sy) * dy) / ls)) : 0;
        const cx = sx + dx * t, cy = sy + dy * t, ox = px - cx, oy = py - cy, d = ox * ox + oy * oy;
        if (d < best) { best = d; nearX = cx; nearY = cy; bestEdge = edge; bestT = t; }
      }
      if (!inside && best >= skin * skin) continue;
      const next = bestEdge + 1 === RING ? 0 : bestEdge + 1, distance = Math.sqrt(best);
      const ex = pb[2 * next] - pb[2 * bestEdge], ey = pb[2 * next + 1] - pb[2 * bestEdge + 1];
      const el = Math.max(1e-5, Math.hypot(ex, ey));
      let nx, ny;
      if (distance > 1e-5) {
        nx = (inside ? nearX - px : px - nearX) / distance;
        ny = (inside ? nearY - py : py - nearY) / distance;
      } else { nx = ey / el; ny = -ex / el; }
      const depth = inside ? distance + skin : skin - distance;
      const t = bestT, u = 1 - t, den = 1 + t * t + u * u;
      const kx = nx * (depth / den), ky = ny * (depth / den);
      pa[2 * index] += kx; pa[2 * index + 1] += ky;
      pb[2 * bestEdge] -= kx * u; pb[2 * bestEdge + 1] -= ky * u;
      pb[2 * next] -= kx * t; pb[2 * next + 1] -= ky * t;
      const rx = pa[2 * index] - qa[2 * index] - (pb[2 * bestEdge] - qb[2 * bestEdge]) * u - (pb[2 * next] - qb[2 * next]) * t;
      const ry = pa[2 * index + 1] - qa[2 * index + 1] - (pb[2 * bestEdge + 1] - qb[2 * bestEdge + 1]) * u - (pb[2 * next + 1] - qb[2 * next + 1]) * t;
      const along = rx * nx + ry * ny, tx = rx - nx * along, ty = ry - ny * along, tl = Math.hypot(tx, ty);
      if (tl > 1e-6) {
        const k = Math.min(tl, depth * 0.28) / tl / den, gx = tx * k, gy = ty * k;
        pa[2 * index] -= gx; pa[2 * index + 1] -= gy;
        pb[2 * bestEdge] += gx * u; pb[2 * bestEdge + 1] += gy * u;
        pb[2 * next] += gx * t; pb[2 * next + 1] += gy * t;
      }
      if (ny > 0.45) out.supportsA = true;
      if (ny < -0.45) out.supportsB = true;
      const speed = Math.max(0, -(rvx * nx + rvy * ny));
      if (speed > out.speed) { out.speed = speed; out.nx = nx; out.ny = ny; }
      out.touched = true;
    }
    return out;
  }

  const coreOut = {}, contactOut = {};
  function overlaps(a, b, margin) {
    const A = a.bounds, B = b.bounds;
    return A[0] - margin <= B[2] && A[2] + margin >= B[0] && A[1] - margin <= B[3] && A[3] + margin >= B[1];
  }
  // Symmetric vertex and edge contacts deform both skins.
  function collidePair(a, b) {
    if (!overlaps(a, b, 2)) return false;
    const sep = separateCores(a, b, coreOut);
    a.supportNext = a.supportNext || sep.supportsA;
    b.supportNext = b.supportNext || sep.supportsB;
    const touched = sep.touched;
    const first = resolveVertices(a, b), second = resolveVertices(b, a);
    return touched || first || second;
  }
  function resolveVertices(a, b) {
    const [x0, y0, x1, y1] = b.bounds, rvx = a.rvx - b.rvx, rvy = a.rvy - b.rvy;
    const c = resolveContacts(a, b, x0 - 1.2, y0 - 1.2, x1 + 1.2, y1 + 1.2, rvx, rvy, contactOut);
    a.supportNext = a.supportNext || c.supportsA;
    b.supportNext = b.supportNext || c.supportsB;
    const closing = Math.hypot(rvx, rvy);
    a.recordImpact(c.speed, c.nx, c.ny, b.cx, b.cy, closing);
    b.recordImpact(c.speed, -c.nx, -c.ny, a.cx, a.cy, closing);
    return c.touched;
  }
  // A moving body against one resting in the pile: the resting one holds still, as if propped
  // up by everything round it, and only joins in when the contact shoves it.
  function collideResting(moving, resting) {
    if (!overlaps(moving, resting, 2)) return 0;
    resting.holdPose();
    collidePair(moving, resting);
    return resting.releaseHeldPose() > resting.bodyH * 0.005 ? 2 : 1;
  }

  // ---------------------------------------------------------------------------------------
  // Their life: JellyPileLife.
  const TEMPER = {
    'tralalero-tralala': 'bouncy', 'chimpanzini-bananini': 'bouncy', 'tung-tung-tung-sahur': 'bouncy',
    'brr-brr-patapim': 'bouncy', 'arancino-muscolino': 'bouncy', 'pollicino-gangsterino': 'bouncy',
    'rhino-toasterino': 'bouncy', 'job-job-job-sahur': 'bouncy', 'boneca-ambalabu': 'bouncy',
    'bananita-dolfinita': 'nervous', 'cappuccino-assassino': 'nervous', 'ta-ta-ta-ta-sahur': 'nervous',
    'espressona-signora': 'nervous', 'piccione-macchina': 'nervous', 'matitino-piedino': 'nervous',
    'procionini-kiwini': 'nervous',
    'la-vaca-saturno-saturnita': 'lazy', 'frigo-camelo': 'lazy', 'bobrito-bandito': 'lazy',
    'strawberry-elephant': 'lazy', 'graipussi-medussi': 'lazy', 'lirili-larila': 'lazy',
    'glorbo-fruttodrillo': 'lazy', 'cocofanto-elefanto': 'lazy', 'capibarini-cocosini': 'lazy',
    'lobster-kitten': 'nervous', 'muscular-orca': 'bouncy', 'crocodile-airplane': 'bouncy',
  };
  const SIGNATURE = {
    'tralalero-tralala': 'pounce', 'chimpanzini-bananini': 'leap', 'bananita-dolfinita': 'ripple',
    'cappuccino-assassino': 'sway', 'la-vaca-saturno-saturnita': 'stomp', 'frigo-camelo': 'reach',
    'bobrito-bandito': 'puff', 'tung-tung-tung-sahur': 'stomp', 'strawberry-elephant': 'stomp',
    'ta-ta-ta-ta-sahur': 'puff', 'brr-brr-patapim': 'sway', 'graipussi-medussi': 'ripple',
    'espressona-signora': 'sway', 'lirili-larila': 'stomp', 'arancino-muscolino': 'puff',
    'pollicino-gangsterino': 'sway', 'piccione-macchina': 'leap', 'matitino-piedino': 'reach',
    'rhino-toasterino': 'leap', 'glorbo-fruttodrillo': 'roll', 'cocofanto-elefanto': 'stomp',
    'job-job-job-sahur': 'stomp', 'procionini-kiwini': 'pounce', 'boneca-ambalabu': 'leap',
    'capibarini-cocosini': 'roll', 'lobster-kitten': 'pounce', 'muscular-orca': 'puff', 'crocodile-airplane': 'leap',
  };
  const TEMPERAMENT = {
    bouncy: { habitEvery: [5, 9], lookEvery: [1.6, 3.4], jumpiness: 1,
      habits: [['bounce', 0.18], ['hop', 0.14], ['jiggle', 0.14], ['signature', 0.14], ['wiggle', 0.1], ['shuffle', 0.1], ['bump', 0.1], ['lookAround', 0.1]] },
    lazy: { habitEvery: [9, 16], lookEvery: [2.6, 5], jumpiness: 0.6,
      habits: [['melt', 0.2], ['stretch', 0.2], ['signature', 0.14], ['lookAround', 0.16], ['jiggle', 0.12], ['bump', 0.08], ['wiggle', 0.05], ['shuffle', 0.05]] },
    nervous: { habitEvery: [6, 10], lookEvery: [0.7, 1.8], jumpiness: 1.5,
      habits: [['lookAround', 0.26], ['shiver', 0.2], ['signature', 0.14], ['jiggle', 0.12], ['hop', 0.1], ['bump', 0.08], ['shuffle', 0.1]] },
  };
  const DURATION = { hop: 0.95, wiggle: 0.9, shiver: 0.65, stretch: 1.75, shuffle: 1.35, lookAround: 2, jiggle: 1.4, melt: 1.9, bounce: 1.2, bump: 1.5, signature: 1.6, bow: 1 };
  const movesBody = habit => habit !== 'lookAround';
  function temperamentOf(id) {
    if (TEMPER[id]) return TEMPER[id];
    let h = 2166136261;                               // the app's stable hash of the ID
    for (const c of new TextEncoder().encode(id)) h = Math.imul(h ^ c, 16777619) >>> 0;
    return ['bouncy', 'lazy', 'nervous'][h % 3];
  }
  const pickIn = ([lo, hi]) => lo + ((unit() + 1) / 2) * (hi - lo);

  class Mind {
    constructor(id) {
      this.temperament = temperamentOf(id);
      this.signature = SIGNATURE[id] || 'roll';
      this.habit = null; this.habitTime = 0; this.habitDirection = 1; this.hopsDone = 0;
      this.habitCountdown = 0; this.lookCountdown = 0; this.idleX = 0; this.idleY = 0;
      this.lookingAt = null; this.watching = null; this.watchPoint = null; this.watchRemaining = 0;
      this.flinchCooldown = 0; this.primed = false;
      this.landTime = null; this.hasLanded = false; this.landHopDone = false;
      this.shineTime = null; this.annoyedRemaining = 0; this.bumpTarget = null;
    }
    watch(toy, point, seconds) {
      this.watching = toy;
      this.watchPoint = toy ? null : point;
      this.watchRemaining = Math.max(this.watchRemaining, seconds);
    }
  }

  class Life {
    constructor() { this.habitGate = 0; this.bodyGate = 0; }
    reset() { this.habitGate = 0; this.bodyGate = 0; }
    // Everyone follows a jelly that was just thrown.
    noteThrow(thrown, toys) {
      const speed = Math.hypot(thrown.body.rvx, thrown.body.rvy) / Math.max(1, thrown.body.bodyH);
      if (speed <= 3.5) return;
      for (const toy of toys) if (toy !== thrown) toy.mind.watch(thrown, null, toy.mind.temperament === 'nervous' ? 2.2 : 1.8);
    }
    // Everyone glances at a point, such as where a finger tapped.
    lookAt(x, y, toys) { for (const toy of toys) toy.mind.watch(null, [x, y], 1.2); }
    shine(toy) { toy.mind.shineTime = 0; }

    update(frame, toys, ctx, world) {
      this.habitGate -= frame;
      this.bodyGate -= frame;
      const landed = this.react(toys, ctx);
      let running = 0;
      for (const toy of toys) if (toy.mind.habit && movesBody(toy.mind.habit)) running++;
      const counter = { running };
      for (const toy of toys) {
        this.live(toy, frame, toys, ctx, counter, world);
        const m = toy.body.mood;
        m.pull = 0;
        // Without a phone to tip, the sheen holds still in its corner (16%), and sweeps across
        // a jelly as it arrives.
        let sx = 0, sy = 0, sz = 0;
        if (toy.mind.shineTime !== null) {
          const t = toy.mind.shineTime, p = Math.min(1, t / 0.7);
          sx = -0.35 + 0.7 * p; sy = 0.08 * Math.sin(Math.PI * p); sz = 0.55 * Math.sin(Math.PI * p);
          toy.mind.shineTime = t + frame >= 0.7 ? null : t + frame;
        }
        m.glossX = sx; m.glossY = sy; m.glossZ = 0.16 + sz;
      }
      return landed;
    }

    // The jelly that was hit looks at whoever hit it; a hard crash makes the neighbours blink,
    // duck and lean away, then look at it.
    react(toys, ctx) {
      const landed = [];
      for (const toy of toys) {
        const impact = toy.body.takeImpact();
        if (!impact || impact.speed <= 2) continue;
        if (!toy.mind.hasLanded) {
          toy.mind.hasLanded = true; toy.mind.landTime = 0; toy.mind.landHopDone = false;
          landed.push(toy);
          continue;
        }
        let hitter = null;
        if (impact.from) {
          let best = Infinity;
          for (const o of toys) {
            if (o === toy) continue;
            const d = Math.hypot(o.body.cx - impact.from[0], o.body.cy - impact.from[1]);
            if (d < best) { best = d; hitter = o; }
          }
          toy.mind.watch(hitter, null, 1.2);
          // Hit hard by another jelly, it gives it a look.
          if (impact.speed > 3.5 && ctx.settled) toy.mind.annoyedRemaining = 1.2;
        }
        // Only a real crash, not a hop landing or a nudge from a neighbour.
        if (impact.speed <= 4.5 || !ctx.settled) continue;
        const reach = 2.6 * toy.body.bodyH;
        for (const other of toys) {
          if (other === toy || other === hitter || other === ctx.held) continue;
          const dx = other.body.cx - toy.body.cx, dy = other.body.cy - toy.body.cy, distance = Math.hypot(dx, dy);
          if (distance >= reach || other.mind.flinchCooldown > 0) continue;
          const strength = Math.min(1, 0.3 + (impact.speed - 4.5) / 7) * (1 - (0.6 * distance) / reach)
            * TEMPERAMENT[other.mind.temperament].jumpiness;
          other.body.flinch(dx, strength);
          other.mind.watch(toy, null, 1);
          other.mind.flinchCooldown = 0.9;
        }
      }
      return landed;
    }

    live(toy, frame, toys, ctx, counter, world) {
      const mind = toy.mind, body = toy.body, height = Math.max(1, body.bodyH);
      if (!mind.primed) {
        mind.primed = true;
        mind.habitCountdown = 2 + pickIn(TEMPERAMENT[mind.temperament].habitEvery);
        mind.lookCountdown = pickIn(TEMPERAMENT[mind.temperament].lookEvery);
      }
      const ex = body.cx, ey = body.cy + 0.15 * height;
      const toward = (x, y) => { const dx = x - ex, dy = y - ey, l = Math.max(Math.hypot(dx, dy), 0.9 * height); return [dx / l, dy / l]; };
      const m = body.mood;
      m.sx = m.sy = m.sz = 0;
      m.lids = 0;
      let habitGaze = null, habitLean = 0;
      mind.flinchCooldown = Math.max(0, mind.flinchCooldown - frame);
      mind.watchRemaining = Math.max(0, mind.watchRemaining - frame);
      mind.annoyedRemaining = Math.max(0, mind.annoyedRemaining - frame);

      // Its landing, in its own way.
      if (mind.landTime !== null) {
        const t = mind.landTime;
        if (mind.temperament === 'bouncy') {
          // A second, smaller bounce straight after touching down.
          if (!mind.landHopDone && t >= 0.1) { body.hop(0, 1.9, 0.6); mind.landHopDone = true; }
        } else if (mind.temperament === 'lazy') {
          // Plops and spreads out a little, eyes drooping, then firms up.
          const melt = smooth(t / 0.15) * (1 - smooth((t - 0.45) / 0.6));
          m.sx = 0.12 * melt; m.sy = -0.16 * melt;
          m.lids = 0.45 * melt;
        } else {
          // Ducks with its eyes squeezed shut, then peeks left and right.
          const duck = 1 - smooth((t - 0.3) / 0.25);
          m.sx = 0.05 * duck; m.sy = -0.12 * duck;
          m.lids = 0.85 * duck;
          if (t > 0.4) habitGaze = [Math.sin((t - 0.4) * 9) * 0.9, 0.05];
        }
        mind.landTime = t + frame >= 1.1 ? null : t + frame;
      }

      // Habits.
      if (mind.habit) {
        mind.habitTime += frame;
        const t = mind.habitTime, dir = mind.habitDirection, habit = mind.habit;
        switch (habit) {
          case 'hop': // crouch, spring up stretching, land
            if (mind.hopsDone === 0) {
              const crouch = smooth(t / 0.18);
              m.sx = 0.1 * crouch; m.sy = -0.15 * crouch;
              if (t >= 0.18) { body.hop(dir * 0.25, mind.temperament === 'bouncy' ? 3.1 : 2.6, 1.1); mind.hopsDone = 1; }
            }
            habitGaze = [dir * 0.2, 0.35];
            break;
          case 'wiggle': {
            const envelope = Math.sin(Math.PI * Math.min(1, t / DURATION.wiggle));
            m.sz = 0.12 * Math.sin(TAU * 4.5 * t) * envelope;
            break;
          }
          case 'shiver': {
            const envelope = Math.sin(Math.PI * Math.min(1, t / DURATION.shiver));
            m.sx = 0.035 * Math.sin(TAU * 11 * t) * envelope;
            m.sz = 0.05 * Math.sin(TAU * 13 * t) * envelope;
            habitGaze = [Math.sin(t * 9) * 0.8, 0.1];
            break;
          }
          case 'stretch': { // up on tiptoes with the eyes squeezed shut, hold, and back down
            const amount = smooth(t / 0.55) * (1 - smooth((t - 1.25) / 0.5));
            m.sx = -0.07 * amount; m.sy = 0.17 * amount;
            m.lids = 0.92 * amount;
            habitGaze = [0, 0.4];
            habitLean = Math.sin(t * 3.2) * 0.4 * amount;
            break;
          }
          case 'shuffle': { // a few little hops one way
            const hops = [0.15, 0.55, 0.95];
            if (mind.hopsDone < 3 && t >= hops[mind.hopsDone]) { body.hop(dir * 0.85, 1.7, 0.5); mind.hopsDone++; }
            const next = mind.hopsDone < 3 ? hops[mind.hopsDone] : 10, c = smooth(1 - (next - t) / 0.12);
            m.sx = 0.06 * c; m.sy = -0.08 * c;
            habitGaze = [dir * 0.9, -0.1];
            habitLean = dir * 0.6;
            break;
          }
          case 'lookAround':
            habitGaze = t < 0.7 ? [dir * 0.95, 0.05] : t < 1.5 ? [-dir * 0.95, 0.05] : [0, 0];
            habitLean = habitGaze[0] * 0.6;
            break;
          case 'jiggle': { // the feet stay put while the top sways, dying away
            const sway = Math.sin(TAU * 3.2 * t) * Math.exp(-2.2 * t) * smooth(t / 0.08);
            m.sz = 0.17 * sway;
            habitGaze = [sway * 0.3, 0.1];
            break;
          }
          case 'melt': { // a lazy sigh: eyes half shut, spreading lower, then back
            const amount = smooth(t / 0.6) * (1 - smooth((t - 1.3) / 0.6));
            m.sx = 0.11 * amount; m.sy = -0.15 * amount;
            m.lids = 0.55 * amount;
            habitGaze = [0, -0.35 * amount];
            break;
          }
          case 'bounce': { // a few quick little bounces on the spot
            const hops = [0.1, 0.45, 0.8];
            if (mind.hopsDone < 3 && t >= hops[mind.hopsDone]) { body.hop(0, 1.5, 0.45); mind.hopsDone++; }
            habitGaze = [0, 0.3];
            break;
          }
          case 'bump': { // a look, a crouch, then a hop over into the neighbour
            if (!mind.bumpTarget) {
              let best = Infinity;
              for (const o of toys) {
                if (o === toy || !o.spawned) continue;
                const d = Math.abs(o.body.cx - body.cx);
                if (d < best) { best = d; mind.bumpTarget = o; }
              }
            }
            const target = mind.bumpTarget, side = target ? (target.body.cx < body.cx ? -1 : 1) : dir;
            if (target) habitGaze = toward(target.body.cx, target.body.cy);
            if (t > 0.35 && t < 0.5) { const c = smooth((t - 0.35) / 0.15); m.sx = 0.08 * c; m.sy = -0.12 * c; }
            if (mind.hopsDone === 0 && t >= 0.5) { body.hop(side * 1.15, 1.5, 0.5); mind.hopsDone = 1; }
            habitLean = side * 0.7;
            break;
          }
          case 'signature': {
            const r = this.signature(mind, t, dir, body, m);
            if (r.gaze) habitGaze = r.gaze;
            if (r.lean !== undefined) habitLean = r.lean;
            break;
          }
        }
        if (t >= DURATION[habit]) {
          mind.habit = null;
          mind.bumpTarget = null;
          mind.habitCountdown = pickIn(TEMPERAMENT[mind.temperament].habitEvery);
        }
      } else if (ctx.settled && !ctx.finger && body.settled) {
        mind.habitCountdown -= frame;
        if (mind.habitCountdown <= 0 && this.habitGate <= 0) {
          const habit = pickHabit(mind.temperament, (unit() + 1) / 2);
          if (!movesBody(habit) || (counter.running === 0 && this.bodyGate <= 0)) {
            mind.habit = habit; mind.habitTime = 0; mind.hopsDone = 0;
            mind.habitDirection = world.directionFor(toy);
            this.habitGate = 0.8;
            if (movesBody(habit)) { counter.running++; this.bodyGate = DURATION[habit] + 3; }
          }
        }
      } else if (!ctx.settled || ctx.finger) {
        // Wait a moment after being played with before starting something.
        mind.habitCountdown = Math.max(mind.habitCountdown, 1.5);
      }

      // Where to look.
      let gaze;
      const watched = mind.watchRemaining > 0 ? (mind.watching ? [mind.watching.body.cx, mind.watching.body.cy] : mind.watchPoint) : null;
      if (toy === ctx.held) gaze = [body.rvx / (4 * height), body.rvy / (4 * height)];
      else if (ctx.finger) gaze = ctx.held ? toward(ctx.held.body.cx, ctx.held.body.cy) : toward(ctx.finger[0], ctx.finger[1]);
      else if (watched) gaze = toward(watched[0], watched[1]);
      else if (habitGaze) gaze = habitGaze;
      else {
        mind.lookCountdown -= frame;
        if (mind.lookCountdown <= 0) pickIdleLook(mind, toy, toys);
        const neighbour = mind.lookingAt;
        gaze = neighbour && neighbour.spawned ? toward(neighbour.body.cx, neighbour.body.cy) : [mind.idleX, mind.idleY];
      }
      // Squinting at whoever bumped into it.
      if (mind.annoyedRemaining > 0) {
        m.lids = Math.max(m.lids, 0.4 * Math.min(1, mind.annoyedRemaining / 0.3));
        habitLean -= gaze[0] * 0.4;
      }
      // Squeezed flat under a finger that holds still, eyes screwed shut.
      if (toy === ctx.held && ctx.squeeze > 0) {
        m.sx = 0.2 * ctx.squeeze; m.sy = -0.32 * ctx.squeeze; m.sz = 0;
        m.lids = Math.max(m.lids, 0.85 * ctx.squeeze);
      }
      let [gx, gy] = gaze;
      const length = Math.hypot(gx, gy);
      if (length > 1) { gx /= length; gy /= length; }
      m.gx = gx; m.gy = gy;
      m.lean = clamp(gx * 0.45 + habitLean, -1, 1);
    }

    // One character's own move, `t` seconds in.
    signature(mind, t, dir, body, m) {
      const envelope = Math.sin(Math.PI * Math.min(1, t / 1.6));
      switch (mind.signature) {
        case 'ripple': // squash and stretch passing through, quick and loose
          m.sx = 0.07 * Math.sin(TAU * 3.5 * t) * envelope;
          m.sy = -0.09 * Math.sin(TAU * 3.5 * t + 1.2) * envelope;
          m.sz = 0.05 * Math.sin(TAU * 2 * t) * envelope;
          return { gaze: [Math.sin(t * 5) * 0.4, 0.2] };
        case 'puff': { // swells up proud, holds, and lets it out in a shake
          const swell = smooth(t / 0.4) * (1 - smooth((t - 1) / 0.25));
          m.sx = 0.15 * swell; m.sy = 0.09 * swell;
          m.sz = t > 1 ? 0.06 * Math.sin(TAU * 9 * t) * Math.exp(-4 * (t - 1)) : 0;
          m.lids = 0.3 * swell;
          return { gaze: [0, 0.45 * swell] };
        }
        case 'sway': // side to side, like a penguin
          m.sz = 0.07 * Math.sin(TAU * 1.25 * t) * envelope;
          return { gaze: [Math.sin(TAU * 1.25 * t) * 0.6, 0.15], lean: Math.sin(TAU * 1.25 * t) * 0.9 * envelope };
        case 'leap': // a big crouch and a high, spinning jump
          if (mind.hopsDone === 0) {
            const c = smooth(t / 0.3);
            m.sx = 0.12 * c; m.sy = -0.2 * c;
            if (t >= 0.3) { body.hop(0, 3.6, 1.2); body.spin(dir * 4); mind.hopsDone = 1; }
          }
          return { gaze: [0, 0.6] };
        case 'reach': { // stretches up tall, like a giraffe
          const rise = smooth(t / 0.45) * (1 - smooth((t - 1.1) / 0.4));
          m.sx = -0.08 * rise; m.sy = 0.24 * rise;
          return { gaze: [dir * 0.3, 0.8 * rise], lean: dir * 0.3 * rise };
        }
        case 'stomp': // a heavy stomp, like an elephant
          if (mind.hopsDone === 0 && t >= 0.15) { body.hop(0, 1.6, 0.3); mind.hopsDone = 1; }
          if (t > 0.75) {
            const thud = smooth((t - 0.75) / 0.08) * (1 - smooth((t - 0.9) / 0.4));
            m.sx = 0.14 * thud; m.sy = -0.18 * thud;
          }
          return {};
        case 'pounce': // crouches low and pounces forward, like a tiger
          if (mind.hopsDone === 0) {
            const c = smooth(t / 0.45);
            m.sx = 0.14 * c; m.sy = -0.2 * c;
            if (t >= 0.45) { body.hop(dir * 1.4, 2.3, 0.9); mind.hopsDone = 1; }
            return { gaze: [dir * 0.9, -0.1], lean: dir * 0.8 };
          }
          return {};
        default: // a slow, rolling wobble
          m.sx = 0.05 * Math.sin(TAU * 1.4 * t) * envelope;
          m.sy = -0.05 * Math.sin(TAU * 1.4 * t) * envelope;
          m.sz = 0.1 * Math.sin(TAU * 0.7 * t) * envelope;
          return { lean: Math.sin(TAU * 0.7 * t) * 0.6 * envelope };
      }
    }
  }
  function pickHabit(temperament, roll) {
    const table = TEMPERAMENT[temperament].habits;
    for (const [habit, weight] of table) { if (roll < weight) return habit; roll -= weight; }
    return table[0][0];
  }
  // At you, at a neighbour, or off to one side.
  function pickIdleLook(mind, toy, toys) {
    mind.lookCountdown = pickIn(TEMPERAMENT[mind.temperament].lookEvery);
    const roll = (unit() + 1) / 2;
    mind.lookingAt = null;
    if (roll < 0.4) { mind.idleX = unit() * 0.12; mind.idleY = -0.08; }
    else if (roll < 0.8 && toys.length > 1) {
      const others = toys.filter(o => o !== toy && o.spawned);
      mind.lookingAt = others.length ? others[Math.max(0, Math.min(others.length - 1, Math.floor(((unit() + 1) / 2) * others.length)))] : null;
      mind.idleX = 0; mind.idleY = 0;
    } else {
      const side = unit() < 0 ? -1 : 1;
      mind.idleX = side * (0.5 + Math.abs(unit()) * 0.4);
      mind.idleY = unit() * 0.4;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Pictures: where each character is in its picture (JellySilhouette), cut out as the body's
  // texture, and the Diamond and holographic Shiny glows (JellyAura), baked once.
  function silhouette(img) {
    const side = 192, canvas = document.createElement('canvas');
    canvas.width = canvas.height = side;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, side, side);
    const px = ctx.getImageData(0, 0, side, side).data, columns = new Float64Array(side);
    let minX = side, maxX = -1, minRow = side, maxRow = -1;
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        if (px[(row * side + col) * 4 + 3] <= 16) continue;
        if (col < minX) minX = col; if (col > maxX) maxX = col;
        if (row < minRow) minRow = row; if (row > maxRow) maxRow = row;
        columns[col]++;
      }
    }
    if (maxX < minX) return { rect: [0, 0, 1, 1], aspect: img.naturalWidth / img.naturalHeight, solid: 1 };
    const s = 1 / side;
    const left = Math.max(0, minX * s - 0.005), right = Math.min(1, (maxX + 1) * s + 0.005);
    const top = Math.max(0, minRow * s - 0.005), bottom = Math.min(1, (maxRow + 1) * s + 0.005);
    const rect = [left, 1 - bottom, right - left, bottom - top];   // texture space, y up
    const aspect = (rect[2] * img.naturalWidth) / (rect[3] * img.naturalHeight);
    // The solid body: the thin outer columns holding 4% of the picture trimmed off.
    let total = 0;
    for (let i = 0; i < side; i++) total += columns[i];
    const trim = total * 0.04;
    let sl = minX, sr = maxX, mass = 0;
    while (sl < maxX && mass + columns[sl] <= trim) { mass += columns[sl]; sl++; }
    mass = 0;
    while (sr > sl && mass + columns[sr] <= trim) { mass += columns[sr]; sr--; }
    return { rect, aspect, solid: clamp((sr - sl + 1) / (maxX - minX + 1), 0.7, 1) };
  }
  const nextPow2 = v => 2 ** Math.ceil(Math.log2(Math.max(2, v)));
  // The character's part of its picture, on a square power-of-two canvas so it can be
  // mipmapped; `crop` is where that part is in the picture (texture space, y up).
  function cutOut(img, sil, side) {
    const w = img.naturalWidth, h = img.naturalHeight, [rx, ry, rw, rh] = sil.rect;
    const x0 = Math.floor(rx * w), x1 = Math.ceil((rx + rw) * w);
    const yTop = Math.floor((1 - ry - rh) * h), yBottom = Math.ceil((1 - ry) * h);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = side;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x0, yTop, x1 - x0, yBottom - yTop, 0, 0, side, side);
    return { canvas, crop: [x0 / w, 1 - yBottom / h, (x1 - x0) / w, (yBottom - yTop) / h], width: x1 - x0, height: yBottom - yTop };
  }
  const canvasBlur = (() => { try { return typeof document.createElement('canvas').getContext('2d').filter === 'string'; } catch (e) { return false; } })();
  function blurred(source, sigma, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (canvasBlur) {
      ctx.filter = `blur(${sigma.toFixed(1)}px)`;
      ctx.drawImage(source, 0, 0);
    } else {
      // No canvas filters (older Safari): shrink it and grow it back, much the same.
      const k = Math.max(1, sigma * 0.9), small = document.createElement('canvas');
      small.width = Math.max(2, Math.round(w / k)); small.height = Math.max(2, Math.round(h / k));
      small.getContext('2d').drawImage(source, 0, 0, small.width, small.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, w, h);
    }
    return canvas;
  }
  // Its silhouette blurred into a wide haze round a brighter halo: icy blue for a Diamond,
  // white for a Shiny (tinted through the rainbow as it's drawn).
  const AURA_PADDING = 0.18;
  function bakeAura(cut, ice) {
    const scale = 200 / Math.max(cut.width, cut.height);
    const aw = cut.width * scale, ah = cut.height * scale;
    const w = Math.round(aw * (1 + 2 * AURA_PADDING)), h = Math.round(ah * (1 + 2 * AURA_PADDING));
    const outline = document.createElement('canvas');
    outline.width = w; outline.height = h;
    const ox = outline.getContext('2d');
    ox.drawImage(cut.canvas, aw * AURA_PADDING, ah * AURA_PADDING, aw, ah);
    ox.globalCompositeOperation = 'source-in';
    ox.fillStyle = '#fff';
    ox.fillRect(0, 0, w, h);
    const reach = Math.min(aw, ah), side = nextPow2(Math.max(w, h)) / 2;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const cx = out.getContext('2d');
    const tints = ice ? ['rgba(77,173,255,1)', 'rgba(199,242,255,0.85)'] : ['rgba(255,255,255,0.95)', 'rgba(255,255,255,0.8)'];
    [[reach * 0.08, tints[0]], [reach * 0.03, tints[1]]].forEach(([sigma, tint]) => {
      const layer = blurred(outline, sigma, w, h), lx = layer.getContext('2d');
      lx.globalCompositeOperation = 'source-in';
      lx.fillStyle = tint;
      lx.fillRect(0, 0, w, h);
      cx.drawImage(layer, 0, 0);
    });
    const square = document.createElement('canvas');
    square.width = square.height = Math.max(64, side);
    square.getContext('2d').drawImage(out, 0, 0, square.width, square.height);
    return square;
  }
  // A four-pointed star with curved sides, for sparkles and glints (JellyEffects).
  function starCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d'), m = 32;
    x.beginPath();
    x.moveTo(m, 0);
    x.quadraticCurveTo(m, m, 64, m);
    x.quadraticCurveTo(m, m, m, 64);
    x.quadraticCurveTo(m, m, 0, m);
    x.quadraticCurveTo(m, m, m, 0);
    x.fillStyle = '#fff';
    x.fill();
    return c;
  }
  // A soft black ellipse for the shadow under each jelly.
  function shadowCanvas() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 32;
    const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.scale(1, 32 / 128);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return c;
  }
  // A Diamond's landing frost: an ellipse ring at `w` points wide, stroked as SpriteKit draws it.
  function ringCanvas(w, color, line, glow) {
    const pad = 12, c = document.createElement('canvas');
    c.width = Math.ceil(w + 2 * pad); c.height = Math.ceil(w * 0.28 + 2 * pad);
    const x = c.getContext('2d');
    x.strokeStyle = color;
    x.lineWidth = line;
    if (glow) { x.shadowColor = color; x.shadowBlur = glow * 2; }
    x.beginPath();
    x.ellipse(c.width / 2, c.height / 2, w / 2, (w * 0.28) / 2, 0, 0, TAU);
    x.stroke();
    return { canvas: c, w: c.width, h: c.height };
  }

  // ---------------------------------------------------------------------------------------
  // Drawing: WebGL, with the app's face shader.
  const FACE_SHADER = `
    precision highp float;
    varying vec2 v_tex_coord;
    uniform sampler2D u_texture;
    uniform vec4 u_leftEye, u_rightEye, u_skinSamples;
    uniform float u_blink, u_flow, u_time, u_alpha;
    uniform vec2 u_gaze;
    uniform vec3 u_gloss;
    float rarityHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec3 rarityHue(float h) { return clamp(abs(fract(vec3(h) + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
    void main() {
      vec2 uv = v_tex_coord;
      float originalAlpha = texture2D(u_texture, uv).a;
      vec2 look = uv;
      for (int eyeIndex = 0; eyeIndex < 2; eyeIndex++) {
        vec4 eye = eyeIndex == 0 ? u_leftEye : u_rightEye;
        vec2 q = (uv - eye.xy) / eye.zw;
        float pull = max(0.0, 1.0 - dot(q, q) * 0.444);
        look -= u_gaze * eye.zw * 0.38 * pull * pull;
      }
      vec4 color = texture2D(u_texture, look);
      float closure = u_blink;
      for (int eyeIndex = 0; eyeIndex < 2; eyeIndex++) {
        vec4 eye = eyeIndex == 0 ? u_leftEye : u_rightEye;
        vec2 q = (uv - eye.xy) / eye.zw;
        float region = 1.0 - smoothstep(1.05, 1.30, length(q));
        if (region > 0.001 && closure > 0.001) {
          vec2 skinUV = eyeIndex == 0 ? u_skinSamples.xy : u_skinSamples.zw;
          vec4 skin = texture2D(u_texture, skinUV);
          skin.rgb *= 1.0 + 0.035 * clamp(q.y, -1.0, 1.0);
          float opening = max(0.055, 1.0 - closure);
          float curve = closure * 0.12 * (q.x * q.x - 0.4);
          vec2 openQ = vec2(q.x, (q.y - curve) / opening);
          float pull = max(0.0, 1.0 - dot(openQ, openQ) * 0.444);
          vec2 sampleUV = eye.xy + openQ * eye.zw - u_gaze * eye.zw * 0.38 * pull * pull;
          float eyeMask = 1.0 - smoothstep(0.95, 1.07, length(openQ));
          vec4 lid = mix(skin, texture2D(u_texture, sampleUV), eyeMask);
          color = mix(color, lid, region * smoothstep(0.0, 0.15, closure));
        }
      }
      if (u_gloss.z > 0.001) {
        vec2 d = (uv - u_gloss.xy) / vec2(0.30, 0.17);
        float sheen = u_gloss.z * pow(max(0.0, 1.0 - dot(d, d)), 2.0);
        color.rgb += (color.a - color.rgb) * sheen * originalAlpha;
      }
      if (u_flow > 0.5) {
        vec3 rgb = color.rgb / max(color.a, 0.0001);
        float high = max(rgb.r, max(rgb.g, rgb.b));
        float low = min(rgb.r, min(rgb.g, rgb.b));
        float vivid = smoothstep(0.18, 0.5, (high - low) / max(high, 0.0001)) * smoothstep(0.1, 0.35, high);
        for (int eyeIndex = 0; eyeIndex < 2; eyeIndex++) {
          vec4 eye = eyeIndex == 0 ? u_leftEye : u_rightEye;
          vivid *= smoothstep(0.95, 1.2, length((uv - eye.xy) / eye.zw));
        }
        float across = uv.x * 0.7 + uv.y * 0.9;
        bool ice = u_flow > 1.5;
        float turn = (ice ? 0.22 : 0.7) * sin(across * 9.0 - u_time * 1.6 + u_gloss.x * 6.0) * vivid;
        mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
        mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
        vec3 yiq = toYIQ * rgb;
        float c = cos(turn);
        float s = sin(turn);
        yiq.yz = vec2(yiq.y * c - yiq.z * s, yiq.y * s + yiq.z * c);
        rgb = clamp(toRGB * yiq, 0.0, 1.0);
        float sweep = fract(across * 0.45 - u_time * 0.22) - 0.5;
        rgb += vec3((ice ? 0.34 : 0.22) * exp(-sweep * sweep * (ice ? 320.0 : 160.0)) * smoothstep(0.15, 0.45, high));
        if (ice) {
          vec2 grid = uv * 7.0;
          vec2 cell = floor(grid);
          float r3 = rarityHash(cell + 41.7);
          vec2 d = grid - cell - (0.25 + 0.5 * vec2(rarityHash(cell), rarityHash(cell + 17.3)));
          float twinkle = pow(max(0.0, sin(u_time * 2.0 + r3 * 6.2832)), 18.0);
          float rays = exp(-abs(d.y) * 110.0) * max(0.0, 1.0 - abs(d.x) * 4.0)
              + exp(-abs(d.x) * 110.0) * max(0.0, 1.0 - abs(d.y) * 4.0);
          rgb += vec3((exp(-dot(d, d) * 120.0) + rays * 0.7) * twinkle * step(0.45, r3)) * smoothstep(0.1, 0.4, high);
        }
        color.rgb = min(rgb, vec3(1.0)) * color.a;
      }
      if (u_flow > 0.5 && u_flow < 1.5) {
        float clear = 1.0;
        for (int eyeIndex = 0; eyeIndex < 2; eyeIndex++) {
          vec4 eye = eyeIndex == 0 ? u_leftEye : u_rightEye;
          clear *= smoothstep(0.95, 1.25, length((uv - eye.xy) / eye.zw));
        }
        vec3 rgb = color.rgb;
        float a = color.a;
        float outside = 0.0;
        vec2 away = vec2(0.0);
        for (int i = 0; i < 8; i++) {
          float angle = float(i) * 0.7854;
          vec2 dir = vec2(cos(angle), sin(angle));
          float gap = 1.0 - texture2D(u_texture, uv + dir * 0.018).a;
          outside += gap;
          away += dir * gap;
        }
        float rim = smoothstep(0.04, 0.45, outside / 8.0) * a;
        float rimHue = fract(atan(away.y, away.x + 0.0001) / 6.2832 - u_time * 0.12);
        rgb += mix(vec3(1.0), rarityHue(rimHue), 0.8) * rim * (0.8 + 0.3 * sin(u_time * 2.2 + rimHue * 6.2832));
        float ps = fract((uv.x * 0.75 + uv.y * 0.65) * 0.5 - u_time * 0.2) - 0.5;
        vec3 prism = vec3(exp(-(ps - 0.03) * (ps - 0.03) * 340.0), exp(-ps * ps * 340.0),
                          exp(-(ps + 0.03) * (ps + 0.03) * 340.0));
        rgb += prism * 0.4 * a * clear;
        vec2 glitterGrid = uv * 16.0;
        vec2 glitterCell = floor(glitterGrid);
        float gr = rarityHash(glitterCell + 5.3);
        vec2 gd = glitterGrid - glitterCell - (0.25 + 0.5 * vec2(rarityHash(glitterCell + 1.7), rarityHash(glitterCell + 9.1)));
        float glimmer = pow(max(0.0, sin(u_time * 2.6 + gr * 6.2832)), 20.0) * step(0.55, gr);
        float glitterRays = exp(-abs(gd.y) * 90.0) * max(0.0, 1.0 - abs(gd.x) * 3.5)
            + exp(-abs(gd.x) * 90.0) * max(0.0, 1.0 - abs(gd.y) * 3.5);
        vec3 glitterColor = mix(vec3(1.0), rarityHue(gr * 3.0 + u_time * 0.05), 0.55);
        rgb += glitterColor * (exp(-dot(gd, gd) * 90.0) + glitterRays * 0.8) * glimmer * a * clear * 1.3;
        color.rgb = min(rgb, vec3(a));
      }
      if (u_flow > 1.5) {
        float clear = 1.0;
        for (int eyeIndex = 0; eyeIndex < 2; eyeIndex++) {
          vec4 eye = eyeIndex == 0 ? u_leftEye : u_rightEye;
          clear *= smoothstep(0.95, 1.25, length((uv - eye.xy) / eye.zw));
        }
        vec3 rgb = color.rgb;
        float a = color.a;
        float outside = 0.0;
        vec2 away = vec2(0.0);
        for (int i = 0; i < 8; i++) {
          float angle = float(i) * 0.7854;
          vec2 dir = vec2(cos(angle), sin(angle));
          float gap = 1.0 - texture2D(u_texture, uv + dir * 0.02).a;
          outside += gap;
          away += dir * gap;
        }
        float rim = smoothstep(0.04, 0.4, outside / 8.0) * a;
        float rimHue = fract(atan(away.y, away.x + 0.0001) / 6.2832 + u_time * 0.07);
        vec3 edge = mix(vec3(0.85, 0.97, 1.0), rarityHue(rimHue), 0.6);
        rgb += edge * rim * (0.85 + 0.35 * sin(u_time * 1.8 + rimHue * 6.2832));
        vec2 cut = vec2(uv.x + uv.y, uv.x - uv.y) * 5.0;
        vec2 facet = floor(cut);
        float facetSeed = rarityHash(facet + 23.9);
        float catchLight = pow(max(0.0, sin(u_time * 1.4 + facetSeed * 6.2832)), 36.0);
        vec2 inFacet = fract(cut) - 0.5;
        float facetShape = 1.0 - smoothstep(0.3, 0.5, max(abs(inFacet.x), abs(inFacet.y)));
        rgb += mix(vec3(0.9, 0.98, 1.0), rarityHue(facetSeed), 0.25) * catchLight * facetShape * 0.45 * a * clear;
        float fs = fract((uv.x * 0.8 + uv.y * 0.6) * 0.5 - u_time * 0.16) - 0.5;
        vec3 fire = vec3(exp(-(fs - 0.02) * (fs - 0.02) * 700.0), exp(-fs * fs * 700.0),
                         exp(-(fs + 0.02) * (fs + 0.02) * 700.0));
        rgb += fire * 0.6 * a * clear;
        vec2 flareGrid = uv * 3.0;
        vec2 flareCell = floor(flareGrid);
        float fr = rarityHash(flareCell + 7.1);
        vec2 fd = flareGrid - flareCell - (0.3 + 0.4 * vec2(rarityHash(flareCell + 3.3), rarityHash(flareCell + 9.7)));
        float bloom = pow(max(0.0, sin(u_time * 0.9 + fr * 6.2832)), 28.0) * step(0.45, fr);
        float flareRays = exp(-abs(fd.y) * 70.0) * max(0.0, 1.0 - abs(fd.x) * 2.2)
            + exp(-abs(fd.x) * 70.0) * max(0.0, 1.0 - abs(fd.y) * 2.2);
        rgb += vec3(0.9, 0.97, 1.0) * (exp(-dot(fd, fd) * 60.0) + flareRays) * bloom * a * 1.4 * clear;
        color.rgb = min(rgb, vec3(a));
      }
      gl_FragColor = color * u_alpha;
    }`;
  const MESH_VERTEX = `
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    uniform vec2 u_view;
    varying vec2 v_tex_coord;
    void main() { v_tex_coord = a_uv; gl_Position = vec4(a_pos / u_view * 2.0 - 1.0, 0.0, 1.0); }`;
  const SPRITE_FRAGMENT = `
    precision mediump float;
    varying vec2 v_tex_coord;
    uniform sampler2D u_texture;
    uniform vec4 u_color;
    void main() { vec4 c = texture2D(u_texture, v_tex_coord); gl_FragColor = vec4(c.rgb * u_color.rgb, c.a) * u_color.a; }`;

  // The warp grid drawn finer than its 11 x 11 points, smoothed between them as SpriteKit's
  // subdivided warp is: Catmull-Rom across each cell, two pieces a side.
  const SUB = 2, FINE = N * SUB + 1;
  const FINE_INDEX = new Int32Array(FINE * 4), FINE_WEIGHT = new Float64Array(FINE * 4);
  for (let f = 0; f < FINE; f++) {
    const x = f / SUB, i = Math.min(N - 1, Math.floor(x)), t = x - i;
    const w = [((-t + 2) * t - 1) * t / 2, ((3 * t - 5) * t * t + 2) / 2, ((-3 * t + 4) * t + 1) * t / 2, (t - 1) * t * t / 2];
    for (let k = 0; k < 4; k++) {
      FINE_INDEX[f * 4 + k] = clamp(i - 1 + k, 0, N);
      FINE_WEIGHT[f * 4 + k] = w[k];
    }
  }

  class Renderer {
    constructor(canvas, antialias = true) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias, depth: false, stencil: false });
      if (!gl) throw new Error('no webgl');
      this.gl = gl;
      this.textures = new Map();
      this.positions = new Float32Array(FINE * FINE * 2);
      this.quad = new Float32Array(8);
      this.init();
    }
    init() {
      const gl = this.gl;
      const compile = (type, source) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const program = (vertex, fragment) => {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        const u = {}, count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < count; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
        return { p, u, pos: gl.getAttribLocation(p, 'a_pos'), uv: gl.getAttribLocation(p, 'a_uv') };
      };
      this.faceProgram = program(MESH_VERTEX, FACE_SHADER);
      this.spriteProgram = program(MESH_VERTEX, SPRITE_FRAGMENT);
      // The fine warp grid: its picture coordinates never change, only where its points go.
      const uvs = new Float32Array(FINE * FINE * 2);
      for (let r = 0; r < FINE; r++) for (let c = 0; c < FINE; c++) { uvs[(r * FINE + c) * 2] = c / (FINE - 1); uvs[(r * FINE + c) * 2 + 1] = r / (FINE - 1); }
      const indices = new Uint16Array((FINE - 1) * (FINE - 1) * 6);
      let k = 0;
      for (let r = 0; r < FINE - 1; r++) {
        for (let c = 0; c < FINE - 1; c++) {
          const a = r * FINE + c, b = a + 1, d = a + FINE, e = d + 1;
          indices.set([a, b, d, b, e, d], k);
          k += 6;
        }
      }
      this.meshCount = indices.length;
      this.meshUV = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshUV);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
      this.meshPos = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshPos);
      gl.bufferData(gl.ARRAY_BUFFER, this.positions.byteLength, gl.DYNAMIC_DRAW);
      this.meshIndex = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshIndex);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      this.quadUV = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUV);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      this.quadPos = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadPos);
      gl.bufferData(gl.ARRAY_BUFFER, 32, gl.DYNAMIC_DRAW);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      for (const entry of this.textures.values()) entry.texture = this.upload(entry.canvas);
    }
    upload(canvas) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);              // texture space has y up, as SpriteKit's
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      const pot = (canvas.width & (canvas.width - 1)) === 0 && (canvas.height & (canvas.height - 1)) === 0;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (pot) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      return t;
    }
    texture(key, make) {
      let entry = this.textures.get(key);
      if (!entry) {
        const canvas = make();
        entry = { canvas, texture: this.gl.isContextLost() ? null : this.upload(canvas) };
        this.textures.set(key, entry);
      }
      return entry;
    }
    resize(width, height, ratio) {
      const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.width = width; this.height = height;
    }
    begin() {
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // A new frame: every warp grid refined anew, and the GL state set again on first use.
      this.frame = (this.frame || 0) + 1;
      this.mode = null; this.additive = null; this.meshTime = null;
    }
    // The GL state shared by draws of one kind, sent only when the kind changes; each draw then
    // sends just what's its own (a pile of a hundred makes hundreds of draws a frame).
    useMeshes(time) {
      const gl = this.gl, f = this.faceProgram;
      if (this.mode !== 'mesh') {
        gl.useProgram(f.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshUV);
        gl.enableVertexAttribArray(f.uv);
        gl.vertexAttribPointer(f.uv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshPos);
        gl.enableVertexAttribArray(f.pos);
        gl.vertexAttribPointer(f.pos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshIndex);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(f.u.u_texture, 0);
        gl.uniform2f(f.u.u_view, this.width, this.height);
        this.mode = 'mesh';
        this.meshTime = null;
      }
      if (this.meshTime !== time) { gl.uniform1f(f.u.u_time, time); this.meshTime = time; }
      this.blend(false);
    }
    useSprites() {
      if (this.mode === 'sprite') return;
      const gl = this.gl, s = this.spriteProgram;
      gl.useProgram(s.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUV);
      gl.enableVertexAttribArray(s.uv);
      gl.vertexAttribPointer(s.uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadPos);
      gl.enableVertexAttribArray(s.pos);
      gl.vertexAttribPointer(s.pos, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(s.u.u_texture, 0);
      gl.uniform2f(s.u.u_view, this.width, this.height);
      this.mode = 'sprite';
    }
    blend(additive) {
      if (this.additive === additive) return;
      const gl = this.gl;
      if (additive) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.additive = additive;
    }
    // A body, its warp grid at `dest` (0...1 over its body, y up), drawn `sw` x `sh` about its middle;
    // `plain` draws just its picture, as the app's smear behind it is.
    mesh(toy, dest, cx, cy, alpha, time, plain = false) {
      const gl = this.gl, f = this.faceProgram, out = this.positions, sw = toy.body.bodyW * toy.body.overhang, sh = toy.body.bodyH;
      // Its warp grid, refined once a frame (its smear's ghosts are the same shape, drawn behind).
      const fine = toy.fineGrid || (toy.fineGrid = new Float32Array(FINE * FINE * 2));
      if (toy.fineFrame !== this.frame || toy.fineDest !== dest) {
        for (let r = 0; r < FINE; r++) {
          for (let c = 0; c < FINE; c++) {
            let x = 0, y = 0;
            for (let a = 0; a < 4; a++) {
              const wr = FINE_WEIGHT[r * 4 + a], row = FINE_INDEX[r * 4 + a] * COLS;
              for (let b = 0; b < 4; b++) {
                const w = wr * FINE_WEIGHT[c * 4 + b], i = (row + FINE_INDEX[c * 4 + b]) * 2;
                x += w * dest[i]; y += w * dest[i + 1];
              }
            }
            const j = (r * FINE + c) * 2;
            fine[j] = x; fine[j + 1] = y;
          }
        }
        toy.fineFrame = this.frame; toy.fineDest = dest;
      }
      for (let j = 0; j < fine.length; j += 2) {
        out[j] = cx + (fine[j] - 0.5) * sw;
        out[j + 1] = cy + (fine[j + 1] - 0.5) * sh;
      }
      this.useMeshes(time);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, out);
      gl.bindTexture(gl.TEXTURE_2D, toy.art.texture);
      const e = toy.eyes, b = toy.body;
      gl.uniform4fv(f.u.u_leftEye, e.left);
      gl.uniform4fv(f.u.u_rightEye, e.right);
      gl.uniform4fv(f.u.u_skinSamples, e.skin);
      const face = b.face && !plain;
      gl.uniform1f(f.u.u_blink, face ? b.blink : 0);
      gl.uniform2f(f.u.u_gaze, face ? b.lookX : 0, face ? b.lookY : 0);
      gl.uniform3f(f.u.u_gloss, b.glossU, b.glossV, face ? b.glossK : 0);
      gl.uniform1f(f.u.u_flow, plain ? 0 : toy.flow);
      gl.uniform1f(f.u.u_alpha, alpha);
      gl.drawElements(gl.TRIANGLES, this.meshCount, gl.UNSIGNED_SHORT, 0);
    }
    // A picture `w` x `h` about `x, y`, turned by `angle`, tinted, faded, maybe additive.
    sprite(texture, x, y, w, h, angle, r, g, b, alpha, additive) {
      if (alpha <= 0.002 || !texture) return;
      const gl = this.gl, s = this.spriteProgram, q = this.quad, c = Math.cos(angle), sn = Math.sin(angle);
      const hx = w / 2, hy = h / 2;
      const corner = (k, px, py) => { q[k] = x + c * px - sn * py; q[k + 1] = y + sn * px + c * py; };
      corner(0, -hx, -hy); corner(2, hx, -hy); corner(4, -hx, hy); corner(6, hx, hy);
      this.useSprites();
      this.blend(additive);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, q);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform4f(s.u.u_color, r, g, b, alpha);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  // ---------------------------------------------------------------------------------------
  // One size for every jelly on the page, the opening's and the hero's alike (the visual size
  // each gets, `commonSize`): about an eighth of the screen across, a fifth of a phone's width.
  // The opening's flood needs them this big to bury a screen with no more than JavaScript can run.
  function jellySize(width, height) { return clamp(0.13 * Math.sqrt(width * height), 56, 170); }

  // ---------------------------------------------------------------------------------------
  // The pile: JellyPileScene, its inventory.
  const RANK = { common: 0, rare: 1, epic: 2, sketch: 3, shiny: 4, diamond: 5 };
  const COLOR = { common: [0.6, 0.8, 1], rare: [1, 0.55, 0.1], epic: [0.72, 0.28, 1], sketch: [0.96, 0.96, 0.96], shiny: [1, 0.36, 0.72], diamond: [0.68, 0.93, 1] };
  const HUES = [0.92, 0.12, 0.3, 0.52, 0.74].map(h => hsv(h, 0.75, 1));
  const ICE = [0.82, 0.96, 1];
  const HIDDEN_EYE = [-4000, -4000, 1, 1];
  function hsv(h, s, v) {
    const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)];
  }
  const mixColor = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // The holographic glow turning through the rainbow, 1.4 s a hue, eased (JellyAura.rainbow).
  function rainbowAt(time) {
    const step = time / 1.4, i = Math.floor(step) % HUES.length, t = step - Math.floor(step);
    return mixColor(HUES[i], HUES[(i + 1) % HUES.length], t * t * (3 - 2 * t));
  }
  // A holographic glint's colour `p` of the way through its life, through the same hues.
  function hueSequence(p) {
    const k = Math.min(3, Math.floor(p * 4));
    return mixColor(HUES[k], HUES[k + 1], clamp(p * 4 - k, 0, 1));
  }

  class Pile {
    // `options`: hero, canvas, hint, jellies (S.jellies), faces, srcFor(id, finish, big), reduceMotion
    constructor(options) {
      Object.assign(this, options);
      this.toys = []; this.life = new Life();
      // `simTime` is the time the physics has actually covered, which falls behind `elapsed`
      // whenever a frame runs out of budget.
      this.elapsed = 0; this.simTime = 0; this.accumulator = 0; this.held = null; this.dragged = false; this.heldTime = 0;
      this.squeezeAmount = 0; this.finger = null; this.touchStart = null; this.fx = [];
      this.lastTap = null; this.W = 0; this.H = 0; this.floor = 60; this.zoneL = 0; this.zoneW = 0; this.size = 60;
      this.stats = { physicsMs: 0, awake: 0, frames: 0 };
      try { this.gl = new Renderer(this.canvas, this.antialias !== false); } catch (e) { this.gl = null; }
      if (this.gl) {
        this.canvas.addEventListener('webglcontextlost', ev => { ev.preventDefault(); this.lost = true; });
        this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.gl.init(); });
      } else {
        // A canvas that has tried WebGL can't draw in 2D, so the plain drawing gets a new one.
        const plain = document.createElement('canvas');
        plain.className = this.canvas.className;
        plain.setAttribute('aria-hidden', 'true');
        this.canvas.replaceWith(plain);
        this.canvas = plain;
        this.ctx2d = plain.getContext('2d');
      }
      this.star = starCanvas();
      this.shadow = shadowCanvas();
    }

    // The hero's room: wide, they pour in to the right of the headline; narrower, across the middle.
    measure() {
      const hero = this.hero;
      this.W = hero.clientWidth;
      this.H = hero.clientHeight;
      this.floor = parseFloat(getComputedStyle(hero).getPropertyValue('--hero-floor')) || 60;
      if (this.wide.matches) { this.zoneL = this.W * 0.44; this.zoneW = this.W - this.zoneL; }
      else { this.zoneL = 0; this.zoneW = this.W; }
      // The same size as the opening's (each jelly is 0.81 of its slot), so the jellies that pour
      // in after it are the ones that buried the screen.
      this.size = jellySize(innerWidth, innerHeight) / 0.81;
      this.ratio = Math.min(2, window.devicePixelRatio || 1);
      if (this.gl) this.gl.resize(this.W, this.H, this.ratio);
      else { this.canvas.width = Math.round(this.W * this.ratio); this.canvas.height = Math.round(this.H * this.ratio); }
    }

    // A mix of jellies and finishes, as a collection has, with a few the same.
    pick(n) {
      const WEIGHTS = [['common', 34], ['rare', 14], ['sketch', 14], ['shiny', 20], ['diamond', 18]];
      const ids = this.jellies.map(j => j.id).sort(() => Math.random() - 0.5), byId = Object.fromEntries(this.jellies.map(j => [j.id, j]));
      const kinds = [], seen = new Set();
      for (let i = 0; kinds.length < Math.min(n, 32) && i < 400; i++) {
        const id = ids[i % ids.length];
        let r = Math.random() * 100, finish = 'common';
        for (const [f, w] of WEIGHTS) { if ((r -= w) <= 0) { finish = f; break; } }
        if (!byId[id].finishes.includes(finish)) finish = byId[id].finishes[0];
        if (seen.has(id + finish)) continue;
        seen.add(id + finish);
        kinds.push([id, finish]);
      }
      const all = Array.from({ length: n }, (_, i) => kinds[i % kinds.length]);
      for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
      return all;
    }

    async build() {
      this.measure();
      // About two rows' worth beside the headline; a little fewer across a narrower screen (a
      // tablet's, upright, has room for two rows under its copy).
      const count = Math.round((this.zoneW / this.size) * (this.wide.matches ? 2.4 : this.W >= 700 ? 2.2 : 1.8));
      const commonSize = this.size * 0.81;
      await this.makeToys(this.pick(count), commonSize, commonSize * this.ratio * 1.35 > 220);
      const gap = Math.min(0.24, 2.5 / Math.max(1, this.toys.length));
      this.toys.forEach((toy, i) => { toy.spawnTime = 0.16 + i * gap; });
      this.lastSpawn = this.toys.length ? this.toys[this.toys.length - 1].spawnTime : 0;
      this.built = true;
    }
    // Each pick's picture loaded and cut out, made a toy with its body and mind. As in the app,
    // every jelly gets the same visual area (`commonSize` squared).
    async makeToys(picks, commonSize, big) {
      const loads = new Map();
      for (const [id, finish] of picks) {
        const key = `${id}/${finish}`;
        if (!loads.has(key)) loads.set(key, loadImage(this.srcFor(id, finish, big)).then(img => this.prepareArt(id, finish, img, commonSize)).catch(() => null));
      }
      const arts = new Map();
      for (const [key, promise] of loads) arts.set(key, await promise);
      const toys = [];
      picks.forEach(([id, finish], index) => {
        const art = arts.get(`${id}/${finish}`);
        if (!art) return;
        const face = this.faceFor(id, finish);
        const body = new Body(face ? { personality: face[12] ?? 0.5 } : null);
        const toy = {
          id, finish, rank: RANK[finish], index, z: index, body, mind: new Mind(id), art: art.texture, aura: art.aura,
          // A Shiny's picture flows like foil and a Diamond's like ice, held still for reduced motion.
          flow: this.reduceMotion ? 0 : finish === 'shiny' ? 1 : finish === 'diamond' ? 2 : 0,
          eyes: art.eyes, aspect: art.aspect, solid: art.solid,
          spawned: false, resting: false, calmTime: 0, quietTime: 0, slowTime: 0, huddleLeft: HUDDLE_TIME, glints: [], glintClock: Math.random(),
        };
        const height = commonSize / Math.sqrt(Math.max(toy.aspect, 0.1));
        toy.height = height;
        toy.width = height * toy.aspect;
        toys.push(toy);
      });
      this.toys = toys;
      this.configureAll();
    }
    // Jellies bump on their solid middles, so they snuggle up with arms and tails overlapping;
    // the walls keep those thin bits in view.
    configureAll() {
      for (const toy of this.toys) {
        const overhang = toy.width * (1 - toy.solid) / 2;
        toy.body.configure(this.W, this.H, toy.width * toy.solid, toy.height, this.floor, 2 + overhang, 1 / toy.solid);
      }
    }
    relayout() {
      this.measure();
      for (const toy of this.toys) {
        toy.body.setWalls(this.W, this.H, this.floor, 2 + toy.width * (1 - toy.solid) / 2);
        this.wake(toy);
      }
    }
    faceFor(id, finish) { return this.faces[`${id}/${finish}`] || this.faces[id] || null; }
    prepareArt(id, finish, img, commonSize) {
      const sil = silhouette(img);
      const height = commonSize / Math.sqrt(Math.max(sil.aspect, 0.1));
      const side = clamp(nextPow2(height * this.ratio * 1.3), 128, 512);
      const cut = cutOut(img, sil, side);
      const entry = this.gl ? this.gl.texture(`${id}/${finish}/${side}`, () => cut.canvas) : { canvas: cut.canvas };
      let aura = null;
      if (finish === 'diamond' || finish === 'shiny') {
        const canvas = bakeAura(cut, finish === 'diamond');
        aura = this.gl ? this.gl.texture(`${id}/${finish}/aura`, () => canvas) : null;
      }
      // Its eyes and skin, in its texture (JellyFace.textureEye).
      const f = this.faceFor(id, finish), [cx, cy, cw, ch] = cut.crop;
      const eye = (x, y, rx, ry) => [(x / 768 - cx) / cw, (1 - y / 768 - cy) / ch, rx / 768 / cw, ry / 768 / ch];
      const eyes = f
        ? { left: new Float32Array(eye(f[0], f[1], f[2], f[3])), right: new Float32Array(eye(f[4], f[5], f[6], f[7])),
            skin: new Float32Array([...eye(f[8], f[9], 0, 0).slice(0, 2), ...eye(f[10], f[11], 0, 0).slice(0, 2)]) }
        : { left: new Float32Array(HIDDEN_EYE), right: new Float32Array(HIDDEN_EYE), skin: new Float32Array(4) };
      return { texture: entry, aura, eyes, aspect: sil.aspect, solid: sil.solid };
    }

    // Each toy's place in the room once it drops in: from a few lanes across the middle,
    // already falling fast, a little tilted and turning.
    spawn(toy, index) {
      const LANES = [0.40, 0.62, 0.49, 0.33, 0.68, 0.53];
      const margin = (toy.height * toy.aspect) / 2 + 8;
      const lane = LANES[index % LANES.length] + unit() * 0.035;
      const x = clamp(this.zoneL + this.zoneW * lane, margin, this.W - margin);
      toy.body.place(x, this.H + toy.height * 0.62, unit() * 30, -toy.height * 7, unit() * 0.18, unit() * 2);
      toy.spawned = true;
      toy.huddleLeft = HUDDLE_TIME;
    }
    wake(toy) { this.stir(toy); toy.huddleLeft = HUDDLE_TIME; }
    stir(toy) { toy.resting = false; toy.calmTime = toy.quietTime = toy.slowTime = 0; }
    rest(toy) {
      // Coming to rest while sliding over means something blocks the way.
      if (toy.body.huddle !== null) toy.huddleLeft = 0;
      toy.resting = true;
      toy.calmTime = toy.quietTime = toy.slowTime = 0;
      toy.body.freeze();
    }
    // Toward the middle when close to an edge; otherwise toward company.
    directionFor(toy) {
      const x = toy.body.cx, margin = toy.width * toy.solid * 1.2;
      if (x < margin) return 1;
      if (x > this.W - margin) return -1;
      let nearest = null;
      for (const o of this.toys) if (o !== toy && o.spawned && (!nearest || Math.abs(o.body.cx - x) < Math.abs(nearest.body.cx - x))) nearest = o;
      if (nearest && Math.abs(nearest.body.cx - x) > toy.width * toy.solid * 1.3 && unit() < 0.4) return nearest.body.cx < x ? -1 : 1;
      return unit() < 0 ? -1 : 1;
    }

    // ---- one frame (JellyPileScene.update, the inventory's) ----
    update(dt) {
      const frame = Math.min(0.1, Math.max(0, dt));
      this.elapsed += frame;
      // A pour drops each in on the physics' own clock, so a slow frame can't stack them up.
      const clock = this.spawnsOnSim ? this.simTime : this.elapsed;
      this.toys.forEach((toy, i) => { if (!toy.spawned && clock >= toy.spawnTime) this.spawn(toy, i); });
      const live = this.toys.filter(t => t.spawned);
      // Holding a jelly without moving squeezes it flat.
      this.heldTime = this.held && !this.dragged ? this.heldTime + frame : 0;
      this.squeezeAmount = smooth((this.heldTime - 0.35) / 0.6);
      const settled = live.length === this.toys.length && this.elapsed > this.lastSpawn + 2.5;
      const landed = this.life.update(frame, live, { finger: this.finger, held: this.held, settled, squeeze: this.squeezeAmount }, this);
      this.celebrate(landed);
      for (const toy of live) toy.body.beginFrame(frame);
      // Toys rest one by one; whatever moves a resting one wakes just that one.
      for (const toy of live) {
        if (!toy.resting) continue;
        const acting = toy.mind.habit && movesBody(toy.mind.habit);
        if (acting || toy === this.held || !toy.body.canSleep) this.wake(toy);
      }
      this.huddle(live, frame);
      const awake = live.filter(t => !t.resting);
      this.stats.awake = awake.length;
      if (!awake.length) {
        for (const toy of live) toy.body.renderFrame(frame);
        this.accumulator = 0;
        this.stats.physicsMs = 0;
        this.simTime += frame;
        return;
      }
      const step = this.substep || T.substep, passes = this.contactPasses || 2, shoved = new Set(), start = performance.now();
      this.accumulator = Math.min(this.accumulator + frame, 0.1);
      // Catch up on missed time only while this frame's physics stays in budget; past that the
      // pile slows a moment rather than fall further behind.
      while (this.accumulator >= step) {
        for (const toy of awake) toy.body.prepareStep(step);
        // Both skins and the floor together; a resting toy holds still against a moving one
        // unless it's shoved.
        for (let pass = 0; pass < passes; pass++) {
          for (let i = 0; i < live.length; i++) {
            const a = live[i];
            for (let j = i + 1; j < live.length; j++) {
              const b = live[j];
              if (!a.resting && !b.resting) collidePair(a.body, b.body);
              else if (!a.resting || !b.resting) {
                const [moving, still] = a.resting ? [b, a] : [a, b];
                if (collideResting(moving.body, still.body) === 2) shoved.add(still);
              }
            }
          }
          for (const toy of awake) toy.body.collideWalls(step);
        }
        for (const toy of awake) toy.body.finishStep(step);
        this.accumulator -= step;
        this.simTime += step;
        if (performance.now() - start > PHYSICS_BUDGET) { this.accumulator = 0; break; }
      }
      this.stats.physicsMs = performance.now() - start;
      for (const toy of shoved) this.wake(toy);
      for (const toy of live) toy.body.renderFrame(frame);
      for (const toy of awake) {
        if (toy.resting) continue;
        const m = toy.body.mood, acting = toy.mind.habit && movesBody(toy.mind.habit);
        const free = toy !== this.held && !acting && m.sx === 0 && m.sy === 0 && m.sz === 0;
        toy.calmTime = free && toy.body.canSleep ? toy.calmTime + frame : 0;
        // A crowded pile never quite stops jittering, and one balanced on a round neighbour can
        // rock for good: after a while of only that, they rest too.
        toy.quietTime = free && toy.body.quiet ? toy.quietTime + frame : 0;
        toy.slowTime = free && toy.body.slow ? toy.slowTime + frame : 0;
        if (toy.calmTime >= 0.6 || toy.quietTime >= 1.5 || toy.slowTime >= 2.5) this.rest(toy);
      }
    }

    // They huddle round the one standing nearest the middle: one on the floor with a gap on
    // that side glides over until it bumps its neighbour, and the two squish together.
    huddle(live, frame) {
      const boxes = live.map(t => t.body.bounds), middle = this.zoneL + this.zoneW / 2;
      let heart = -1;
      live.forEach((t, i) => {
        if (!t.body.onFloor) return;
        if (heart < 0 || Math.abs((boxes[i][0] + boxes[i][2]) / 2 - middle) < Math.abs((boxes[heart][0] + boxes[heart][2]) / 2 - middle)) heart = i;
      });
      live.forEach((toy, index) => {
        const sliding = toy.body.huddle !== null, box = boxes[index], height = box[3] - box[1];
        let pull = null, bumped = null;
        if (heart >= 0 && index !== heart && toy.huddleLeft > 0 && toy !== this.held
            && !(toy.mind.habit && movesBody(toy.mind.habit)) && toy.body.onFloor) {
          const side = (boxes[heart][0] + boxes[heart][2]) / 2 < (box[0] + box[2]) / 2 ? -1 : 1;
          let gap = Infinity, nearest = -1;
          boxes.forEach((o, k) => {
            if (k === index || !(o[1] < box[3] - height * 0.15 && o[3] > box[1] + height * 0.15)
                || ((o[0] + o[2]) / 2 - (box[0] + box[2]) / 2) * side <= 0) return;
            const between = side > 0 ? o[0] - box[2] : box[0] - o[2];
            if (between < gap) { gap = between; nearest = k; }
          });
          // One lying across the gap, propped on both, already fills it.
          const bridged = nearest >= 0 && boxes.some((o, k) => k !== index && k !== nearest && o[1] > box[1] + height * 0.3
            && o[0] < (side > 0 ? box[2] : boxes[nearest][2]) && o[2] > (side > 0 ? boxes[nearest][0] : box[0]));
          const bodyHeight = Math.max(1, toy.body.bodyH);
          if (nearest >= 0 && !bridged && gap > (sliding ? HUDDLE_TOUCH : HUDDLE_GAP)) {
            const speed = (toy.body.rvx * side) / bodyHeight, target = Math.min(HUDDLE_SPEED, 0.35 + (3 * gap) / bodyHeight);
            pull = side * HUDDLE_PULL * (speed < target ? 1 : -1);
          } else if (sliding && nearest >= 0) bumped = live[nearest];
        }
        toy.body.huddle = pull;
        if (pull !== null) {
          if (toy.resting) this.stir(toy);
          toy.huddleLeft -= frame;
          // Whatever rides on it comes along, or drops into the gap.
          live.forEach((other, k) => {
            const o = boxes[k];
            if (other.resting && o[1] > (box[1] + box[3]) / 2 && Math.min(o[2], box[2]) > Math.max(o[0], box[0])) this.stir(other);
          });
        } else if (bumped) {
          const speed = Math.abs(toy.body.rvx) / Math.max(1, toy.body.bodyH);
          const squish = HUDDLE_SQUISH * clamp((speed - 0.45) / 0.6, 0, 1);
          if (squish > 0) {
            toy.body.squishSideways(squish);
            if (bumped.resting) this.stir(bumped);
            bumped.body.squishSideways(squish * 0.7);
          }
        }
      });
    }

    // Rarer jellies land with sparkles and a sheen, a Diamond with frost.
    celebrate(landed) {
      for (const toy of landed) {
        if (toy.rank < RANK.epic) continue;
        const color = COLOR[toy.finish];
        this.sparkles(toy.body.cx, toy.body.cy, color, toy.finish === 'diamond' ? 16 : 11, toy.height * 0.9);
        if (toy.finish === 'diamond') this.frost(toy.body.cx, toy.body.floorY, toy.height * 1.4);
        this.life.shine(toy);
      }
    }
    // A burst of four-pointed sparkles flying out (JellyEffects.sparkles); every third one white.
    sparkles(x, y, color, count, reach) {
      if (this.reduceMotion) return;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * TAU + (Math.random() - 0.5) * 0.5, distance = reach * (0.55 + Math.random() * 0.45);
        this.fx.push({ kind: 'spark', x, y, dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance, size: 9 + Math.random() * 8,
          color: i % 3 === 0 ? [1, 1, 1] : color, age: 0 });
      }
    }
    // A Diamond landing: a ring of frost spreading over the floor at its feet.
    frost(x, y, width) {
      if (this.reduceMotion || !this.gl) return;
      const w = Math.round(width);
      const ice = this.gl.texture(`frost/ice/${w}`, () => ringCanvas(w, 'rgba(140,224,255,1)', 3, 3).canvas);
      const white = this.gl.texture(`frost/white/${w}`, () => ringCanvas(w, 'rgba(255,255,255,1)', 1.5, 0).canvas);
      const tw = ice.canvas.width, th = ice.canvas.height;
      this.fx.push({ kind: 'frost', x, y, tex: ice, w: tw, h: th, to: 2, delay: 0, age: 0 });
      this.fx.push({ kind: 'frost', x, y, tex: white, w: white.canvas.width, h: white.canvas.height, to: 1.6, delay: 0.06, age: 0 });
    }
    // A big jump with a spin, for a double tap.
    bigJump(toy) {
      if (this.reduceMotion) return;
      this.wake(toy);
      toy.body.hop(0, 4.4, 1.3);
      toy.body.spin((unit() < 0 ? -1 : 1) * 7);
      this.sparkles(toy.body.cx, toy.body.cy, COLOR[toy.finish], 8, 44);
    }

    // ---- touch (scene points, y up) ----
    toyAt(x, y) {
      const sorted = this.toys.filter(t => t.spawned).sort((a, b) => b.z - a.z);
      return sorted.find(t => t.body.contains(x, y)) || null;
    }
    pressStart(x, y, toy) {
      this.touchStart = [x, y];
      this.held = toy;
      this.dragged = false;
      this.heldTime = 0;
      this.finger = [x, y];                             // looking at the finger needs no physics
      if (!toy) return;
      toy.body.beginTouch(x, y);
      toy.z = 1000;
      this.wake(toy);
    }
    pressMove(x, y) {
      if (!this.touchStart) return;
      this.finger = [x, y];
      const toy = this.held;
      if (!toy) return;
      this.dragged = this.dragged || Math.hypot(x - this.touchStart[0], y - this.touchStart[1]) > 8;
      toy.body.moveTouch(clamp(x, 8, this.W - 8), clamp(y, this.floor + 8, this.H - 8));
    }
    // Returns the toy tapped, if it was a tap.
    pressEnd(cancelled) {
      const toy = this.held, squeezed = this.squeezeAmount > 0.3, squeeze = this.squeezeAmount;
      const tapped = toy && !this.dragged && !squeezed ? toy : null;
      if (toy) {
        if (cancelled) toy.body.cancelTouch(); else toy.body.endTouch();
        toy.z = toy.index;
        this.wake(toy);
        if (!cancelled) {
          if (this.dragged) this.life.noteThrow(toy, this.toys.filter(t => t.spawned));
          if (squeezed) {
            // Let go of a squeeze and it springs up with a pop.
            toy.body.hop(0, 1.6 + 1.8 * squeeze, 1.2 * squeeze);
            this.sparkles(toy.body.cx, toy.body.cy - toy.height * 0.3, COLOR[toy.finish], 7, 34);
          }
        }
      }
      this.heldTime = 0; this.squeezeAmount = 0; this.finger = null; this.held = null; this.touchStart = null; this.dragged = false;
      if (cancelled || !tapped) return null;
      // One tap squishes it; a second straight after makes it jump.
      const now = performance.now() / 1000;
      if (this.lastTap && this.lastTap.toy === tapped && now - this.lastTap.at <= 0.28) { this.lastTap = null; this.bigJump(tapped); }
      else this.lastTap = { toy: tapped, at: now };
      return tapped;
    }

    // ---- drawing ----
    draw(time) {
      if (!this.gl) { this.draw2d(); return; }
      if (this.lost) return;
      const gl = this.gl, still = this.reduceMotion;
      gl.begin();
      const items = [];
      const t = time % 3600;
      for (const fx of this.fx) if (fx.kind === 'frost') items.push([-9.5, () => this.drawFrost(fx)]);
      for (const toy of this.toys) {
        if (!toy.spawned) continue;
        const b = toy.body, z = toy.z;
        if (!still) items.push([z - 10, () => this.drawShadow(toy)]);
        if (toy.aura && toy.aura.texture) items.push([z - 6, () => this.drawAura(toy, time)]);
        if (!still) {
          const speed = Math.hypot(b.rvx, b.rvy) / b.bodyH, strength = toy.resting ? 0 : clamp((speed - T.trailFrom) / T.trailFrom, 0, 1);
          if (strength > 0.01) {
            const ghosts = this.trailCount || T.trailCount;
            for (let k = 0; k < ghosts; k++) {
              const fraction = (k + 1) / (ghosts + 1);
              items.push([z - 1 - k, () => gl.mesh(toy, b.dest, b.drawX - b.rvx * T.trailDuration * fraction,
                b.drawY - b.rvy * T.trailDuration * fraction, strength * 0.3 * (1 - fraction), t, true)]);
            }
          }
        }
        items.push([z, () => (still ? gl.mesh(toy, STILL_GRID, b.cx, b.cy, 1, t) : gl.mesh(toy, b.dest, b.drawX, b.drawY, 1, t))]);
        if (toy.glints.length) items.push([z + 5, () => this.drawGlints(toy)]);
      }
      items.sort((a, b) => a[0] - b[0]);
      for (const [, draw] of items) draw();
      for (const fx of this.fx) if (fx.kind === 'spark') this.drawSpark(fx);
    }
    drawShadow(toy) {
      const b = toy.body, lift = clamp((b.minY - b.floorY) / (1.2 * b.bodyH), 0, 1), alpha = 0.45 * (1 - lift);
      if (alpha <= 0.004) return;
      const tex = this.gl.texture('shadow', () => this.shadow).texture;
      const w = b.bodyW * 0.72 * ((b.maxX - b.minX) / b.bodyW) * (1 - 0.6 * lift), h = b.bodyW * 0.12 * (1 - 0.6 * lift);
      this.gl.sprite(tex, b.drawX, b.floorY + 0.03 * b.bodyH, w, h, 0, 1, 1, 1, alpha, false);
    }
    drawAura(toy, time) {
      const b = toy.body, sw = b.bodyW * b.overhang * (1 + 2 * AURA_PADDING), sh = b.bodyH * (1 + 2 * AURA_PADDING);
      const xs = this.reduceMotion ? 1 : (b.maxX - b.minX) / b.bodyW, ys = this.reduceMotion ? 1 : (b.maxY - b.minY) / b.bodyH;
      // Breathing brighter and dimmer, 1.5 s each way; a Shiny's turning through the rainbow.
      const breathe = this.reduceMotion ? 1 : 0.8 + 0.2 * Math.cos((time * Math.PI) / 1.5);
      const tint = toy.finish === 'shiny' && !this.reduceMotion ? rainbowAt(time) : toy.finish === 'shiny' ? HUES[0] : [1, 1, 1];
      const x = this.reduceMotion ? b.cx : b.drawX, y = this.reduceMotion ? b.cy : b.drawY;
      this.gl.sprite(toy.aura.texture, x, y, sw * xs, sh * ys, 0, tint[0], tint[1], tint[2], breathe, false);
    }
    drawGlints(toy) {
      const b = toy.body, tex = this.gl.texture('star', () => this.star).texture;
      for (const g of toy.glints) {
        const life = g.age / g.life, alpha = life < 0.25 ? life / 0.25 : 1 - (life - 0.25) / 0.75;
        const size = g.size * Math.max(0, g.scale - 0.4 * g.age);
        const color = g.rainbow ? hueSequence(g.age / g.life) : ICE;
        this.gl.sprite(tex, b.drawX + g.x, b.drawY + g.y, size, size, g.angle, color[0], color[1], color[2], alpha, true);
      }
    }
    drawSpark(fx) {
      const tex = this.gl.texture('star', () => this.star).texture, t = fx.age;
      if (t >= 0.75) return;
      const travel = 1 - (1 - Math.min(1, t / 0.7)) ** 2;
      const scale = t < 0.18 ? 0.2 + 0.8 * (t / 0.18) : Math.max(0.3, 1 - 0.7 * ((t - 0.18) / 0.55));
      const alpha = t < 0.35 ? 1 : Math.max(0, 1 - (t - 0.35) / 0.4);
      const size = fx.size * scale;
      this.gl.sprite(tex, fx.x + fx.dx * travel, fx.y + fx.dy * travel, size, size, Math.PI * Math.min(1, t / 0.75),
        fx.color[0], fx.color[1], fx.color[2], alpha, true);
    }
    drawFrost(fx) {
      const t = fx.age - fx.delay;
      if (t < 0 || t > 0.7) return;
      const p = 1 - (1 - t / 0.7) ** 2, scale = 0.3 + (fx.to - 0.3) * p, alpha = 0.95 * (1 - t / 0.7);
      this.gl.sprite(fx.tex.texture, fx.x, fx.y, fx.w * scale, fx.h * scale, 0, 1, 1, 1, alpha, false);
    }
    // Without WebGL: each picture squashed and turned with its body, without its face.
    draw2d() {
      const ctx = this.ctx2d, r = this.ratio;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const order = this.toys.filter(t => t.spawned).sort((a, b) => a.z - b.z);
      for (const toy of order) {
        const b = toy.body, a = 1 + b.sx, o = b.sz, d = 1 + b.sy, c = Math.cos(b.theta), s = Math.sin(b.theta);
        // Its squash and turn (strain times rotation), from y up into the canvas's y down.
        const m00 = a * c + o * s, m01 = -a * s + o * c, m10 = o * c + d * s, m11 = -o * s + d * c;
        ctx.setTransform(m00 * r, -m10 * r, -m01 * r, m11 * r, b.cx * r, (this.H - b.cy) * r);
        const sw = b.bodyW * b.overhang, sh = b.bodyH;
        ctx.drawImage(toy.art.canvas, -sw / 2, -sh / 2, sw, sh);
      }
    }
    // Glints twinkling round a Diamond or a holographic Shiny, five a second (JellyAura.glints).
    stepEffects(dt) {
      for (const fx of this.fx) fx.age += dt;
      this.fx = this.fx.filter(fx => (fx.kind === 'spark' ? fx.age < 0.75 : fx.age < fx.delay + 0.7));
      if (this.reduceMotion) return;
      for (const toy of this.toys) {
        if (!toy.spawned || !toy.aura) continue;
        for (const g of toy.glints) {
          g.age += dt;
          g.x += g.vx * dt; g.y += g.vy * dt; g.angle += 1.5 * dt;
        }
        toy.glints = toy.glints.filter(g => g.age < g.life);
        toy.glintClock += dt * 5;
        const b = toy.body, sw = b.bodyW * b.overhang, sh = b.bodyH, side = Math.max(sw, sh);
        while (toy.glintClock >= 1) {
          toy.glintClock -= 1;
          const angle = Math.random() * TAU, speed = 8 + (Math.random() - 0.5) * 6;
          toy.glints.push({
            x: (Math.random() - 0.5) * sw * 1.1, y: (Math.random() - 0.5) * sh * 1.1, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            age: 0, life: 1.1 + (Math.random() - 0.5) * 0.5, size: side * 0.16, scale: 1 + (Math.random() - 0.5) * 0.6,
            angle: (Math.random() - 0.5) * Math.PI, rainbow: toy.finish === 'shiny', hue: Math.random() * 7,
          });
        }
      }
    }
  }
  const PHYSICS_BUDGET = 9;
  const HUDDLE_TIME = 2, HUDDLE_PULL = 0.5, HUDDLE_SPEED = 1.2, HUDDLE_GAP = 3, HUDDLE_TOUCH = 1, HUDDLE_SQUISH = 1.6;
  // The plain picture, for a still pile.
  const STILL_GRID = new Float64Array(GRID * 2);
  for (let r = 0; r < COLS; r++) for (let c = 0; c < COLS; c++) { STILL_GRID[(r * COLS + c) * 2] = c / N; STILL_GRID[(r * COLS + c) * 2 + 1] = r / N; }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      // Decoded off the main thread before it's drawn where the browser can, but never waited on
      // for long: a page that isn't being drawn may not decode until it is.
      img.onload = () => {
        if (!img.decode) { resolve(img); return; }
        Promise.race([img.decode().catch(() => {}), new Promise(done => setTimeout(done, 400))]).then(() => resolve(img));
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  // ---------------------------------------------------------------------------------------
  // The site's opening pour, after the app's (OnboardingView's JellyPour) and in the pile's own
  // physics, but smaller and wilder: a few jellies drop in slowly, one at a time, then they come
  // faster and faster until all the rest flood down at once and bury the screen. Once it's full it
  // says so, and the page underneath takes over.
  const POUR_FIRST = 0.1, POUR_FLOOR = 18;
  // When each drops in, after the first: gaps that start long and shrink, down to a flood of about
  // 60 a second.
  function pourDelay(index) {
    let delay = 0, gap = 0.42;
    for (let i = 0; i < index; i++) { delay += gap; gap = Math.max(0.016, gap * 0.8); }
    return delay;
  }
  // The first few drop in gently where they'll be watched, a little either side of the middle;
  // from POUR_RUSH on they come too fast to follow one by one.
  const SLOW_LANES = [0.5, 0.31, 0.69, 0.41, 0.6, 0.24, 0.77], POUR_GENTLE = 5, POUR_RUSH = 9;

  // The app's substeps and contact passes for the few, then lighter ones for the flood: a hundred
  // jellies tumbling together look the same at any of them, and JavaScript can't run so many at the
  // app's. A device still short of time steps down sooner.
  const POUR_LEVELS = [[1 / 480, 2], [1 / 240, 2], [1 / 160, 1]];

  // The opening's logo as ground: the top and bottom of its letters column by column, read from
  // the picture's own alpha, so jellies land on the word itself and roll off its rounded ends.
  // `rect` is where it shows (CSS pixels from the host's top left); `height`, the host's.
  function logoGround(img, rect, height) {
    const n = 120, rows = 60, canvas = document.createElement('canvas');
    canvas.width = n; canvas.height = rows;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, n, rows);
    const px = ctx.getImageData(0, 0, n, rows).data;
    const raw = new Float64Array(n), top = new Float64Array(n), bottom = new Float64Array(n), nx = new Float64Array(n), ny = new Float64Array(n);
    let y0 = Infinity, y1 = -Infinity;
    for (let c = 0; c < n; c++) {
      let first = -1, last = -1;
      for (let r = 0; r < rows; r++) if (px[(r * n + c) * 4 + 3] > 110) { if (first < 0) first = r; last = r; }
      if (first < 0) { raw[c] = NaN; top[c] = -Infinity; bottom[c] = Infinity; continue; }
      raw[c] = height - (rect.top + (first / rows) * rect.height);           // y up, as the scene's
      bottom[c] = height - (rect.top + ((last + 1) / rows) * rect.height);
      y0 = Math.min(y0, bottom[c]);
    }
    const dx = rect.width / n;
    for (let c = 0; c < n; c++) {
      if (Number.isNaN(raw[c])) continue;
      // A little smoothed, so a jelly doesn't catch on a pixel step.
      let sum = 0, k = 0;
      for (let d = -1; d <= 1; d++) if (c + d >= 0 && c + d < n && !Number.isNaN(raw[c + d])) { sum += raw[c + d]; k++; }
      top[c] = sum / k;
      y1 = Math.max(y1, top[c]);
    }
    for (let c = 0; c < n; c++) {
      if (!(top[c] > bottom[c])) continue;
      const a = c > 0 && top[c - 1] > bottom[c - 1] ? top[c - 1] : top[c], b = c < n - 1 && top[c + 1] > bottom[c + 1] ? top[c + 1] : top[c];
      const slope = (b - a) / (2 * dx), length = Math.hypot(slope, 1);
      nx[c] = -slope / length; ny[c] = 1 / length;
    }
    return { x0: rect.left, x1: rect.left + rect.width, y0, y1, n, dx, top, bottom, nx, ny };
  }

  class Pour extends Pile {
    constructor(options) {
      super(options);
      this.spawnsOnSim = true;
      // Two ghosts in a falling jelly's smear rather than four: they're small, and a hundred.
      this.trailCount = 2;
      this.level = 0; this.strained = 0;
      [this.substep, this.contactPasses] = POUR_LEVELS[0];
    }
    update(dt) {
      super.update(dt);
      // Most of the way through the flood the logo gives under the mound on it: no longer ground,
      // so the heap fills in under where it was and buries the screen.
      if (this.ground && this.simTime >= this.crushAt) {
        this.ground = null;
        for (const toy of this.toys) toy.body.ground = null;
        if (this.onGroundGone) this.onGroundGone();
      }
      // A hard landing on the logo, reported (the strongest a frame) so the logo can squish there.
      if (this.ground) {
        let best = null;
        for (const toy of this.toys) {
          const b = toy.body;
          if (b.groundHit > 0) {
            const speed = b.groundHit / b.bodyH;
            if (speed > 2.5 && (!best || speed > best.speed)) best = { x: (b.groundHitX - this.ground.x0) / (this.ground.x1 - this.ground.x0), speed };
            b.groundHit = 0;
          }
        }
        if (best && this.onGroundHit) this.onGroundHit(best.x, best.speed);
      }
      // Gone once it has fallen right out of the bottom.
      if (this.dropping) for (const toy of this.toys) if (toy.spawned && toy.body.maxY < 0) { toy.spawned = false; toy.spawnTime = Infinity; }
      this.strained = this.stats.physicsMs >= PHYSICS_BUDGET * 0.8 ? this.strained + 1 : 0;
      const last = POUR_LEVELS.length - 1;
      if (this.level < last && this.toys.length > POUR_RUSH && this.toys[POUR_RUSH].spawned) this.setLevel(last);
      else if (this.strained >= 3 && this.level < last) this.setLevel(this.level + 1);
    }
    // A flood has no middle to gather round.
    huddle(live) { for (const toy of live) toy.body.huddle = null; }
    // The floor gives way: the heap falls out of the bottom together, live and a little heavier
    // than usual, so its top sweeps down the screen and uncovers what's underneath from the top
    // down, the jellies tumbling and jiggling against each other as it goes.
    drop() {
      this.dropping = true;
      this.ground = null;
      // Heavier the more jelly-heights the screen is tall, so it clears in about the same time on
      // a phone as on a desktop (gravity goes by a jelly's own size).
      const tall = clamp(this.H / this.size / 6.7, 1, 2);
      for (const toy of this.toys) {
        // Any still above the screen (the heap overflows it) go now, unseen, rather than rain in
        // through the top behind the rest.
        if (!toy.spawned || toy.body.minY > this.H) { toy.spawned = false; toy.spawnTime = Infinity; continue; }
        const b = toy.body;
        b.setWalls(this.W, this.H, -1e6, 2 + (toy.width * (1 - toy.solid)) / 2);
        b.ground = null;
        b.fall = 1.8 * tall;
        this.stir(toy);
        b.hop(unit() * 0.25, -(2.6 + 0.4 * Math.random()) * Math.sqrt(tall), 0);
        b.spin(unit() * 1.2);
      }
    }
    // Nothing settles while it falls.
    rest(toy) { if (!this.dropping) super.rest(toy); }
    get gone() { return !!this.dropping && !this.toys.some(t => t.spawned); }
    setLevel(level) {
      this.level = level;
      this.strained = 0;
      [this.substep, this.contactPasses] = POUR_LEVELS[level];
    }
    // The whole screen, each jelly the page's one size (jellySize).
    measure() {
      this.W = this.hero.clientWidth;
      this.H = this.hero.clientHeight;
      this.floor = POUR_FLOOR; this.zoneL = 0; this.zoneW = this.W;
      this.size = jellySize(this.W, this.H);
      // A canvas the size of the screen, drawn a hundred times over each frame: kept to about
      // three million pixels, which is still twice over on a phone.
      this.ratio = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(3e6 / Math.max(1, this.W * this.H)));
      if (this.gl) this.gl.resize(this.W, this.H, this.ratio);
      else { this.canvas.width = Math.round(this.W * this.ratio); this.canvas.height = Math.round(this.H * this.ratio); }
    }
    // Every jelly over and over in its plain look, and every seventh a showpiece in its grandest,
    // Diamonds and Shinies taking turns (FlowStar).
    pick(count) {
      const ids = this.jellies.map(j => j.id);
      const looks = finish => this.jellies.filter(j => j.finishes.includes(finish)).map(j => j.id);
      const diamonds = looks('diamond'), shinies = looks('shiny'), stars = [];
      for (let i = 0; i < Math.max(diamonds.length, shinies.length); i++) {
        if (i < diamonds.length) stars.push([diamonds[i], 'diamond']);
        if (i < shinies.length) stars.push([shinies[i], 'shiny']);
      }
      return Array.from({ length: count }, (_, i) => (i % 7 === 3 && stars.length ? stars[i % stars.length] : [ids[(i * 5) % ids.length], 'common']));
    }
    async build() {
      this.measure();
      // As many as it takes to bury the screen.
      const count = clamp(Math.round((2 * this.W * this.H) / (this.size * this.size)), 70, 150);
      await this.makeToys(this.pick(count), this.size, this.size * this.ratio > 300);
      this.toys.forEach((toy, i) => { toy.spawnTime = POUR_FIRST + pourDelay(i); });
      this.crushAt = POUR_FIRST + pourDelay(Math.round(this.toys.length * 0.7));
      this.lastSpawn = this.toys.length ? this.toys[this.toys.length - 1].spawnTime : 0;
      this.built = true;
    }
    // The screen changed before it poured: each jelly sized for the new one.
    resize() {
      this.measure();
      for (const toy of this.toys) {
        toy.height = this.size / Math.sqrt(Math.max(toy.aspect, 0.1));
        toy.width = toy.height * toy.aspect;
      }
      this.configureAll();
    }
    // The first few drop in gently near the middle; the flood comes from anywhere across, falling
    // fast and tumbling, each dropped in just above any it would land on.
    spawn(toy, index) {
      const margin = (toy.height * toy.aspect) / 2 + 8;
      const lane = index < SLOW_LANES.length ? SLOW_LANES[index] + unit() * 0.03 : 0.06 + 0.88 * ((0.5 + index * 0.6180339887) % 1) + unit() * 0.02;
      const x = clamp(this.W * lane, margin, this.W - margin);
      const rush = clamp((index - POUR_GENTLE) / (POUR_RUSH - POUR_GENTLE), 0, 1);
      let y = this.H + toy.height * (0.62 + rush * 1.2 * Math.random());
      for (let k = Math.max(0, index - 16); k < index; k++) {
        const b = this.toys[k].body;
        if (this.toys[k].spawned && Math.abs(b.cx - x) < (b.bodyW * b.overhang + toy.width) / 2 && Math.abs(b.cy - y) < (b.bodyH + toy.height) / 2) {
          y = b.cy + (b.bodyH + toy.height) / 2 + 2;
        }
      }
      const speed = 3 + rush * (4 + 2 * Math.random());
      toy.body.place(x, y, unit() * (20 + 25 * rush), -toy.height * speed, unit() * (0.12 + 0.18 * rush), unit() * (1.2 + 1.8 * rush));
      toy.body.ground = this.ground;
      toy.spawned = true;
      toy.huddleLeft = HUDDLE_TIME;
    }
    // How much of the screen above the floor the jellies hide: a grid of points tested against
    // their bodies (narrower than their pictures, so it never claims too much: 0.86 looks buried).
    coverage() {
      const cols = 14, rows = Math.max(6, Math.round((cols * this.H) / this.W)), boxes = [];
      for (const toy of this.toys) {
        if (!toy.spawned) continue;
        const b = toy.body, inX = (b.maxX - b.minX) * 0.1, inY = (b.maxY - b.minY) * 0.1;
        boxes.push([b.minX + inX, b.minY + inY, b.maxX - inX, b.maxY - inY]);
      }
      let hidden = 0;
      for (let r = 0; r < rows; r++) {
        const y = this.floor + ((r + 0.5) / rows) * (this.H - this.floor);
        for (let c = 0; c < cols; c++) {
          const x = ((c + 0.5) / cols) * this.W;
          for (const q of boxes) if (x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]) { hidden++; break; }
        }
      }
      return hidden / (rows * cols);
    }
    // Full once they're all in and bury it, the last given a moment to land. Soon after anyway.
    get full() {
      if (!this.toys.length || !this.toys[this.toys.length - 1].spawned) return false;
      if (this.simTime >= this.lastSpawn + 1) return true;
      return this.simTime >= this.lastSpawn + 0.25 && this.coverage() >= 0.86;
    }
  }

  // The pour over `host` (the whole screen). Built (loaded, unseen) ahead, so starting it only
  // sets it going; `start()` resolves once the heap has filled the screen.
  // `onGroundHit(x, speed)`: a jelly landing hard on the logo (x across it, 0 to 1; speed in its
  // heights a second). `onGroundGone()`: the logo giving way under the flood.
  function pour({ host, jellies, faces, srcFor, onGroundHit, onGroundGone }) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pour-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    // Without multisampling: the jellies' edges are their pictures' own soft alpha.
    const heap = new Pour({ hero: host, canvas, jellies, faces, srcFor, onGroundHit, onGroundGone, reduceMotion: false, antialias: false });
    window.squishPour = heap;                           // handy for checking the frame budget in the console
    let running = false, started = false, stopped = false, last = 0, covered = null, dropped = null, edge = 0;
    // Built for the screen it pours over, so not before that has a size.
    const sized = () => host.clientWidth >= 100 && host.clientHeight >= 100;
    const ready = new Promise(resolve => {
      const build = () => heap.build().then(() => resolve(heap.toys.length > 0), () => resolve(false));
      if (sized() || !window.ResizeObserver) { build(); return; }
      const watch = new ResizeObserver(() => { if (sized()) { watch.disconnect(); build(); } });
      watch.observe(host);
    });
    const frame = now => {
      if (!running) return;
      if (stopped || document.hidden) { running = false; return; }
      // At most the app's 60 frames a second, even on a faster screen.
      if (now - last < 10.5) { requestAnimationFrame(frame); return; }
      const dt = Math.min(0.1, (now - last) / 1000 || 1 / 60);
      last = now;
      heap.update(dt);
      heap.stepEffects(dt);
      heap.draw(now / 1000);
      heap.stats.frames++;
      if (covered && heap.stats.frames % 3 === 0 && heap.full) { const done = covered; covered = null; done(); }
      if (heap.dropping) {
        // How far down the falling heap's top has come (CSS pixels from the top of the screen),
        // never back up: the shade behind it follows (site.css), so the page shows from the top
        // down only where the heap has gone. Its top taken a little below the highest few, so a
        // jelly bouncing clear of the rest doesn't hold it up.
        const tops = heap.toys.filter(t => t.spawned).map(t => t.body.maxY).sort((p, q) => q - p);
        const top = tops.length ? tops[Math.floor(tops.length * 0.12)] : -heap.H;
        edge = Math.max(edge, clamp(heap.H - top, 0, heap.H + 200));
        host.style.setProperty('--edge', `${edge.toFixed(1)}px`);
      }
      if (dropped && heap.gone) { const done = dropped; dropped = null; done(); }
      requestAnimationFrame(frame);
    };
    const run = () => {
      if (running || stopped || !started || document.hidden) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    };
    const resized = () => { if (started && !stopped) heap.relayout(); };
    document.addEventListener('visibilitychange', run);
    addEventListener('resize', resized);
    return {
      ready,
      start() {
        if (started) return Promise.resolve();
        if (Math.abs(host.clientWidth - heap.W) > 1 || Math.abs(host.clientHeight - heap.H) > 1) heap.resize();
        started = true;
        const filled = new Promise(resolve => { covered = resolve; });
        run();
        return filled;
      },
      // The logo as ground the jellies land on (`rect`: where it shows, CSS pixels from the host's
      // top left).
      setGround(img, rect) {
        try { heap.ground = logoGround(img, rect, host.clientHeight); } catch (e) { heap.ground = null; }
        return !!heap.ground;
      },
      // The floor gives way; resolves once the last jelly has fallen out of the bottom.
      drop() {
        heap.drop();
        return new Promise(resolve => { dropped = resolve; });
      },
      stop() { stopped = true; running = false; },
      destroy() {
        stopped = true; running = false;
        document.removeEventListener('visibilitychange', run);
        removeEventListener('resize', resized);
        const gl = heap.gl && heap.gl.gl, lose = gl && gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        heap.canvas.remove();
        if (window.squishPour === heap) window.squishPour = null;
      },
    };
  }

  // ---------------------------------------------------------------------------------------
  // On the page.
  // `holdUntil`: a promise the pour waits for once built (the site's opening, playing over it).
  function start({ hero, pit, hint, jellies, faces, srcFor, reduceMotion, holdUntil }) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pit-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    pit.appendChild(canvas);
    // Beside the headline only on a wide screen on its side (site.css's hero layout).
    const pile = new Pile({ hero, canvas, hint, jellies, faces, srcFor, reduceMotion, wide: matchMedia('(min-width: 900px) and (orientation: landscape)') });
    window.squishPit = pile;                            // handy for checking the frame budget in the console
    let started = false, ready = false, running = false, visible = false, last = 0, held = !!holdUntil;
    if (holdUntil) holdUntil.then(() => { held = false; wake(); });

    const local = ev => { const r = hero.getBoundingClientRect(); return [ev.clientX - r.left, pile.H - (ev.clientY - r.top)]; };
    const frame = now => {
      if (!running) return;
      // At most the app's 60 frames a second, even on a faster screen.
      if (now - last < 10.5 && visible && !document.hidden) { requestAnimationFrame(frame); return; }
      const dt = Math.min(0.1, (now - last) / 1000 || 1 / 60);
      last = now;
      pile.update(dt);
      pile.stepEffects(dt);
      pile.draw(now / 1000);
      pile.stats.frames++;
      if (visible && !document.hidden) requestAnimationFrame(frame);
      else running = false;
    };
    const wake = () => {
      if (held || running || !visible || !ready || reduceMotion || document.hidden) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    };
    // Worked out ahead and drawn once, for people who turn off motion: the heap as it settles.
    const settleStill = seconds => {
      const life = pile.life;
      pile.life = { update: () => [], noteThrow() {}, lookAt() {}, shine() {} };
      for (let i = 0; i < 60 * seconds; i++) pile.update(1 / 60);
      pile.life = life;
      pile.toys.forEach(t => { if (t.body.face) t.body.blink = 0; });
      pile.draw(0);
    };
    // The pile pours in once the hero is on screen at its real size.
    const begin = async () => {
      if (started || document.hidden) return;
      pile.measure();
      if (pile.W < 100 || pile.H < 100) return;
      started = true;
      await pile.build();
      ready = true;
      if (reduceMotion) settleStill(8);
      else wake();
    };

    new IntersectionObserver(entries => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) { begin(); wake(); }
    }).observe(hero);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) { begin(); wake(); } });
    let resizeTimer = 0, lastWidth = 0;
    const resized = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!ready) { if (visible) begin(); return; }
        if (hero.clientWidth === lastWidth && hero.clientHeight === pile.H) return;
        lastWidth = hero.clientWidth;
        pile.relayout();
        if (reduceMotion) settleStill(3);
        else wake();
      }, 120);
    };
    addEventListener('resize', resized);
    if (window.ResizeObserver) new ResizeObserver(resized).observe(hero);

    if (reduceMotion) return pile;

    // Touch: a press squishes the jelly under it (twice quickly to jump), holding still squeezes
    // it flat, and dragging carries it off to toss. Everyone looks at the finger meanwhile.
    let press = null, hoverAt = 0;
    const done = () => { if (hint) hint.classList.add('is-done'); };
    hero.addEventListener('pointerdown', ev => {
      if (!ready || press || ev.button > 0 || ev.target.closest('a, button')) return;
      const [x, y] = local(ev), toy = pile.toyAt(x, y);
      press = { id: ev.pointerId, toy };
      pile.pressStart(x, y, toy);
      // Kept, so the press always ends here, wherever it's let go.
      try { hero.setPointerCapture(ev.pointerId); } catch (e) { /* capture is optional */ }
      if (toy) {
        ev.preventDefault();
        hero.style.cursor = 'grabbing';
      }
      wake();
    });
    // A finger on a jelly holds the page still rather than scrolling it.
    hero.addEventListener('touchstart', ev => {
      if (!ready || ev.touches.length !== 1 || ev.target.closest('a, button')) return;
      const t = ev.touches[0], [x, y] = local(t);
      if (pile.toyAt(x, y)) ev.preventDefault();
    }, { passive: false });
    hero.addEventListener('pointermove', ev => {
      if (press && ev.pointerId === press.id) {
        const [x, y] = local(ev);
        pile.pressMove(x, y);
        return;
      }
      // A mouse over the hero: the jellies glance at it as they would at a tap, and the one
      // under it can be picked up.
      if (!ready || ev.pointerType !== 'mouse' || ev.target.closest('a, button')) return;
      const [x, y] = local(ev);
      hero.style.cursor = pile.toyAt(x, y) ? 'grab' : '';
      if (ev.timeStamp - hoverAt > 120) {
        hoverAt = ev.timeStamp;
        pile.life.lookAt(x, y, pile.toys.filter(t => t.spawned));
      }
    });
    const letGo = ev => {
      if (!press || ev.pointerId !== press.id) return;
      const hadToy = !!press.toy;
      press = null;
      pile.pressEnd(ev.type === 'pointercancel');
      hero.style.cursor = '';
      if (hadToy && ev.type !== 'pointercancel') done();
      wake();
    };
    hero.addEventListener('pointerup', letGo);
    hero.addEventListener('pointercancel', letGo);
    hero.addEventListener('lostpointercapture', letGo);
    return pile;
  }

  window.SquishPit = { start, pour };
})();
