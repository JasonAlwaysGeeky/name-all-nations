/*
 * The game, on the globe — enough of it to feel how it plays there.
 *
 * This is a cut-down copy of app.js's loop, not a link to it: name and
 * place modes, the whole world or one region, the buttons for the small
 * countries, the dense zones that fold into a numbered button and unfold
 * when you dive, and the jump keys landing on the same boxes. It shares
 * the game's data (countries, offsets, zones, view boxes, target sizes,
 * name matching) and its stylesheet; the renderer is globe.js, which
 * hands over a small API (window.GLOBE) and knows nothing about any of
 * this.
 *
 * Not here: timers, stats, hints, hardcore, voice, the results panel,
 * and the pair buttons two crowded buttons merge into.
 */
(() => {
  'use strict';

  const D2R = Math.PI / 180;
  const BTN_R = 18;            // button radius, px — the flat map's numbers
  const BTN_HIT = 25;
  const BTN_LOCK = 5;
  const BTN_TAIL_MAX = 88;
  const TAIL_W = 8;
  const STRIKES = 3;
  const SAFE_BASE = { top: 60, bottom: 64, left: 12, right: 12 };

  const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map(c => [c.code, c]));
  const WORLD = COUNTRIES.map(c => c.code);
  const REGIONS = [...new Set(COUNTRIES.map(c => c.region))];
  const LEVELS = [
    { name: 'The whole world', codes: WORLD },
    ...REGIONS.map(r => ({ name: r, codes: COUNTRIES.filter(c => c.region === r).map(c => c.code) })),
  ];
  const ZONE_BY_NAME = Object.fromEntries(BUTTON_ZONES.map(z => [z.name, z]));

  const el = {};
  for (const id of [
    'globe-wrap', 'globe', 'progress-wrap', 'level-title', 'progress-text', 'level-mode', 'jump-bar',
    'card', 'card-close', 'card-question', 'guess-form', 'guess-input', 'feedback', 'reveal-btn',
    'card-answer', 'answer-result', 'answer-name',
    'word-bank', 'bank-flag', 'bank-name', 'bank-strikes', 'bank-skip', 'bank-show', 'bank-collapse', 'bank-hint', 'bank-chips',
  ]) el[id.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = document.getElementById(id);

  const state = { level: null, levelIx: 0, mode: 'place', selected: null, selectedAt: null, attempts: 0, armed: null, strikes: 0 };
  let G = null;

  const flagHTML = (code) => `<img class="flag" src="flags/${code.toLowerCase()}.svg" alt="" loading="lazy" onerror="this.remove()">`;

  // ————— the safe area —————
  //
  // What the map has to itself: the window minus the HUD along the top
  // and whatever is docked along the bottom, measured. The disc is
  // centred in it, so a fit that fills it is a fit that fills the glass.

  const SAFE = { ...SAFE_BASE };
  function updateSafe() {
    const { W, H } = G.size();
    const top0 = el.globe.getBoundingClientRect().top;
    let bottom = SAFE_BASE.bottom;
    for (const e of [el.jumpBar, el.wordBank, el.card]) {
      if (!e || e.hidden || !e.offsetParent) continue;
      const r = e.getBoundingClientRect();
      // the minimap counts only where it spans a real share of the width
      if (e === el.jumpBar && r.width < W * 0.4) continue;
      const top = r.top - top0;
      if (top < H) bottom = Math.max(bottom, Math.round(H - top) + 10);
    }
    SAFE.bottom = Math.min(bottom, Math.max(SAFE_BASE.bottom, H * 0.45));
    G.centreAt(SAFE.left + (W - SAFE.left - SAFE.right) / 2, SAFE.top + (H - SAFE.top - SAFE.bottom) / 2);
  }

  // ————— fits —————
  //
  // A box from js/views.js is the area that must be on screen, and the
  // flat map lands it at some zoom — px per map unit, safeScale there.
  // The globe lands the same box at the same zoom *number*, read at the
  // box's middle latitude: a map unit there spans a degree over PXK of
  // longitude, and a degree at that latitude is r·π/180·cos(lat) px. So
  // every rule the game states in that unit — when a button retires,
  // when a zone unfolds — fires on the same view on either map, which
  // is the comparison this page exists for. (Mercator inflates the far
  // north, so on the globe a northern box lands with room to spare; a
  // chord fit would fill the glass and open Europe's micro-states a
  // whole layer early.)

  const MAP_W = 1009.12;   // the map's width in units; the flat map caps a fit at half its 60x
  const MAX_ZOOM = 60;

  function fitBox(b) {
    const { W, H } = G.size();
    let s = Math.min((W - SAFE.left - SAFE.right) / (b[2] - b[0]), (H - SAFE.top - SAFE.bottom) / (b[3] - b[1]));
    s = Math.min(s, W / (MAP_W / MAX_ZOOM * 2));
    const mid = G.lonLat((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    return { lon: mid.lon, lat: mid.lat, r: G.radiusOf(s / Math.cos(mid.lat * D2R)), s };
  }

  // What the flat map would call this view's zoom: read at the middle of
  // the screen, one number for the whole view, as it is there. (A globe
  // is zoomed in more at its southern edge than its northern one in
  // these terms — Mercator's doing, not the sphere's — and reading the
  // rules at each country's own latitude opened Europe's micro-states,
  // which sit south of the view's middle, a layer earlier than the map.)
  const viewScale = () => G.scale() * Math.cos(G.view.phi);

  function fitCodes(codes, pad = 8) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const c of codes) {
      const f = G.focus(c);
      if (!f) continue;
      const p = G.mapXY(f.lon, f.lat);
      x1 = Math.min(x1, p.x); x2 = Math.max(x2, p.x); y1 = Math.min(y1, p.y); y2 = Math.max(y2, p.y);
    }
    if (x1 === Infinity) return null;
    return fitBox([x1 - pad, y1 - pad, x2 + pad, y2 + pad]);
  }

  // Zoomed all the way out is the whole hemisphere, filling the safe area.
  function worldView() {
    const { W, H } = G.size();
    return { lon: G.view.lam / D2R, lat: 20, r: Math.min(W - SAFE.left - SAFE.right, H - SAFE.top - SAFE.bottom) / 2 * 0.96 };
  }

  const zoomToView = (name) => G.animateTo(fitBox(VIEW_BOXES[name]), 220);

  // The zoom a zone unfolds at — the flat map's rule, in its unit.
  function zoneOpenScale(z) {
    const b = VIEW_BOXES[z.name];
    return b ? Math.min(z.minScale, fitBox(b).s * 0.98) : z.minScale;
  }

  function zoomToZone(z) {
    if (VIEW_BOXES[z.name]) { zoomToView(z.name); return; }
    const f = fitCodes(z.codes);
    if (!f) return;
    if (f.s < z.minScale * 1.1) f.r = G.radiusOf(z.minScale * 1.1 / Math.cos(f.lat * D2R));
    G.animateTo(f, 220);
  }

  // ————— jump keys —————

  const view = (name) => () => zoomToView(name);
  const zone = (name) => () => zoomToZone(ZONE_BY_NAME[name]);
  const JUMP_KEYS = {
    1: { name: 'North America', go: view('North America'), sub: view('Central America') },
    2: { name: 'Europe', go: view('Europe'), sub: zone('European microstates') },
    3: { name: 'Asia', go: view('Asia'), sub: zone('Middle East') },
    q: { name: 'South America', go: view('South America'), sub: zone('Caribbean') },
    w: { name: 'Africa', go: view('Africa'), sub: zone('West African coast') },
    e: { name: 'South Asia', go: view('South Asia'), sub: view('Pacific islands') },
  };
  const jumpState = { key: null, stage: 0, t: 0 };
  let jumpMarkTimer = null;

  function markJumpKeys() {
    const live = jumpState.key != null && performance.now() - jumpState.t < 15000;
    for (const b of el.jumpBar.querySelectorAll('button[data-key]')) {
      const on = live && b.dataset.key === jumpState.key;
      const deep = on && jumpState.stage === 1;
      b.classList.toggle('armed', on && !deep);
      b.classList.toggle('deep', deep);
      b.querySelector('.jump-to').textContent = on && !deep ? b.dataset.pocket : b.dataset.area;
    }
    clearTimeout(jumpMarkTimer);
    if (live) jumpMarkTimer = setTimeout(markJumpKeys, 15020 - (performance.now() - jumpState.t));
  }

  function jumpTo(key, straight = false) {
    if (key === '0') {
      G.animateTo(worldView(), 220);
      jumpState.key = null;
      markJumpKeys();
      return;
    }
    const j = JUMP_KEYS[key];
    if (!j) return;
    const now = performance.now();
    const again = jumpState.key === key && now - jumpState.t < 15000;
    jumpState.stage = straight ? 1 : (again ? (jumpState.stage + 1) % 2 : 0);
    jumpState.key = key;
    jumpState.t = now;
    if (jumpState.stage === 1) j.sub(); else j.go();
    markJumpKeys();
  }

  // ————— the buttons —————
  //
  // Drawn over the globe every frame, so they ride on it: a country's
  // button sits at its landmass plus the same pixel offset the flat map
  // gives it, retires by the same rule (a disc the size of the button
  // fits inside the country on screen), and folds into its zone's
  // numbered button below the zoom the zone opens at.

  let drawn = [];   // this frame's buttons, for the tap to look through

  function buttonOffset(off, s) {
    const mag = Math.hypot(off[0], off[1]);
    if (!mag) return { x: 0, y: 0, px: 0 };
    const grow = Math.min(Math.max(s / BTN_LOCK, 1), BTN_TAIL_MAX / mag);
    return { x: off[0] * grow, y: off[1] * grow, px: mag * grow };
  }

  // An archipelago's target is its dotted outline, not its land, so its
  // button retires once its biggest island group is a fair size on
  // screen — the flat map's rule.
  const buttonRedundant = (code, s) => groups[code]
    ? Math.max(biggestGroup(code).w, biggestGroup(code).h) * s >= 48
    : (TARGET_R[code] || 0) * s >= BTN_R;

  // ————— island outlines —————
  //
  // js/islands.js lays them out in map units, exactly as on the flat
  // map; here each rounded rect is walked as a polygon and every point
  // of it projected onto the sphere, so an outline is the flat map's
  // shape draped over the globe.

  const groups = {};           // code -> island groups, for the archipelagos
  const groupsOf = (code) => groups[code];
  const biggestGroup = (code) => groups[code].reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  let outlines = [];           // this frame's outlines, projected, for the tap to look through

  function buildGroups() {
    for (const code of ARCHIPELAGOS) {
      const boxes = G.islandBoxes(code);
      if (boxes.length) groups[code] = groupIslands(boxes);
    }
  }

  // Where a country's button points: the middle of the biggest island
  // group for an archipelago (the flat map's focusPoint), else the globe's.
  function buttonFocus(code) {
    if (!groups[code]) return G.focus(code);
    const b = biggestGroup(code);
    return G.lonLat(b.x + b.w / 2, b.y + b.h / 2);
  }

  // A rounded rect, turned about its centre, as points in map units.
  function rectPoints(b) {
    const pts = [];
    const hw = b.w / 2, hh = b.h / 2, r = Math.min(b.rx, hw, hh);
    const th = b.angle * D2R, c = Math.cos(th), sn = Math.sin(th);
    const corners = [[hw - r, hh - r, 0], [-(hw - r), hh - r, 90], [-(hw - r), -(hh - r), 180], [hw - r, -(hh - r), 270]];
    for (const [ox, oy, a0] of corners) {
      for (let k = 0; k <= 6; k++) {
        const a = (a0 + k * 15) * D2R;
        const x = ox + r * Math.cos(a), y = oy + r * Math.sin(a);
        pts.push([b.cx + x * c - y * sn, b.cy + x * sn + y * c]);
      }
    }
    return pts;
  }

  const OUTLINE_FILL = 'rgba(42, 61, 88, 0.35)', OUTLINE_LINE = 'rgba(127, 176, 240, 0.55)';
  const OUTLINE_HOT = 'rgba(60, 86, 121, 0.7)';
  const OUTLINE_FACE = {
    selected: 'rgba(201, 162, 74, 0.8)', named: 'rgba(79, 154, 98, 0.8)', revealed: 'rgba(176, 106, 85, 0.8)',
    placed: 'rgba(79, 134, 184, 0.8)', missed: 'rgba(176, 106, 85, 0.8)',
  };

  function drawOutlines(ctx, codes, s, squared) {
    outlines = [];
    for (const b of layoutOutlines(codes, s, groupsOf, squared)) {
      const pts = [];
      let behind = false;
      for (const [mx, my] of rectPoints(b)) {
        const ll = G.lonLat(mx, my), p = G.project(ll.lon, ll.lat);
        if (!p.front) { behind = true; break; }
        pts.push(p);
      }
      if (behind) continue;
      outlines.push({ code: b.code, pts });
      const st = b.code === state.selected ? 'selected' : G.status[b.code];
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      if (st) {
        ctx.fillStyle = OUTLINE_FACE[st]; ctx.strokeStyle = FACE[st][1];
        ctx.lineWidth = st === 'selected' ? 2 : 1.2; ctx.setLineDash([]);
      } else if (hot === b.code) {
        ctx.fillStyle = OUTLINE_HOT; ctx.strokeStyle = LINE; ctx.lineWidth = 1.2; ctx.setLineDash([]);
      } else {
        ctx.fillStyle = OUTLINE_FILL; ctx.strokeStyle = OUTLINE_LINE; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
      }
      ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function outlineAt(x, y) {
    for (let k = outlines.length - 1; k >= 0; k--) {
      const pts = outlines[k].pts;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (inside) return outlines[k].code;
    }
    return null;
  }

  const css = getComputedStyle(document.documentElement);
  const colour = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
  const FACE = {
    named: [colour('--named', '#7fd08c'), colour('--named-stroke', '#3f8f4e')],
    placed: [colour('--placed', '#4f86b8'), colour('--placed-stroke', '#8fbde8')],
    missed: [colour('--missed', '#b06a55'), colour('--missed-stroke', '#d99a86')],
    revealed: [colour('--revealed', '#f2b95c'), colour('--revealed-stroke', '#c98f2e')],
    selected: [colour('--selected', '#ffca57'), colour('--selected-stroke', '#b9821a')],
  };
  const LINE = colour('--color-line', '#7fb0f0');
  // An unanswered button is a ring you can see through: zoomed out they
  // crowd a small globe, and a solid disc hid the very nations it stood
  // for — most of all the ones it sits on top of, with no pointer to say so.
  const RING = 'rgba(12, 21, 34, 0.4)';
  const RING_HOT = 'rgba(42, 61, 88, 0.8)';
  const LINE_HOT = colour('--color-accent-100', '#eff4fd');
  const SURFACE = colour('--color-surface', '#172233');
  const TEXT = colour('--color-text', '#e7ebf2');
  const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="icons/ph.svg#${name}"/></svg>`;

  function drawButtons(ctx) {
    drawn = [];
    const codes = state.level ? state.level.codes : WORLD;
    const inLevel = new Set(codes);
    const grouped = new Set();
    const s = viewScale();
    const squared = squaredAt(s, groupsOf);
    drawOutlines(ctx, codes, s, squared);

    for (const z of BUTTON_ZONES) {
      const members = z.codes.filter(c => inLevel.has(c) && BUTTON_OFFSETS[c] && !buttonRedundant(c, s) &&
        !(ZONE_SOLO[c] && s >= ZONE_SOLO[c]));
      if (s >= zoneOpenScale(z) || members.length < 2) continue;
      for (const c of members) grouped.add(c);
      const at = G.lonLat(z.at[0], z.at[1]);
      const p = G.project(at.lon, at.lat);
      if (!p.front) continue;
      drawn.push({ x: p.x, y: p.y, r: BTN_R + 3, zone: z, label: String(members.length) });
    }

    for (const code of codes) {
      const off = BUTTON_OFFSETS[code];
      if (!off || grouped.has(code) || squared.has(code)) continue;
      const f = buttonFocus(code);
      if (!f) continue;
      if (s < (BUTTON_MIN_SCALE[code] || 0) || buttonRedundant(code, s)) continue;
      const p = G.project(f.lon, f.lat);
      if (!p.front) continue;
      const d = buttonOffset(off, s);
      drawn.push({ x: p.x + d.x, y: p.y + d.y, r: BTN_R, code, fx: p.x, fy: p.y, tail: d.px > 0 && Math.hypot(d.x, d.y) > BTN_R + 8 });
    }

    ctx.lineJoin = 'round';
    // Pointers first, so every face sits on top of every tail.
    for (const b of drawn) {
      if (!b.tail) continue;
      const dx = b.fx - b.x, dy = b.fy - b.y, dist = Math.hypot(dx, dy);
      const ux = dx / dist, uy = dy / dist, r0 = BTN_R - 2;
      const bx = b.x + ux * r0, by = b.y + uy * r0;
      ctx.beginPath();
      ctx.moveTo(bx - uy * TAIL_W, by + ux * TAIL_W);
      ctx.lineTo(b.fx, b.fy);
      ctx.lineTo(bx + uy * TAIL_W, by - ux * TAIL_W);
      ctx.closePath();
      const [fill, stroke] = faceOf(b.code);
      ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.5;
      ctx.fill(); ctx.stroke();
    }
    for (const b of drawn) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      if (b.zone) {
        const on = hot === 'zone:' + b.zone.name;
        ctx.fillStyle = on ? RING_HOT : SURFACE; ctx.strokeStyle = on ? LINE_HOT : LINE; ctx.lineWidth = 2;
        ctx.setLineDash(on ? [] : [5, 3]); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = TEXT; ctx.font = '600 17px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(b.label, b.x, b.y + 1);
      } else {
        const [fill, stroke] = faceOf(b.code);
        ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 2;
        ctx.fill(); ctx.stroke();
      }
    }
  }

  function faceOf(code) {
    if (code === state.selected) return FACE.selected;
    const face = FACE[G.status[code]];
    if (hot === code) return face ? [face[0], LINE_HOT] : [RING_HOT, LINE_HOT];
    return face || [RING, LINE];
  }

  // The button under the cursor lights up, and so does its nation — the
  // same pair a click on it would select. The globe asks this before it
  // looks at the countries, because a click does.
  let hot = null;
  function hoverButton(x, y) {
    const b = drawn.find(b => Math.hypot(b.x - x, b.y - y) <= BTN_HIT);
    const isle = b ? null : outlineAt(x, y);
    const key = b ? (b.zone ? 'zone:' + b.zone.name : b.code) : isle;
    if (key !== hot) { hot = key; G.invalidate(); }
    if (isle) return isle;
    return !b ? undefined : b.zone ? null : b.code;
  }

  // A tap looks at the buttons before the countries under them.
  function tapButton(x, y) {
    const b = drawn.find(b => Math.hypot(b.x - x, b.y - y) <= BTN_HIT);
    if (!b) {
      const isle = outlineAt(x, y);
      if (!isle) return false;
      onCountry(isle, x, y);
      return true;
    }
    if (b.zone) zoomToZone(b.zone); else onCountry(b.code, x, y);
    return true;
  }

  // ————— pops —————

  function pop(x, y, html, cls) {
    const d = document.createElement('div');
    d.className = `pop ${cls}`;
    d.innerHTML = html;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    el.globeWrap.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  function ensureVisible(code) {
    const f = G.focus(code);
    if (!f) return false;
    G.animateTo({ lon: f.lon, lat: f.lat, r: Math.max(G.view.r, G.radiusOf(3 / Math.cos(f.lat * D2R))) }, 300);
    return true;
  }

  // ————— the level —————

  function startLevel(def, mode) {
    state.level = { name: def.name, codes: def.codes.slice(), mode };
    state.mode = mode;
    for (const k of Object.keys(G.status)) delete G.status[k];
    G.dim(def.codes.length === WORLD.length ? null : def.codes);
    closeCard();
    state.armed = null;
    if (mode === 'place') buildBank(); else el.wordBank.hidden = true;
    el.levelTitle.textContent = def.name;
    el.levelMode.textContent = mode === 'place' ? 'Place' : 'Name';
    updateProgress();
    updateSafe();
    if (def.codes.length === WORLD.length) G.animateTo(worldView(), 260);
    else if (VIEW_BOXES[def.name]) G.animateTo(fitBox(VIEW_BOXES[def.name]), 260);
    else { const f = fitCodes(def.codes); if (f) G.animateTo(f, 260); }
    G.invalidate();
  }

  function updateProgress() {
    const L = state.level;
    const done = L.codes.filter(c => G.status[c] === 'named' || G.status[c] === 'placed').length;
    el.progressText.textContent = `${done} / ${L.codes.length}`;
  }

  function checkComplete() {
    const L = state.level;
    if (L.codes.some(c => !G.status[c])) return;
    const { W, H } = G.size();
    const misses = L.codes.filter(c => G.status[c] !== 'named' && G.status[c] !== 'placed').length;
    pop(W / 2, H / 2, misses ? `Done — ${misses} missed` : 'All of them ✓', misses ? 'show' : 'good');
  }

  // ————— name mode —————

  function onCountry(code, x, y) {
    const L = state.level;
    if (!code || !L.codes.includes(code)) { if (state.mode === 'name') closeCard(); return; }
    if (state.mode === 'place') placeAttempt(code, x, y);
    else selectCountry(code, x, y);
  }

  function selectCountry(code, x, y) {
    const c = COUNTRY_BY_CODE[code];
    if (G.status[code]) {
      const what = G.status[code] === 'named' ? 'named' : 'revealed';
      pop(x, y, `${flagHTML(code)} ${c.name} — already ${what}`, G.status[code] === 'named' ? 'good' : 'show');
      return;
    }
    state.selected = code;
    state.selectedAt = { x, y };
    state.attempts = 0;
    G.select(code);
    el.cardQuestion.hidden = false;
    el.cardAnswer.hidden = true;
    el.feedback.textContent = '';
    el.feedback.className = '';
    el.guessInput.value = '';
    el.card.hidden = false;
    updateSafe();
    el.guessInput.focus();
  }

  function closeCard() {
    el.card.hidden = true;
    state.selected = null;
    G.select(null);
    updateSafe();
  }

  function submitGuess(guess) {
    const code = state.selected;
    if (!code || !guess.trim()) return;
    const c = COUNTRY_BY_CODE[code];
    if (matchGuess(guess, code)) {
      G.status[code] = 'named';
      G.flash(code, 'flash-good', 900);
      pop(state.selectedAt.x, state.selectedAt.y, `✓ ${c.name}`, 'good');
      showAnswer('✓ Correct!', 'good', c);
      updateProgress();
      checkComplete();
    } else {
      state.attempts++;
      G.flash(code, 'flash-bad', 450);
      el.card.classList.remove('shake');
      void el.card.offsetWidth;
      el.card.classList.add('shake');
      el.feedback.textContent = state.attempts >= 3 ? 'Not quite — Reveal it?' : 'Not quite — try again!';
      el.feedback.className = 'bad';
      el.guessInput.select();
    }
  }

  function revealSelected() {
    const code = state.selected;
    if (!code) return;
    const c = COUNTRY_BY_CODE[code];
    G.status[code] = 'revealed';
    G.flash(code, 'flash-show', 1200);
    showAnswer('Revealed', 'meh', c);
    updateProgress();
    checkComplete();
  }

  function showAnswer(result, cls, c) {
    el.answerResult.textContent = result;
    el.answerResult.className = cls;
    el.answerName.innerHTML = `${flagHTML(c.code)}<span></span>`;
    el.answerName.querySelector('span').textContent = c.name;
    el.cardQuestion.hidden = true;
    el.cardAnswer.hidden = false;
    state.selected = null;
    G.select(null);
    updateSafe();
  }

  // ————— place mode —————

  function buildBank() {
    el.wordBank.hidden = false;
    el.wordBank.classList.add('collapsed');
    el.bankCollapse.innerHTML = icon('caret-up');
    el.bankChips.innerHTML = '';
    el.bankHint.textContent = '';
    el.bankHint.className = '';
    const pending = state.level.codes.filter(c => !G.status[c]).sort(() => Math.random() - 0.5);
    for (const code of pending) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.innerHTML = `${flagHTML(code)}<span></span>`;
      b.querySelector('span').textContent = COUNTRY_BY_CODE[code].name;
      b.dataset.code = code;
      b.addEventListener('click', () => armChip(code));
      el.bankChips.appendChild(b);
    }
    if (pending.length) armChip(pending[0]);
  }

  function armChip(code) {
    state.armed = code;
    state.strikes = 0;
    el.bankChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('armed', c.dataset.code === code));
    el.bankName.textContent = COUNTRY_BY_CODE[code].name;
    el.bankFlag.innerHTML = flagHTML(code);
    el.bankStrikes.textContent = '';
    el.bankHint.className = '';
    el.bankTarget?.classList.remove('switch');
  }

  function placeAttempt(code, x, y) {
    const name = COUNTRY_BY_CODE[code].name;
    if (G.status[code]) { pop(x, y, `${flagHTML(code)} <b>${name}</b> — already placed ✓`, 'good'); return; }
    if (!state.armed) return;
    if (state.armed === code) {
      G.status[code] = 'placed';
      G.flash(code, 'flash-good', 900);
      pop(x, y, `✓ ${name}`, 'good');
      el.bankChips.querySelector(`.chip[data-code="${code}"]`)?.remove();
      advanceTarget();
    } else {
      state.strikes++;
      el.bankStrikes.textContent = '✗'.repeat(state.strikes);
      G.flash(code, 'flash-bad', 450);
      if (state.strikes >= STRIKES) revealTarget(true);
      else {
        const left = STRIKES - state.strikes;
        el.bankHint.textContent = `That's not ${COUNTRY_BY_CODE[state.armed].name} — ${left} ${left === 1 ? 'try' : 'tries'} left before it's shown.`;
        el.bankHint.className = 'bad';
      }
    }
  }

  function revealTarget(auto = false) {
    const code = state.armed;
    if (!code) return;
    const name = COUNTRY_BY_CODE[code].name;
    G.status[code] = 'missed';
    const moved = ensureVisible(code);
    G.flash(code, 'flash-show', 1800);
    setTimeout(() => {
      const f = G.focus(code), p = G.project(f.lon, f.lat);
      pop(p.x, p.y, `${flagHTML(code)} ${name} is here`, 'show');
    }, moved ? 320 : 0);
    el.bankChips.querySelector(`.chip[data-code="${code}"]`)?.remove();
    advanceTarget(`${name} is flashing — ${auto ? 'three misses' : 'shown'}, so it counts as a miss.`);
  }

  function skipTarget() {
    if (state.mode !== 'place' || !state.armed) return;
    const chip = el.bankChips.querySelector(`.chip[data-code="${state.armed}"]`);
    if (!chip || el.bankChips.children.length < 2) return;
    el.bankChips.appendChild(chip);
    armChip(el.bankChips.querySelector('.chip').dataset.code);
  }

  function advanceTarget(msg = '') {
    state.armed = null;
    const next = el.bankChips.querySelector('.chip');
    if (next) armChip(next.dataset.code);
    else { el.bankName.textContent = 'All placed!'; el.bankFlag.innerHTML = ''; el.bankStrikes.textContent = ''; }
    el.bankHint.textContent = msg;
    el.bankHint.className = msg ? 'bad' : '';
    updateProgress();
    checkComplete();
  }

  // ————— wiring —————

  function boot() {
    G = window.GLOBE;
    buildGroups();
    G.onDraw((ctx) => drawButtons(ctx));
    G.onTap(tapButton);
    G.onHover(hoverButton);
    G.onCountry(onCountry);

    for (const b of el.jumpBar.querySelectorAll('button[data-key]')) {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => jumpTo(b.dataset.key, e.shiftKey));
    }
    el.progressWrap.addEventListener('click', () => {
      state.levelIx = (state.levelIx + 1) % LEVELS.length;
      startLevel(LEVELS[state.levelIx], state.mode);
    });
    el.levelMode.addEventListener('click', () => startLevel(LEVELS[state.levelIx], state.mode === 'place' ? 'name' : 'place'));

    el.guessForm.addEventListener('submit', (e) => { e.preventDefault(); submitGuess(el.guessInput.value); });
    el.revealBtn.addEventListener('click', revealSelected);
    el.cardClose.addEventListener('click', closeCard);
    el.bankSkip.addEventListener('click', skipTarget);
    el.bankShow.addEventListener('click', () => revealTarget(false));
    el.bankCollapse.addEventListener('click', () => {
      const collapsed = el.wordBank.classList.toggle('collapsed');
      el.bankCollapse.innerHTML = icon(collapsed ? 'caret-up' : 'caret-down');
      document.body.classList.toggle('bank-open', !collapsed);
    });
    for (const b of [el.bankSkip, el.bankShow, el.bankCollapse]) b.addEventListener('mousedown', (e) => e.preventDefault());

    // Whatever docks along the bottom changes what the globe has to itself.
    const chrome = new ResizeObserver(() => updateSafe());
    fetch('map/world-lo.json').then(r => r.json())
      .then(lo => drawMiniMap(lo, (id) => !!COUNTRY_BY_CODE[id])).catch(() => {});
    chrome.observe(el.card);
    chrome.observe(el.wordBank);
    chrome.observe(el.jumpBar);
    addEventListener('resize', () => setTimeout(updateSafe, 0));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeCard(); return; }
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'ArrowRight') { if (state.mode === 'place') { e.preventDefault(); skipTarget(); } return; }
      const k = e.key.toLowerCase();
      const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '')?.[1];
      const key = (k === '0' || JUMP_KEYS[k]) ? k : (digit && (digit === '0' || JUMP_KEYS[digit]) ? digit : null);
      if (key) { e.preventDefault(); jumpTo(key, e.shiftKey); }
    });

    window.GLOBE_PLAY = { state, LEVELS, startLevel, armChip, zoomToView, zoomToZone, fitBox, zoneOpenScale, SAFE, drawn: () => drawn, outlines: () => outlines, hot: () => hot };
    startLevel(LEVELS[0], 'place');
    markJumpKeys();
  }

  if (window.GLOBE) boot();
  else addEventListener('globe-ready', boot, { once: true });
})();
