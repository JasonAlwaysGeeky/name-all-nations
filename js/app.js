/* Name All Nations — click a country, name it (typed or spoken). */

(() => {
  'use strict';

  const PREFS_KEY = 'name-all-nations-v1';
  const STATS_KEY = 'name-all-nations-stats-v1';
  const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map(c => [c.code, c]));
  const REGIONS = [...new Set(COUNTRIES.map(c => c.region))];
  const WORLD_CODES = COUNTRIES.map(c => c.code);
  const CODES_BY_REGION = Object.fromEntries(REGIONS.map(r => [r, COUNTRIES.filter(c => c.region === r).map(c => c.code)]));

  // Every playable challenge, laid out in drill order: the whole world,
  // then each continent, then the bite-size regions nested inside it.
  const CHALLENGES = [{ id: 'world', name: 'The whole world', tier: 'world', codes: WORLD_CODES }];
  for (const region of REGIONS) {
    CHALLENGES.push({ id: 'cont:' + region, name: region, tier: 'continent', region, codes: CODES_BY_REGION[region] });
    for (const sub of SUBREGIONS.filter(s => s.region === region)) {
      CHALLENGES.push({ id: 'sub:' + sub.name, name: sub.name, tier: 'subregion', region: sub.region, codes: sub.codes.slice() });
    }
  }
  const CHALLENGE_BY_ID = Object.fromEntries(CHALLENGES.map(c => [c.id, c]));

  // ————— tuning —————
  const VIEW_MARGIN = 0.3;     // SVG is rendered this much larger than the viewport per side (matches CSS)
  const BAKE_IDLE = 90;        // ms of no view change before the crisp re-render
  const MAX_ZOOM = 60;
  const LOD_HI = 2.6;          // px per map unit above which the detailed coastlines are used…
  const LOD_LO = 2.2;          // …and below which the coarse ones come back (hysteresis)
  const BTN_R = 13;            // button radius, px
  const BTN_HIT = 18;          // invisible click radius around a button, px
  const TAIL_W = 6;            // half-width of a button's pointer where it leaves the circle, px
  const TAP_SLOP = { mouse: 5, pen: 5, touch: 9 };
  const STRIKES = 3;           // wrong placements before the answer is shown

  // Island nations drawn with a dotted outline per island group — the
  // Pacific ones, plus the Caribbean micro-islands so they get the same
  // look once you're zoomed into the arc.
  const ARCHIPELAGOS = new Set(['TV', 'FM', 'TO', 'MH', 'PW', 'KI', 'CV', 'KM', 'VU', 'BS', 'FJ', 'SB', 'ST', 'WS', 'TT', 'MV',
    'AG', 'KN', 'DM', 'LC', 'BB', 'VC', 'GD']);
  const ARCH_GAP = 45;         // map units between islands before they split into separate groups

  // Continent hotkeys run west → east across the map. Oceania has no
  // digit — the T zone frames it whole, so one hotkey is enough.
  const CONTINENT_KEYS = { 1: 'North America', 2: 'South America', 3: 'Europe', 4: 'Africa', 5: 'Asia' };
  const ZONE_BY_KEY = {};
  const ZONE_BY_CODE = {};
  for (const z of BUTTON_ZONES) {
    if (z.key) ZONE_BY_KEY[z.key] = z;
    for (const c of z.codes) ZONE_BY_CODE[c] = z;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ————— state —————
  const state = {
    status: {},          // code -> 'named' | 'revealed' | 'placed' | 'missed' (current challenge only)
    selected: null,      // currently selected country code (name mode)
    selectedAt: null,    // screen point it was clicked at
    level: null,         // active challenge
    hintLevel: 0,
    attempts: 0,
    micOn: false,
    seenIntro: false,
    prefs: { flags: true },
    heat: false,
  };
  let stats = { games: 0, byCode: {}, bests: {}, history: [] };

  // ————— text matching —————

  function normalize(s) {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')      // strip accents
      .replace(/[^a-z0-9]+/g, ' ')          // punctuation -> space
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^the /, '');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    const cur = new Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length];
  }

  // How many typos we forgive, by answer length. Short names get no
  // slack so Iran/Iraq and Niger/Nigeria can't blur together.
  function typoBudget(len) {
    if (len <= 4) return 0;
    if (len <= 6) return 1;
    if (len <= 11) return 2;
    return 3;
  }

  const ANSWERS = [];
  for (const c of COUNTRIES) {
    for (const raw of [c.name, ...c.aliases]) ANSWERS.push({ norm: normalize(raw), code: c.code });
  }

  // A guess is correct for `code` when that country is (one of) the
  // closest matches overall and within the typo budget.
  function matchGuess(guess, code) {
    const g = normalize(guess);
    if (!g) return false;
    let best = Infinity;
    const bestCodes = new Set();
    for (const a of ANSWERS) {
      const d = levenshtein(g, a.norm);
      if (d > typoBudget(a.norm.length)) continue;
      if (d < best) { best = d; bestCodes.clear(); }
      if (d <= best) bestCodes.add(a.code);
    }
    return bestCodes.has(code);
  }

  // ————— persistence —————

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ seenIntro: state.seenIntro, flags: state.prefs.flags }));
    } catch { /* private mode etc. */ }
  }

  function loadPrefs() {
    try {
      const d = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      state.seenIntro = !!d.seenIntro;
      if (typeof d.flags === 'boolean') state.prefs.flags = d.flags;
    } catch { /* corrupted — defaults */ }
  }

  function saveStats() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* ignore */ }
  }

  function loadStats() {
    try {
      const d = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
      if (d && d.byCode) stats = { games: d.games || 0, byCode: d.byCode, bests: d.bests || {}, history: d.history || [] };
    } catch { /* corrupted — start fresh */ }
  }

  // Per-country record for a mode: streak = consecutive clean answers
  // across every game you've played.
  function rec(code, mode) {
    const b = (stats.byCode[code] ||= {});
    return (b[mode] ||= { streak: 0, best: 0, right: 0, wrong: 0 });
  }

  function recordResult(code, ok) {
    const r = rec(code, state.level.mode);
    if (ok) { r.streak++; r.right++; r.best = Math.max(r.best, r.streak); }
    else { r.streak = 0; r.wrong++; }
    saveStats();
  }

  // First clean attempt decides the country's result for this game;
  // later attempts don't change it.
  function settle(code, ok) {
    const L = state.level;
    if (!L || L.result[code] !== undefined) return;
    L.result[code] = ok;
    recordResult(code, ok);
  }

  // ————— flags —————

  function flagHTML(code, cls = 'flag') {
    const cc = code.toLowerCase();
    return `<img class="${cls}" src="https://flagcdn.com/w40/${cc}.png" srcset="https://flagcdn.com/w80/${cc}.png 2x" alt="" loading="lazy" onerror="this.remove()">`;
  }

  // ————— speech (out) —————

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  // ————— speech (in) —————

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;

  function ensureRecognition() {
    if (recognition || !SpeechRec) return recognition;
    recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (!last.isFinal) return;
      const heard = last[0].transcript.trim();
      if (!heard || !state.selected) return;
      el.guessInput.value = heard;
      submitGuess(heard, true);
    };
    recognition.onend = () => {
      if (state.micOn && state.selected) startListening();
    };
    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        state.micOn = false;
        updateMicUI();
        setFeedback('Microphone access was blocked — check browser permissions.', 'bad');
      }
    };
    return recognition;
  }

  function startListening() {
    const r = ensureRecognition();
    if (!r) return;
    try { r.start(); } catch { /* already running */ }
  }

  function stopListening() {
    if (recognition) { try { recognition.stop(); } catch { /* not running */ } }
  }

  // ————— DOM —————

  const el = {};
  for (const id of [
    'map-wrap', 'map', 'tooltip', 'toast', 'progress-text', 'progress-fill', 'progress-wrap',
    'mic-toggle', 'zoom-in', 'zoom-out', 'zoom-reset', 'stats-btn', 'help-btn', 'jump-bar',
    'hello', 'hello-close', 'card', 'card-close', 'card-question',
    'card-prompt', 'guess-form', 'guess-input', 'mic-status', 'feedback',
    'hint-btn', 'reveal-btn', 'card-answer', 'answer-result', 'answer-name',
    'answer-meta', 'speak-btn', 'retry-btn', 'levels-btn', 'levels-panel', 'levels-close',
    'levels-list', 'level-banner', 'level-title', 'level-progress', 'level-timer', 'level-mode',
    'challenge-prev', 'challenge-next', 'level-restart',
    'word-bank', 'bank-target', 'bank-flag', 'bank-name', 'bank-strikes', 'bank-skip', 'bank-show', 'bank-collapse', 'bank-hint', 'bank-chips',
    'pause-timer', 'pause-veil',
    'results', 'results-close', 'results-title', 'results-sub', 'results-tiles', 'results-misses', 'results-again', 'results-mode', 'results-next', 'confetti',
    'stats-panel', 'stats-close', 'stat-tiles', 'heat-toggle', 'heat-mode-note', 'flags-toggle', 'best-times', 'region-mastery', 'stats-reset',
    'help', 'help-close',
  ]) {
    el[id.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = document.getElementById(id);
  }

  // ————— map setup —————

  let svg = null;
  let fullVB = null;              // { x, y, w, h } of the whole map
  const shapes = {};              // code -> country path
  const allPaths = {};            // id -> every map path (countries + territories)
  const bboxByCode = {};          // code -> getBBox() (countries + territories)
  const geom = {};                // code -> { anchor, boxes, groups? }
  const elemsByCode = {};         // code -> every map element mirroring status/selection
  let ovByCode = {};              // code -> overlay elements (rebuilt on every bake)
  let hitLayer = null;
  let overlayLayer = null;
  const dHi = {}, dLo = {};       // id -> path data at the two detail levels
  let lod = 'lo';

  function register(code, elem) {
    (elemsByCode[code] ||= []).push(elem);
  }

  const STATUS_CLASSES = ['named', 'revealed', 'placed', 'missed'];

  function allElems(code) {
    return [...(elemsByCode[code] || []), ...(ovByCode[code] || [])];
  }

  function applyStatus(code) {
    const st = state.status[code];
    for (const e of allElems(code)) {
      e.classList.remove(...STATUS_CLASSES);
      if (st) e.classList.add(st);
    }
  }

  function setSelectedClass(code, on) {
    for (const e of allElems(code)) e.classList.toggle('selected', on);
  }

  async function initMap() {
    const [svgText, lo] = await Promise.all([
      fetch('map/world.svg').then(r => r.text()),
      fetch('map/world-lo.json').then(r => r.json()).catch(() => null),
    ]);
    el.map.innerHTML = svgText;
    svg = el.map.querySelector('svg');
    svg.querySelectorAll('style').forEach(s => s.remove());
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.classList.add('world');

    // Antarctica blows up the Mercator bounding box (and isn't one of
    // the 195) — drop it, then fit the view to what's left.
    svg.querySelector('path#AQ')?.remove();

    for (const p of svg.querySelectorAll('path[id]')) {
      const code = p.id;
      p.classList.remove('land');
      allPaths[code] = p;
      dHi[code] = p.getAttribute('d');
      dLo[code] = (lo && lo[code]) || dHi[code];
      bboxByCode[code] = p.getBBox();
      if (COUNTRY_BY_CODE[code]) {
        p.classList.add('country');
        shapes[code] = p;
        register(code, p);
      } else {
        p.classList.add('territory');
      }
    }

    const bb = svg.getBBox();
    fullVB = { x: bb.x, y: bb.y, w: bb.width, h: bb.height };

    computeGeometry();
    buildHitLayer();
    overlayLayer = document.createElementNS(SVG_NS, 'g');
    overlayLayer.id = 'overlay-layer';
    svg.appendChild(overlayLayer);

    // Start on the coarse coastlines; bake() swaps levels as you zoom.
    for (const id of Object.keys(allPaths)) allPaths[id].setAttribute('d', dLo[id]);

    measure();
    setView({ ...fullVB });
    bindMapEvents();

    // A tab can load hidden (0x0 viewport) and be shown later; re-measure
    // and refit whenever the map's size actually changes.
    new ResizeObserver(() => {
      const w0 = W, h0 = H;
      measure();
      if (W === w0 && H === h0) return;
      if (!vb || !isFinite(vb.x + vb.y + vb.w + vb.h)) {
        if (W > 0 && H > 0) { base = null; setView({ ...fullVB }); }
        return;
      }
      dirty = true;
      setView({ ...vb });
      bake();
    }).observe(el.map);
  }

  // A country's bounding box lies about where it "is" when its islands
  // are scattered (Kiribati straddles the antimeridian). Anchor = centre
  // and size of the largest single landmass; archipelagos also get one
  // outline per island group.
  function computeGeometry() {
    const probe = document.createElementNS(SVG_NS, 'path');
    probe.setAttribute('visibility', 'hidden');
    svg.appendChild(probe);
    for (const code of Object.keys(shapes)) {
      const subs = shapes[code].getAttribute('d').split(/(?=M)/);
      const boxes = [];
      for (const sub of subs) {
        probe.setAttribute('d', sub);
        const b = probe.getBBox();
        if (subs.length > 1 && b.width * b.height < 1e-4) continue;
        boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height });
      }
      if (!boxes.length) {
        const b = bboxByCode[code];
        boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height });
      }
      let big = boxes[0];
      for (const b of boxes) if (b.w * b.h > big.w * big.h) big = b;
      const g = {
        anchor: { x: big.x + big.w / 2, y: big.y + big.h / 2, dim: Math.max(big.w, big.h), thin: Math.min(big.w, big.h) },
        boxes,
      };
      if (ARCHIPELAGOS.has(code)) g.groups = groupIslands(boxes);
      geom[code] = g;
    }
    probe.remove();
  }

  function groupIslands(boxes) {
    const parent = boxes.map((_, i) => i);
    const find = (i) => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const gap = (a, b) => Math.hypot(
      Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)),
      Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (gap(boxes[i], boxes[j]) <= ARCH_GAP) parent[find(i)] = find(j);
      }
    }
    const byRoot = {};
    boxes.forEach((b, i) => (byRoot[find(i)] ||= []).push(b));
    return Object.values(byRoot).map(list => {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const b of list) {
        x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
        x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
      }
      const pad = Math.max(1.4, Math.max(x2 - x1, y2 - y1) * 0.12);
      return { x: x1 - pad, y: y1 - pad, w: (x2 - x1) + 2 * pad, h: (y2 - y1) + 2 * pad };
    });
  }

  // A button earns its keep only while the country itself is too small
  // to click; past that it's clutter. Archipelagos drop theirs once the
  // dotted group outline is a big target of its own.
  function buttonRedundant(code, s) {
    const g = geom[code];
    if (g.groups) return focusPoint(code).dim * s >= 110;
    return g.anchor.dim * s >= 26 && g.anchor.thin * s >= 12;
  }

  // Zoom needed before this country's own button shows (zone layers and
  // the boxed-in micro-states).
  function minScaleFor(code) {
    let m = BUTTON_MIN_SCALE[code] || 0;
    const z = ZONE_BY_CODE[code];
    if (z) m = Math.max(m, z.minScale);
    return m;
  }

  // Where to look for a country: the biggest island group for
  // archipelagos, else the largest landmass.
  function focusPoint(code) {
    const g = geom[code];
    if (g.groups) {
      let best = g.groups[0];
      for (const b of g.groups) if (b.w * b.h > best.w * best.h) best = b;
      return { x: best.x + best.w / 2, y: best.y + best.h / 2, dim: Math.max(best.w, best.h) };
    }
    return g.anchor;
  }

  // Invisible click padding: a copy of every country outline with a fat
  // stroke, layered UNDER the visible map. Clicking land hits the visible
  // country; clicking just offshore falls through to the nearest padding
  // stroke. Small countries go last so they win over big neighbours.
  // The stroke is non-scaling, so it stays 12px at every zoom for free.
  function buildHitLayer() {
    hitLayer = document.createElementNS(SVG_NS, 'g');
    hitLayer.id = 'hit-layer';
    const order = Object.keys(shapes).sort((a, b) => {
      const A = bboxByCode[a], B = bboxByCode[b];
      return (B.width * B.height) - (A.width * A.height);
    });
    for (const code of order) {
      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', dLo[code]);
      hit.setAttribute('class', 'hit');
      hit.dataset.code = code;
      hitLayer.appendChild(hit);
    }
    const firstPath = svg.querySelector('path');
    firstPath.parentNode.insertBefore(hitLayer, firstPath);
  }

  // ————— view: GPU transform while moving, viewBox once settled —————
  //
  // Rewriting the viewBox re-rasterises every path, which is far too slow
  // to do per frame. Instead the SVG is drawn once (with a margin around
  // the viewport) and moved with a CSS transform during pans, zooms and
  // animations; when the view rests — or drifts past the margin — the
  // viewBox is rewritten ("baked") and the transform reset.

  let base = null;                // view the SVG was last rasterised for
  let vb = null;                  // logical current view
  let W = 0, H = 0, rectLeft = 0, rectTop = 0;
  let bakeTimer = null;
  let dirty = false;

  function measure() {
    const r = el.map.getBoundingClientRect();
    W = r.width; H = r.height; rectLeft = r.left; rectTop = r.top;
  }

  function scaleFor(v) {
    return Math.min(W / v.w, H / v.h);
  }

  function clampView(n) {
    const minW = fullVB.w / MAX_ZOOM;
    const w = Math.min(Math.max(n.w, minW), fullVB.w);
    const h = w * (fullVB.h / fullVB.w);
    const mx = fullVB.w * 0.05, my = fullVB.h * 0.05;
    return {
      x: Math.min(Math.max(n.x, fullVB.x - mx), fullVB.x + fullVB.w + mx - w),
      y: Math.min(Math.max(n.y, fullVB.y - my), fullVB.y + fullVB.h + my - h),
      w, h,
    };
  }

  function setView(next) {
    next = clampView(next);
    if (!isFinite(next.x + next.y + next.w + next.h)) return;   // never let a bad fit poison the view
    vb = next;
    if (!base) { bake(); return; }
    const sb = scaleFor(base), s = scaleFor(vb), k = s / sb;
    const ox = (W - base.w * sb) / 2, oy = (H - base.h * sb) / 2;
    const tx = ox * (1 - k) + k * sb * (base.x - vb.x);
    const ty = oy * (1 - k) + k * sb * (base.y - vb.y);
    svg.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    dirty = true;
    // Panned past the pre-rendered margin (bare edges would show) or
    // zoomed far from the baked raster (mush) — re-render right away.
    const lim = VIEW_MARGIN * Math.min(k, 1) * 0.92;
    if (Math.abs(tx) > W * lim || Math.abs(ty) > H * lim || k < 0.75 || k > 3.2) bake();
    else scheduleBake();
  }

  function scheduleBake(delay = BAKE_IDLE) {
    clearTimeout(bakeTimer);
    bakeTimer = setTimeout(bake, delay);
  }

  function bake() {
    clearTimeout(bakeTimer);
    bakeTimer = null;
    if (!dirty && base) return;
    dirty = false;
    base = { ...vb };
    const s = scaleFor(vb);
    // Coarse coastlines when zoomed out (a third of the points to
    // rasterise), full detail once you're in close.
    const want = s > LOD_HI ? 'hi' : s < LOD_LO ? 'lo' : lod;
    if (want !== lod) {
      lod = want;
      const src = lod === 'hi' ? dHi : dLo;
      for (const id of Object.keys(allPaths)) allPaths[id].setAttribute('d', src[id]);
    }
    const m = VIEW_MARGIN;
    svg.setAttribute('viewBox', `${vb.x - m * vb.w} ${vb.y - m * vb.h} ${vb.w * (1 + 2 * m)} ${vb.h * (1 + 2 * m)}`);
    svg.style.transform = '';
    updateOverlay();
  }

  function clientToMap(cx, cy) {
    const s = scaleFor(vb);
    const ox = (W - vb.w * s) / 2, oy = (H - vb.h * s) / 2;
    return { x: vb.x + (cx - rectLeft - ox) / s, y: vb.y + (cy - rectTop - oy) / s, s };
  }

  function mapToScreen(px, py) {
    const s = scaleFor(vb);
    const ox = (W - vb.w * s) / 2, oy = (H - vb.h * s) / 2;
    return { x: ox + (px - vb.x) * s, y: oy + (py - vb.y) * s };
  }

  // ————— animations —————

  let animId = null;
  const zoomAnim = { active: false, targetW: 0, ax: 0, ay: 0, cx: 0, cy: 0, last: 0 };

  function cancelAnim() {
    if (animId) cancelAnimationFrame(animId);
    animId = null;
    zoomAnim.active = false;
  }

  function animateView(target, ms = 260) {
    cancelAnim();
    const from = { ...vb };
    const to = clampView(target);
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setView({
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        w: from.w + (to.w - from.w) * e,
        h: from.h + (to.h - from.h) * e,
      });
      if (k < 1) animId = requestAnimationFrame(step);
      else { animId = null; bake(); }
    };
    step();
  }

  // Wheel / button zoom: each input nudges a target width; the view
  // chases it with a short exponential ease, anchored under the cursor.
  function zoomTowards(clientX, clientY, factor) {
    const pt = clientToMap(clientX, clientY);
    if (!zoomAnim.active) zoomAnim.targetW = vb.w;
    zoomAnim.targetW = clampView({ x: vb.x, y: vb.y, w: zoomAnim.targetW * factor }).w;
    zoomAnim.ax = pt.x; zoomAnim.ay = pt.y;
    zoomAnim.cx = clientX; zoomAnim.cy = clientY;
    if (!zoomAnim.active) {
      if (animId) cancelAnimationFrame(animId);
      animId = null;
      zoomAnim.active = true;
      zoomAnim.last = performance.now();
      requestAnimationFrame(zoomStep);
    }
  }

  function zoomStep(now) {
    if (!zoomAnim.active) return;
    const dt = Math.min(50, now - zoomAnim.last);
    zoomAnim.last = now;
    const a = 1 - Math.exp(-dt / 55);
    let w = vb.w + (zoomAnim.targetW - vb.w) * a;
    const done = Math.abs(w - zoomAnim.targetW) / zoomAnim.targetW < 0.002;
    if (done) w = zoomAnim.targetW;
    const h = w * (fullVB.h / fullVB.w);
    const s = Math.min(W / w, H / h);
    const ox = (W - w * s) / 2, oy = (H - h * s) / 2;
    setView({
      x: zoomAnim.ax - (zoomAnim.cx - rectLeft - ox) / s,
      y: zoomAnim.ay - (zoomAnim.cy - rectTop - oy) / s,
      w, h,
    });
    if (done) { zoomAnim.active = false; scheduleBake(); }
    else requestAnimationFrame(zoomStep);
  }

  function zoomAtClient(cx, cy, factor) {
    const pt = clientToMap(cx, cy);
    const w = vb.w * factor;
    const k = w / vb.w;
    setView({ x: pt.x - (pt.x - vb.x) * k, y: pt.y - (pt.y - vb.y) * k, w, h: vb.h * k });
  }

  function fitCodes(codes) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    // A giant country only pulls the frame up to 30 units past its core:
    // a continent view should frame the playable mass, not drag half a
    // screen of empty Arctic in because Canada technically reaches it.
    const CAP = codes.length > 1 ? 22 : Infinity;
    for (const code of codes) {
      const g = geom[code];
      if (!g) continue;
      // Russia's bbox reaches the Pacific; fitting it would turn the
      // Europe view into the whole world. It's still in the challenge.
      if (code === 'RU' && codes.length > 1) continue;
      const parts = g.groups || [{ x: g.anchor.x - g.anchor.dim / 2, y: g.anchor.y - g.anchor.dim / 2, w: g.anchor.dim, h: g.anchor.dim }];
      for (const b of parts) {
        // Kiribati's far-flung groups would force a whole-map view; only
        // the region's centre of mass matters for a multi-country zoom.
        if (codes.length > 1 && g.groups && b !== g.groups[0] && Math.abs(b.x - g.groups[0].x) > 200) continue;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const hw = Math.min(Math.max(b.w, 1) / 2, CAP), hh = Math.min(Math.max(b.h, 1) / 2, CAP);
        x1 = Math.min(x1, cx - hw); y1 = Math.min(y1, cy - hh);
        x2 = Math.max(x2, cx + hw); y2 = Math.max(y2, cy + hh);
      }
    }
    return x1 === Infinity ? null : { x1, y1, x2, y2 };
  }

  // Fit tight — the play area should fill the screen — with a fixed
  // screen allowance so offset buttons and their tails stay inside.
  function zoomToCodes(codes, ms = 260, padFactor = 1.08) {
    if (codes.length === WORLD_CODES.length) { animateView({ ...fullVB }, ms); return; }
    const f = fitCodes(codes);
    if (!f) return;
    const w = f.x2 - f.x1, h = f.y2 - f.y1;
    const aspect = fullVB.h / fullVB.w;
    let tw = Math.max(w * padFactor, h * padFactor / aspect, fullVB.w / MAX_ZOOM * 2);
    if (W > 400) tw *= W / (W - 110);           // room for buttons and tails
    animateView({ x: f.x1 + w / 2 - tw / 2, y: f.y1 + h / 2 - (tw * aspect) / 2, w: tw, h: tw * aspect }, ms);
  }

  // Zoom to a layer where the zone's buttons are clickable.
  function zoomToZone(z, ms = 240) {
    if (!z) return;
    const f = fitCodes(z.codes);
    if (!f) return;
    const w = f.x2 - f.x1, h = f.y2 - f.y1;
    const aspect = fullVB.h / fullVB.w;
    const K = Math.min(W, H / aspect);          // scale = K / tw
    let tw = Math.max(w * 1.1, h * 1.1 / aspect);
    if (W > 400) tw *= W / (W - 110);           // room for buttons and tails
    if (K > 0) tw = Math.min(tw, K / (z.minScale * 1.1));  // at least clickable-layer zoom
    tw = Math.max(tw, fullVB.w / MAX_ZOOM * 2);
    animateView({ x: f.x1 + w / 2 - tw / 2, y: f.y1 + h / 2 - (tw * aspect) / 2, w: tw, h: tw * aspect }, ms);
  }

  // Pan (and zoom in if needed) so a country is comfortably on screen.
  function ensureVisible(code) {
    const f = focusPoint(code);
    const s = scaleFor(vb);
    const pad = 0.12;
    const inside = f.x > vb.x + vb.w * pad && f.x < vb.x + vb.w * (1 - pad) &&
                   f.y > vb.y + vb.h * pad && f.y < vb.y + vb.h * (1 - pad);
    const hasButton = BUTTON_OFFSETS[code] && s >= minScaleFor(code);
    if (inside && (f.dim * s >= 6 || hasButton)) return false;
    const aspect = fullVB.h / fullVB.w;
    let w = vb.w;
    if (f.dim * s < 6 && !hasButton) w = Math.min(vb.w, Math.max(f.dim * 10, fullVB.w / 10));
    animateView({ x: f.x - w / 2, y: f.y - (w * aspect) / 2, w, h: w * aspect }, 300);
    return true;
  }

  // ————— overlay: island outlines & buttons —————

  const activeFlash = new Map();   // code -> Set of flash classes in progress

  function updateOverlay() {
    if (!overlayLayer || !vb) return;
    overlayLayer.textContent = '';
    ovByCode = {};
    const s = scaleFor(vb);
    if (!isFinite(s) || s <= 0) return;         // hidden viewport — rebuilt on resize
    const codes = state.level ? state.level.codes : WORLD_CODES;

    const decorate = (elem, code) => {
      elem.dataset.code = code;
      (ovByCode[code] ||= []).push(elem);
      if (state.status[code]) elem.classList.add(state.status[code]);
      if (state.selected === code) elem.classList.add('selected');
      for (const cls of activeFlash.get(code) || []) elem.classList.add(cls);
    };

    // Dotted outline around each island group — a rounded box for a
    // compact nation, an ellipse for the pieces of a split one (Kiribati
    // either side of the antimeridian) so the two halves read as a pair.
    for (const code of codes) {
      const g = geom[code];
      if (!g?.groups) continue;
      for (const b of g.groups) {
        if (Math.max(b.w, b.h) * s < 12) continue;
        const grp = document.createElementNS(SVG_NS, 'g');
        grp.setAttribute('class', 'ov-box');
        let shape;
        if (g.groups.length > 1) {
          shape = document.createElementNS(SVG_NS, 'ellipse');
          shape.setAttribute('cx', b.x + b.w / 2); shape.setAttribute('cy', b.y + b.h / 2);
          shape.setAttribute('rx', b.w * 0.72); shape.setAttribute('ry', b.h * 0.72);
        } else {
          shape = document.createElementNS(SVG_NS, 'rect');
          shape.setAttribute('x', b.x); shape.setAttribute('y', b.y);
          shape.setAttribute('width', b.w); shape.setAttribute('height', b.h);
          shape.setAttribute('rx', Math.min(b.w, b.h) * 0.3);
        }
        grp.appendChild(shape);
        decorate(grp, code);
        overlayLayer.appendChild(grp);
      }
    }

    // Zoom layers: below a zone's minScale its buttons collapse into one
    // numbered button that zooms to where they're clickable.
    const grouped = new Set();
    for (const z of BUTTON_ZONES) {
      const members = z.codes.filter(c => codes.includes(c) && BUTTON_OFFSETS[c] && geom[c] && !buttonRedundant(c, s));
      if (s >= z.minScale || members.length < 2) continue;
      for (const c of members) grouped.add(c);
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'btn zone');
      g.dataset.zone = z.name;
      g.dataset.codes = members.join(',');
      const face = document.createElementNS(SVG_NS, 'circle');
      face.setAttribute('class', 'face');
      face.setAttribute('cx', z.at[0]); face.setAttribute('cy', z.at[1]);
      face.setAttribute('r', (BTN_R + 3) / s);
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', z.at[0]); t.setAttribute('y', z.at[1]);
      t.setAttribute('font-size', 13 / s);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      t.textContent = members.length;
      const zpad = document.createElementNS(SVG_NS, 'circle');
      zpad.setAttribute('class', 'pad');
      zpad.setAttribute('cx', z.at[0]); zpad.setAttribute('cy', z.at[1]);
      zpad.setAttribute('r', (BTN_HIT + 4) / s);
      g.appendChild(face); g.appendChild(t); g.appendChild(zpad);
      overlayLayer.appendChild(g);
    }

    // Buttons: fixed screen size and offset, so they never cover the
    // shape they point at, and gone once the country is big enough to
    // click for itself.
    const items = [];
    for (const code of codes) {
      const off = BUTTON_OFFSETS[code];
      if (!off || !geom[code] || grouped.has(code) || s < (BUTTON_MIN_SCALE[code] || 0) || buttonRedundant(code, s)) continue;
      const f = focusPoint(code);
      items.push({ code, fx: f.x, fy: f.y, x: f.x + off[0] / s, y: f.y + off[1] / s, offset: Math.hypot(off[0], off[1]) });
    }
    // Two buttons closer than their own width (tiny window, far zoomed
    // out) merge into one numbered button that zooms in on the pair.
    const parent = items.map((_, i) => i);
    const find = (i) => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const limit = (2 * BTN_R + 2) / s;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) < limit) parent[find(i)] = find(j);
      }
    }
    const groups = {};
    items.forEach((it, i) => (groups[find(i)] ||= []).push(it));

    for (const group of Object.values(groups)) {
      const g = document.createElementNS(SVG_NS, 'g');
      if (group.length === 1) {
        const it = group[0];
        g.setAttribute('class', 'btn');
        // Pointer: a wedge from the circle to the country, unless the
        // country is already under the button.
        const d = Math.hypot(it.fx - it.x, it.fy - it.y);
        if (it.offset > 0 && d * s > BTN_R + 3) {
          const ux = (it.fx - it.x) / d, uy = (it.fy - it.y) / d;
          const w = TAIL_W / s;
          const tail = document.createElementNS(SVG_NS, 'path');
          tail.setAttribute('class', 'tail');
          tail.setAttribute('d', `M${it.x - uy * w},${it.y + ux * w} L${it.fx},${it.fy} L${it.x + uy * w},${it.y - ux * w} Z`);
          g.appendChild(tail);
        }
        const face = document.createElementNS(SVG_NS, 'circle');
        face.setAttribute('class', 'face');
        face.setAttribute('cx', it.x); face.setAttribute('cy', it.y);
        face.setAttribute('r', BTN_R / s);
        g.appendChild(face);
        const pad = document.createElementNS(SVG_NS, 'circle');
        pad.setAttribute('class', 'pad');
        pad.setAttribute('cx', it.x); pad.setAttribute('cy', it.y);
        pad.setAttribute('r', BTN_HIT / s);
        g.appendChild(pad);
        decorate(g, it.code);
      } else {
        const cx = group.reduce((t, m) => t + m.x, 0) / group.length;
        const cy = group.reduce((t, m) => t + m.y, 0) / group.length;
        g.setAttribute('class', 'btn group');
        g.dataset.codes = group.map(m => m.code).join(',');
        const face = document.createElementNS(SVG_NS, 'circle');
        face.setAttribute('class', 'face');
        face.setAttribute('cx', cx); face.setAttribute('cy', cy);
        face.setAttribute('r', (BTN_R + 2) / s);
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', cx); t.setAttribute('y', cy);
        t.setAttribute('font-size', 13 / s);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('dominant-baseline', 'central');
        t.textContent = group.length;
        const pad = document.createElementNS(SVG_NS, 'circle');
        pad.setAttribute('class', 'pad');
        pad.setAttribute('cx', cx); pad.setAttribute('cy', cy);
        pad.setAttribute('r', BTN_HIT / s);
        g.appendChild(face); g.appendChild(t); g.appendChild(pad);
      }
      overlayLayer.appendChild(g);
    }
  }

  function flash(code, cls, ms) {
    const set = activeFlash.get(code) || new Set();
    set.add(cls);
    activeFlash.set(code, set);
    const elems = allElems(code);
    for (const e of elems) e.classList.remove(cls);
    void el.map.offsetWidth;              // reflow so a repeat flash restarts its animation
    for (const e of elems) e.classList.add(cls);
    setTimeout(() => {
      set.delete(cls);
      if (!set.size) activeFlash.delete(code);
      for (const e of allElems(code)) e.classList.remove(cls);
    }, ms);
  }

  // Floating "✓ Kiribati" that rises from a screen point and fades.
  function popAt(pt, html, cls) {
    const d = document.createElement('div');
    d.className = 'pop ' + cls;
    d.innerHTML = html;
    d.style.left = `${Math.min(Math.max(pt.x, 60), W - 60)}px`;
    d.style.top = `${Math.min(Math.max(pt.y, 40), H - 10)}px`;
    el.mapWrap.appendChild(d);
    setTimeout(() => d.remove(), 1150);
  }

  let toastTimer = null;
  function showToast(html, pt, ms = 2200) {
    el.toast.innerHTML = html;
    el.toast.hidden = false;
    const half = Math.min(el.toast.offsetWidth / 2 + 8, W / 2);
    el.toast.style.left = `${Math.min(Math.max(pt.x, half), W - half)}px`;
    el.toast.style.top = `${Math.min(Math.max(pt.y, 50), H - 10)}px`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  // ————— pointer input —————

  function handleTarget(target, pt) {
    if (state.level?.pausedAt != null) return;
    const zg = target.closest('g.btn.zone');
    if (zg) {
      zoomToZone(BUTTON_ZONES.find(z => z.name === zg.dataset.zone));
      return;
    }
    const grp = target.closest('g.btn.group');
    if (grp) {
      zoomToCodes(grp.dataset.codes.split(','), 260, 3);
      return;
    }
    const code = target.dataset.code || target.id;
    const L = state.level;
    if (!L) return;
    if (COUNTRY_BY_CODE[code]) {
      if (!L.codes.includes(code)) return;
      if (L.mode === 'place') placeAttempt(code, pt);
      else selectCountry(code, pt);
    } else if (TERRITORIES[code]) {
      // Territories never count, but you can still tap them to learn what
      // they are (except when a focused challenge has faded them out).
      if (L.codes.length < WORLD_CODES.length) return;
      const [name, rest] = TERRITORIES[code].split(' (');
      showToast(`<b>${name}</b> — ${rest ? rest.replace(/\)$/, '') : 'territory'} · not one of the 195`, pt);
    }
  }

  function bindMapEvents() {
    el.map.addEventListener('wheel', (e) => {
      e.preventDefault();
      // ~0.8× per notch, finer for trackpads; ctrl+wheel is a pinch.
      const f = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
      zoomTowards(e.clientX, e.clientY, f);
    }, { passive: false });

    // Pointer-based pan + pinch. A press that moves less than TAP_SLOP
    // is a tap on the element under the initial pointerdown — we can't
    // rely on the click event because setPointerCapture retargets it.
    const pointers = new Map();
    let down = null;
    let panning = false;
    let pinch = null;

    el.map.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancelAnim();
      try { el.map.setPointerCapture(e.pointerId); } catch { /* synthetic / stale pointer */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        panning = false;
        down = { x: e.clientX, y: e.clientY, vb: { ...vb }, target: e.target, type: e.pointerType };
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), vbw: vb.w };
        panning = true;
      }
    });

    el.map.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) { updateTooltip(e); return; }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1 && down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!panning && Math.hypot(dx, dy) > (TAP_SLOP[down.type] || 6)) {
          panning = true;
          el.map.classList.add('panning');
          el.tooltip.hidden = true;
        }
        if (panning) {
          const s = scaleFor(down.vb);
          setView({ x: down.vb.x - dx / s, y: down.vb.y - dy / s, w: down.vb.w, h: down.vb.h });
        }
      } else if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist > 0) {
          zoomAtClient((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.dist / dist) * (pinch.vbw / vb.w));
        }
      }
      if (!panning) updateTooltip(e);
    });

    const endPointer = (e) => {
      const wasTap = e.type === 'pointerup' && pointers.size === 1 && !panning && down;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        el.map.classList.remove('panning');
        if (panning) bake();
        panning = false;
      }
      if (wasTap) {
        const target = down.target.closest?.('[data-code], path[id], g.btn');
        if (target) handleTarget(target, { x: e.clientX - rectLeft, y: e.clientY - rectTop });
      }
      if (pointers.size === 0) down = null;
    };
    el.map.addEventListener('pointerup', endPointer);
    el.map.addEventListener('pointercancel', endPointer);
    el.map.addEventListener('pointerleave', () => { el.tooltip.hidden = true; });
  }

  // ————— tooltip (hover, desktop) —————

  function updateTooltip(e) {
    if (e.pointerType !== 'mouse') return;
    const target = e.target.closest?.('[data-code], path[id], g.btn');
    let text = null;
    if (target?.closest('g.btn.zone')) {
      const zg2 = target.closest('g.btn.zone');
      text = `${zg2.dataset.zone} — ${zg2.dataset.codes.split(',').length} small countries · click to zoom in`;
    } else if (target?.closest('g.btn.group')) {
      const n = target.closest('g.btn.group').dataset.codes.split(',').length;
      text = `${n} small countries — click to zoom in`;
    } else if (target) {
      const code = target.dataset.code || target.id;
      const L = state.level;
      const c = COUNTRY_BY_CODE[code];
      if (c) {
        if (L && !L.codes.includes(code)) text = null;
        else if (state.heat) {
          const r = stats.byCode[code]?.[L?.mode === 'place' ? 'place' : 'name'];
          text = `${c.name} · ${r ? `${r.streak} in a row` : 'not tried yet'}`;
        }
        else if (state.status[code]) text = `${c.name} ✓`;
        else text = L?.mode === 'place' ? null : 'Click to name this country';
      } else if (TERRITORIES[code] && (!L || L.codes.length === WORLD_CODES.length)) {
        text = TERRITORIES[code];
      }
    }
    if (!text) { el.tooltip.hidden = true; return; }
    el.tooltip.textContent = text;
    el.tooltip.style.left = `${e.clientX - rectLeft}px`;
    el.tooltip.style.top = `${e.clientY - rectTop}px`;
    el.tooltip.hidden = false;
  }

  // ————— selection & guessing (name mode) —————

  function selectCountry(code, pt) {
    ensureTimer();
    if (state.selected) setSelectedClass(state.selected, false);
    state.selected = code;
    state.selectedAt = pt;
    state.hintLevel = 0;
    state.attempts = 0;
    setSelectedClass(code, true);
    el.helloClose.click();
    closePanels();
    el.card.hidden = false;

    const done = state.status[code];
    if (done) {
      showAnswerPane(done === 'named' ? '✓ Already named — no penalty' : 'Revealed earlier — name it yourself to turn it green',
        done === 'named' ? 'good' : 'meh');
    } else {
      el.cardQuestion.hidden = false;
      el.cardAnswer.hidden = true;
      el.cardPrompt.textContent = 'What country is this?';
      el.guessInput.value = '';
      setFeedback('', '');
      el.micStatus.hidden = !state.micOn;
      if (state.micOn) startListening();
      el.guessInput.focus();
    }
  }

  function showAnswerPane(resultText, resultClass) {
    const c = COUNTRY_BY_CODE[state.selected];
    el.cardQuestion.hidden = true;
    el.cardAnswer.hidden = false;
    el.answerResult.textContent = resultText;
    el.answerResult.className = resultClass;
    el.answerName.innerHTML = `${flagHTML(c.code)}<span></span>`;
    el.answerName.querySelector('span').textContent = c.name;
    el.answerMeta.textContent = c.region;
    el.speakBtn.hidden = false;
    el.retryBtn.hidden = state.status[state.selected] !== 'revealed';
  }

  function deselect() {
    if (state.selected) setSelectedClass(state.selected, false);
    state.selected = null;
    el.card.hidden = true;
    stopListening();
  }

  function setFeedback(msg, cls) {
    el.feedback.textContent = msg;
    el.feedback.className = cls;
  }

  function setStatus(code, st) {
    state.status[code] = st;
    applyStatus(code);
    updateProgress();
    updateLevelUI();
  }

  function submitGuess(guess, viaVoice = false) {
    if (state.level?.pausedAt != null) return;
    ensureTimer();
    const code = state.selected;
    if (!code || state.status[code] === 'named') return;
    if (!guess.trim()) return;
    const c = COUNTRY_BY_CODE[code];

    if (matchGuess(guess, code)) {
      settle(code, true);
      setStatus(code, 'named');
      flash(code, 'flash-good', 900);
      popAt(state.selectedAt || mapToScreen(focusPoint(code).x, focusPoint(code).y), `✓ ${c.name}`, 'good');
      showAnswerPane('✓ Correct!', 'good');
      checkComplete();
    } else {
      settle(code, false);
      state.attempts++;
      el.card.classList.remove('shake');
      void el.card.offsetWidth;             // restart the animation
      el.card.classList.add('shake');
      const msg = viaVoice
        ? `I heard “${guess}” — not this one. Try again!`
        : state.attempts >= 3
          ? 'Not quite — need a 💡 hint, or Reveal it?'
          : 'Not quite — try again!';
      setFeedback(msg, 'bad');
      el.guessInput.select();
    }
  }

  function giveHint() {
    const c = COUNTRY_BY_CODE[state.selected];
    if (!c) return;
    ensureTimer();
    settle(c.code, false);
    state.hintLevel++;
    const name = c.name;
    const words = name.split(' ').length;
    if (state.hintLevel === 1) {
      const shape = words > 1 ? `${words} words` : `${name.length} letters`;
      setFeedback(`Starts with “${name[0]}” · ${shape} · ${c.region}`, 'hint');
    } else {
      const reveal = Math.min(2 + state.hintLevel, Math.ceil(name.length / 2));
      setFeedback(`“${name.slice(0, reveal)}…”`, 'hint');
    }
  }

  function revealAnswer() {
    const code = state.selected;
    if (!code || state.status[code] === 'named') return;
    settle(code, false);
    if (state.status[code] !== 'revealed') setStatus(code, 'revealed');
    showAnswerPane('Revealed — name it yourself later to turn it green', 'meh');
    checkComplete();
  }

  // ————— progress —————

  function updateProgress() {
    const L = state.level;
    const codes = L ? L.codes : WORLD_CODES;
    const want = L?.mode === 'place' ? 'placed' : 'named';
    const n = codes.filter(c => state.status[c] === want).length;
    el.progressText.textContent = `${n} / ${codes.length}`;
    el.progressFill.style.width = `${(n / codes.length) * 100}%`;
  }

  // ————— timer —————

  let timerId = null;

  function fmtTime(ms) {
    const t = Math.max(0, ms);
    const m = Math.floor(t / 60000), s = Math.floor((t % 60000) / 1000), d = Math.floor((t % 1000) / 100);
    return `${m}:${String(s).padStart(2, '0')}.${d}`;
  }

  function renderTimer() {
    const L = state.level;
    if (!L) return;
    const ms = L.done ? L.elapsed
      : L.t0 == null ? 0
      : (L.pausedAt != null ? L.pausedAt : performance.now()) - L.t0;
    el.levelTimer.textContent = fmtTime(ms);
  }

  // The clock starts on your first move, not when the challenge loads.
  function ensureTimer() {
    const L = state.level;
    if (L && !L.done && L.t0 == null) L.t0 = performance.now();
  }

  // Pause stops the clock but also hides the map — no scouting for free.
  function togglePause() {
    const L = state.level;
    if (!L || L.done || L.t0 == null) return;
    if (L.pausedAt == null) {
      L.pausedAt = performance.now();
      el.pauseVeil.hidden = false;
      el.pauseTimer.textContent = '▶';
      if (document.activeElement?.blur) document.activeElement.blur();
    } else {
      L.t0 += performance.now() - L.pausedAt;
      L.pausedAt = null;
      el.pauseVeil.hidden = true;
      el.pauseTimer.textContent = '⏸';
    }
    renderTimer();
  }

  function startTimer() {
    clearInterval(timerId);
    timerId = setInterval(renderTimer, 100);
    renderTimer();
  }

  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
    renderTimer();
  }

  // ————— challenges —————

  function currentIndex() {
    return state.level ? CHALLENGES.findIndex(c => c.id === state.level.id) : 0;
  }

  function stepChallenge(delta) {
    const i = currentIndex();
    const n = ((i + delta) % CHALLENGES.length + CHALLENGES.length) % CHALLENGES.length;
    startLevel(CHALLENGES[n], state.level?.mode || 'name');
  }

  function startLevel(def, mode = 'name') {
    clearLevelClasses();
    const wasMarked = Object.keys(state.status);
    state.status = {};
    for (const code of wasMarked) applyStatus(code);
    if (state.heat) { state.heat = false; applyHeat(); }

    state.level = {
      id: def.id, name: def.name, tier: def.tier, region: def.region,
      codes: def.codes.slice(), mode,
      armed: null, strikes: 0, result: {},
      t0: null, pausedAt: null, elapsed: 0, done: false,
    };
    deselect();
    closePanels();
    el.hello.hidden = true;   // boot re-shows the intro afterwards if unseen

    // The whole-world challenge covers everything, so nothing dims; a
    // smaller challenge fades the rest of the map back.
    const isSubset = state.level.codes.length < WORLD_CODES.length;
    document.body.classList.toggle('level-active', isSubset);
    for (const code of state.level.codes) {
      for (const e of elemsByCode[code] || []) e.classList.add('in-level');
    }
    updateOverlay();
    zoomToCodes(state.level.codes);
    el.levelBanner.hidden = false;
    el.pauseVeil.hidden = true;
    el.pauseTimer.textContent = '⏸';
    if (mode === 'place') buildBank();
    else el.wordBank.hidden = true;
    updateLevelUI();
    updateProgress();
    startTimer();
  }

  function clearLevelClasses() {
    document.querySelectorAll('.in-level').forEach(e => e.classList.remove('in-level'));
  }

  function updateLevelUI() {
    const L = state.level;
    if (!L) return;
    const total = L.codes.length;
    const icon = L.tier === 'world' ? '🌍' : L.tier === 'continent' ? '🗺️' : '📍';
    el.levelTitle.textContent = `${icon} ${L.name}`;
    if (L.mode === 'place') {
      const done = L.codes.filter(c => state.status[c]).length;
      el.levelProgress.textContent = done === total ? '🎉 all placed!' : `${done} / ${total} placed`;
      el.levelMode.textContent = '✏️ Name mode';
    } else {
      const named = L.codes.filter(c => state.status[c] === 'named').length;
      el.levelProgress.textContent = named === total ? '🏆 complete!' : `${named} / ${total} named`;
      el.levelMode.textContent = '🧩 Place mode';
    }
  }

  function checkComplete() {
    const L = state.level;
    if (!L || L.done) return;
    if (L.codes.every(c => state.status[c])) finishLevel();
  }

  // ————— place mode —————

  function buildBank() {
    const L = state.level;
    el.wordBank.hidden = false;
    // Start folded — the list blocks the map otherwise; ▾ opens it.
    el.wordBank.classList.add('collapsed');
    el.bankCollapse.textContent = '▴';
    el.bankChips.innerHTML = '';
    el.bankHint.className = '';
    const pending = L.codes.filter(c => !state.status[c]).sort(() => Math.random() - 0.5);
    for (const code of pending) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.innerHTML = `${flagHTML(code)}<span></span>`;
      b.querySelector('span').textContent = COUNTRY_BY_CODE[code].name;
      b.dataset.code = code;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { armChip(code); setBankHint(`Now find ${COUNTRY_BY_CODE[code].name}.`, ''); });
      el.bankChips.appendChild(b);
    }
    if (pending.length) {
      setBankHint('Click where it is on the map · Space skips · three misses shows you.', '');
      armChip(pending[0]);
    } else {
      el.bankName.textContent = 'All placed!';
      el.bankFlag.innerHTML = '';
    }
  }

  function setBankHint(msg, cls) {
    el.bankHint.textContent = msg;
    el.bankHint.className = cls;
  }

  function armChip(code) {
    const L = state.level;
    if (!L) return;
    L.armed = code;
    L.strikes = 0;
    el.bankChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('armed', c.dataset.code === code));
    el.bankChips.querySelector('.chip.armed')?.scrollIntoView({ block: 'nearest' });
    el.bankFlag.innerHTML = flagHTML(code);
    el.bankName.textContent = COUNTRY_BY_CODE[code].name;
    el.bankStrikes.textContent = '';
    // Make the switch unmissable — the whole target row pulses.
    el.bankTarget.classList.remove('switch');
    void el.bankTarget.offsetWidth;
    el.bankTarget.classList.add('switch');
  }

  function skipTarget() {
    const L = state.level;
    if (!L || L.mode !== 'place' || !L.armed || L.pausedAt != null) return;
    ensureTimer();
    const chip = el.bankChips.querySelector(`.chip[data-code="${L.armed}"]`);
    if (!chip || el.bankChips.children.length < 2) return;
    const skipped = COUNTRY_BY_CODE[L.armed].name;
    el.bankChips.appendChild(chip);
    const next = el.bankChips.querySelector('.chip').dataset.code;
    armChip(next);
    setBankHint(`Skipped ${skipped} (it's back at the end of the list) → now find ${COUNTRY_BY_CODE[next].name}.`, '');
  }

  function placeAttempt(code, pt) {
    ensureTimer();
    const L = state.level;
    const name = COUNTRY_BY_CODE[code].name;
    if (state.status[code]) {
      showToast(`${flagHTML(code)} <b>${name}</b> — already placed ✓ (no penalty)`, pt, 1600);
      return;
    }
    if (!L.armed) return;
    const target = COUNTRY_BY_CODE[L.armed].name;

    if (L.armed === code) {
      settle(code, true);
      setStatus(code, 'placed');
      flash(code, 'flash-good', 900);
      popAt(pt, `✓ ${name}`, 'good');
      el.bankChips.querySelector(`.chip[data-code="${code}"]`)?.remove();
      advanceTarget(`✓ ${name}`, 'good');
    } else {
      settle(L.armed, false);
      L.strikes++;
      el.bankStrikes.textContent = '✗'.repeat(L.strikes);
      flash(code, 'flash-bad', 450);
      const chip = el.bankChips.querySelector(`.chip[data-code="${L.armed}"]`);
      if (chip) { chip.classList.remove('shake-x'); void chip.offsetWidth; chip.classList.add('shake-x'); }
      if (L.strikes >= STRIKES) revealTarget(true);
      else {
        const left = STRIKES - L.strikes;
        setBankHint(`That's not ${target} — ${left} ${left === 1 ? 'try' : 'tries'} left before it's shown.`, 'bad');
      }
    }
  }

  // Show where the current target is (three misses, or 👁 Show me). It
  // turns orange and counts as a miss, then the next name comes up.
  function revealTarget(auto = false) {
    const L = state.level;
    const code = L?.armed;
    if (!code || L.pausedAt != null) return;
    ensureTimer();
    const name = COUNTRY_BY_CODE[code].name;
    settle(code, false);
    setStatus(code, 'missed');
    const moved = ensureVisible(code);
    flash(code, 'flash-show', 1800);
    const f = focusPoint(code);
    setTimeout(() => popAt(mapToScreen(f.x, f.y), `${flagHTML(code)} ${name} is here`, 'show'), moved ? 320 : 0);
    el.bankChips.querySelector(`.chip[data-code="${code}"]`)?.remove();
    advanceTarget(`${name} is flashing — ${auto ? 'three misses' : 'shown'}, so it counts as a miss.`, 'bad');
  }

  function advanceTarget(msg, cls) {
    const L = state.level;
    L.armed = null;
    const next = el.bankChips.querySelector('.chip');
    if (next) {
      armChip(next.dataset.code);
      setBankHint(`${msg} → now find ${COUNTRY_BY_CODE[next.dataset.code].name}.`, cls);
    } else {
      el.bankName.textContent = 'All placed!';
      el.bankFlag.innerHTML = '';
      el.bankStrikes.textContent = '';
      setBankHint(msg, cls);
    }
    updateLevelUI();
    checkComplete();
  }

  // ————— finishing a challenge —————

  function finishLevel() {
    const L = state.level;
    L.done = true;
    L.elapsed = L.t0 == null ? 0 : (L.pausedAt != null ? L.pausedAt : performance.now()) - L.t0;
    L.pausedAt = null;
    el.pauseVeil.hidden = true;
    el.pauseTimer.textContent = '⏸';
    stopTimer();
    const total = L.codes.length;
    const clean = L.codes.filter(c => L.result[c] === true).length;
    const key = `${L.id}|${L.mode}`;
    const prev = stats.bests[key] || {};
    const newFast = !prev.ms || L.elapsed < prev.ms;
    const isClean = clean === total;
    const newClean = isClean && (!prev.clean || L.elapsed < prev.clean);
    const newAcc = clean > (prev.acc || 0);
    stats.bests[key] = {
      ms: newFast ? L.elapsed : prev.ms,
      clean: newClean ? L.elapsed : (prev.clean || null),
      acc: Math.max(prev.acc || 0, clean),
    };
    stats.games++;
    stats.history.unshift({ id: L.id, mode: L.mode, ms: L.elapsed, clean, total, at: Date.now() });
    stats.history.length = Math.min(stats.history.length, 50);
    saveStats();
    deselect();
    showResults({ prev, newFast, newClean, newAcc, clean, total, isClean });
    confetti();
  }

  function showResults({ prev, newFast, newClean, newAcc, clean, total, isClean }) {
    const L = state.level;
    el.resultsTitle.textContent = `${L.name} — complete!`;
    el.resultsSub.textContent = L.mode === 'place' ? 'Place mode' : 'Name mode';
    const pct = Math.round((clean / total) * 100);
    const tile = (label, value, sub, record) =>
      `<div class="tile${record ? ' record' : ''}"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`;
    el.resultsTiles.innerHTML =
      tile('⏱ Time', fmtTime(L.elapsed), newFast ? (prev.ms ? '🎉 New best!' : 'First finish') : `best ${fmtTime(prev.ms)}`, newFast && prev.ms) +
      tile('🎯 First try', `${clean}/${total}`, newAcc ? (prev.acc ? `🎉 Best yet (${pct}%)` : `${pct}%`) : `${pct}% · best ${prev.acc}`, newAcc && prev.acc) +
      tile('✨ Clean run', isClean ? fmtTime(L.elapsed) : '—', isClean
        ? (newClean ? (prev.clean ? '🎉 New clean best!' : 'Flawless!') : `best ${fmtTime(prev.clean)}`)
        : (prev.clean ? `best ${fmtTime(prev.clean)}` : 'all first-try to set one'), isClean && newClean);

    const misses = L.codes.filter(c => L.result[c] !== true);
    if (misses.length) {
      el.resultsMisses.innerHTML = `<h3>Missed (${misses.length}) — click one to see it</h3><div class="chips"></div>`;
      const box = el.resultsMisses.querySelector('.chips');
      for (const code of misses) {
        const b = document.createElement('button');
        b.className = 'chip';
        b.innerHTML = `${flagHTML(code)}<span></span>`;
        b.querySelector('span').textContent = COUNTRY_BY_CODE[code].name;
        b.addEventListener('click', () => { el.results.hidden = true; zoomToCodes([code]); });
        box.appendChild(b);
      }
    } else {
      el.resultsMisses.innerHTML = `<p class="clean">✨ Every single one on the first try.</p>`;
    }
    el.resultsMode.textContent = L.mode === 'place' ? '✏️ Now name them' : '🧩 Place mode';
    el.results.hidden = false;
  }

  function confetti() {
    const c = el.confetti;
    c.width = W; c.height = H;
    c.hidden = false;
    const ctx = c.getContext('2d');
    const colors = ['#ff5e5b', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#8338ec', '#fb5607', '#ffffff'];
    const P = Array.from({ length: 190 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.4, y: H * 0.4,
      vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 5,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      col: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    const step = (now) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(0, Math.min(1, 3.4 - t));
      for (const p of P) {
        p.vy += 0.32; p.x += p.vx; p.y += p.vy; p.vx *= 0.985; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.col;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (t < 3.5) requestAnimationFrame(step);
      else { ctx.clearRect(0, 0, W, H); c.hidden = true; }
    };
    requestAnimationFrame(step);
  }

  // ————— stats panel & heat map —————

  function bestFor(id, mode) {
    return stats.bests[`${id}|${mode}`];
  }

  function openStats() {
    deselect();
    closePanels();
    const names = COUNTRIES.map(c => stats.byCode[c.code]?.name).filter(Boolean);
    const places = COUNTRIES.map(c => stats.byCode[c.code]?.place).filter(Boolean);
    const mastered = names.filter(r => r.streak >= 3).length;
    const acc = (rs) => { const r = rs.reduce((a, x) => a + x.right, 0), w = rs.reduce((a, x) => a + x.wrong, 0); return r + w ? `${Math.round(100 * r / (r + w))}%` : '—'; };
    const tile = (label, value, sub) =>
      `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`;
    el.statTiles.innerHTML =
      tile('Games', stats.games, 'finished') +
      tile('Mastered', `${mastered}`, `of 195 · 3+ in a row`) +
      tile('Naming', acc(names), 'first-try accuracy') +
      tile('Placing', acc(places), 'first-try accuracy');

    const mode = state.level?.mode === 'place' ? 'place' : 'name';
    el.heatModeNote.textContent = `Showing ${mode} mode. Turns off when you start a challenge.`;
    el.heatToggle.checked = state.heat;
    el.flagsToggle.checked = state.prefs.flags;

    const rows = CHALLENGES.filter(c => bestFor(c.id, 'name') || bestFor(c.id, 'place'));
    el.bestTimes.innerHTML = rows.length ? '' : '<p class="empty-note">Finish a challenge to set a time.</p>';
    for (const c of rows) {
      const row = document.createElement('div');
      row.className = 'best-row';
      const parts = [];
      for (const m of ['name', 'place']) {
        const b = bestFor(c.id, m);
        if (!b) continue;
        parts.push(`${m === 'name' ? '✏️' : '🧩'} <b>${fmtTime(b.ms)}</b>${b.clean ? ` · clean ${fmtTime(b.clean)}` : ''} · ${b.acc}/${c.codes.length}`);
      }
      row.innerHTML = `<span class="best-name"></span><span class="best-t">${parts.join(' &nbsp; ')}</span>`;
      row.querySelector('.best-name').textContent = c.name;
      el.bestTimes.appendChild(row);
    }

    el.regionMastery.innerHTML = '';
    for (const region of REGIONS) {
      const codes = CODES_BY_REGION[region];
      const n = codes.filter(code => (stats.byCode[code]?.name?.streak || 0) >= 3).length;
      const row = document.createElement('div');
      row.className = 'mastery-row';
      row.innerHTML = `<span class="m-name"></span><span class="m-bar"><span class="m-fill" style="width:${(100 * n / codes.length).toFixed(0)}%"></span></span><span class="m-n">${n} / ${codes.length}</span>`;
      row.querySelector('.m-name').textContent = region;
      el.regionMastery.appendChild(row);
    }
    el.statsPanel.hidden = false;
  }

  function applyHeat() {
    document.body.classList.toggle('heatmap', state.heat);
    const mode = state.level?.mode === 'place' ? 'place' : 'name';
    for (const code of Object.keys(shapes)) {
      const p = shapes[code];
      p.classList.remove('heat-x', 'heat-0', 'heat-1', 'heat-2', 'heat-3', 'heat-4');
      if (!state.heat) continue;
      const r = stats.byCode[code]?.[mode];
      const bin = !r ? 'x' : r.streak >= 5 ? 4 : r.streak >= 3 ? 3 : r.streak;
      p.classList.add('heat-' + bin);
    }
  }

  // ————— levels panel —————

  function challengeRow(def, { big = false, place = false } = {}) {
    const active = state.level?.id === def.id;
    const row = document.createElement('div');
    row.className = 'level-row' + (big ? ' level-row-big' : '') + (active ? ' active' : '');
    const bn = bestFor(def.id, 'name'), bp = bestFor(def.id, 'place');
    const best = [bn && `✏️ ${fmtTime(bn.ms)}`, bp && `🧩 ${fmtTime(bp.ms)}`].filter(Boolean).join(' · ');
    row.innerHTML =
      `<span class="level-name"></span>` +
      (best ? `<span class="level-best">${best}</span>` : '') +
      `<span class="level-count">${def.codes.length}</span>` +
      `<span class="level-actions">` +
      (place ? `<button class="level-place">Place</button>` : '') +
      `<button class="level-play">Name</button>` +
      `</span>`;
    row.querySelector('.level-name').textContent = def.name;
    const play = () => startLevel(def, 'name');
    row.querySelector('.level-play').addEventListener('click', (e) => { e.stopPropagation(); play(); });
    if (place) row.querySelector('.level-place').addEventListener('click', (e) => { e.stopPropagation(); startLevel(def, 'place'); });
    row.addEventListener('click', play);
    return row;
  }

  function openLevels() {
    deselect();
    closePanels();
    el.levelsList.innerHTML = '';

    const worldHeader = document.createElement('div');
    worldHeader.className = 'level-region';
    worldHeader.textContent = 'The big one';
    el.levelsList.appendChild(worldHeader);
    el.levelsList.appendChild(challengeRow(CHALLENGE_BY_ID.world, { big: true, place: true }));

    for (const region of REGIONS) {
      const header = document.createElement('div');
      header.className = 'level-region';
      header.textContent = region;
      el.levelsList.appendChild(header);
      el.levelsList.appendChild(challengeRow(CHALLENGE_BY_ID['cont:' + region], { big: true, place: true }));
      for (const sub of SUBREGIONS.filter(s => s.region === region)) {
        el.levelsList.appendChild(challengeRow(CHALLENGE_BY_ID['sub:' + sub.name], { place: true }));
      }
    }
    el.levelsPanel.hidden = false;
  }

  function closePanels() {
    el.levelsPanel.hidden = true;
    el.statsPanel.hidden = true;
    el.help.hidden = true;
    el.results.hidden = true;
  }

  // ————— UI wiring —————

  function updateMicUI() {
    el.micToggle.classList.toggle('listening', state.micOn);
    el.micToggle.classList.toggle('off', !state.micOn);
    el.micStatus.hidden = !(state.micOn && state.selected && !state.status[state.selected]);
  }

  el.helloClose.addEventListener('click', () => {
    el.hello.hidden = true;
    if (!state.seenIntro) { state.seenIntro = true; savePrefs(); }
  });

  el.guessForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitGuess(el.guessInput.value);
  });

  el.hintBtn.addEventListener('click', giveHint);
  el.revealBtn.addEventListener('click', revealAnswer);
  el.cardClose.addEventListener('click', deselect);
  el.speakBtn.addEventListener('click', () => {
    if (state.selected) speak(COUNTRY_BY_CODE[state.selected].name);
  });

  el.retryBtn.addEventListener('click', () => {
    if (!state.selected || state.status[state.selected] !== 'revealed') return;
    el.cardQuestion.hidden = false;
    el.cardAnswer.hidden = true;
    el.cardPrompt.textContent = 'What country is this?';
    el.guessInput.value = '';
    setFeedback('', '');
    el.guessInput.focus();
  });

  const toggleLevels = () => {
    if (el.levelsPanel.hidden) openLevels();
    else el.levelsPanel.hidden = true;
  };
  el.levelsBtn.addEventListener('click', toggleLevels);
  el.progressWrap.addEventListener('click', toggleLevels);
  el.levelsClose.addEventListener('click', () => { el.levelsPanel.hidden = true; });

  el.statsBtn.addEventListener('click', () => { if (el.statsPanel.hidden) openStats(); else el.statsPanel.hidden = true; });
  el.statsClose.addEventListener('click', () => { el.statsPanel.hidden = true; });
  el.heatToggle.addEventListener('change', () => { state.heat = el.heatToggle.checked; applyHeat(); });
  el.flagsToggle.addEventListener('change', () => {
    state.prefs.flags = el.flagsToggle.checked;
    document.body.classList.toggle('no-flags', !state.prefs.flags);
    savePrefs();
  });
  el.statsReset.addEventListener('click', () => {
    if (!confirm('Reset every streak, best time and accuracy stat?')) return;
    stats = { games: 0, byCode: {}, bests: {}, history: [] };
    saveStats();
    if (state.heat) applyHeat();
    openStats();
  });

  const toggleHelp = () => { const was = el.help.hidden; closePanels(); el.help.hidden = !was; };
  el.helpBtn.addEventListener('click', toggleHelp);
  el.helpClose.addEventListener('click', () => { el.help.hidden = true; });

  el.pauseTimer.addEventListener('click', () => togglePause());
  el.pauseVeil.addEventListener('click', () => togglePause());
  document.addEventListener('visibilitychange', () => {
    const L = state.level;
    if (document.hidden && L && !L.done && L.t0 != null && L.pausedAt == null) togglePause();
  });

  el.challengePrev.addEventListener('click', () => stepChallenge(-1));
  el.challengeNext.addEventListener('click', () => stepChallenge(1));
  el.levelRestart.addEventListener('click', () => {
    const L = state.level;
    if (L) startLevel(CHALLENGE_BY_ID[L.id], L.mode);
  });
  el.levelMode.addEventListener('click', () => {
    const L = state.level;
    if (!L) return;
    startLevel(CHALLENGE_BY_ID[L.id], L.mode === 'place' ? 'name' : 'place');
  });

  for (const b of [el.bankSkip, el.bankShow, el.bankCollapse]) b.addEventListener('mousedown', (e) => e.preventDefault());
  el.bankSkip.addEventListener('click', skipTarget);
  el.bankShow.addEventListener('click', () => revealTarget(false));
  el.bankCollapse.addEventListener('click', () => {
    const collapsed = el.wordBank.classList.toggle('collapsed');
    el.bankCollapse.textContent = collapsed ? '▴' : '▾';
  });

  el.resultsClose.addEventListener('click', () => { el.results.hidden = true; });
  el.resultsAgain.addEventListener('click', () => { const L = state.level; startLevel(CHALLENGE_BY_ID[L.id], L.mode); });
  el.resultsNext.addEventListener('click', () => stepChallenge(1));
  el.resultsMode.addEventListener('click', () => { const L = state.level; startLevel(CHALLENGE_BY_ID[L.id], L.mode === 'place' ? 'name' : 'place'); });

  el.micToggle.addEventListener('click', () => {
    if (!SpeechRec) {
      alert('Voice input is not supported in this browser — try Chrome or Edge. You can still type the names!');
      return;
    }
    state.micOn = !state.micOn;
    if (state.micOn && state.selected) startListening();
    if (!state.micOn) stopListening();
    updateMicUI();
  });

  el.zoomIn.addEventListener('click', () => zoomTowards(rectLeft + W / 2, rectTop + H / 2, 0.6));
  el.zoomOut.addEventListener('click', () => zoomTowards(rectLeft + W / 2, rectTop + H / 2, 1 / 0.6));
  el.zoomReset.addEventListener('click', () => animateView({ ...fullVB }));

  // Jump bar / hotkeys: three zoom layers. 0 = the world, digits 1-6 =
  // continents (west to east), letters = the dense areas that need a
  // layer of their own; anything deeper is scroll and drag.
  const jumpTo = (key) => {
    if (!vb) return;
    if (key === 'q') key = '2';                 // Q doubles as South America (pairs with W, its Caribbean)
    if (key === '0') { animateView({ ...fullVB }, 220); return; }
    if (ZONE_BY_KEY[key]) { zoomToZone(ZONE_BY_KEY[key], 220); return; }
    if (CONTINENT_KEYS[key]) zoomToCodes(CODES_BY_REGION[CONTINENT_KEYS[key]], 220);
  };
  for (const b of el.jumpBar.querySelectorAll('button')) {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => jumpTo(b.dataset.key));
  }

  document.addEventListener('keydown', (e) => {
    if (state.level?.pausedAt != null) {
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); togglePause(); }
      return;
    }
    if (e.key === 'Escape') { deselect(); closePanels(); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;     // don't hijack typing
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!vb) return;
    const L = state.level;
    if (e.key === '[') { e.preventDefault(); stepChallenge(-1); }
    else if (e.key === ']') { e.preventDefault(); stepChallenge(1); }
    else if (e.key === ' ' || e.key === 'ArrowRight') {
      if (L?.mode === 'place' && L.armed) { e.preventDefault(); skipTarget(); }
    }
    else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePause(); }
    else if (e.key === '?') { e.preventDefault(); toggleHelp(); }
    else if (e.key === '0' || e.key.toLowerCase() === 'q' || CONTINENT_KEYS[e.key] || ZONE_BY_KEY[e.key.toLowerCase()]) {
      e.preventDefault();
      jumpTo(CONTINENT_KEYS[e.key] || e.key === '0' ? e.key : e.key.toLowerCase());
    }
  });

  window.addEventListener('resize', () => {
    if (!vb) return;
    measure();
    dirty = true;
    setView({ ...vb });
    bake();
  });

  // ————— boot —————

  // Read-only hooks for testing from the console.
  window.NAN_DEBUG = { state, geom, view: () => vb, base: () => base, stats: () => stats, lod: () => lod };

  loadPrefs();
  loadStats();
  document.body.classList.toggle('no-flags', !state.prefs.flags);
  updateProgress();
  el.micToggle.classList.add('off');
  el.hello.hidden = true;

  initMap().then(() => {
    startLevel(CHALLENGE_BY_ID.world, 'name');
    el.hello.hidden = state.seenIntro;
  }).catch((err) => {
    el.map.innerHTML = `<p style="padding:2rem">Could not load the map (${err.message}). If you opened index.html directly, run it through a local web server instead.</p>`;
  });
})();
