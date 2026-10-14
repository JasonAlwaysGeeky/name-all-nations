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
  const LOD_FULL_HI = 8.5;     // …and above which the untouched full-detail borders swap in
  const LOD_FULL_LO = 7;       // (with their own hysteresis band on the way back out)
  const ANIM_BAKE_GAP = 80;    // min ms between mid-animation re-renders (2-3 per transition)
  const BTN_R = 18;            // button radius, px
  const BTN_HIT = 25;          // invisible click radius around a button, px
  const BTN_MERGE = 34;        // two buttons closer than this merge into one numbered button, px
  const BTN_LOCK = 5;          // px per map unit past which a button holds its place on the map
  const BTN_TAIL_MAX = 88;     // …until its pointer would outgrow this, px
  const TAIL_W = 8;            // half-width of a button's pointer where it leaves the circle, px
  const TAP_SLOP = { mouse: 5, pen: 8, touch: 10 };
  // Flick momentum. A touch pan that ends while moving keeps gliding, its
  // speed decaying by e every FLING_TAU ms — so a flick travels roughly
  // v0 * FLING_TAU px. Shorter than a map app's (~325ms) on purpose: this
  // is a game, and the map should settle where you threw it, not drift.
  const FLING_TAU = 190;       // ms; momentum decay time constant
  const FLING_MIN = 0.02;      // px/ms below which the glide stops
  const FLING_MAX = 5;         // px/ms cap on the launch speed
  const FLING_WINDOW = 90;     // ms of recent movement the launch speed is measured over
  const STRIKES = 3;           // wrong placements before the answer is shown

  const ZONE_BY_CODE = {};
  for (const z of BUTTON_ZONES) {
    for (const c of z.codes) ZONE_BY_CODE[c] = z;
  }
  const ZONE_BY_NAME = Object.fromEntries(BUTTON_ZONES.map(z => [z.name, z]));
  const SUB_CODES = Object.fromEntries(SUBREGIONS.map(x => [x.name, x.codes]));
  const SUBREGION_BY_CODE = {};
  for (const sub of SUBREGIONS) for (const c of sub.codes) SUBREGION_BY_CODE[c] = sub.name;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // What you do to a nation, in the words of the device you are holding.
  const TAP = matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click';

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
    seenFs: false,       // the full-screen chip has drawn attention to itself once
    prefs: { flags: true },
    heat: false,
  };
  let stats = { games: 0, byCode: {}, bests: {}, history: [] };

  // Text matching — normalize, bestMatches, matchGuess — lives in
  // js/names.js, shared with the globe.

  // ————— persistence —————

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ seenIntro: state.seenIntro, flags: state.prefs.flags, seenFs: state.seenFs }));
    } catch { /* private mode etc. */ }
  }

  function loadPrefs() {
    try {
      const d = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      state.seenIntro = !!d.seenIntro;
      state.seenFs = !!d.seenFs;
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

  // Two skills are kept score of: naming a nation and finding it. Hardcore
  // is naming with the net taken away, so its answers are naming answers —
  // filed on their own they fed neither the heat map nor mastery.
  function recordResult(code, ok) {
    const r = rec(code, state.level.mode === 'place' ? 'place' : 'name');
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

  // The flags ship with the game (flags/, from flag-icons): they used to
  // come from a CDN, and any host that will not fetch from it — an
  // artifact sandbox, a phone offline — showed no flags at all. SVG, so
  // one file is every size.
  function flagHTML(code, cls = 'flag') {
    return `<img class="${cls}" src="flags/${code.toLowerCase()}.svg" alt="" loading="lazy" onerror="this.remove()">`;
  }

  // An icon from the sprite (icons/ph.svg, built by tools/gen-icons.mjs).
  function icon(name) {
    return `<svg class="ic" aria-hidden="true"><use href="icons/ph.svg#${name}"/></svg>`;
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
  let micErrors = 0;                    // consecutive failures since the last result
  let heardSound = false;               // whether any session ever detected sound
  const MIC_HINT = 'listening… just say the nation’s name';

  // Selection clicks build an ordered queue of countries; the transcript is
  // parsed against that queue in the background, fuzzy-matching each queued
  // name in sequence. Nothing depends on where the transcript had gotten to
  // when a click happened, so the player never waits on the recognizer.
  const voiceQueue = [];                // ordered {code, state: 'open'|'eager'|'done'}
  let voiceBuf = [];                    // final transcript words not yet consumed
  let tickerText = '';

  function voiceWords(t) { return t.trim() ? t.trim().split(/\s+/) : []; }

  // Of the recognizer's ranked guesses, the first one that contains a
  // country name — otherwise its own favourite. The recognizer ranks by
  // plausible English, so its favourite is the one most likely to be a
  // common word that happens to sound like the country you said.
  function pickAlternative(res) {
    const n = Math.min(res.length || 1, 5);
    for (let i = 0; i < n; i++) {
      const words = voiceWords(res[i].transcript);
      if (words.length && containsCountry(words)) return res[i].transcript;
    }
    return res[0].transcript;
  }

  function voicePush(code) {
    if (!state.micOn || !code || state.status[code] === 'named') return;
    // Re-clicking a country that's already waiting shouldn't double it up.
    for (let i = voiceQueue.length - 1; i >= 0; i--) {
      if (voiceQueue[i].state === 'done') break;
      if (voiceQueue[i].code === code) return;
    }
    voiceQueue.push({ code, state: 'open' });
    updateTicker();
  }

  // Does any window of these words sound like some country's name?
  // Audio that doesn't clear this bar never counts as a submission.
  function containsCountry(words) {
    for (let start = 0; start < words.length; start++) {
      for (let len = Math.min(6, words.length - start); len >= 1; len--) {
        if (bestMatches(words.slice(start, start + len).join(' '), true).size) return true;
      }
    }
    return false;
  }

  // Find `code`'s name somewhere near words[from..]: a few words of leading
  // noise are allowed, and windows are tried longest-first so multi-word
  // names ("papua new guinea") beat their own fragments.
  function findVoiceMatch(words, from, code) {
    const lastStart = Math.min(from + 4, words.length - 1);
    for (let start = from; start <= lastStart; start++) {
      for (let len = Math.min(6, words.length - start); len >= 1; len--) {
        if (matchGuess(words.slice(start, start + len).join(' '), code, true)) return { start, end: start + len };
      }
    }
    return null;
  }

  // Walk the queue in order against the words we have. A committed pass
  // (final transcript) consumes words, resolves skipped countries, and
  // surfaces wrong attempts; an eager pass (interims) only banks correct
  // answers so they pop the moment the words show up.
  function alignVoice(extra, commit) {
    if (state.level?.pausedAt != null) return;
    const words = commit ? voiceBuf : voiceBuf.concat(extra);
    let pos = 0;
    let skipped = [];                   // open slots passed over without a match
    for (const slot of voiceQueue) {
      if (slot.state === 'done') continue;
      const m = findVoiceMatch(words, pos, slot.code);
      if (m) {
        if (commit && skipped.length) {
          // Later country matched first — the ones in between never got a
          // recognizable answer. If the stray words sound like some (wrong)
          // country, that's a real miss for the first of them; anything else
          // was noise, and they all just stay unanswered on the map.
          const noise = words.slice(pos, m.start);
          if (noise.length && containsCountry(noise)) gradeVoiceGuess(noise.join(' '), skipped[0].code);
          for (const s of skipped) s.state = 'done';
          skipped = [];
        }
        if (slot.state === 'open') gradeVoiceGuess(words.slice(m.start, m.end).join(' '), slot.code);
        slot.state = commit ? 'done' : 'eager';
        pos = m.end;
      } else if (slot.state === 'eager') {
        if (commit) slot.state = 'done';   // graded from an interim the final revised away
      } else if (commit) {
        skipped.push(slot);
      }
    }
    if (!commit) { updateTicker(); return; }
    voiceBuf = words.slice(pos);
    while (voiceQueue.length && voiceQueue[0].state === 'done') voiceQueue.shift();
    // Leftover words with only the on-screen country still waiting: if they
    // sound like some (wrong) country, that's a real miss. Otherwise no
    // penalty — keep the words, since the next final may complete a
    // half-heard name ("papua new" + "guinea").
    const first = voiceQueue.find(s => s.state === 'open');
    if (voiceBuf.length && first && first.code === state.selected) {
      if (containsCountry(voiceBuf)) {
        gradeVoiceGuess(voiceBuf.join(' '), first.code);
        voiceBuf = [];
      } else {
        setFeedback(`Heard “${voiceBuf.join(' ')}” — not a nation’s name, no penalty. Say it again?`, 'hint');
      }
    }
    if (voiceBuf.length > 8) voiceBuf = voiceBuf.slice(-8);
    updateTicker();
  }

  function updateTicker(text) {
    if (text != null) tickerText = text.trim();
    if (!el.micStatusText) return;
    const waiting = voiceQueue.filter(s => s.state === 'open').length;
    const shown = tickerText.length > 34 ? '…' + tickerText.slice(-34) : tickerText;
    el.micStatusText.textContent = (shown ? `“${shown}…”` : MIC_HINT) + (waiting > 1 ? `  ·  ${waiting} to grade` : '');
  }

  // ————— mic level meter —————
  // The recognizer doesn't expose audio levels, so a second capture of the
  // same mic drives a little VU meter next to the guess box — live proof
  // the mic is hearing you, independent of transcription.

  let meterStream = null, meterCtx = null, meterRAF = 0;
  // getUserMedia resolves long after the toggle that asked for it, so the
  // "already running" guard can't just be `meterStream` — that's still null
  // while a capture is in flight. Every start claims a token; a stop, or a
  // later start, bumps it. A capture that lands after its moment has passed
  // shuts itself down instead of overwriting a live one and leaking a hot
  // mic (the browser's recording dot stays lit) plus an orphan rAF loop.
  let meterGen = 0, meterPending = false;

  async function startMeter() {
    if (meterStream || meterPending || !navigator.mediaDevices?.getUserMedia) return;
    const gen = ++meterGen;
    meterPending = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (gen === meterGen) meterPending = false;
      return;                           // no meter, but recognition still works
    }
    if (gen !== meterGen || !state.micOn) {       // stopped while we waited
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    meterPending = false;
    meterStream = stream;
    meterCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = meterCtx.createAnalyser();
    analyser.fftSize = 512;
    meterCtx.createMediaStreamSource(meterStream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
      el.voiceMeter.style.setProperty('--vol', Math.min(1, Math.sqrt(sum / buf.length) * 4).toFixed(3));
      meterRAF = requestAnimationFrame(tick);
    };
    meterRAF = requestAnimationFrame(tick);
  }

  function stopMeter() {
    meterGen++;                         // orphans any capture still in flight
    meterPending = false;
    cancelAnimationFrame(meterRAF);
    if (meterStream) for (const t of meterStream.getTracks()) t.stop();
    if (meterCtx) meterCtx.close();
    meterStream = null; meterCtx = null; meterRAF = 0;
    el.voiceMeter?.style.setProperty('--vol', 0);
  }

  function gradeVoiceGuess(heard, code) {
    if (code === state.selected) {
      el.guessInput.value = heard;
      submitGuess(heard, true);
      return;
    }
    // Player has already moved on — settle this one quietly on the map.
    if (state.status[code] === 'named' || state.level?.pausedAt != null) return;
    const c = COUNTRY_BY_CODE[code];
    const pt = mapToScreen(focusPoint(code).x, focusPoint(code).y);
    if (matchGuess(heard, code, true)) {
      settle(code, true);
      setStatus(code, 'named');
      flash(code, 'flash-good', 900);
      popAt(pt, `✓ ${c.name}`, 'good');
      checkComplete();
    } else {
      settle(code, false);
      flash(code, 'flash-bad', 450);
      popAt(pt, `✗ “${heard.replace(/[<>&]/g, '')}”`, 'bad');
    }
  }

  function ensureRecognition() {
    if (recognition || !SpeechRec) return recognition;
    recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    // Interim results tell us when an utterance *began*, which is what lets
    // each one be pinned to the country that was selected at that moment.
    recognition.interimResults = true;
    // The recognizer ranks its guesses by what makes an English sentence,
    // which is not the job here: asked for one answer it returns
    // "everybody" and keeps Kiribati in second place. Asked for five, the
    // country is usually in the list, and pickAlternative below takes the
    // one that actually contains country names.
    recognition.maxAlternatives = 5;
    // The staged status line doubles as a mic diagnostic: if it never gets
    // past "waiting for sound", the browser is capturing a silent device.
    recognition.onstart = () => { el.micStatusText.textContent = 'mic open — waiting for sound…'; };
    recognition.onsoundstart = () => { heardSound = true; el.micStatusText.textContent = 'hearing sound…'; };
    recognition.onspeechstart = () => { el.micStatusText.textContent = 'hearing speech…'; };
    recognition.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        micErrors = 0;                  // results flowing — the pipeline works
        const words = voiceWords(pickAlternative(res));
        if (!res.isFinal) {
          updateTicker(res[0].transcript);
          alignVoice(words, false);     // bank correct answers the moment they appear
          continue;
        }
        updateTicker('');
        voiceBuf.push(...words);
        alignVoice(null, true);
      }
    };
    recognition.onend = () => {
      // Not while paused — that's the one case where ending is deliberate.
      if (state.micOn && state.selected && state.level?.pausedAt == null) startListening();
    };
    recognition.onerror = (e) => {
      if (e.error === 'no-speech') {
        el.micStatusText.textContent = heardSound
          ? 'heard sound, but no words — try again?'
          : 'only silence — is the right microphone chosen in the browser’s mic settings?';
        return;                                                       // onend restarts
      }
      if (e.error === 'aborted') return;                              // routine — onend restarts
      micErrors++;
      const why = {
        'not-allowed': 'Microphone access was blocked — check browser permissions.',
        'service-not-allowed': 'This browser blocked its speech service on this page.',
        'audio-capture': 'No microphone found — is one connected and allowed?',
        'network': 'The speech service is unreachable. Voice needs internet, and some Chromium-based browsers ship without a speech backend — try Chrome or Edge.',
        'language-not-supported': 'This browser cannot recognize English speech.',
      }[e.error] || `Voice input error: ${e.error}`;
      // Permission errors are final; anything else gets three tries before
      // the mic turns itself off instead of silently spinning.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || micErrors >= 3) {
        state.micOn = false;
        updateMicUI();
      }
      setFeedback(why, 'bad');
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
    'mic-toggle', 'voice-meter', 'mic-status-text', 'stats-btn', 'help-btn', 'fs-btn',
    'jump-bar', 'jump-flash', 'jump-caption', 'mini-map', 'mini-view', 'zoom-in', 'zoom-out',
    'menu', 'menu-btn', 'menu-restart', 'challenges-btn', 'mode-seg', 'heat-btn', 'intro-btn', 'dev-btn',
    'level-chip', 'idle-bar', 'idle-text',
    'card', 'card-close', 'card-question',
    'card-prompt', 'guess-form', 'guess-input', 'mic-status', 'feedback',
    'card-actions', 'hint-btn', 'reveal-btn', 'card-answer', 'answer-result', 'answer-name',
    'answer-meta', 'speak-btn', 'retry-btn',
    'level-banner', 'level-title', 'level-timer',
    'home', 'home-back', 'home-intro', 'home-heat', 'home-stats', 'home-help', 'home-continue', 'home-cards',
    'mode-dialog', 'mode-for', 'mode-count', 'mode-opts', 'mode-cancel', 'mode-start',
    'onboard', 'onboard-count', 'onboard-dots', 'onboard-skip', 'onboard-next',
    'word-bank', 'bank-target', 'bank-flag', 'bank-name', 'bank-strikes', 'bank-skip', 'bank-show', 'bank-collapse', 'bank-hint', 'bank-chips',
    'hardcore-bar', 'hc-find', 'hc-giveup',
    'pause-timer', 'pause-veil',
    'results', 'results-title', 'results-sub', 'results-time', 'results-best', 'results-tiles', 'results-misses',
    'results-practise', 'results-again', 'results-mode', 'results-home', 'confetti',
    'stats-panel', 'stats-close', 'stat-tiles', 'stats-heat', 'flags-toggle', 'best-times', 'region-mastery', 'stats-reset',
    'heat-bar', 'heat-panel', 'heat-close', 'heat-seg', 'heat-sel', 'heat-flag', 'heat-name', 'heat-dot', 'heat-text', 'heat-prompt',
    'help', 'help-close', 'dev', 'dev-close', 'dev-guides',
  ]) {
    el[id.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = document.getElementById(id);
  }

  // ————— map setup —————

  let svg = null;
  let osvg = null;                // the overlay's own <svg>, laid over the map's
  let fullVB = null;              // { x, y, w, h } of the whole map
  const shapes = {};              // code -> country path
  const allPaths = {};            // id -> every map path (countries + territories)
  const bboxByCode = {};          // code -> getBBox() (countries + territories)
  const geom = {};                // code -> { anchor, boxes, groups? }
  const elemsByCode = {};         // code -> every map element mirroring status/selection
  let ovByCode = {};              // code -> overlay elements (rebuilt on every bake)
  let hitLayer = null;
  let overlayLayer = null;
  const dHi = {}, dLo = {};       // id -> path data at the two always-loaded detail levels
  let dFull = null;               // id -> untouched amCharts path data (lazy-loaded)
  let fullLoading = false;
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
    // The overlay gets an <svg> of its own, over the map's and moved in
    // step with it. A style change inside an svg repaints the whole svg,
    // and the map's is 250 paths of borders that the transform-only
    // pan/zoom exists to leave alone; here a button can hide for a zoom
    // or flash for an answer at the cost of repainting a few dozen
    // circles. Nothing in it catches the pointer but the targets
    // themselves, so a tap between them still lands on the map.
    osvg = document.createElementNS(SVG_NS, 'svg');
    osvg.id = 'overlay';
    osvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    osvg.appendChild(overlayLayer);
    el.map.appendChild(osvg);

    // Start on the coarse coastlines; bake() swaps levels as you zoom.
    for (const id of Object.keys(allPaths)) allPaths[id].setAttribute('d', dLo[id]);
    drawMiniMap(dLo, (id) => !!COUNTRY_BY_CODE[id], fullVB);

    measure();
    setView(worldView());
    bindMapEvents();

    // A tab can load hidden (0x0 viewport) and be shown later; re-measure
    // and refit whenever the map's size actually changes.
    new ResizeObserver(() => {
      const w0 = W, h0 = H;
      measure();
      if (W === w0 && H === h0) return;
      // Coming up from nothing: every fit made while the window had no
      // size is finite but meaningless (clamped to the deepest zoom), so
      // there is no view worth keeping — frame the challenge afresh.
      if (!(w0 > 0 && h0 > 0) && W > 0 && H > 0) {
        base = null;
        setView(worldView());
        if (state.level) zoomToCodes(state.level.codes, 0);
        return;
      }
      if (!vb || !isFinite(vb.x + vb.y + vb.w + vb.h)) {
        if (W > 0 && H > 0) { base = null; setView(worldView()); }
        return;
      }
      dirty = true;
      setView({ ...vb });
      reanchor();
      if (!interacting()) bake();
    }).observe(el.map);

    // The quiz card and the word bank come and go, and on a phone each
    // one changes how much of the glass the map actually has. Watching
    // them keeps the *next* fit honest, without yanking the view you are
    // already looking at.
    // …but never in the middle of a gesture. The safe area feeds the
    // clamp's travel limits, so moving it while a finger is down tugs
    // the map out from under that finger.
    const chrome = new ResizeObserver(() => { if (!interacting()) updateSafe(); });
    for (const e of [el.card, el.idleBar, el.wordBank, el.hardcoreBar, el.jumpBar]) chrome.observe(e);
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
        anchor: { x: big.x + big.w / 2, y: big.y + big.h / 2, dim: Math.max(big.w, big.h) },
        boxes,
      };
      if (ARCHIPELAGOS.has(code)) g.groups = groupIslands(boxes);
      geom[code] = g;
    }
    probe.remove();
  }

  // One rule, no exceptions: a button stands in for a country only while
  // the country is the smaller target of the two. The moment a disc the
  // size of the button's own face fits inside the borders on screen, the
  // country can be clicked for itself and the button is clutter.
  //
  // TARGET_R (js/targets.js, generated from the map) is that fit in map
  // units — the largest circle inside the country, which is honest about
  // the shapes a bounding box flatters: slivers like the Gambia, hollows
  // and crescents wrapped around a bay. It is why Burundi keeps its
  // button a whole sub-region layer longer than its box says it should,
  // and why the hand-written "keep this one anyway" list is gone.
  //
  // Archipelagos are the one different case, because their target isn't
  // the country: it's the dotted group outline, which the overlay grows
  // to a comfortable size of its own.
  function buttonRedundant(code, s) {
    if (geom[code].groups) return focusPoint(code).dim * s >= 48;
    return (TARGET_R[code] || 0) * s >= BTN_R;
  }

  // The zoom a zone unfolds at: its minScale — where its member buttons
  // were spaced to stop merging — or, when its own dive lands wider than
  // that on this screen, the landing itself. A dive always arrives on
  // open buttons; a narrow phone pays with buttons a little closer, not
  // with a view cropped around the numbered button it just tapped. (The
  // 0.98 keeps the landing clear of its own threshold.)
  function zoneOpenScale(z) {
    const b = viewBox(z.name);
    return b ? Math.min(z.minScale, viewScale(b) * 0.98) : z.minScale;
  }

  // Zoom needed before this country's own button shows (zone layers and
  // the boxed-in micro-states).
  function minScaleFor(code) {
    let m = BUTTON_MIN_SCALE[code] || 0;
    const z = ZONE_BY_CODE[code];
    if (z) m = Math.max(m, ZONE_SOLO[code] ?? zoneOpenScale(z));
    return m;
  }

  // A zone member is folded into the numbered button until it either
  // earns its own (ZONE_SOLO) or the whole zone opens up.
  function inZoneFold(code, s) {
    return !(ZONE_SOLO[code] && s >= ZONE_SOLO[code]);
  }

  // Where a button sits, in map units, relative to the country it points
  // at. Up to BTN_LOCK the authored offset is a plain pixel offset —
  // that's what keeps buttons off each other at world and continent
  // zoom, where the map is crowded. Past it the button holds the place
  // on the map that offset gave it, so zooming in (or switching between
  // two views of the same area) can't slide it onto a neighbour; only a
  // pointer longer than BTN_TAIL_MAX starts pulling it back in.
  function buttonOffset(off, s) {
    const mag = Math.hypot(off[0], off[1]);
    if (!mag) return { x: 0, y: 0, px: 0 };
    const grow = Math.min(Math.max(s / BTN_LOCK, 1), BTN_TAIL_MAX / mag);
    return { x: off[0] * grow / s, y: off[1] * grow / s, px: mag * grow };
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
  let lastBakeAt = 0;
  let dragging = false;           // a finger/mouse is actively moving the view
  let reanchor = () => {};        // set by bindMapEvents; re-bases a live gesture

  // While the view is under the user's hand (or gliding after a flick),
  // swapping every path's `d` for another detail level, or rebuilding the
  // small-country overlay, costs far more than a frame's budget — which
  // on a phone reads as the map lurching. Both wait for the settle bake.
  function interacting() { return dragging || fling.id != null; }

  function measure() {
    const r = el.map.getBoundingClientRect();
    W = r.width; H = r.height; rectLeft = r.left; rectTop = r.top;
    updateSafe();
  }

  function scaleFor(v) {
    return Math.min(W / v.w, H / v.h);
  }

  // The view rect takes the *window's* shape, not the map's. Pinned to
  // the map's own 3:2, a portrait phone letterboxed down to a 250px band
  // of map inside an 800px screen — every region, however tall, framed
  // into a third of the glass. Matching the window means a fit fills it.
  function viewAspect() { return W > 0 && H > 0 ? H / W : fullVB.h / fullVB.w; }

  // The whole map, as a fit box.
  const mapBox = () => ({ x1: fullVB.x, y1: fullVB.y, x2: fullVB.x + fullVB.w, y2: fullVB.y + fullVB.h });

  // Zoomed all the way out is "the whole map is somewhere I can see it",
  // and on a phone that is not the same as "on screen": the jump keys and
  // the word bank own a slice of the glass between them, so a world view
  // centred in the *window* hands them the bottom half of the map. It
  // goes through the same safe-area fit every other view does.
  function worldView() {
    const box = mapBox();
    return frameAt(box, safeScale(box, 1));
  }

  function clampView(n) {
    const asp = viewAspect();
    const box = mapBox();
    const minW = fullVB.w / MAX_ZOOM;
    const maxW = Math.max(W / safeScale(box, 1), minW);
    const w = Math.min(Math.max(n.w, minW), maxW);
    const h = w * asp;
    const s = W / w;
    // Where the map comes to rest on an axis with no travel left: the
    // middle of what the map has to itself, not the middle of the window.
    const rest = frameAt(box, s);
    // The travel limits stretch by the safe insets, so anything on the
    // map can always be dragged out from under the UI — otherwise a
    // country near the south edge can never leave the word bank's shadow.
    const mx = fullVB.w * 0.05, my = fullVB.h * 0.05;
    const span = (lo, hi, want, mid) => (hi < lo ? mid : Math.min(Math.max(want, lo), hi));
    return {
      x: span(fullVB.x - mx - SAFE.left / s, fullVB.x + fullVB.w + mx - w + SAFE.right / s, n.x, rest.x),
      y: span(fullVB.y - my - SAFE.top / s, fullVB.y + fullVB.h + my - h + SAFE.bottom / s, n.y, rest.y),
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
    svg.style.transform = osvg.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    dirty = true;
    // Panned past the pre-rendered margin (bare edges would show) or
    // zoomed far from the baked raster (mush) — re-render right away.
    // During an animation, though, a big zoom crosses that threshold on
    // every frame; re-rendering each one is what makes a hotkey jump
    // stutter, so mid-flight bakes are rationed and the landing bake
    // restores full crispness.
    const lim = VIEW_MARGIN * Math.min(k, 1) * 0.92;
    const rough = Math.abs(tx) > W * lim || Math.abs(ty) > H * lim || k < 0.75 || k > 3.2;
    const animating = animId != null || zoomAnim.active;
    if (rough && (!animating || performance.now() - lastBakeAt > ANIM_BAKE_GAP)) bake();
    else scheduleBake();
  }

  function scheduleBake(delay = BAKE_IDLE) {
    clearTimeout(bakeTimer);
    bakeTimer = setTimeout(bake, delay);
  }

  function bake() {
    clearTimeout(bakeTimer);
    bakeTimer = null;
    const settled = animId == null && !zoomAnim.active && !interacting();
    if (!dirty && base) { if (settled) landOverlay(); return; }
    dirty = false;
    base = { ...vb };
    lastBakeAt = performance.now();
    const s = scaleFor(vb);
    // Three detail levels: coarse coastlines zoomed out (a third of the
    // points to rasterise), the simplified map in the middle, and the
    // untouched amCharts borders once you're deep into a sub-area.
    let want = lod;
    if (s > LOD_FULL_HI) want = 'full';
    else if (s > LOD_HI) { if (lod !== 'full' || s < LOD_FULL_LO) want = 'hi'; }
    else if (s < LOD_LO) want = 'lo';
    if (want === 'full' && !dFull) { loadFullDetail(); want = 'hi'; }
    if (interacting()) want = lod;
    if (want !== lod) {
      lod = want;
      const src = lod === 'full' ? dFull : lod === 'hi' ? dHi : dLo;
      for (const id of Object.keys(allPaths)) allPaths[id].setAttribute('d', src[id]);
    }
    const m = VIEW_MARGIN;
    const box = `${vb.x - m * vb.w} ${vb.y - m * vb.h} ${vb.w * (1 + 2 * m)} ${vb.h * (1 + 2 * m)}`;
    svg.setAttribute('viewBox', box);
    osvg.setAttribute('viewBox', box);
    svg.style.transform = osvg.style.transform = '';
    markView();
    // Rebuilding the overlay mid-animation would just add to the frame's
    // work; the landing bake redraws it at the final scale anyway.
    if (settled) { updateOverlay(); landOverlay(); }
  }

  // The minimap's patch of light: what the map is showing, clipped to the
  // map. It moves when the view is baked, not on every frame of a drag — a
  // second svg repainting under the finger is exactly what the
  // transform-only pan exists to avoid. Zoomed all the way out there is
  // nothing to pick out.
  function markView() {
    const x1 = Math.max(vb.x, fullVB.x), y1 = Math.max(vb.y, fullVB.y);
    const x2 = Math.min(vb.x + vb.w, fullVB.x + fullVB.w), y2 = Math.min(vb.y + vb.h, fullVB.y + fullVB.h);
    const whole = x2 - x1 >= fullVB.w * 0.98 && y2 - y1 >= fullVB.h * 0.98;
    if (whole || x2 <= x1 || y2 <= y1) { el.miniView.setAttribute('display', 'none'); return; }
    el.miniView.setAttribute('x', x1); el.miniView.setAttribute('y', y1);
    el.miniView.setAttribute('width', x2 - x1); el.miniView.setAttribute('height', y2 - y1);
    el.miniView.removeAttribute('display');
  }

  // Mid-zoom the buttons would scale with the map — a button the size of
  // Spain for a moment, then a snap back at the landing — so they step
  // aside for the flight (the `zooming` class) and come back at their
  // size once it settles: the frame after they are rebuilt, so the
  // fade-in has something to fade from.
  function landOverlay() {
    requestAnimationFrame(() => osvg.classList.remove('zooming'));
  }

  // The untouched amCharts map (full border detail, 1.4MB) is fetched in
  // the background — at boot idle, or on first deep zoom — and swaps in
  // as the third detail level.
  function loadFullDetail() {
    if (fullLoading) return;
    fullLoading = true;
    fetch('map/world-full.svg').then(r => r.text()).then(text => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const d = {};
      for (const p of doc.querySelectorAll('path[id]')) d[p.id] = p.getAttribute('d');
      dFull = d;
      if (scaleFor(vb) > LOD_FULL_HI) { dirty = true; bake(); }
    }).catch(() => { fullLoading = false; });   // offline etc. — retry on next deep zoom
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
  const fling = { id: null, vx: 0, vy: 0, last: 0 };

  function stopFling() {
    if (fling.id) cancelAnimationFrame(fling.id);
    const was = fling.id != null;
    fling.id = null;
    fling.vx = fling.vy = 0;
    return was;
  }

  function cancelAnim() {
    if (animId) cancelAnimationFrame(animId);
    animId = null;
    zoomAnim.active = false;
    stopFling();
  }

  // Glide on after a flick: velocity (client px/ms) decays exponentially
  // and the view is pushed by it each frame. Running into a clamp edge
  // kills that axis so the map never grinds against the boundary.
  function flingStep(now) {
    if (!fling.id) return;
    const dt = Math.min(40, now - fling.last);
    fling.last = now;
    const s = scaleFor(vb);
    const wantX = fling.vx * dt / s, wantY = fling.vy * dt / s;
    const x0 = vb.x, y0 = vb.y;
    setView({ x: vb.x - wantX, y: vb.y - wantY, w: vb.w, h: vb.h });
    if (Math.abs(wantX) > 1e-9 && Math.abs(vb.x - x0) < Math.abs(wantX) * 0.5) fling.vx = 0;
    if (Math.abs(wantY) > 1e-9 && Math.abs(vb.y - y0) < Math.abs(wantY) * 0.5) fling.vy = 0;
    const k = Math.exp(-dt / FLING_TAU);
    fling.vx *= k; fling.vy *= k;
    if (Math.hypot(fling.vx, fling.vy) < FLING_MIN) { stopFling(); bake(); }
    else fling.id = requestAnimationFrame(flingStep);
  }

  function startFling(vx, vy) {
    const sp = Math.hypot(vx, vy);
    if (!(sp > FLING_MIN * 4)) return false;
    const c = Math.min(1, FLING_MAX / sp);
    fling.vx = vx * c; fling.vy = vy * c;
    fling.last = performance.now();
    fling.id = requestAnimationFrame(flingStep);
    return true;
  }

  function animateView(target, ms = 260) {
    cancelAnim();
    const from = { ...vb };
    const to = clampView(target);
    if (ms <= 0) { setView(to); bake(); return; }
    if (Math.abs(to.w - from.w) > from.w * 0.002) osvg.classList.add('zooming');
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
      // The last frame's setView may have spent the dirty flag on a
      // mid-flight bake — one that skips the overlay, because animId was
      // still set. The landing always redraws it at the final scale.
      else { animId = null; dirty = true; bake(); }
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
      osvg.classList.add('zooming');
      zoomAnim.last = performance.now();
      requestAnimationFrame(zoomStep);
    }
  }

  function zoomStep(now) {
    if (!zoomAnim.active) return;
    const dt = Math.min(50, now - zoomAnim.last);
    zoomAnim.last = now;
    const a = 1 - Math.exp(-dt / 45);   // snappier than a map app's — this is a game
    let w = vb.w + (zoomAnim.targetW - vb.w) * a;
    const done = Math.abs(w - zoomAnim.targetW) / zoomAnim.targetW < 0.002;
    if (done) w = zoomAnim.targetW;
    const h = w * viewAspect();
    const s = W / w;                    // rect and window agree, so no letterbox offset
    setView({
      x: zoomAnim.ax - (zoomAnim.cx - rectLeft) / s,
      y: zoomAnim.ay - (zoomAnim.cy - rectTop) / s,
      w, h,
    });
    if (done) { zoomAnim.active = false; scheduleBake(); }
    else requestAnimationFrame(zoomStep);
  }

  // Two rectangles: x1…y2 caps a giant country's pull to 22 units past
  // its core (so the scale frames the playable mass), while tx1…ty2 is
  // the true union of the same landmasses, used to centre the view and
  // to loosen the scale a little when the real extent needs it.
  function fitCodes(codes) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    let tx1 = Infinity, ty1 = Infinity, tx2 = -Infinity, ty2 = -Infinity;
    const CAP = codes.length > 1 ? 22 : Infinity;
    for (const code of codes) {
      const g = geom[code];
      if (!g) continue;
      // Russia's bbox reaches the Pacific; fitting it would turn the
      // Europe view into the whole world. It's still in the challenge.
      if (code === 'RU' && codes.length > 1) continue;
      let big = g.boxes[0];
      for (const b of g.boxes) if (b.w * b.h > big.w * big.h) big = b;
      const parts = g.groups || [big];
      for (const b of parts) {
        // Kiribati's far-flung groups would force a whole-map view; only
        // the region's centre of mass matters for a multi-country zoom.
        if (codes.length > 1 && g.groups && b !== g.groups[0] && Math.abs(b.x - g.groups[0].x) > 200) continue;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const hw = Math.min(Math.max(b.w, 1) / 2, CAP), hh = Math.min(Math.max(b.h, 1) / 2, CAP);
        x1 = Math.min(x1, cx - hw); y1 = Math.min(y1, cy - hh);
        x2 = Math.max(x2, cx + hw); y2 = Math.max(y2, cy + hh);
        tx1 = Math.min(tx1, b.x); ty1 = Math.min(ty1, b.y);
        tx2 = Math.max(tx2, b.x + b.w); ty2 = Math.max(ty2, b.y + b.h);
      }
    }
    return x1 === Infinity ? null : { x1, y1, x2, y2, tx1, ty1, tx2, ty2 };
  }

  // The big area views are framed by hand (js/views.js), not from the
  // countries' bounding boxes: a box there is the area that has to be on
  // screen, whatever shape the screen is. A challenge over a whole region
  // opens on the same frame its jump key lands on.
  function viewBox(name) {
    const b = VIEW_BOXES[name];
    return b ? { x1: b[0], y1: b[1], x2: b[2], y2: b[3] } : null;
  }

  function regionView(codes) {
    for (const region of Object.keys(CODES_BY_REGION)) {
      if (!VIEW_BOXES[region]) continue;
      const rc = CODES_BY_REGION[region];
      if (codes.length === rc.length && rc.every(c => codes.includes(c))) return region;
    }
    return null;
  }

  // The floating UI overlays the map's edges — the HUD across the top,
  // and along the bottom the bar plus, on a phone, the minimap above it.
  // Fits aim for the window minus this border, so a framed area never
  // starts life under the chrome (and offset buttons and tails get
  // breathing room too). The sides are bare on every screen: 40px of a
  // 412px phone was a tenth of the map given away.
  const SAFE = { top: 60, bottom: 64, left: 12, right: 12 };
  const SAFE_BASE = { ...SAFE };

  // What is docked along the bottom right now — whichever bar the mode
  // has up — is measured rather than guessed at, on every measure(). A
  // fit that does not know the bar is 70px tall frames the country it is
  // asking you to find underneath it. The minimap counts only where it
  // spans a real share of the width: on a phone it does, and a fit has to
  // clear it; on a wide window it is a corner, and reserving its whole
  // height across the bottom would cost the map a fifth of the screen to
  // protect a ninth of it.
  function updateSafe() {
    let bottom = SAFE_BASE.bottom;
    for (const e of [el.jumpBar, el.idleBar, el.wordBank, el.hardcoreBar, el.card]) {
      if (!e || e.hidden || !e.offsetParent) continue;
      const r = e.getBoundingClientRect();
      if (e === el.jumpBar && r.width < W * 0.4) continue;
      const top = r.top - rectTop;
      if (top < H) bottom = Math.max(bottom, Math.round(H - top) + 10);
    }
    SAFE.bottom = Math.min(bottom, Math.max(SAFE_BASE.bottom, H * 0.45));
  }

  function safeScale(f, pad) {
    return Math.min(
      (W - SAFE.left - SAFE.right) / ((f.x2 - f.x1) * pad),
      (H - SAFE.top - SAFE.bottom) / ((f.y2 - f.y1) * pad));
  }

  // The widest allowed fit is half of MAX_ZOOM, so a "zoom to this tiny
  // island" never lands at full magnification.
  function maxFitScale() {
    return W / (fullVB.w / MAX_ZOOM * 2);
  }

  // View rect that shows `f` at scale s, centred in the safe area.
  function frameAt(f, s) {
    return {
      x: (f.x1 + f.x2) / 2 - (SAFE.left + (W - SAFE.left - SAFE.right) / 2) / s,
      y: (f.y1 + f.y2) / 2 - (SAFE.top + (H - SAFE.top - SAFE.bottom) / 2) / s,
      w: W / s, h: H / s,
    };
  }

  // Fit the play area into the safe frame so it fills the screen without
  // hiding under the UI. The capped fit sets the baseline zoom, loosened
  // up to 20% when the true extent asks for it (all of Norway, Chile's
  // tip); the true extent is what gets centred, splitting any remaining
  // overflow evenly between the frame's edges.
  function zoomToCodes(codes, ms = 260, padFactor = 1.05) {
    if (codes.length === WORLD_CODES.length) { animateView(worldView(), ms); return; }
    const rv = regionView(codes);
    if (rv) { zoomToView(rv, ms); return; }
    const f = fitCodes(codes);
    if (!f) return;
    const tf = { x1: f.tx1, y1: f.ty1, x2: f.tx2, y2: f.ty2 };
    let s = Math.max(safeScale(tf, padFactor), safeScale(f, padFactor) * 0.8);
    s = Math.min(s, maxFitScale());
    if (!(s > 0)) return;
    animateView(frameAt(tf, s), ms);
  }

  // A hand-set view: the tightest zoom that holds the whole box inside
  // the safe area, centred in it. Nothing overrules the box.
  function viewScale(b) { return Math.min(safeScale(b, 1), maxFitScale()); }

  function zoomToView(name, ms = 220) {
    const b = viewBox(name);
    if (!b) return;
    const s = viewScale(b);
    if (!(s > 0)) return;
    animateView(frameAt(b, s), ms);
  }

  // Zoom to the layer where the zone's buttons are clickable. A zone with
  // a box lands on it like any other view, and unfolds wherever that is
  // (zoneOpenScale). One without a box (Oceania, reached only by its
  // numbered button) fits its members, and at least at the zoom its
  // buttons unfold at.
  function zoomToZone(z, ms = 240) {
    if (!z) return;
    if (VIEW_BOXES[z.name]) { zoomToView(z.name, ms); return; }
    const f = fitCodes(z.codes);
    if (!f) return;
    let s = Math.max(safeScale(f, 1.05), z.minScale * 1.1);
    s = Math.min(s, maxFitScale());
    if (!(s > 0)) return;
    animateView(frameAt(f, s), ms);
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
    const aspect = viewAspect();
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

    // The dotted island outlines (js/islands.js decides their shapes;
    // here they only become SVG). Past a dense zone's squareScale an
    // outline replaces its nation's button entirely.
    const groupsOf = (c) => geom[c]?.groups;
    const squared = squaredAt(s, groupsOf);
    for (const b of layoutOutlines(codes, s, groupsOf, squared)) {
      const grp = document.createElementNS(SVG_NS, 'g');
      grp.setAttribute('class', 'ov-box');
      const shape = document.createElementNS(SVG_NS, 'rect');
      shape.setAttribute('x', b.cx - b.w / 2); shape.setAttribute('y', b.cy - b.h / 2);
      shape.setAttribute('width', b.w); shape.setAttribute('height', b.h);
      shape.setAttribute('rx', b.rx);
      if (b.angle) shape.setAttribute('transform', `rotate(${b.angle} ${b.cx} ${b.cy})`);
      grp.appendChild(shape);
      decorate(grp, b.code);
      overlayLayer.appendChild(grp);
    }

    // Zoom layers: below the zoom a zone opens at, its buttons collapse
    // into one numbered button that zooms to where they're clickable.
    const grouped = new Set();
    for (const z of BUTTON_ZONES) {
      const members = z.codes.filter(c => codes.includes(c) && BUTTON_OFFSETS[c] && geom[c] &&
        !buttonRedundant(c, s) && inZoneFold(c, s));
      if (s >= zoneOpenScale(z) || members.length < 2) continue;
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
      t.setAttribute('font-size', 17 / s);
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
      if (!off || !geom[code] || grouped.has(code) || squared.has(code) || s < (BUTTON_MIN_SCALE[code] || 0) || buttonRedundant(code, s)) continue;
      const f = focusPoint(code);
      const d = buttonOffset(off, s);
      items.push({ code, fx: f.x, fy: f.y, x: f.x + d.x, y: f.y + d.y, offset: d.px });
    }
    // Two buttons closer than their own width (tiny window, far zoomed
    // out) merge into one numbered button that zooms in on the pair.
    const parent = items.map((_, i) => i);
    const find = (i) => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const limit = BTN_MERGE / s;
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
        // Pointer: a wedge to the country, based at the circle's rim —
        // the face is translucent, so a wedge crossing under its middle
        // would show through. Skipped when the country is under the
        // button.
        const d = Math.hypot(it.fx - it.x, it.fy - it.y);
        if (it.offset > 0 && d * s > BTN_R + 8) {
          const ux = (it.fx - it.x) / d, uy = (it.fy - it.y) / d;
          const w = TAIL_W / s, r0 = (BTN_R - 2) / s;
          const bx = it.x + ux * r0, by = it.y + uy * r0;
          const tail = document.createElementNS(SVG_NS, 'path');
          tail.setAttribute('class', 'tail');
          tail.setAttribute('d', `M${bx - uy * w},${by + ux * w} L${it.fx},${it.fy} L${bx + uy * w},${by - ux * w} Z`);
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
        t.setAttribute('font-size', 17 / s);
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
    if (state.level?.pausedAt != null && !state.heat) return;
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
    if (state.heat) { heatSelect(COUNTRY_BY_CODE[code] ? code : null); return; }
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

    // Pointer-based pan + pinch, run as one continuous gesture.
    //
    // Every pointer in play contributes to a centroid and a spread. The
    // gesture keeps one anchor — the map point that sat under the centroid
    // when the anchor was taken — and each move simply re-solves the view
    // so that map point is back under the centroid, at a width scaled by
    // how far the fingers have spread. One finger and two therefore run
    // through exactly the same path, and two-finger drags pan as well as
    // zoom, the way a map app does.
    //
    // The anchor is retaken whenever the set of pointers changes. That is
    // what stops the classic jump: lift one finger out of a pinch and the
    // centroid leaps across the screen, and a gesture anchored at the
    // original touch-down would teleport the map by the same distance.
    // Re-anchoring makes the remaining finger pick up from where the view
    // already is.
    //
    // A press that never moves beyond TAP_SLOP is a tap on the element
    // under the initial pointerdown — we can't rely on the click event
    // because setPointerCapture retargets it.
    const pointers = new Map();
    let gest = null;
    reanchor = () => { if (gest) anchorGesture(); };
    const vel = [];   // recent centroid samples, for the release velocity

    const centroidOf = (pts) => {
      let cx = 0, cy = 0;
      for (const p of pts) { cx += p.x; cy += p.y; }
      return { x: cx / pts.length, y: cy / pts.length };
    };

    // Mean distance from the centroid: for two fingers that is half the
    // pinch distance, and it keeps working if a third finger lands.
    const spreadOf = (pts, c) => {
      if (pts.length < 2) return 0;
      let d = 0;
      for (const p of pts) d += Math.hypot(p.x - c.x, p.y - c.y);
      return d / pts.length;
    };

    function anchorGesture() {
      const pts = [...pointers.values()];
      if (!pts.length) { gest = null; return; }
      const c = centroidOf(pts);
      const pt = clientToMap(c.x, c.y);
      gest = {
        ax: pt.x, ay: pt.y, cx: c.x, cy: c.y,
        spread: spreadOf(pts, c), w: vb.w,
        moved: gest ? gest.moved : false,
        target: gest ? gest.target : null,
        type: gest ? gest.type : 'touch',
        noTap: gest ? gest.noTap : false,
      };
      vel.length = 0;   // the centroid just jumped; old samples would fling
    }

    // Put the anchored map point back under `c`, at view width `w`.
    //
    // The view rect takes the window's shape (viewAspect), which means it
    // always fills the glass and the scale is simply W/w, with nothing
    // letterboxed. This used to solve with the *map's* shape instead, and
    // subtract letterbox offsets that no longer exist, so the grabbed
    // point jumped the moment you moved it — by nothing at all dead
    // centre, and by more the further out you grabbed, which on a phone
    // is every drag. clientToMap is the other half of this same sum, and
    // the two have to stay in step.
    function applyGesture(c, w) {
      const s = W / w;
      setView({
        x: gest.ax - (c.x - rectLeft) / s,
        y: gest.ay - (c.y - rectTop) / s,
        w, h: w * viewAspect(),
      });
    }

    function sample(c) {
      const now = performance.now();
      vel.push({ t: now, x: c.x, y: c.y });
      while (vel.length > 2 && now - vel[0].t > FLING_WINDOW) vel.shift();
    }

    function releaseVelocity() {
      if (vel.length < 2) return null;
      const a = vel[0], b = vel[vel.length - 1];
      const dt = b.t - a.t;
      // A finger that stopped before lifting should not fling.
      if (dt < 8 || performance.now() - b.t > 70) return null;
      return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
    }

    el.map.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // A touch that catches a glide should stop it, not also count as a
      // tap on whatever happened to slide under the finger.
      const caught = stopFling();
      cancelAnim();
      try { el.map.setPointerCapture(e.pointerId); } catch { /* synthetic / stale pointer */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        gest = null;
        anchorGesture();
        gest.target = e.target;
        gest.type = e.pointerType;
        gest.noTap = caught;
      } else {
        anchorGesture();
        gest.moved = true;      // a second finger is never a tap
        gest.noTap = true;
        dragging = true;
        el.map.classList.add('panning');
        osvg.classList.add('zooming');   // a pinch scales the buttons with the map too
        el.tooltip.hidden = true;
        clearHot();
      }
    });

    el.map.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) { updateTooltip(e); return; }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gest) return;

      const pts = [...pointers.values()];
      const c = centroidOf(pts);

      if (!gest.moved) {
        if (Math.hypot(c.x - gest.cx, c.y - gest.cy) <= (TAP_SLOP[gest.type] || 8)) {
          updateTooltip(e);
          return;
        }
        gest.moved = true;
        dragging = true;
        el.map.classList.add('panning');
        el.tooltip.hidden = true;
        clearHot();
        // Re-anchor at the point the drag actually broke loose, so the map
        // doesn't snap by the slop distance on the first moved frame.
        anchorGesture();
        return;
      }

      let w = gest.w;
      if (gest.spread > 0) {
        const sp = spreadOf(pts, c);
        if (sp > 0) w = clampView({ x: vb.x, y: vb.y, w: gest.w * (gest.spread / sp) }).w;
      }
      applyGesture(c, w);
      if (pts.length === 1) sample(c);
      else vel.length = 0;      // don't fling out of a pinch
    });

    const endPointer = (e) => {
      const wasTap = e.type === 'pointerup' && pointers.size === 1 && gest && !gest.moved && !gest.noTap;
      const tapTarget = gest?.target;
      pointers.delete(e.pointerId);

      if (pointers.size > 0) {
        // Fingers still down (a pinch losing one): re-anchor rather than
        // carry on from a centroid that no longer means anything.
        anchorGesture();
      } else {
        const moved = gest?.moved;
        const type = gest?.type;
        gest = null;
        el.map.classList.remove('panning');
        dragging = false;
        updateSafe();                 // deferred while the gesture was live
        if (moved) {
          const v = type !== 'mouse' ? releaseVelocity() : null;
          if (!v || !startFling(v.vx, v.vy)) bake();
        }
        vel.length = 0;
      }

      if (wasTap && tapTarget) {
        const target = tapTarget.closest?.('[data-code], path[id], g.btn');
        if (target) handleTarget(target, { x: e.clientX - rectLeft, y: e.clientY - rectTop });
      }
    };
    el.map.addEventListener('pointerup', endPointer);
    el.map.addEventListener('pointercancel', endPointer);
    el.map.addEventListener('pointerleave', () => { el.tooltip.hidden = true; clearHot(); });
  }

  // ————— tooltip & hover (desktop) —————

  // What a click here would arm. Buttons and island outlines sit above
  // the map; below it, every country carries a fat invisible stroke of
  // click padding, so a point just offshore still resolves to its
  // country. The tooltip and the highlight both run off this one answer,
  // because a highlight that disagrees with the click is how you end up
  // naming the wrong country.
  let hotEls = [];
  function setHot(target) {
    for (const e of hotEls) e.classList.remove('hot');
    hotEls = [];
    const grp = target?.closest?.('g.btn, g.ov-box');
    if (grp) {
      hotEls = [grp];
    } else if (target) {
      const code = target.dataset?.code || target.id;
      if (code && (COUNTRY_BY_CODE[code] || TERRITORIES[code])) {
        hotEls = allElems(code).slice();
        if (!hotEls.length && allPaths[code]) hotEls = [allPaths[code]];
      }
    }
    for (const e of hotEls) e.classList.add('hot');
  }
  const clearHot = () => setHot(null);

  function updateTooltip(e) {
    if (e.pointerType !== 'mouse') return;
    const target = e.target.closest?.('[data-code], path[id], g.btn');
    setHot(target);
    let text = null;
    if (target?.closest('g.btn.zone')) {
      const zg2 = target.closest('g.btn.zone');
      text = `${zg2.dataset.zone} — ${zg2.dataset.codes.split(',').length} small nations · click to zoom in`;
    } else if (target?.closest('g.btn.group')) {
      const n = target.closest('g.btn.group').dataset.codes.split(',').length;
      text = `${n} small nations — click to zoom in`;
    } else if (target) {
      const code = target.dataset.code || target.id;
      const L = state.level;
      const c = COUNTRY_BY_CODE[code];
      if (c) {
        if (L && !L.codes.includes(code)) text = null;
        else if (state.heat) {
          const r = stats.byCode[code]?.[heatMode()];
          text = `${c.name} · ${r?.streak ? `${r.streak} in a row` : 'no streak yet'}`;
        }
        else if (state.status[code]) text = `${c.name} ✓`;
        else text = L?.mode === 'place' ? null : 'Click to name this nation';
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
    voicePush(code);
    if (state.selected) setSelectedClass(state.selected, false);
    state.selected = code;
    state.selectedAt = pt;
    state.hintLevel = 0;
    updateHintBtn();
    state.attempts = 0;
    setSelectedClass(code, true);
    closePanels();
    el.card.hidden = false;
    setNote('', '');
    updateDock();

    const done = state.status[code];
    if (done) {
      showAnswerPane(done === 'named' ? '✓ Already named — no penalty' : 'Revealed earlier — name it yourself to turn it green',
        done === 'named' ? 'good' : 'meh');
    } else {
      el.cardQuestion.hidden = false;
      el.cardAnswer.hidden = true;
      el.cardPrompt.textContent = 'What nation is this?';
      el.guessInput.value = '';
      setFeedback('', '');
      el.micStatus.hidden = !state.micOn;
      updateTicker('');
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
    updateDock();
    stopListening();                    // pending finals still arrive and grade
  }

  // The bottom bar holds one thing at a time. With nothing selected in a
  // naming mode it says what to do — hardcore's own bar does that job
  // there, with its two buttons — and both step aside while a country is
  // being asked. Place mode's bar is the word bank, which is never idle.
  function updateDock() {
    const L = state.level;
    const asking = !el.card.hidden;
    document.body.classList.toggle('asking', asking);
    el.idleBar.hidden = !L || L.done || L.mode !== 'name' || asking;
    if (L) {
      el.idleText.textContent = L.t0 == null
        ? `${TAP} any nation to name it. The clock starts on your first move.`
        : `${TAP} a nation to name it`;
    }
  }

  function setFeedback(msg, cls) {
    el.feedback.textContent = msg;
    el.feedback.className = cls;
  }

  // What the last answer came to, above the idle bar (and hardcore's):
  // the question it belonged to has closed by the time it is read.
  function setNote(msg, cls) {
    for (const n of document.querySelectorAll('.dock-note')) {
      n.textContent = msg;
      n.className = `dock-note ${cls}`;
    }
  }

  function setStatus(code, st) {
    state.status[code] = st;
    applyStatus(code);
    updateLevelUI();                 // …which refreshes the progress readout too
  }

  function submitGuess(guess, viaVoice = false) {
    if (state.level?.pausedAt != null) return;
    ensureTimer();
    const code = state.selected;
    if (!code || state.status[code] === 'named') return;
    if (!guess.trim()) return;
    const c = COUNTRY_BY_CODE[code];

    // viaVoice also opens the phonetic pass: this is the same submission
    // path the keyboard uses, and a spoken answer has to be forgiven the
    // same way here as it is when the queue grades it off screen.
    if (matchGuess(guess, code, viaVoice)) {
      settle(code, true);
      setStatus(code, 'named');
      flash(code, 'flash-good', 900);
      popAt(state.selectedAt || mapToScreen(focusPoint(code).x, focusPoint(code).y), `✓ ${c.name}`, 'good');
      // A right answer closes the question: the bar goes back to idle
      // with the result above it, and the next click is the next country
      // — nothing to dismiss in between.
      const first = state.level?.result[code] === true;
      deselect();
      setNote(`✓ ${c.name}${first ? ' · first try' : ''}`, 'good');
      checkComplete();
    } else {
      settle(code, false);
      state.attempts++;
      flash(code, 'flash-bad', 450);
      el.card.classList.remove('shake');
      void el.card.offsetWidth;             // restart the animation
      el.card.classList.add('shake');
      const msg = viaVoice
        ? `I heard “${guess}” — not this one. Try again!`
        : state.attempts >= 3
          ? 'Not quite — need a hint, or Reveal it?'
          : 'Not quite — try again!';
      setFeedback(msg, 'bad');
      el.guessInput.select();
    }
  }

  // Three hints, each a different *kind* of clue, and none of them worth
  // more than two letters. The old ladder handed over one more letter
  // every time and ran to half the name, so a country you did not know
  // could simply be spelled out of it — which is no answer at all to
  // someone who knew it cold. It also charged you for that silently: the
  // first hint settles the country as not-first-try, and nothing said so
  // until the results called it a miss. Now the first one says it out
  // loud, and the fourth one does not exist.
  const MAX_HINTS = 3;

  function hintText(c, level) {
    const name = c.name;
    if (level === 1) {
      const words = name.split(' ').length;
      return `${c.region} · ${words > 1 ? `${words} words` : `${name.length} letters`}`;
    }
    if (level === 2) return `${SUBREGION_BY_CODE[c.code] || c.region} · starts with “${name[0]}”`;
    return `“${name.slice(0, 2)}…” · ${name.length} letters — that is the last one`;
  }

  function updateHintBtn() {
    if (!el.hintBtn) return;
    el.cardActions.hidden = isHardcore();
    if (isHardcore()) return;
    const left = MAX_HINTS - state.hintLevel;
    el.hintBtn.disabled = left <= 0;
    el.hintBtn.innerHTML = icon('lightbulb') + (left > 0
      ? `Hint ${state.hintLevel + 1}/${MAX_HINTS}`
      : 'No hints left');
  }

  function giveHint() {
    const c = COUNTRY_BY_CODE[state.selected];
    if (!c || isHardcore() || state.hintLevel >= MAX_HINTS) return;
    ensureTimer();
    const costsNow = state.level && state.level.result[c.code] === undefined;
    settle(c.code, false);
    state.hintLevel++;
    setFeedback(hintText(c, state.hintLevel) +
      (costsNow ? ' — no longer counts as first-try' : ''), 'hint');
    updateHintBtn();
  }

  function revealAnswer() {
    const code = state.selected;
    if (!code || isHardcore() || state.status[code] === 'named') return;
    settle(code, false);
    if (state.status[code] !== 'revealed') setStatus(code, 'revealed');
    showAnswerPane('Revealed — name it yourself later to turn it green', 'meh');
    checkComplete();
  }

  // ————— hardcore mode —————

  // Somewhere you have not named yet. Which one is chosen at random, so
  // it cannot be worked backwards into an ordering of the map, and it
  // selects the country as if you had clicked it — asking the question
  // without answering it.
  function findGap() {
    const L = state.level;
    if (!L || L.done) return;
    const left = L.codes.filter(c => !state.status[c]);
    if (!left.length) return;
    const code = left[Math.floor(Math.random() * left.length)];
    zoomToCodes([code], 300);
    setTimeout(() => selectCountry(code, mapToScreen(focusPoint(code).x, focusPoint(code).y)), 320);
  }

  // Giving up ends the run for good, so the button asks once — and then
  // disarms itself rather than waiting for an answer, because a dialog
  // in the middle of a timed run is worse than the misclick it prevents.
  let giveUpTimer = null;
  function armGiveUp(on) {
    clearTimeout(giveUpTimer);
    el.hcGiveup.classList.toggle('arming', on);
    el.hcGiveup.innerHTML = on ? 'Sure? This ends it' : `${icon('flag-checkered')}I'm done <kbd>G</kbd>`;
    if (on) giveUpTimer = setTimeout(() => armGiveUp(false), 4000);
  }

  function giveUp() {
    const L = state.level;
    if (!L || L.done) return;
    if (!el.hcGiveup.classList.contains('arming')) { armGiveUp(true); return; }
    armGiveUp(false);
    finishLevel();
  }

  // ————— progress —————

  function updateProgress() {
    const L = state.level;
    const codes = L ? L.codes : WORLD_CODES;
    // Place mode counts everything that has been settled, however it
    // got there; name mode only counts the ones you actually named.
    const n = L?.mode === 'place'
      ? codes.filter(c => state.status[c]).length
      : codes.filter(c => state.status[c] === 'named').length;
    el.progressText.textContent = n === codes.length ? `all ${codes.length}` : `${n} / ${codes.length}`;
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
  // The veil transitions now, so `hidden` (display: none) can only go on
  // after the fade out has run — and has to come off a frame before the
  // fade in starts, or there is nothing to transition from.
  let veilTimer = null;
  function showVeil(on) {
    clearTimeout(veilTimer);
    if (on) {
      el.pauseVeil.hidden = false;
      requestAnimationFrame(() => el.pauseVeil.classList.add('on'));
    } else {
      el.pauseVeil.classList.remove('on');
      veilTimer = setTimeout(() => {
        if (!el.pauseVeil.classList.contains('on')) el.pauseVeil.hidden = true;
      }, 300);
    }
  }

  // The menu's first row is pause while you play and resume while you don't.
  function markPause(paused) {
    el.pauseTimer.innerHTML = `${icon(paused ? 'play' : 'pause')}<span>${paused ? 'Resume' : 'Pause'}</span><kbd>P</kbd>`;
  }

  function togglePause() {
    const L = state.level;
    if (!L || L.done || L.t0 == null) return;
    if (L.pausedAt == null) {
      L.pausedAt = performance.now();
      showVeil(true);
      markPause(true);
      if (document.activeElement?.blur) document.activeElement.blur();
      // Paused means the mic is actually off, not merely ignored. Leaving
      // it open banked a transcript nothing was consuming — it grew for as
      // long as the pause lasted, then graded itself against the queue the
      // moment play resumed. The queue survives (those clicks are still
      // owed an answer); the half-heard words do not.
      stopListening();
      stopMeter();
      voiceBuf = [];
      updateTicker('');
    } else {
      L.t0 += performance.now() - L.pausedAt;
      L.pausedAt = null;
      showVeil(false);
      markPause(false);
      if (state.micOn) {
        startMeter();
        if (state.selected) startListening();
      }
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

  // Three modes, in the order the mode button cycles them. Hardcore is
  // name mode with the safety net taken away: no hints, no reveals, and
  // nothing forcing you to finish — you stop when you are done, and
  // whatever you never got is what you never got. Its one concession is
  // that it will take you to a country you have not named yet, because
  // "which of the 195 have I missed" is a search problem rather than a
  // knowledge one, and hunting for gaps is not the game.
  const MODES = ['name', 'place', 'hardcore'];
  const MODE_LABEL = { name: 'Name mode', place: 'Place mode', hardcore: 'Hardcore' };
  const MODE_NAME = { name: 'Name', place: 'Place', hardcore: 'Hardcore' };
  const MODE_ICON = { name: 'pencil-simple', place: 'puzzle-piece', hardcore: 'skull' };
  const modeLabel = (m) => icon(MODE_ICON[m]) + MODE_LABEL[m];
  const nextMode = (m) => MODES[(MODES.indexOf(m) + 1) % MODES.length];
  const isHardcore = () => state.level?.mode === 'hardcore';

  function startLevel(def, mode = 'name') {
    clearLevelClasses();
    const wasMarked = Object.keys(state.status);
    state.status = {};
    for (const code of wasMarked) applyStatus(code);
    if (state.heat) { state.heat = false; applyHeat(); }

    state.level = {
      id: def.id, name: def.name, tier: def.tier, region: def.region, def,
      codes: def.codes.slice(), mode,
      armed: null, strikes: 0, result: {},
      t0: null, pausedAt: null, elapsed: 0, done: false,
    };
    deselect();
    closePanels();
    el.home.hidden = el.onboard.hidden = el.modeDialog.hidden = true;
    held = false;

    // The whole-world challenge covers everything, so nothing dims; a
    // smaller challenge fades the rest of the map back.
    const isSubset = state.level.codes.length < WORLD_CODES.length;
    document.body.classList.toggle('level-active', isSubset);
    for (const code of state.level.codes) {
      for (const e of elemsByCode[code] || []) e.classList.add('in-level');
    }
    // The mode's own dock goes up *before* the camera moves, and the safe
    // area is re-read on the spot: the observer that usually does that
    // fires a frame later, which is a frame after the fit has already
    // framed a country underneath the bar that just appeared.
    if (mode === 'place') buildBank();
    else el.wordBank.hidden = true;
    el.hardcoreBar.hidden = mode !== 'hardcore';
    document.body.classList.toggle('hardcore', mode === 'hardcore');
    armGiveUp(false);
    document.body.classList.remove('bank-open');
    setNote('', '');
    updateDock();
    closeMenu();
    updateSafe();

    updateOverlay();
    zoomToCodes(state.level.codes);
    el.levelBanner.hidden = false;
    el.pauseVeil.hidden = true;
    markPause(false);
    updateLevelUI();
    startTimer();
  }

  function clearLevelClasses() {
    document.querySelectorAll('.in-level').forEach(e => e.classList.remove('in-level'));
  }

  function updateLevelUI() {
    const L = state.level;
    if (!L) return;
    el.levelTitle.textContent = L.name;
    el.levelChip.textContent = MODE_NAME[L.mode];
    for (const b of el.modeSeg.children) b.classList.toggle('on', b.dataset.mode === L.mode);
    updateProgress();
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
    // Start folded — the list blocks the map otherwise; the caret opens it.
    el.wordBank.classList.add('collapsed');
    el.bankCollapse.innerHTML = icon('caret-up');
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
      b.addEventListener('click', () => { armChip(code); setBankHint('', ''); });
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
    // On a phone the hit/miss line is a pill that fades out above the bar;
    // two misses in a row carry the same class, so drop it for a beat or
    // the second one never replays the fade and never shows.
    el.bankHint.className = '';
    if (cls) { void el.bankHint.offsetWidth; el.bankHint.className = cls; }
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
    setBankHint(`Skipped ${skipped} — it's back at the end of the list.`, '');
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

  // Show where the current target is (three misses, or Show me). It
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

  // The next name comes up in the target row, which pulses to say so —
  // the line under it does not repeat it ("✓ Malta → now find Belize"
  // was three things to read for one thing that happened). A hit says
  // nothing more: the pop on the map already did. A miss or a reveal
  // keeps its line, because that is where the cost is explained.
  function advanceTarget(msg, cls) {
    const L = state.level;
    L.armed = null;
    const next = el.bankChips.querySelector('.chip');
    if (next) {
      armChip(next.dataset.code);
      setBankHint(cls === 'good' ? '' : msg, cls === 'good' ? '' : cls);
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
    showVeil(false);
    markPause(false);
    el.hardcoreBar.hidden = true;
    document.body.classList.remove('hardcore');
    closeMenu();
    stopTimer();
    const total = L.codes.length;
    const clean = L.codes.filter(c => L.result[c] === true).length;
    const key = `${L.id}|${L.mode}`;
    const prev = stats.bests[key] || {};
    const newFast = !prev.ms || L.elapsed < prev.ms;
    const isClean = clean === total;
    const newClean = isClean && (!prev.clean || L.elapsed < prev.clean);
    const newAcc = clean > (prev.acc || 0);
    // A practice run sets no records, and neither does a run that was
    // stopped short: giving up after two seconds is not a best time.
    const stopped = L.codes.some(c => !state.status[c]);
    if (L.id !== 'custom' && !stopped) stats.bests[key] = {
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
    // The time leads, because the time is the score. A run that was
    // stopped (hardcore's "I'm done") is not a finish and is not ranked.
    const stopped = L.codes.some(c => !state.status[c]);
    const pct = Math.round((clean / total) * 100);
    el.resultsSub.textContent = `${L.name} · ${MODE_LABEL[L.mode]}`;
    el.resultsTime.textContent = fmtTime(L.elapsed);
    el.resultsTitle.textContent = stopped ? 'Run ended' : isClean ? 'Clean run' : 'Challenge complete';
    el.resultsBest.hidden = stopped || !(newFast && prev.ms);
    const tile = (label, value) =>
      `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div></div>`;
    el.resultsTiles.innerHTML =
      tile('First try', `${clean} / ${total}`) +
      tile('Accuracy', `${pct}%`) +
      tile('Previous best', stopped ? 'Not ranked' : prev.ms ? fmtTime(prev.ms) : '—') +
      (prev.clean ? tile('Best clean run', fmtTime(prev.clean)) : '');

    // "Missed" used to mean everything that was not first-try, which put
    // a country you took one hint on and then named right next to one you
    // never got at all. Since a hint still leaves the map green, that
    // read as the results contradicting the map you had just been
    // looking at. They are different things, and they are listed as
    // different things.
    const got = (c) => state.status[c] === 'named' || state.status[c] === 'placed';
    const lost = L.codes.filter(c => L.result[c] !== true && !got(c));
    const helped = L.codes.filter(c => L.result[c] !== true && got(c));

    const chipsFor = (codes) => {
      const box = document.createElement('div');
      box.className = 'chips';
      for (const code of codes) {
        const b = document.createElement('button');
        b.className = 'chip';
        b.innerHTML = `${flagHTML(code)}<span></span>`;
        b.querySelector('span').textContent = COUNTRY_BY_CODE[code].name;
        b.addEventListener('click', () => { el.results.hidden = true; zoomToCodes([code]); });
        box.appendChild(b);
      }
      return box;
    };

    el.resultsMisses.innerHTML = '';
    if (!lost.length && !helped.length) {
      el.resultsMisses.innerHTML = `<p class="clean">Every single one on the first try.</p>`;
    } else {
      for (const [codes, title] of [
        [lost, `Never got it (${lost.length}) — click one to see it`],
        [helped, `Got there, but not first try (${helped.length}) — a hint, a wrong guess, or both`],
      ]) {
        if (!codes.length) continue;
        const h = document.createElement('h3');
        h.textContent = title;
        el.resultsMisses.appendChild(h);
        el.resultsMisses.appendChild(chipsFor(codes));
      }
    }
    // The misses, as a challenge of their own — in the mode they were
    // missed in, except hardcore's, which are practised with the net up.
    const again = [...lost, ...helped];
    el.resultsPractise.hidden = !again.length;
    el.resultsPractise.textContent = again.length === 1 ? 'Practise the 1 miss' : `Practise the ${again.length} misses`;
    el.resultsPractise.onclick = () => startLevel(
      { id: 'custom', name: `Missed from ${L.name}`, tier: 'custom', codes: again },
      L.mode === 'hardcore' ? 'name' : L.mode);
    el.resultsMode.textContent = `Try ${MODE_LABEL[nextMode(L.mode)]}`;
    el.results.hidden = false;
    el.results.scrollTop = 0;
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

  let statsFrom = 'play';
  function openStats() {
    statsFrom = el.home.hidden ? 'play' : 'home';
    deselect();
    closePanels();
    closeMenu();
    holdRun();
    el.home.hidden = true;
    const names = COUNTRIES.map(c => stats.byCode[c.code]?.name).filter(Boolean);
    const mastered = names.filter(r => r.streak >= 3).length;
    const longest = Math.max(0, ...names.map(r => r.best || r.streak));
    const tile = (label, value) =>
      `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div></div>`;
    el.statTiles.innerHTML =
      tile('Games played', stats.games) +
      tile('Nations tried', `${names.length} / ${WORLD_CODES.length}`) +
      tile('Mastered', mastered) +
      tile('Longest streak', `${longest} in a row`);
    el.flagsToggle.checked = state.prefs.flags;

    el.bestTimes.innerHTML = '';
    for (const c of CHALLENGES) {
      for (const m of MODES) {
        const b = bestFor(c.id, m);
        if (!b?.ms) continue;
        const row = document.createElement('div');
        row.className = 'best-row';
        row.innerHTML = `<span class="best-name"></span><span class="best-mode">${MODE_NAME[m]}</span><span class="best-t">${fmtTime(b.ms)}</span>`;
        row.querySelector('.best-name').textContent = c.name;
        el.bestTimes.appendChild(row);
      }
    }
    if (!el.bestTimes.children.length) el.bestTimes.innerHTML = '<p class="empty-note">Finish a challenge to set a time.</p>';

    el.regionMastery.innerHTML = '';
    for (const region of REGIONS) {
      const codes = CODES_BY_REGION[region];
      const n = codes.filter(code => (stats.byCode[code]?.name?.streak || 0) >= 3).length;
      const row = document.createElement('div');
      row.className = 'mastery-row';
      row.innerHTML = `<span class="m-name"></span><span class="bar"><i style="width:${(100 * n / codes.length).toFixed(0)}%"></i></span><span class="m-n">${n} / ${codes.length}</span>`;
      row.querySelector('.m-name').textContent = region;
      el.regionMastery.appendChild(row);
    }
    el.statsPanel.hidden = false;
    el.statsPanel.scrollTop = 0;
  }

  function closeStats() {
    el.statsPanel.hidden = true;
    if (statsFrom === 'home') openHome(); else releaseRun();
  }

  function applyHeat() {
    document.body.classList.toggle('heatmap', state.heat);
    el.heatBar.hidden = el.heatPanel.hidden = !state.heat;
    const mode = heatMode();
    for (const b of el.heatSeg.children) b.classList.toggle('on', b.dataset.mode === mode);
    if (!state.heat && heatSel) heatSelect(null);
    for (const code of Object.keys(shapes)) {
      const p = shapes[code];
      p.classList.remove('heat-x', 'heat-1', 'heat-2', 'heat-3', 'heat-4');
      if (!state.heat) continue;
      const r = stats.byCode[code]?.[mode];
      p.classList.add('heat-' + heatBin(r));
    }
  }

  // ————— screens —————
  //
  // Home, stats, the intro, the results and the heat map each take the
  // whole window. A run that is under way is paused while one of them is
  // up and picks itself back up when the last one closes — unless a new
  // challenge was started from there, which is a fresh clock anyway.

  let held = false;                 // a screen paused the run, so a screen resumes it
  const screenOpen = () => !el.home.hidden || !el.statsPanel.hidden || !el.onboard.hidden ||
    !el.results.hidden || !el.modeDialog.hidden || state.heat;

  function holdRun() {
    const L = state.level;
    if (L && !L.done && L.t0 != null && L.pausedAt == null) { togglePause(); held = true; }
  }

  function releaseRun() {
    if (!held || screenOpen()) return;
    held = false;
    if (state.level?.pausedAt != null) togglePause();
  }

  // Share of these countries named three times running, as a percentage.
  function mastery(codes) {
    const n = codes.filter(c => (stats.byCode[c]?.name?.streak || 0) >= 3).length;
    return codes.length ? Math.round(100 * n / codes.length) : 0;
  }

  // The time to beat for a challenge, whichever mode it was set in.
  function bestOf(id) {
    const b = MODES.map(m => bestFor(id, m)).find(b => b?.ms);
    return b ? fmtTime(b.ms).replace(/\.\d$/, '') : '—';
  }

  // One card: a challenge and, under it, the smaller ones inside it. The
  // whole world is the first card and has nothing under it.
  function homeCard(def, subs) {
    const card = document.createElement('div');
    card.className = 'home-card';
    const m = mastery(def.codes);
    const head = document.createElement('button');
    head.className = 'home-card-head';
    head.innerHTML =
      `<span class="hc-row"><b></b><span>${def.codes.length} nations</span>${icon('caret-right')}</span>` +
      `<span class="bar"><i style="width:${m}%"></i></span>` +
      `<span class="hc-row hc-meta"><span>${m}% mastered</span><span>Best ${bestOf(def.id)}</span></span>`;
    head.querySelector('b').textContent = def.name;
    head.addEventListener('click', () => askMode(def));
    card.appendChild(head);
    if (subs.length) {
      const list = document.createElement('div');
      list.className = 'home-subs';
      for (const sub of subs) {
        const b = document.createElement('button');
        b.innerHTML = `<span></span><span class="bar"><i style="width:${mastery(sub.codes)}%"></i></span><em>${sub.codes.length}</em>`;
        b.firstElementChild.textContent = sub.name;
        b.addEventListener('click', () => askMode(sub));
        list.appendChild(b);
      }
      card.appendChild(list);
    }
    return card;
  }

  function openHome() {
    holdRun();
    deselect();
    closePanels();
    closeMenu();
    if (state.heat) { state.heat = false; applyHeat(); }
    const L = state.level;
    const live = !!L && L.t0 != null && !L.done;
    el.homeContinue.hidden = !live;
    if (live) {
      el.homeContinue.querySelector('b').textContent = `${L.name} · ${MODE_NAME[L.mode]}`;
      el.homeContinue.querySelector('em').textContent =
        `${el.progressText.textContent.replace(' / ', ' of ')} · ${el.levelTimer.textContent}`;
    }
    el.homeCards.innerHTML = '';
    el.homeCards.appendChild(homeCard(CHALLENGE_BY_ID.world, []));
    for (const region of REGIONS) {
      el.homeCards.appendChild(homeCard(CHALLENGE_BY_ID['cont:' + region],
        SUBREGIONS.filter(s => s.region === region).map(s => CHALLENGE_BY_ID['sub:' + s.name])));
    }
    el.home.hidden = false;
    el.home.scrollTop = 0;
  }

  function closeHome() {
    el.home.hidden = true;
    releaseRun();
  }

  // Which mode, asked once a challenge is picked. It opens on the mode
  // you last played, so the common case is one more click.
  let pick = null;
  function askMode(def) {
    pick = { def, mode: state.level?.mode || 'place' };
    el.modeFor.textContent = def.name;
    el.modeCount.textContent = `${def.codes.length} ${def.codes.length === 1 ? 'nation' : 'nations'}`;
    markPick();
    el.modeDialog.hidden = false;
    el.modeStart.focus();
  }

  function markPick() {
    for (const b of el.modeOpts.children) b.classList.toggle('on', b.dataset.mode === pick.mode);
  }

  function closeModeDialog() {
    el.modeDialog.hidden = true;
    pick = null;
  }

  // ————— the intro —————

  let onboardStep = 0;
  function showOnboardStep(n) {
    onboardStep = n;
    for (const s of el.onboard.querySelectorAll('.onboard-step')) s.hidden = Number(s.dataset.step) !== n;
    el.onboardCount.textContent = `0${n + 1} / 03`;
    [...el.onboardDots.children].forEach((d, i) => d.classList.toggle('on', i === n));
    el.onboardNext.textContent = n === 2 ? 'Choose a challenge' : 'Next';
  }

  function openOnboard() {
    holdRun();
    deselect();
    closePanels();
    closeMenu();
    el.home.hidden = true;
    showOnboardStep(0);
    el.onboard.hidden = false;
  }

  function finishOnboard() {
    el.onboard.hidden = true;
    if (!state.seenIntro) { state.seenIntro = true; savePrefs(); }
    openHome();
  }

  // ————— the heat map view —————

  let heatFrom = 'play';
  function openHeat() {
    holdRun();
    heatFrom = el.home.hidden ? 'play' : 'home';
    deselect();
    closePanels();
    closeMenu();
    el.home.hidden = true;
    state.heat = true;
    if (!heatShown) heatShown = played('place') > played('name') ? 'place' : 'name';
    applyHeat();
    heatSelect(null);
    animateView(worldView(), 260);
  }

  function closeHeat() {
    state.heat = false;
    applyHeat();
    if (heatFrom === 'home') { openHome(); return; }
    if (state.level) zoomToCodes(state.level.codes);
    releaseRun();
  }

  // Which mode's streaks the heat map is showing — the switch in its bar.
  // It opens on the one you have actually played, so a place-mode player
  // is not shown a map of everything they have never typed.
  let heatShown = null;
  const heatMode = () => heatShown || 'name';
  const played = (mode) => COUNTRIES.filter(c => stats.byCode[c.code]?.[mode]).length;
  // A streak is what is coloured. No streak — never tried, or missed last
  // time — is plain land: the map shows what you know, not what went wrong.
  const heatBin = (r) => (!r?.streak ? 'x' : r.streak >= 5 ? 4 : r.streak >= 3 ? 3 : r.streak);

  let heatSel = null;
  function heatSelect(code) {
    if (heatSel) shapes[heatSel]?.classList.remove('selected');
    heatSel = code;
    el.heatSel.hidden = !code;
    el.heatPrompt.hidden = !!code;
    if (!code) return;
    shapes[code]?.classList.add('selected');
    const c = COUNTRY_BY_CODE[code];
    const r = stats.byCode[code]?.[heatMode()];
    el.heatFlag.innerHTML = flagHTML(code);
    el.heatName.textContent = c.name;
    el.heatDot.className = `leg-${heatBin(r)}`;
    el.heatText.textContent = !r ? 'Not tried yet' : r.streak === 0 ? 'No streak: missed last time' : `${r.streak} in a row on the first try`;
  }

  function closePanels() {
    el.statsPanel.hidden = true;
    el.help.hidden = true;
    el.dev.hidden = true;
    el.results.hidden = true;
  }

  // ————— UI wiring —————

  function updateMicUI() {
    el.micToggle.classList.toggle('listening', state.micOn);
    el.micToggle.classList.toggle('off', !state.micOn);
    el.micToggle.querySelector('.menu-state').textContent = state.micOn ? 'On' : 'Off';
    el.micStatus.hidden = !(state.micOn && state.selected && !state.status[state.selected]);
    if (state.micOn) startMeter(); else stopMeter();
    updateTicker();
  }

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
    el.cardPrompt.textContent = 'What nation is this?';
    el.guessInput.value = '';
    setFeedback('', '');
    el.guessInput.focus();
  });

  el.progressWrap.addEventListener('click', openHome);

  // The menu: everything a run does not need in front of it. Any choice
  // closes it, and so does a tap anywhere else — including on the map,
  // where that tap is spent on closing the menu and not on a country.
  const menuOpen = () => !el.menu.hidden;
  function closeMenu() {
    el.menu.hidden = true;
    el.menuBtn.setAttribute('aria-expanded', 'false');
  }
  el.menuBtn.addEventListener('click', () => {
    const open = el.menu.hidden;
    el.menu.hidden = !open;
    el.menuBtn.setAttribute('aria-expanded', String(open));
  });
  el.menu.addEventListener('click', (e) => { if (e.target.closest('button')) closeMenu(); });
  document.addEventListener('pointerdown', (e) => {
    if (!menuOpen() || e.target.closest('#menu, #menu-btn')) return;
    closeMenu();
    if (e.target.closest('#map')) e.stopPropagation();
  }, true);

  el.menuRestart.addEventListener('click', () => {
    const L = state.level;
    if (L) startLevel(L.def, L.mode);
  });
  el.challengesBtn.addEventListener('click', openHome);
  el.modeSeg.addEventListener('click', (e) => {
    const mode = e.target.closest('button')?.dataset.mode;
    const L = state.level;
    if (mode && L && mode !== L.mode) startLevel(L.def, mode);
  });
  el.heatBtn.addEventListener('click', openHeat);
  el.introBtn.addEventListener('click', openOnboard);

  el.homeContinue.addEventListener('click', closeHome);
  el.homeBack.addEventListener('click', closeHome);
  el.homeIntro.addEventListener('click', openOnboard);
  el.homeStats.addEventListener('click', openStats);
  el.homeHeat.addEventListener('click', openHeat);
  el.homeHelp.addEventListener('click', () => { el.help.hidden = false; });

  el.modeOpts.addEventListener('click', (e) => {
    const mode = e.target.closest('button')?.dataset.mode;
    if (mode && pick) { pick.mode = mode; markPick(); }
  });
  el.modeDialog.addEventListener('click', (e) => { if (e.target === el.modeDialog) closeModeDialog(); });
  el.modeCancel.addEventListener('click', closeModeDialog);
  el.modeStart.addEventListener('click', () => { if (pick) startLevel(pick.def, pick.mode); });

  el.onboardSkip.addEventListener('click', finishOnboard);
  el.onboardNext.addEventListener('click', () => { if (onboardStep < 2) showOnboardStep(onboardStep + 1); else finishOnboard(); });

  el.heatClose.addEventListener('click', closeHeat);
  el.heatSeg.addEventListener('click', (e) => {
    const mode = e.target.closest('button')?.dataset.mode;
    if (!mode || mode === heatMode()) return;
    heatShown = mode;
    applyHeat();
    heatSelect(heatSel);
  });
  // …and back out of the heat map to wherever stats was opened from
  el.statsHeat.addEventListener('click', () => { el.statsPanel.hidden = true; openHeat(); heatFrom = statsFrom; });

  // (the factor scales the view's width, so zooming in is the small one)
  for (const [b, f] of [[el.zoomIn, 1 / 1.6], [el.zoomOut, 1.6]]) {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => zoomTowards(rectLeft + W / 2, rectTop + (SAFE.top + H - SAFE.bottom) / 2, f));
  }

  el.statsBtn.addEventListener('click', openStats);
  el.statsClose.addEventListener('click', closeStats);
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

  for (const b of [el.hcFind, el.hcGiveup]) b.addEventListener('mousedown', (e) => e.preventDefault());
  el.hcFind.addEventListener('click', findGap);
  el.hcGiveup.addEventListener('click', giveUp);

  for (const b of [el.bankSkip, el.bankShow, el.bankCollapse]) b.addEventListener('mousedown', (e) => e.preventDefault());
  el.bankSkip.addEventListener('click', skipTarget);
  el.bankShow.addEventListener('click', () => revealTarget(false));
  el.bankCollapse.addEventListener('click', () => {
    const collapsed = el.wordBank.classList.toggle('collapsed');
    el.bankCollapse.innerHTML = icon(collapsed ? 'caret-up' : 'caret-down');
    document.body.classList.toggle('bank-open', !collapsed);
  });

  el.resultsAgain.addEventListener('click', () => { const L = state.level; startLevel(L.def, L.mode); });
  el.resultsHome.addEventListener('click', () => { el.results.hidden = true; openHome(); });
  el.resultsMode.addEventListener('click', () => { const L = state.level; startLevel(L.def, nextMode(L.mode)); });

  el.micToggle.addEventListener('click', () => {
    if (!SpeechRec) {
      alert('Voice input is not supported in this browser — try Chrome or Edge. You can still type the names!');
      return;
    }
    state.micOn = !state.micOn;
    if (state.micOn && state.selected) { voicePush(state.selected); startListening(); }
    if (!state.micOn) { stopListening(); voiceQueue.length = 0; voiceBuf = []; updateTicker(''); }
    updateMicUI();
  });

  // ————— full screen —————
  //
  // On a phone this is the single biggest change to how much map you get:
  // in landscape the address bar and the system bars between them eat
  // more height than the map is left with. Fullscreen takes them all away.
  const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

  function toggleFullscreen() {
    if (!fsSupported) return;
    if (fsOn()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const r = document.documentElement;
      const req = (r.requestFullscreen || r.webkitRequestFullscreen).call(r, { navigationUI: 'hide' });
      req?.catch?.(() => {});          // iOS Safari on iPhone has no element fullscreen
    }
  }

  function markFullscreen() {
    const on = fsOn();
    el.fsBtn.classList.toggle('on', on);
    const label = on ? 'Leave full screen' : 'Full screen';
    el.fsBtn.title = `${label} (F)`;
    el.fsBtn.setAttribute('aria-label', label);
    if (on) {
      el.fsBtn.classList.remove('nudge');
      if (!state.seenFs) { state.seenFs = true; savePrefs(); }
    }
  }

  if (fsSupported) {
    el.fsBtn.hidden = false;
    el.fsBtn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', markFullscreen);
    document.addEventListener('webkitfullscreenchange', markFullscreen);
    // Point at it once, on the devices that need it — a phone, where the
    // browser's own chrome is the thing crowding the map out.
    if (!state.seenFs && matchMedia('(pointer: coarse)').matches) {
      el.fsBtn.classList.add('nudge');
      setTimeout(() => el.fsBtn.classList.remove('nudge'), 9000);
    }
    markFullscreen();
  }

  // The keyboard is a little map: 1 2 3 across the north (N. America,
  // Europe, Asia), Q W E across the south (S. America, Africa, South
  // Asia — India across to New Zealand). Tapping the same key again
  // dives into that area's dense pocket; tapping once more comes back
  // out. The row on screen runs west to east, one keyboard column at a
  // time: 1 Q 2 W 3 E.
  //
  // Every landing is a hand-set box in js/views.js — the same rule for all
  // twelve, so a view that looks wrong is a box to drag, not code to read.
  // The four that dive into a button zone go through zoomToZone, which
  // also holds them at the zoom where that zone's buttons unfold.
  const view = (name) => () => zoomToView(name, 220);
  const zone = (name) => () => zoomToZone(ZONE_BY_NAME[name], 220);
  const JUMP_KEYS = {
    1: { name: 'North America', subName: 'Central America', go: view('North America'), sub: view('Central America') },
    2: { name: 'Europe', subName: 'The micro-states', go: view('Europe'), sub: zone('European microstates') },
    3: { name: 'Asia', subName: 'The Middle East', go: view('Asia'), sub: zone('Middle East') },
    q: { name: 'South America', subName: 'The Caribbean', go: view('South America'), sub: zone('Caribbean') },
    w: { name: 'Africa', subName: 'The West African coast', go: view('Africa'), sub: zone('West African coast') },
    e: { name: 'South Asia', subName: 'The Pacific islands', go: view('South Asia'), sub: view('Pacific islands') },
  };
  const jumpState = { key: null, stage: 0, t: 0 };

  // Which jump key a keystroke means. Shift+W still reads as 'w', but
  // Shift+1 arrives as '!' on a US layout and as something else again
  // elsewhere — so for the digits, fall back to the physical key, which
  // every layout agrees on.
  function jumpKeyFor(e) {
    const k = e.key.toLowerCase();
    if (k === '0' || JUMP_KEYS[k]) return k;
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '')?.[1];
    return digit && (digit === '0' || JUMP_KEYS[digit]) ? digit : null;
  }

  // Which key you're standing on, and which of its two floors — and, on
  // every key, where its next tap goes: the area from anywhere else, the
  // dense pocket while you stand on the area, the area again from inside
  // the pocket. A key forgets where you stood after 15s (jumpTo), and the
  // label is told when that happens.
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
    // Under the minimap: where you stand, and where the same key goes next.
    const j = live ? JUMP_KEYS[jumpState.key] : null;
    const deep = !!j && jumpState.stage === 1;
    el.jumpCaption.hidden = !j;
    if (j) {
      const K = jumpState.key.toUpperCase();
      el.jumpCaption.firstElementChild.textContent = deep ? j.subName : j.name;
      el.jumpCaption.lastElementChild.textContent = deep ? `${K} for ${j.name}` : `${K} again for ${j.subName.replace(/^The /, 'the ')}`;
    }
    clearTimeout(jumpMarkTimer);
    if (live) jumpMarkTimer = setTimeout(markJumpKeys, 15020 - (performance.now() - jumpState.t));
  }

  // Say out loud where that key just put you. Cheap to ignore, but it
  // turns a jump that looked wrong into a jump you can read.
  let jumpFlashTimer = null;
  function flashJump(key, label, deep) {
    el.jumpFlash.innerHTML =
      `<span class="jf-key">${key.toUpperCase()}</span>${deep ? '<span class="jf-deep">▸ </span>' : ''}${label}`;
    el.jumpFlash.hidden = true;
    void el.jumpFlash.offsetWidth;                  // restart the fade on a repeat tap
    el.jumpFlash.hidden = false;
    clearTimeout(jumpFlashTimer);
    jumpFlashTimer = setTimeout(() => { el.jumpFlash.hidden = true; }, 850);
  }

  // `straight` skips the first floor: Shift (or shift-click) lands you in
  // the dense pocket in one move, instead of a jump to the area and a
  // second jump out of it that the camera has to animate through. The
  // stage is still set to the deep floor afterwards, so the same key
  // without Shift steps back out exactly as it always did.
  const jumpTo = (key, straight = false) => {
    if (!vb) return;
    if (key === '0') {
      animateView(worldView(), 220);
      jumpState.key = null;
      markJumpKeys();
      flashJump('0', 'Whole world', false);
      return;
    }
    const j = JUMP_KEYS[key];
    if (!j) return;
    const now = performance.now();
    const again = jumpState.key === key && now - jumpState.t < 15000;
    jumpState.stage = straight ? 1 : (again ? (jumpState.stage + 1) % 2 : 0);
    jumpState.key = key;
    jumpState.t = now;
    const deep = jumpState.stage === 1;
    if (deep) j.sub(); else j.go();
    markJumpKeys();
    flashJump(key, deep ? j.subName : j.name, deep);
  };
  for (const b of el.jumpBar.querySelectorAll('button[data-key]')) {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => jumpTo(b.dataset.key, e.shiftKey));
  }

  document.addEventListener('keydown', (e) => {
    // Escape backs out of whatever is on top, one layer at a time; and
    // while a screen is up, no other key reaches the run underneath it.
    if (e.key === 'Escape') {
      e.preventDefault();
      if (menuOpen()) closeMenu();
      else if (!el.modeDialog.hidden) closeModeDialog();
      else if (!el.help.hidden) el.help.hidden = true;
      else if (!el.dev.hidden) el.dev.hidden = true;
      else if (state.heat) closeHeat();
      else if (!el.statsPanel.hidden) closeStats();
      else if (!el.onboard.hidden) finishOnboard();
      else if (!el.home.hidden) closeHome();
      else if (!el.results.hidden) el.results.hidden = true;
      else if (state.level?.pausedAt != null) togglePause();
      else deselect();
      return;
    }
    if (!el.modeDialog.hidden) {
      if (e.key === 'Enter') { e.preventDefault(); el.modeStart.click(); }
      return;
    }
    if (screenOpen() && el.results.hidden) return;
    if (state.level?.pausedAt != null) {
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePause(); }
      return;
    }
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
    else if (e.key === 'r' || e.key === 'R') {
      // The restart button moved into the challenge panel; the key it
      // used to sit next to is the one a run actually reaches for.
      e.preventDefault();
      if (L) startLevel(L.def, L.mode);
    }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
    else if ((e.key === 'm' || e.key === 'M') && isHardcore()) { e.preventDefault(); findGap(); }
    else if ((e.key === 'g' || e.key === 'G') && isHardcore()) { e.preventDefault(); giveUp(); }
    else if (e.key === '?') { e.preventDefault(); toggleHelp(); }
    else if (e.key === '`' && devOn) { e.preventDefault(); toggleDev(); }
    else {
      const key = jumpKeyFor(e);
      if (key) { e.preventDefault(); jumpTo(key, e.shiftKey); }
    }
  });

  window.addEventListener('resize', () => {
    if (!vb) return;
    measure();
    dirty = true;
    setView({ ...vb });
    // The scale just changed under the finger (on Android, usually the URL
    // bar collapsing mid-drag) — rebase the gesture or it lurches.
    reanchor();
    if (!interacting()) bake();
  });

  // ————— boot —————

  // Console hooks for testing (the zoom/fit ones move the view).
  window.NAN_DEBUG = {
    state, geom, view: () => vb, base: () => base, stats: () => stats, lod: () => lod,
    scale: () => scaleFor(vb), fullVB: () => fullVB, size: () => ({ W, H }), SAFE,
    settled: () => animId == null && !zoomAnim.active && !interacting(),
    zoomToCodes, zoomToZone, zoomToView, animateView, fitCodes, mapToScreen, clientToMap, bake,
    worldView, frameAt, safeScale, maxFitScale, viewAspect, viewScale, zoneOpenScale,
    CODES_BY_REGION, SUB_CODES,
    startLevel, CHALLENGE_BY_ID, selectCountry,
  };

  // ?guides draws js/views.js over the map as boxes you can drag. It is a
  // tuning tool, so none of it ships in the game proper: the editor is a
  // separate file that only this flag ever fetches.
  const guidesOn = new URLSearchParams(location.search).has('guides');
  if (guidesOn) {
    const s = document.createElement('script');
    s.src = 'js/guides.js';
    document.body.appendChild(s);
  }

  // The developer panel gathers the tools for working on the game — the
  // globe, the view editor — out of the way of the screens a player sees.
  // A build on this machine or the local network has it in the menu — the
  // dev server, the preview pane, a phone on the LAN. Anywhere else (Pages,
  // a shared artifact) a player might be looking, so it waits for ?dev,
  // which this browser then remembers; ?dev=0 forgets it again.
  const DEV_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|.+\.local)$/;
  const DEV_KEY = 'nan.dev';
  const devParam = new URLSearchParams(location.search).get('dev');
  try {
    if (devParam === '0') localStorage.removeItem(DEV_KEY);
    else if (devParam != null) localStorage.setItem(DEV_KEY, '1');
  } catch { /* private window: the flag still counts for this page */ }
  let devSaved = false;
  try { devSaved = localStorage.getItem(DEV_KEY) === '1'; } catch { /* fine */ }
  const devOn = guidesOn || DEV_HOST.test(location.hostname) || (devParam != null && devParam !== '0') || devSaved;
  const toggleDev = () => { const was = el.dev.hidden; closeMenu(); closePanels(); el.dev.hidden = !was; };
  if (devOn) {
    el.devBtn.hidden = false;
    el.devBtn.addEventListener('click', toggleDev);
    el.devClose.addEventListener('click', () => { el.dev.hidden = true; });
    if (guidesOn) el.devGuides.querySelector('b').textContent = 'Leave the view editor';
    el.devGuides.addEventListener('click', () => {
      const q = new URLSearchParams(location.search);
      if (guidesOn) q.delete('guides'); else q.set('guides', '1');
      q.set('play', state.level?.mode || 'place');   // back on the map, in the mode you were in
      location.search = q.toString();
    });
  }

  loadPrefs();
  loadStats();
  document.body.classList.toggle('no-flags', !state.prefs.flags);
  updateProgress();
  el.micToggle.classList.add('off');
  document.getElementById('hc-note').textContent = `${TAP} a nation to name it`;
  el.heatPrompt.textContent = `${TAP} a nation to see its streak`;

  // Offline play, and the fetch handler Chrome looks for before it will
  // offer to install the game to the home screen — which is the version
  // with no address bar. Rejects harmlessly over file:// and in private
  // windows; nothing above depends on it.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
    });
  }

  initMap().then(() => {
    // The whole world is always loaded underneath, so the map is live
    // the moment a screen closes. ?play skips the screens: a bookmark for
    // going straight in.
    const play = new URLSearchParams(location.search).get('play');
    // Place is where a new player starts: finding a named nation is the
    // gentler way in, and naming them cold is what it builds up to.
    // ?play=name (or hardcore) goes straight into that mode instead.
    startLevel(CHALLENGE_BY_ID.world, MODES.includes(play) ? play : 'place');
    if (play != null) { /* straight in */ }
    else if (state.seenIntro) openHome();
    else openOnboard();
    setTimeout(loadFullDetail, 2500);   // warm the deep-zoom borders once boot has settled
  }).catch((err) => {
    el.map.innerHTML = `<p style="padding:2rem">Could not load the map (${err.message}). If you opened index.html directly, run it through a local web server instead.</p>`;
  });
})();
