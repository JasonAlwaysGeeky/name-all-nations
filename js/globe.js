/*
 * Globe mode, as an experiment.
 *
 * The question this is here to answer is not "can the map be a globe" —
 * it obviously can — but "can it be a globe without giving up the frame
 * rate the flat map has". So this is a real renderer over the real
 * borders, with the cost of every frame on screen, rather than a mockup.
 *
 * Why it can't reuse the flat map's trick: that one draws the SVG once
 * and moves it with a GPU transform, rewriting the viewBox only when the
 * gesture settles. A rotating globe has no such transform — every vertex
 * moves differently, because the sphere turns underneath them. So every
 * frame really does have to re-project and re-draw, which rules out SVG
 * (1,600 paths re-rasterised per frame) and rules in canvas.
 *
 * What makes that affordable:
 *
 *   - The amCharts map is a plain Mercator, which inverts exactly. Each
 *     vertex is turned into a latitude and longitude ONCE at load, and
 *     cached as four numbers — sin/cos of each — so a frame is a handful
 *     of multiply-adds per vertex and no trigonometry at all.
 *   - Rings are culled whole, by a dot product against a precomputed
 *     bounding cap: half the world is behind the globe at any moment,
 *     and most of the rest is too small to see.
 *   - Coarse borders while you're moving, fine ones once you stop — the
 *     same bargain bake() makes on the flat map, for the same reason.
 *
 * Everything is in flat typed arrays rather than objects per point: at
 * 25,000 vertices a frame, the difference is cache misses, and cache
 * misses are the whole budget.
 */

(() => {
  'use strict';

  // ————— the map's projection —————
  //
  // Fitted from the map itself, against places small enough that their
  // bounding-box centre is the place: the Vatican, Monaco, Singapore,
  // Nauru, Tuvalu and friends. Longitude is linear in x to within a
  // quarter of a map unit, and y is Mercator in latitude to within half
  // of one — so the inverse below is exact for anything we can see.
  const PX0 = 475.7263, PXK = 2.8066667;    // x = PX0 + PXK * lon°
  const PY0 = 462.0971, PYK = 159.27238;    // y = PY0 - PYK * mercator(lat)

  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;

  const lonAt = (x) => {
    let lon = (x - PX0) / PXK;
    // The sheet runs from about -169° to +190°: the far east of it is
    // the far west of the world.
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;
    return lon;
  };
  const latAt = (y) => (2 * Math.atan(Math.exp((PY0 - y) / PYK)) - Math.PI / 2) * R2D;

  // ————— tuning —————

  const MIN_R = 120;           // globe radius, px
  const MAX_R = 9700;         // the flat map's own 60x, as a radius
  // The flat map's own numbers (app.js), read at the surface in px/ms, so
  // a flick feels the same on either.
  const FLING_TAU = 190;       // ms; momentum decay time constant
  const FLING_MIN = 0.02;      // px/ms below which a spin stops
  const FLING_MAX = 5;         // px/ms cap on the launch speed
  const FLING_WINDOW = 90;     // ms of recent movement the launch speed is measured over
  const TAP_SLOP = { mouse: 5, pen: 8, touch: 10 };   // px of movement still counted as a tap
  // Past this share of the radius the grabbed point has no honest place
  // to be (a finger off the disc is off the planet), so a drag out there
  // turns the globe by rate instead, and takes the point back up when the
  // finger comes back over it.
  const RATE_EDGE = 0.95;
  const HIT_PAD = 12;          // px of click padding around a country — the flat map's
  const RING_MIN_PX = 0.6;     // rings smaller than this on screen are skipped

  // ————— state —————

  const view = { lam: 0, phi: 20 * D2R, r: 0, cx: 0, cy: 0 };
  const spin = { vlam: 0, vphi: 0, at: 0 };
  let W = 0, H = 0, dpr = 1;
  let lod = 'lo';              // which border set is loaded into the arrays
  let geom = null;             // the flat arrays, for the current lod
  const built = {};            // lod -> geometry, built once each
  let moving = false;
  let selected = null;
  let hovered = null;
  let isCountry = new Set();   // the 195; everything else on the map is a territory
  let nameOf = {};
  let needsDraw = true;
  let settleTimer = null;

  // ————— what the game paints —————
  //
  // The renderer knows nothing about the game; the game (globe-play.js)
  // sets these and draws its own things over the top.
  const status = {};           // code -> named | placed | missed | revealed
  const flashes = new Map();   // code -> a fill to show for a moment
  let dimTo = null;            // the codes in play; everything else fades back
  let drawHook = null;         // called over the finished globe every frame
  let hoverHook = null;        // asked first what the cursor is over (the game's buttons)
  let tapHook = null;          // first look at a tap, before the countries
  let countryHook = null;      // a tap that reached a country (or the ocean)
  let anim = null;             // a camera flight in progress
  let centre = null;           // where the disc is centred, when not the canvas middle

  const el = {};
  for (const id of ['globe', 'pick', 'fps', 'readout']) {
    el[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
  }
  const ctx = el.globe.getContext('2d');
  const pickCtx = el.pick.getContext('2d', { willReadFrequently: true });

  let autoSpin = false;
  let showGrid = true;

  // ————— geometry —————
  //
  // One pass over the path data turns "M12.3,45.6L…" into four parallel
  // arrays of trig, plus a ring table. Nothing allocates per frame after
  // this.

  function buildGeometry(paths, codes) {
    let total = 0, ringCount = 0;
    const subsOf = (d) => d.split(/(?=M)/);
    for (const id of codes) {
      for (const sub of subsOf(paths[id])) {
        const n = (sub.match(/[ML]/g) || []).length;
        if (n >= 3) { total += n; ringCount++; }
      }
    }

    const sinLat = new Float64Array(total), cosLat = new Float64Array(total);
    const sinLon = new Float64Array(total), cosLon = new Float64Array(total);
    const start = new Int32Array(ringCount), count = new Int32Array(ringCount);
    const ringCode = new Array(ringCount);
    // Bounding cap per ring: a unit vector through its middle, and how
    // far its furthest vertex leans away from that. Two numbers that let
    // a whole ring be skipped without touching its vertices.
    const capX = new Float64Array(ringCount), capY = new Float64Array(ringCount);
    const capZ = new Float64Array(ringCount), capSin = new Float64Array(ringCount);
    const capAng = new Float64Array(ringCount);

    let v = 0, ri = 0;
    for (const id of codes) {
      for (const sub of subsOf(paths[id])) {
        const nums = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g);
        if (!nums || nums.length < 6) continue;
        const n = nums.length >> 1;
        if (n < 3) continue;
        start[ri] = v; count[ri] = n; ringCode[ri] = id;
        let sx = 0, sy = 0, sz = 0;
        for (let i = 0; i < n; i++) {
          const lat = latAt(+nums[i * 2 + 1]) * D2R;
          const lon = lonAt(+nums[i * 2]) * D2R;
          const sa = Math.sin(lat), ca = Math.cos(lat);
          const so = Math.sin(lon), co = Math.cos(lon);
          sinLat[v] = sa; cosLat[v] = ca; sinLon[v] = so; cosLon[v] = co;
          sx += ca * co; sy += ca * so; sz += sa;
          v++;
        }
        const len = Math.hypot(sx, sy, sz) || 1;
        const nx = sx / len, ny = sy / len, nz = sz / len;
        let minDot = 1;
        for (let i = start[ri]; i < v; i++) {
          const d = cosLat[i] * cosLon[i] * nx + cosLat[i] * sinLon[i] * ny + sinLat[i] * nz;
          if (d < minDot) minDot = d;
        }
        capX[ri] = nx; capY[ri] = ny; capZ[ri] = nz;
        // The angular radius, and its sine: one bounds how far the ring
        // can land from its centre on screen, the other is what the
        // behind-the-globe test wants.
        capAng[ri] = Math.acos(Math.max(-1, Math.min(1, minDot)));
        capSin[ri] = Math.sin(capAng[ri]);
        ri++;
      }
    }

    return { sinLat, cosLat, sinLon, cosLon, start, count, ringCode, capX, capY, capZ, capSin, capAng, rings: ri, verts: v };
  }

  // ————— projection —————
  //
  // Orthographic, straight out of the textbook, with the camera's own
  // sines and cosines hoisted out of the loop. The scratch buffer is
  // reused for every ring of every frame.

  let sx = new Float64Array(4096), sy = new Float64Array(4096);
  function scratch(n) {
    if (n > sx.length) { sx = new Float64Array(n * 2); sy = new Float64Array(n * 2); }
  }

  let drawnVerts = 0, drawnRings = 0;

  // Projects one ring into the scratch buffer. Points on the far side of
  // the globe are pushed out onto the limb along their own bearing,
  // which keeps a country that straddles the horizon a closed shape
  // instead of an unravelled one, and costs nothing.
  function projectRing(g, ri, cam) {
    const s = g.start[ri], n = g.count[ri];
    scratch(n);
    const { sinLat, cosLat, sinLon, cosLon } = g;
    const { sp, cp, sl, cl, r, cx, cy } = cam;
    for (let i = 0; i < n; i++) {
      const j = s + i;
      const so = sinLon[j], co = cosLon[j], sa = sinLat[j], ca = cosLat[j];
      const cd = co * cl + so * sl;          // cos(lon - lam0)
      const sd = so * cl - co * sl;          // sin(lon - lam0)
      const cacd = ca * cd;
      let px = ca * sd;
      let py = cp * sa - sp * cacd;
      const cosc = sp * sa + cp * cacd;
      if (cosc < 0) {
        const m = Math.hypot(px, py) || 1;   // behind the globe: pin to the limb
        px /= m; py /= m;
      }
      sx[i] = cx + r * px;
      sy[i] = cy - r * py;
    }
    return n;
  }

  // A ring is worth drawing when some of it is in front of the globe, is
  // bigger than a speck, and lands somewhere on the canvas. All three
  // from the ring's bounding cap, so a ring that fails costs three dot
  // products rather than a walk over its vertices — which is what makes
  // a zoomed-in globe cheaper to draw than a whole one, instead of the
  // same price with most of it off screen.
  function ringVisible(g, ri, cam) {
    const cx = g.capX[ri], cy = g.capY[ri], cz = g.capZ[ri];
    if (cx * cam.ex + cy * cam.ey + cz * cam.ez < -g.capSin[ri]) return false;
    if (g.capSin[ri] * cam.r < RING_MIN_PX) return false;
    const px = cam.cx + cam.r * (cx * cam.Ex + cy * cam.Ey);
    const py = cam.cy - cam.r * (cx * cam.Nx + cy * cam.Ny + cz * cam.Nz);
    const pad = cam.r * g.capAng[ri] + 3;
    return px + pad >= 0 && px - pad <= W && py + pad >= 0 && py - pad <= H;
  }

  function camera() {
    const sp = Math.sin(view.phi), cp = Math.cos(view.phi);
    const sl = Math.sin(view.lam), cl = Math.cos(view.lam);
    return {
      sp, cp, sl, cl, r: view.r, cx: view.cx, cy: view.cy,
      // the point at the centre of the disc, as a unit vector…
      ex: cp * cl, ey: cp * sl, ez: sp,
      // …and the east/north pair that turns any other unit vector into
      // a screen offset, which is how a whole ring gets placed on screen
      // from one dot product instead of all its vertices.
      Ex: -sl, Ey: cl,
      Nx: -sp * cl, Ny: -sp * sl, Nz: cp,
    };
  }

  // ————— drawing —————

  const css = getComputedStyle(document.documentElement);
  const colour = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
  const FILL = {
    land: colour('--land', '#f5edd6'),
    territory: colour('--territory', '#cdc7b9'),
    dim: colour('--map-land-inactive', '#182537'),
    selected: colour('--selected', '#ffca57'),
    hover: colour('--hover', '#ffe1a0'),
    named: colour('--named', '#7fd08c'),
    placed: colour('--placed', '#8cc1ec'),
    missed: colour('--missed', '#f2b95c'),
    revealed: colour('--revealed', '#f2b95c'),
    'flash-good': colour('--map-flash-good', '#62d283'),
    'flash-bad': colour('--map-flash-bad', '#d0605a'),
    'flash-show': colour('--map-flash-show', '#e8d56a'),
  };
  const STROKE = {
    land: colour('--land-stroke', '#8a7d5f'),
    territory: colour('--territory-stroke', '#a59e8c'),
    selected: colour('--selected-stroke', '#b9821a'),
  };
  // Borders are gaps of ocean, as on the flat map: a status changes a
  // country's fill and never its line. Only the selection has its own.
  for (const k of ['dim', 'named', 'placed', 'missed', 'revealed']) STROKE[k] = STROKE.land;

  // The same order of precedence as the flat map's classes: a flash on
  // top of everything, then the selection, the hover, what the game has
  // decided about the country, and last what it is.
  function paint(code) {
    const playable = isCountry.has(code);
    const st = status[code];
    if (flashes.has(code)) return { fill: FILL[flashes.get(code)], stroke: STROKE[st] || STROKE.land };
    if (code === selected) return { fill: FILL.selected, stroke: STROKE.selected };
    if (code === hovered && playable && (!dimTo || dimTo.has(code))) return { fill: FILL.hover, stroke: STROKE[st] || STROKE.land };
    if (st) return { fill: FILL[st], stroke: STROKE[st] };
    if (!playable) return { fill: FILL.territory, stroke: STROKE.territory };
    if (dimTo && !dimTo.has(code)) return { fill: FILL.dim, stroke: STROKE.dim };
    return { fill: FILL.land, stroke: STROKE.land };
  }

  function draw() {
    const cam = camera();
    drawnVerts = 0; drawnRings = 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // ocean
    const grad = ctx.createLinearGradient(0, view.cy - view.r, 0, view.cy + view.r);
    grad.addColorStop(0, colour('--globe-ocean-top', '#16253a'));
    grad.addColorStop(1, colour('--globe-ocean-bot', '#101a29'));
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, view.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    if (showGrid) drawGraticule(cam);

    // Land, country by country: one path per country so its fill can
    // differ, stroked in the same pass so the vertices are only walked
    // once.
    const g = geom;
    ctx.lineWidth = 0.9;
    ctx.lineJoin = 'round';
    let i = 0;
    while (i < g.rings) {
      const code = g.ringCode[i];
      let any = false;
      ctx.beginPath();
      // every ring of this country
      let j = i;
      for (; j < g.rings && g.ringCode[j] === code; j++) {
        if (!ringVisible(g, j, cam)) continue;
        const n = projectRing(g, j, cam);
        ctx.moveTo(sx[0], sy[0]);
        for (let k = 1; k < n; k++) ctx.lineTo(sx[k], sy[k]);
        ctx.closePath();
        drawnVerts += n; drawnRings++;
        any = true;
      }
      if (any) {
        const p = paint(code);
        ctx.fillStyle = p.fill;
        ctx.fill();
        ctx.strokeStyle = p.stroke;
        ctx.stroke();
      }
      i = j;
    }

    // the limb, last, so no coastline overhangs it
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, view.r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(127, 176, 240, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (drawHook) drawHook(ctx, cam);
  }

  // Meridians and parallels every 30°, so the globe reads as a turning
  // sphere and not a wobbling blob. Drawn as short chords; cheap enough
  // not to show up in the frame budget.
  function drawGraticule(cam) {
    const { sp, cp, sl, cl, r, cx, cy } = cam;
    ctx.strokeStyle = 'rgba(127, 176, 240, 0.14)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    // Chords, so the step has to shrink as the globe grows or the
    // meridians start looking like polygons.
    const step = Math.max(0.25, Math.min(4, 2000 / r));
    for (let lon = -180; lon < 180; lon += 30) {
      let down = false;
      for (let lat = -90; lat <= 90; lat += step) {
        const la = lat * D2R, lo = lon * D2R;
        const ca = Math.cos(la), sa = Math.sin(la);
        const cd = Math.cos(lo) * cl + Math.sin(lo) * sl, sd = Math.sin(lo) * cl - Math.cos(lo) * sl;
        if (sp * sa + cp * ca * cd < 0) { down = false; continue; }
        const px = cx + r * ca * sd, py = cy - r * (cp * sa - sp * ca * cd);
        if (down) ctx.lineTo(px, py); else { ctx.moveTo(px, py); down = true; }
      }
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const la = lat * D2R, ca = Math.cos(la), sa = Math.sin(la);
      let down = false;
      for (let lon = -180; lon <= 180; lon += step) {
        const lo = lon * D2R;
        const cd = Math.cos(lo) * cl + Math.sin(lo) * sl, sd = Math.sin(lo) * cl - Math.cos(lo) * sl;
        if (sp * sa + cp * ca * cd < 0) { down = false; continue; }
        const px = cx + r * ca * sd, py = cy - r * (cp * sa - sp * ca * cd);
        if (down) ctx.lineTo(px, py); else { ctx.moveTo(px, py); down = true; }
      }
    }
    ctx.stroke();
  }

  // ————— hit testing —————
  //
  // An off-screen copy of the same drawing, with every country filled in
  // a colour that is really its index — so a click is one pixel read
  // rather than a point-in-polygon walk.
  //
  // It is painted in two layers, the way the flat map stacks its own:
  // the click padding underneath (a fat stroke round every country, small
  // ones last so they win the sea they share), and every country's real
  // shape on top. So padding only ever claims water — a point that is on
  // a country's land is that country, however small its neighbour. Done
  // as one layer, fill and stroke together, each small country's padding
  // was painted over its neighbours' land and took a 12px bite out of them.

  let pickCodes = [];
  let pickDirty = true;

  function buildPick() {
    const g = geom;
    const cam = camera();
    el.pick.width = W; el.pick.height = H;
    pickCtx.setTransform(1, 0, 0, 1, 0, 0);
    pickCtx.clearRect(0, 0, W, H);
    pickCtx.lineJoin = 'round';

    // biggest first, so the small ones paint over them
    const order = [];
    let i = 0;
    while (i < g.rings) {
      const code = g.ringCode[i];
      let j = i, area = 0;
      for (; j < g.rings && g.ringCode[j] === code; j++) area += g.capSin[j] * g.capSin[j];
      order.push({ code, from: i, to: j, area });
      i = j;
    }
    order.sort((a, b) => b.area - a.area);
    pickCodes = order.map(o => o.code);

    const trace = (o) => {
      pickCtx.beginPath();
      let any = false;
      for (let j = o.from; j < o.to; j++) {
        if (!ringVisible(g, j, cam)) continue;
        const n = projectRing(g, j, cam);
        pickCtx.moveTo(sx[0], sy[0]);
        for (let k = 1; k < n; k++) pickCtx.lineTo(sx[k], sy[k]);
        pickCtx.closePath();
        any = true;
      }
      return any;
    };
    const colour = (idx) => { const id = idx + 1; return `rgb(${id & 255},${(id >> 8) & 255},${(id >> 16) & 255})`; };

    // the padding: countries only — a territory is not a target, and has
    // no business claiming the sea next to one that is
    pickCtx.lineWidth = HIT_PAD * 2;
    order.forEach((o, idx) => {
      if (!isCountry.has(o.code) || !trace(o)) return;
      pickCtx.strokeStyle = colour(idx);
      pickCtx.stroke();
    });
    // the shapes themselves, over all of it
    order.forEach((o, idx) => {
      if (!trace(o)) return;
      pickCtx.fillStyle = colour(idx);
      pickCtx.fill();
    });
    pickDirty = false;
  }

  // One pixel is not enough to go on. Where two fills meet, the canvas
  // antialiases the edge, and the pixel on it is a blend of two colours —
  // which, colours being indexes, is the index of some third country that
  // is nowhere near. Moving the cursor across a border flashed it. So the
  // read is a 3×3 block and the answer is whichever index most of it
  // agrees on: a blended edge is one pixel wide and never has the votes.
  function codeAt(x, y) {
    if (Math.hypot(x - view.cx, y - view.cy) > view.r) return null;
    if (pickDirty) buildPick();
    const d = pickCtx.getImageData(Math.round(x) - 1, Math.round(y) - 1, 3, 3).data;
    const votes = new Map();
    let best = 0, bestN = 0;
    for (let i = 0; i < 36; i += 4) {
      if (d[i + 3] !== 255) continue;               // a half-covered pixel on a coast: no vote
      const id = d[i] | (d[i + 1] << 8) | (d[i + 2] << 16);
      const n = (votes.get(id) || 0) + 1;
      votes.set(id, n);
      if (n > bestN) { best = id; bestN = n; }
    }
    return bestN >= 3 && best > 0 && best <= pickCodes.length ? pickCodes[best - 1] : null;
  }

  // ————— frame loop —————

  const frames = [];
  let rafId = 0;

  function tick(now) {
    rafId = 0;
    const t0 = performance.now();

    if (autoSpin && !moving) { view.lam += 0.0022; needsDraw = true; }

    // a flight: the same ease the flat map's animateView uses
    if (anim) {
      const k = Math.min(1, (now - anim.t0) / anim.ms), e = 1 - Math.pow(1 - k, 3);
      view.lam = anim.from.lam + anim.dlam * e;
      view.phi = clampPhi(anim.from.phi + (anim.to.phi - anim.from.phi) * e);
      view.r = anim.from.r + (anim.to.r - anim.from.r) * e;
      needsDraw = true;
      if (k >= 1) { anim = null; scheduleSettle(); }
    }

    // momentum, decaying by e every FLING_TAU
    if (!moving && (spin.vlam || spin.vphi)) {
      const dt = Math.min(50, now - spin.at);
      spin.at = now;
      const decay = Math.exp(-dt / FLING_TAU);
      view.lam += spin.vlam * dt;
      view.phi = clampPhi(view.phi + spin.vphi * dt);
      spin.vlam *= decay; spin.vphi *= decay;
      if (Math.hypot(spin.vlam * Math.cos(view.phi), spin.vphi) * view.r < FLING_MIN) {
        spin.vlam = spin.vphi = 0;
        scheduleSettle();
      }
      needsDraw = true;
    }

    if (needsDraw) {
      // mid-gesture and mid-flight the right border set can change as the
      // zoom does — a pinch that ends deep should not stay coarse all the way in
      if (moving || anim) useCoarseWhileMoving();
      draw();
      needsDraw = false;
      pickDirty = true;
    }

    const took = performance.now() - t0;
    if (lod === 'hi' && took > FINE_BUDGET && (moving || anim || spin.vlam || spin.vphi)) {
      fineFromR = Math.max(fineFromR, view.r * 1.2);
    }
    frames.push(took);
    if (frames.length > 60) frames.shift();

    // The readout is throttled while frames are flowing, but the last
    // frame of a gesture has to land whatever the throttle says —
    // otherwise the numbers on screen are the second-to-last frame's,
    // which is exactly when someone is reading them.
    const busy = autoSpin || spin.vlam || spin.vphi || needsDraw || anim;
    hud(!busy);
    if (busy) request();
  }

  function request() { if (!rafId) rafId = requestAnimationFrame(tick); }
  function invalidate() { needsDraw = true; request(); }

  const clampPhi = (p) => Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p));

  let hudAt = 0;
  function hud(force) {
    if (!el.fps) return;
    const now = performance.now();
    if (!force && now - hudAt < 200) return;
    hudAt = now;
    const avg = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
    const worst = Math.max(...frames);
    el.fps.textContent =
      `${avg.toFixed(1)} ms/frame (worst ${worst.toFixed(1)}) · ${Math.round(1000 / Math.max(avg, 0.001))} fps headroom · ` +
      `${drawnVerts.toLocaleString()} of ${geom.verts.toLocaleString()} points · ${drawnRings} of ${geom.rings} rings · ${lod} detail`;
  }

  // Fine borders once you stop moving, whatever was drawn on the way.
  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (lod !== 'hi' && built.hi) { lod = 'hi'; geom = built.hi; invalidate(); }
    }, 90);
  }

  // The coarse borders are each country simplified on its own, so two
  // neighbours no longer share an edge: up close there are slivers of sea
  // between them. Coarse is the right trade when most of the globe is on
  // screen and every frame walks tens of thousands of points; zoomed in,
  // most rings are off screen and skipped, and the fine set costs no more
  // little more than the coarse one did zoomed out.
  //
  // What "cheap enough" is depends on the device, so it is measured: the
  // fine set is used everywhere until a moving frame runs over budget on
  // it, and that pushes the radius it is used from out past where it
  // happened. A fast machine never draws the coarse borders at all; a slow
  // phone finds its own line within a frame or two. Standing still there
  // is no budget to keep, so the globe at rest is always the fine set.
  const FINE_BUDGET = 10;      // ms; a moving frame on the fine borders may take this long
  let fineFromR = 0;
  function fineIsAffordable() {
    return !!built.hi && !!built.lo && view.r >= fineFromR;
  }

  function useCoarseWhileMoving() {
    const want = fineIsAffordable() ? 'hi' : 'lo';
    if (want !== lod && built[want]) { lod = want; geom = built[want]; }
  }

  // ————— input —————
  //
  // The gesture the flat map runs (bindMapEvents there), on a sphere.
  // Every pointer in play contributes to a centroid and a spread; the
  // gesture keeps one anchor — the point on the globe that sat under the
  // centroid when the anchor was taken — and each move re-solves the
  // camera so that point is back under the centroid, at a radius scaled
  // by how far the fingers have spread. One finger and two run through
  // the same path, and the anchor is retaken whenever the set of
  // pointers changes, so lifting one finger out of a pinch does not
  // teleport the globe. A press that never moves past TAP_SLOP is a tap.
  //
  // "Back under the centroid" is a rotation here, with north kept up,
  // and both angles of it fall out in closed form (aim) — so the grabbed
  // point stays under the finger exactly, the way a grabbed map point
  // does, instead of the globe turning by some rate per pixel.

  function bind() {
    const canvas = el.globe;
    const pointers = new Map();
    let gest = null;
    const trail = [];   // recent camera attitudes, for the release spin

    const local = (p) => { const rect = canvas.getBoundingClientRect(); return { x: p.x - rect.left, y: p.y - rect.top }; };

    function anchorGesture() {
      const pts = [...pointers.values()];
      if (!pts.length) { gest = null; return; }
      const c = centroidOf(pts);
      const l = local(c);
      gest = {
        a: unproject(l.x, l.y), cx: c.x, cy: c.y, lx: c.x, ly: c.y,
        spread: spreadOf(pts, c), r: view.r,
        rate: Math.hypot(l.x - view.cx, l.y - view.cy) > RATE_EDGE * view.r,
        moved: gest ? gest.moved : false,
        type: gest ? gest.type : 'touch',
        noTap: gest ? gest.noTap : false,
        tap: gest ? gest.tap : null,
      };
      trail.length = 0;   // the centroid just jumped; old samples would fling
    }

    function begin() {
      if (moving) return;
      moving = true;
      useCoarseWhileMoving();
      canvas.classList.add('turning');
    }

    function sample() {
      const now = performance.now();
      trail.push({ t: now, lam: view.lam, phi: view.phi });
      while (trail.length > 2 && now - trail[0].t > FLING_WINDOW) trail.shift();
    }

    function releaseSpin() {
      if (trail.length < 2) return null;
      const a = trail[0], b = trail[trail.length - 1];
      const dt = b.t - a.t;
      // A finger that stopped before lifting should not fling.
      if (dt < 8 || performance.now() - b.t > 70) return null;
      const dl = b.lam - a.lam;
      return { vlam: Math.atan2(Math.sin(dl), Math.cos(dl)) / dt, vphi: (b.phi - a.phi) / dt };
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // A touch that catches a spin should stop it, not also count as a
      // tap on whatever happened to turn under the finger.
      const caught = spin.vlam !== 0 || spin.vphi !== 0;
      spin.vlam = spin.vphi = 0;
      anim = null;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic / stale pointer */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        gest = null;
        anchorGesture();
        gest.type = e.pointerType;
        gest.noTap = caught;
        gest.tap = local({ x: e.clientX, y: e.clientY });
      } else {
        anchorGesture();
        gest.moved = true;      // a second finger is never a tap
        gest.noTap = true;
        begin();
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') hover(e);
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gest) return;

      const pts = [...pointers.values()];
      const c = centroidOf(pts);

      if (!gest.moved) {
        if (Math.hypot(c.x - gest.cx, c.y - gest.cy) <= (TAP_SLOP[gest.type] || 8)) return;
        gest.moved = true;
        begin();
        // Re-anchor at the point the drag actually broke loose, so the
        // globe doesn't snap by the slop distance on the first moved frame.
        anchorGesture();
        return;
      }

      let r = gest.r;
      if (gest.spread > 0) {
        const sp = spreadOf(pts, c);
        if (sp > 0) r = gest.r * (sp / gest.spread);
      }
      setRadius(r);
      const l = local(c);
      if (Math.hypot(l.x - view.cx, l.y - view.cy) > RATE_EDGE * view.r) {
        // Out past the rim: turn by the finger's travel, a radian per
        // radius, which is what holding on would mean near the centre.
        gest.rate = true;
        view.lam -= (c.x - gest.lx) / view.r;
        view.phi = clampPhi(view.phi + (c.y - gest.ly) / view.r);
      } else {
        // Back over the planet: take hold of what is under the finger
        // now, so nothing jumps, and hold it from here.
        if (gest.rate) anchorGesture();
        aim(gest.a, l.x, l.y);
      }
      gest.lx = c.x; gest.ly = c.y;
      if (pts.length === 1) sample();
      else trail.length = 0;      // don't fling out of a pinch
      invalidate();
    });

    const endPointer = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const wasTap = e.type === 'pointerup' && pointers.size === 1 && gest && !gest.moved && !gest.noTap;
      const tap = gest?.tap;
      pointers.delete(e.pointerId);

      if (pointers.size > 0) {
        // Fingers still down (a pinch losing one): re-anchor rather than
        // carry on from a centroid that no longer means anything.
        anchorGesture();
        return;
      }
      const moved = gest?.moved, type = gest?.type;
      gest = null;
      moving = false;
      canvas.classList.remove('turning');
      if (moved) {
        const v = type !== 'mouse' ? releaseSpin() : null;
        if (v) startSpin(v.vlam, v.vphi);
      }
      trail.length = 0;
      if (wasTap && tap && !(tapHook && tapHook(tap.x, tap.y))) pick(tap.x, tap.y);
      spin.at = performance.now();
      scheduleSettle();
      request();
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      anim = null;
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top,
        Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)));
      useCoarseWhileMoving();
      scheduleSettle();
      invalidate();
    }, { passive: false });

    addEventListener('resize', measure);
  }

  const centroidOf = (pts) => {
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    return { x: x / pts.length, y: y / pts.length };
  };
  // Mean distance from the centroid: for two fingers that is half the
  // pinch distance, and it keeps working if a third finger lands.
  const spreadOf = (pts, c) => {
    if (pts.length < 2) return 0;
    let d = 0;
    for (const p of pts) d += Math.hypot(p.x - c.x, p.y - c.y);
    return d / pts.length;
  };

  function setRadius(r) {
    view.r = Math.max(MIN_R, Math.min(MAX_R, r));
  }

  // A spin is a fling: the flat map's numbers, read in px/ms at the
  // surface under the centre of the disc.
  function startSpin(vlam, vphi) {
    const px = Math.hypot(vlam * Math.cos(view.phi), vphi) * view.r;
    if (!(px > FLING_MIN * 4)) return;
    const c = Math.min(1, FLING_MAX / px);
    spin.vlam = vlam * c; spin.vphi = vphi * c;
  }

  // Screen position → the camera-space point on the sphere under it,
  // (east, north, depth) in radii. Off the disc, the nearest point on
  // its rim, so a drag that runs out over the ocean still holds on.
  function discPoint(x, y) {
    let px = (x - view.cx) / view.r, py = -(y - view.cy) / view.r;
    const d = Math.hypot(px, py);
    if (d > 0.999) { px *= 0.999 / d; py *= 0.999 / d; }
    return { px, py, pz: Math.sqrt(Math.max(0, 1 - px * px - py * py)) };
  }

  // The point on the globe under a screen position, as a world unit
  // vector — projectRing run backwards.
  function unproject(x, y) {
    const { px, py, pz } = discPoint(x, y);
    const cam = camera();
    return {
      x: px * cam.Ex + py * cam.Nx + pz * cam.ex,
      y: px * cam.Ey + py * cam.Ny + pz * cam.ey,
      z: py * cam.Nz + pz * cam.ez,        // east has no z
    };
  }

  // Turn the camera so the world point `a` sits under screen (x, y), with
  // north still up. Two unknowns, and two equations that each involve
  // one of them: a's east component depends on the longitude alone, and
  // once that is known its depth fixes the latitude. Each equation has
  // two answers, so four candidate attitudes; with east and depth both
  // right, a's north component can only be the one asked for or its
  // mirror, and that is what tells the true answer from the other three.
  // Among the true ones (there can be two, on the far side of a pole),
  // the nearer to where the camera already points is the one the hand
  // meant.
  function aim(a, x, y) {
    const { px: qx, py: qy, pz: qz } = discPoint(x, y);
    const rho = Math.hypot(a.x, a.y);
    if (rho < 1e-6) return;                          // holding a pole: nothing to turn
    const alpha = Math.atan2(a.x, a.y);
    const base = Math.acos(Math.max(-1, Math.min(1, qx / rho)));
    let best = null;
    for (const lam of [base - alpha, -base - alpha]) {
      const cl = Math.cos(lam), sl = Math.sin(lam);
      const u = a.x * cl + a.y * sl;
      const R = Math.hypot(u, a.z);
      if (R < 1e-6) continue;
      const beta = Math.atan2(a.z, u);
      const off = Math.acos(Math.max(-1, Math.min(1, qz / R)));
      const dl = Math.atan2(Math.sin(lam - view.lam), Math.cos(lam - view.lam));
      for (const phi of [beta + off, beta - off]) {
        const p = clampPhi(phi);
        const north = -Math.sin(p) * u + Math.cos(p) * a.z;                // a · N at this attitude
        const miss = Math.abs(north - qy);
        const cost = Math.hypot(dl * Math.cos(view.phi), p - view.phi);   // how far the camera would move
        if (!best || miss < best.miss - 1e-9 || (Math.abs(miss - best.miss) <= 1e-9 && cost < best.cost)) {
          best = { lam: view.lam + dl, phi: p, miss, cost };
        }
      }
    }
    if (best) { view.lam = best.lam; view.phi = best.phi; }
  }

  // Zoom towards a point, the way the flat map zooms at the cursor —
  // except that on a globe "keep this point under the cursor" is a
  // rotation, not a translation. The point sits some angle out from the
  // centre of the disc; growing the globe shrinks that angle for the
  // same number of pixels, so the camera walks the difference along the
  // great circle towards it.
  function zoomAt(x, y, factor) {
    const dx = x - view.cx, dy = y - view.cy;
    const d = Math.hypot(dx, dy);
    const r0 = view.r;
    setRadius(r0 * factor);
    if (view.r === r0 || d < 1 || d > r0) return;
    const rho0 = Math.asin(Math.min(1, d / r0));
    const rho1 = Math.asin(Math.min(1, d / view.r));
    const delta = rho0 - rho1;
    if (!delta) return;
    const bearing = Math.atan2(dx, -dy);          // clockwise from north
    const sd = Math.sin(delta), cd = Math.cos(delta);
    const sp = Math.sin(view.phi), cp = Math.cos(view.phi);
    const phi = Math.asin(Math.max(-1, Math.min(1, sp * cd + cp * sd * Math.cos(bearing))));
    view.lam += Math.atan2(Math.sin(bearing) * sd * cp, cd - sp * Math.sin(phi));
    view.phi = clampPhi(phi);
  }

  // What is under the cursor is what a click would get — and a click
  // looks at the game's buttons before the countries behind them, so the
  // hover has to as well. The hook answers with a country's code (its
  // button is under the cursor), null (a button that is no one country),
  // or undefined (no button here: ask the globe).
  function hover(e) {
    const rect = el.globe.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const over = hoverHook ? hoverHook(x, y) : undefined;
    const code = over !== undefined ? over : codeAt(x, y);
    if (code === hovered) return;
    hovered = code;
    invalidate();
  }

  function pick(x, y) {
    const code = codeAt(x, y);
    if (countryHook) { countryHook(code, x, y); return; }
    selected = code;
    if (el.readout) el.readout.textContent = code ? (nameOf[code] || code) : 'ocean';
    invalidate();
  }

  // ————— what the game is given —————

  // A point on the globe, on screen: canvas coordinates, and whether it
  // faces the camera at all.
  function project(lon, lat) {
    const cam = camera();
    const la = lat * D2R, lo = lon * D2R;
    const ca = Math.cos(la), sa = Math.sin(la);
    const cd = Math.cos(lo) * cam.cl + Math.sin(lo) * cam.sl, sd = Math.sin(lo) * cam.cl - Math.cos(lo) * cam.sl;
    return {
      x: cam.cx + cam.r * ca * sd,
      y: cam.cy - cam.r * (cam.cp * sa - cam.sp * ca * cd),
      front: cam.sp * sa + cam.cp * ca * cd >= 0,
    };
  }

  // Each island of a country as an upright box in map units — what the
  // flat map's getBBox gives it, for the island outlines (js/islands.js).
  let pathOf = {};
  function islandBoxes(code) {
    const d = pathOf[code];
    if (!d) return [];
    const subs = d.split(/(?=M)/), boxes = [];
    for (const sub of subs) {
      const nums = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g);
      if (!nums || nums.length < 2) continue;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = +nums[i], y = +nums[i + 1];
        if (x < x1) x1 = x; if (x > x2) x2 = x;
        if (y < y1) y1 = y; if (y > y2) y2 = y;
      }
      if (subs.length > 1 && (x2 - x1) * (y2 - y1) < 1e-4) continue;
      boxes.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
    return boxes;
  }

  // Where to look for a country: the middle of its biggest ring, which
  // is its biggest landmass — the flat map's focusPoint, on a sphere.
  const focusOf = {};
  function focus(code) {
    if (focusOf[code]) return focusOf[code];
    const g = built.hi || geom;
    let best = -1, at = null;
    for (let i = 0; i < g.rings; i++) {
      if (g.ringCode[i] !== code || g.capSin[i] <= best) continue;
      best = g.capSin[i];
      at = { lon: Math.atan2(g.capY[i], g.capX[i]) * R2D, lat: Math.asin(Math.max(-1, Math.min(1, g.capZ[i]))) * R2D };
    }
    return (focusOf[code] = at);
  }

  // The flat map's zoom, px per map unit, for this radius: a map unit is
  // 1/PXK of a degree of longitude, and at the equator a degree is
  // r·π/180 px across. Every rule the game states in that unit — when a
  // button retires, when a zone unfolds — reads the same here.
  const scaleOf = (r) => r * (Math.PI / 180) / PXK;
  const radiusOf = (s) => s * PXK / (Math.PI / 180);

  function animateTo(to, ms = 260) {
    spin.vlam = spin.vphi = 0;
    const target = { lam: to.lon * D2R, phi: clampPhi(to.lat * D2R), r: Math.max(MIN_R, Math.min(MAX_R, to.r)) };
    if (ms <= 0) { view.lam = target.lam; view.phi = target.phi; view.r = target.r; anim = null; invalidate(); scheduleSettle(); return; }
    const dl = target.lam - view.lam;
    anim = { from: { lam: view.lam, phi: view.phi, r: view.r }, to: target, dlam: Math.atan2(Math.sin(dl), Math.cos(dl)), t0: performance.now(), ms };
    useCoarseWhileMoving();
    request();
  }

  function flash(code, kind, ms) {
    flashes.set(code, kind);
    invalidate();
    setTimeout(() => { if (flashes.get(code) === kind) { flashes.delete(code); invalidate(); } }, ms);
  }

  // ————— boot —————

  function measure() {
    const rect = el.globe.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(rect.width); H = Math.round(rect.height);
    el.globe.width = Math.round(W * dpr); el.globe.height = Math.round(H * dpr);
    el.globe.style.width = `${W}px`; el.globe.style.height = `${H}px`;
    view.cx = centre ? centre.x : W / 2;
    view.cy = centre ? centre.y : H / 2;
    if (!view.r) view.r = Math.min(W, H) * 0.42;
    pickDirty = true;
    invalidate();
  }

  async function boot() {
    const [svgText, lo] = await Promise.all([
      fetch('map/world.svg').then(r => r.text()),
      fetch('map/world-lo.json').then(r => r.json()).catch(() => null),
    ]);
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const hiPaths = {};
    for (const p of doc.querySelectorAll('path[id]')) {
      if (p.id === 'AQ') continue;                  // Antarctica is not in play
      hiPaths[p.id] = p.getAttribute('d');
    }
    const codes = Object.keys(hiPaths);
    pathOf = hiPaths;
    const loPaths = {};
    for (const id of codes) loPaths[id] = (lo && lo[id]) || hiPaths[id];

    // countries.js is a classic script: its top-level `const` is a
    // lexical global, not a property of `window`, so it has to be named
    // directly rather than looked up on the object.
    const list = typeof COUNTRIES !== 'undefined' ? COUNTRIES : [];
    isCountry = new Set(list.map(c => c.code));
    nameOf = Object.fromEntries(list.map(c => [c.code, c.name]));
    if (typeof TERRITORIES !== 'undefined') for (const [k, v] of Object.entries(TERRITORIES)) nameOf[k] ||= v;

    const t0 = performance.now();
    built.lo = buildGeometry(loPaths, codes);
    built.hi = buildGeometry(hiPaths, codes);
    const buildMs = performance.now() - t0;

    geom = built.lo;
    // Console hooks, same idea as the flat map's NAN_DEBUG.
    window.GLOBE_DEBUG = {
      view, spin, built,
      lod: () => lod,
      stats: () => ({ drawnVerts, drawnRings, rings: geom.rings, verts: geom.verts }),
      go: (lon, lat, r) => { view.lam = lon * D2R; view.phi = clampPhi(lat * D2R); if (r) setRadius(r); invalidate(); },
      // what is under a canvas position, in degrees — for the tests
      under: (x, y) => { const p = unproject(x, y); return { lon: Math.atan2(p.y, p.x) * R2D, lat: Math.asin(Math.max(-1, Math.min(1, p.z))) * R2D }; },
      settled: () => !moving && !spin.vlam && !spin.vphi,
      unproject, aim, invalidate,
    };
    // What the game layer (globe-play.js) gets to work with.
    window.GLOBE = {
      view, status, project, focus, unproject, codeAt, animateTo, flash, invalidate, scaleOf, radiusOf, islandBoxes,
      size: () => ({ W, H }),
      scale: () => scaleOf(view.r),
      lonLat: (x, y) => ({ lon: lonAt(x), lat: latAt(y) }),     // map units → degrees
      mapXY: (lon, lat) => ({ x: PX0 + PXK * lon, y: PY0 - PYK * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2)) }),
      lonLatOf: (p) => ({ lon: Math.atan2(p.y, p.x) * R2D, lat: Math.asin(Math.max(-1, Math.min(1, p.z))) * R2D }),
      isCountry: (code) => isCountry.has(code),
      select: (code) => { selected = code; invalidate(); },
      dim: (codes) => { dimTo = codes ? new Set(codes) : null; invalidate(); },
      centreAt: (x, y) => { centre = x == null ? null : { x, y }; measure(); },
      onDraw: (fn) => { drawHook = fn; invalidate(); },
      onTap: (fn) => { tapHook = fn; },
      onHover: (fn) => { hoverHook = fn; },
      onCountry: (fn) => { countryHook = fn; },
      settled: () => !moving && !spin.vlam && !spin.vphi && !anim,
    };
    measure();
    bind();
    if (el.readout) el.readout.textContent = `ready — ${built.lo.verts.toLocaleString()} coarse / ${built.hi.verts.toLocaleString()} fine points, prepared in ${buildMs.toFixed(0)}ms`;
    request();
    dispatchEvent(new Event('globe-ready'));
  }

  boot().catch((err) => {
    if (el.readout) el.readout.textContent = `could not load the map (${err.message})`;
    console.error(err);
  });
})();
