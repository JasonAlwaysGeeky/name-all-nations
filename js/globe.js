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
  const FLING_TAU = 190;       // matches the flat map's momentum
  const FLING_MIN = 0.00002;   // radians/ms below which a spin stops
  const TAP_SLOP = 6;          // px of movement still counted as a tap
  const HIT_PAD = 11;          // px of click padding around a country
  const LOD_HI_R = 900;        // above this radius, the fine borders are worth it
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

  const el = {};
  for (const id of ['globe', 'pick', 'hud', 'readout', 'fps', 'detail', 'grid', 'spin-toggle']) {
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
    selected: colour('--selected', '#ffca57'),
    hover: colour('--hover', '#ffe1a0'),
  };
  const STROKE = {
    land: colour('--land-stroke', '#8a7d5f'),
    territory: colour('--territory-stroke', '#a59e8c'),
  };

  function draw() {
    const cam = camera();
    drawnVerts = 0; drawnRings = 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // ocean
    const grad = ctx.createLinearGradient(0, view.cy - view.r, 0, view.cy + view.r);
    grad.addColorStop(0, colour('--ocean-top', '#bddbef'));
    grad.addColorStop(1, colour('--ocean-bot', '#8ab6d8'));
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
        const playable = isCountry.has(code);
        ctx.fillStyle = code === selected ? FILL.selected
          : code === hovered && playable ? FILL.hover
            : playable ? FILL.land : FILL.territory;
        ctx.fill();
        ctx.strokeStyle = playable ? STROKE.land : STROKE.territory;
        ctx.stroke();
      }
      i = j;
    }

    // the limb, last, so no coastline overhangs it
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, view.r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(20, 55, 90, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Meridians and parallels every 30°, so the globe reads as a turning
  // sphere and not a wobbling blob. Drawn as short chords; cheap enough
  // not to show up in the frame budget.
  function drawGraticule(cam) {
    const { sp, cp, sl, cl, r, cx, cy } = cam;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
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
  // rather than a point-in-polygon walk. Small countries are drawn last
  // and with a fat stroke, which is the canvas version of the flat map's
  // click padding: land just offshore still belongs to the country.

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

    order.forEach((o, idx) => {
      const id = idx + 1;
      const col = `rgb(${id & 255},${(id >> 8) & 255},${(id >> 16) & 255})`;
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
      if (!any) return;
      pickCtx.fillStyle = col;
      pickCtx.fill();
      pickCtx.strokeStyle = col;
      pickCtx.lineWidth = HIT_PAD * 2;
      pickCtx.stroke();
    });
    pickDirty = false;
  }

  function codeAt(x, y) {
    if (Math.hypot(x - view.cx, y - view.cy) > view.r) return null;
    if (pickDirty) buildPick();
    const d = pickCtx.getImageData(x, y, 1, 1).data;
    const id = d[0] | (d[1] << 8) | (d[2] << 16);
    return id > 0 ? pickCodes[id - 1] : null;
  }

  // ————— frame loop —————

  const frames = [];
  let rafId = 0;

  function tick(now) {
    rafId = 0;
    const t0 = performance.now();

    if (autoSpin && !moving) { view.lam += 0.0022; needsDraw = true; }

    // momentum, decaying by e every FLING_TAU
    if (!moving && (spin.vlam || spin.vphi)) {
      const dt = Math.min(50, now - spin.at);
      spin.at = now;
      const decay = Math.exp(-dt / FLING_TAU);
      view.lam += spin.vlam * dt;
      view.phi = clampPhi(view.phi + spin.vphi * dt);
      spin.vlam *= decay; spin.vphi *= decay;
      if (Math.abs(spin.vlam) < FLING_MIN && Math.abs(spin.vphi) < FLING_MIN) {
        spin.vlam = spin.vphi = 0;
        scheduleSettle();
      }
      needsDraw = true;
    }

    if (needsDraw) {
      draw();
      needsDraw = false;
      pickDirty = true;
    }

    frames.push(performance.now() - t0);
    if (frames.length > 60) frames.shift();

    // The readout is throttled while frames are flowing, but the last
    // frame of a gesture has to land whatever the throttle says —
    // otherwise the numbers on screen are the second-to-last frame's,
    // which is exactly when someone is reading them.
    const busy = autoSpin || spin.vlam || spin.vphi || needsDraw;
    hud(!busy);
    if (busy) request();
  }

  function request() { if (!rafId) rafId = requestAnimationFrame(tick); }
  function invalidate() { needsDraw = true; request(); }

  const clampPhi = (p) => Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p));

  let hudAt = 0;
  function hud(force) {
    const now = performance.now();
    if (!force && now - hudAt < 200) return;
    hudAt = now;
    const avg = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
    const worst = Math.max(...frames);
    el.fps.textContent =
      `${avg.toFixed(1)} ms/frame (worst ${worst.toFixed(1)}) · ${Math.round(1000 / Math.max(avg, 0.001))} fps headroom · ` +
      `${drawnVerts.toLocaleString()} of ${geom.verts.toLocaleString()} points · ${drawnRings} of ${geom.rings} rings · ${lod} detail`;
  }

  // Fine borders once you stop moving, coarse ones while you turn — the
  // same bargain the flat map makes when it rewrites its viewBox.
  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const want = view.r >= LOD_HI_R ? 'hi' : 'lo';
      if (want !== lod && built[want]) { lod = want; geom = built[want]; invalidate(); }
    }, 90);
  }

  function useCoarseWhileMoving() {
    if (lod !== 'lo' && built.lo) { lod = 'lo'; geom = built.lo; }
  }

  // ————— input —————

  function bind() {
    const canvas = el.globe;
    const pointers = new Map();
    let last = null, tapAt = null, movedBy = 0;

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = { x: e.clientX, y: e.clientY, t: performance.now(), spread: spreadOf(pointers) };
      tapAt = { x: e.clientX, y: e.clientY };
      movedBy = 0;
      spin.vlam = spin.vphi = 0;
      moving = true;
      useCoarseWhileMoving();
      canvas.classList.add('turning');
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') hover(e);
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = centroid(pointers);
      const now = performance.now();
      const dt = Math.max(1, now - last.t);

      // Turning: a drag of one radius across the screen turns the globe
      // by one radian, which is the closest thing to "the point under
      // your finger stays under it" that survives a pole.
      const dx = c.x - last.x, dy = c.y - last.y;
      const dlam = -dx / view.r, dphi = dy / view.r;
      view.lam += dlam;
      view.phi = clampPhi(view.phi + dphi);
      spin.vlam = dlam / dt; spin.vphi = dphi / dt; spin.at = now;

      const sp = spreadOf(pointers);
      if (last.spread > 0 && sp > 0) {
        const rect = canvas.getBoundingClientRect();
        zoomAt(c.x - rect.left, c.y - rect.top, sp / last.spread);
      }

      movedBy += Math.hypot(dx, dy);
      last = { x: c.x, y: c.y, t: now, spread: sp };
      invalidate();
    });

    const up = (e) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size) { const c = centroid(pointers); last = { x: c.x, y: c.y, t: performance.now(), spread: spreadOf(pointers) }; return; }
      moving = false;
      canvas.classList.remove('turning');
      if (movedBy <= TAP_SLOP && tapAt) {
        const rect = canvas.getBoundingClientRect();
        pick(tapAt.x - rect.left, tapAt.y - rect.top);
        spin.vlam = spin.vphi = 0;
      }
      spin.at = performance.now();
      scheduleSettle();
      request();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top,
        Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)));
      useCoarseWhileMoving();
      scheduleSettle();
      invalidate();
    }, { passive: false });

    el.detail.addEventListener('change', () => {
      lod = el.detail.checked ? 'hi' : 'lo';
      geom = built[lod] || geom;
      invalidate();
    });
    el.grid.addEventListener('change', () => { showGrid = el.grid.checked; invalidate(); });
    el.spinToggle.addEventListener('change', () => { autoSpin = el.spinToggle.checked; request(); });

    addEventListener('resize', measure);
  }

  const centroid = (pts) => {
    let x = 0, y = 0;
    for (const p of pts.values()) { x += p.x; y += p.y; }
    return { x: x / pts.size, y: y / pts.size };
  };
  const spreadOf = (pts) => {
    if (pts.size < 2) return 0;
    const c = centroid(pts);
    let d = 0;
    for (const p of pts.values()) d += Math.hypot(p.x - c.x, p.y - c.y);
    return d / pts.size;
  };

  function setRadius(r) {
    view.r = Math.max(MIN_R, Math.min(MAX_R, r));
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

  function hover(e) {
    const rect = el.globe.getBoundingClientRect();
    const code = codeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (code === hovered) return;
    hovered = code;
    invalidate();
  }

  function pick(x, y) {
    const code = codeAt(x, y);
    selected = code;
    el.readout.textContent = code ? (nameOf[code] || code) : 'ocean';
    invalidate();
  }

  // ————— boot —————

  function measure() {
    const rect = el.globe.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(rect.width); H = Math.round(rect.height);
    el.globe.width = Math.round(W * dpr); el.globe.height = Math.round(H * dpr);
    el.globe.style.width = `${W}px`; el.globe.style.height = `${H}px`;
    view.cx = W / 2; view.cy = H / 2;
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
    };
    measure();
    bind();
    el.hud.hidden = false;
    el.readout.textContent = `ready — ${built.lo.verts.toLocaleString()} coarse / ${built.hi.verts.toLocaleString()} fine points, prepared in ${buildMs.toFixed(0)}ms`;
    request();
  }

  boot().catch((err) => {
    el.readout.textContent = `could not load the map (${err.message})`;
  });
})();
