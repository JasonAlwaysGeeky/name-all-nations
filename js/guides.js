/*
 * ?guides — the view boxes from js/views.js, drawn over the map so they
 * can be set by eye. Only ever fetched when the address asks for it.
 *
 *   · tap a name (on the map or in the list) to select that box and jump
 *     to it exactly as its key would
 *   · drag the selected box's edges and corners; drag its name to move it
 *   · Done (or Esc, or its row again) lets go of it
 *   · the dashed green frame is this screen's safe area — every box lands
 *     centred in it. A row marked ⚠ lands below the zoom that zone's
 *     buttons were spaced for, so some of them may pair up there
 *   · Save sends the table where it can go: on the local server (npm run
 *     serve) into js/views.js, from whatever device made it; in the
 *     published artifact into its own store, for Claude to bring into
 *     js/views.js; anywhere else to the clipboard, to paste over
 *     VIEW_BOXES. The line under the title says which happened
 *   · until then edits live in this browser's storage (and only apply in
 *     ?guides), so a half-tuned set survives a reload on the phone it was
 *     tuned on
 */
(() => {
  'use strict';
  const STORE = 'nan.viewBoxes';
  const ORIGINAL = JSON.parse(JSON.stringify(VIEW_BOXES));
  const ZONES = Object.fromEntries(BUTTON_ZONES.map(z => [z.name, z]));
  const names = Object.keys(VIEW_BOXES);
  let D = null, selected = null, open = true, lastSig = '', restored = false;

  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    for (const n of names) {
      if (Array.isArray(saved[n]) && saved[n].length === 4 && saved[n].every(Number.isFinite)) {
        if (saved[n].some((v, i) => v !== VIEW_BOXES[n][i])) restored = true;   // edits never saved
        VIEW_BOXES[n].splice(0, 4, ...saved[n]);      // in place: the game reads this same array
      }
    }
  } catch { /* private window, corrupt entry — start from the file */ }

  // Where an edit goes. Every drag is kept in this browser's storage at
  // once, so nothing is lost to a reload; Save is what makes it count.
  // On the local server Save rewrites js/views.js, and once it has, the
  // file is the truth and the browser's copy is dropped, so an old one can
  // never come back over a newer file. In the published artifact, which
  // has no server, Save puts the table in the artifact's own store, where
  // Claude reads it back into js/views.js (and where ?guides on another
  // device finds it). Anywhere else there is nowhere to send it, and Save
  // copies the table to paste over VIEW_BOXES instead. A test driving the
  // page never writes the file or the store at all.
  const live = !navigator.webdriver;
  let toFile = live, dirty = restored, status = '', store = null;
  const keep = () => { try { localStorage.setItem(STORE, JSON.stringify(VIEW_BOXES)); } catch { /* fine */ } };
  const edited = () => { keep(); dirty = true; status = ''; renderRows(); };
  const table = () => Object.fromEntries(names.map(n => [n, [...VIEW_BOXES[n]]]));

  async function save() {
    keep();
    status = 'Saving…';
    renderRows();
    if (toFile) {
      try {
        const r = await fetch('__views', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(table()) });
        if (!r.ok) throw new Error(r.status);
        try { localStorage.removeItem(STORE); } catch { /* fine */ }
        dirty = false; status = 'Saved to js/views.js';
        renderRows();
        return;
      } catch { toFile = false; }
    }
    if (store) {
      try {
        await store.doc('views/boxes').set({ boxes: table(), savedAt: new Date().toISOString() });
        dirty = false; status = 'Saved. Ask Claude to put it in the game';
        renderRows();
        return;
      } catch { /* fall through to the copy */ }
    }
    if (!live) { dirty = false; status = 'Saved in this browser'; renderRows(); return; }
    copy();
    dirty = false; status = 'Copied. Paste it over VIEW_BOXES';
    renderRows();
  }

  // The artifact's store, when this page is the published artifact. Boxes
  // saved there from another device come in here, unless this browser has
  // edits of its own still waiting to be saved.
  if (live && window.claude?.use) {
    window.claude.use('db').then(async (db) => {
      if (!db) return;
      store = db;
      let mine = false;
      try { mine = !!localStorage.getItem(STORE); } catch { /* fine */ }
      if (mine) return;
      try {
        const snap = await db.doc('views/boxes').get();
        const saved = snap.exists ? snap.data().boxes : null;
        if (!saved) return;
        for (const n of names) {
          const b = saved[n];
          if (Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)) VIEW_BOXES[n].splice(0, 4, ...b);
        }
        status = 'Loaded the boxes saved to this artifact';
        renderRows();
      } catch { /* the file's boxes stand */ }
    }).catch(() => {});
  }

  const css = document.createElement('style');
  css.textContent = `
    #gd-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; overflow: hidden; }
    .gd-box { position: absolute; border: 1.5px solid rgba(143, 181, 238, 0.55); border-radius: var(--radius-sm); box-sizing: border-box; }
    .gd-box.sel { border: 2px solid var(--map-selected-stroke); background: rgba(201, 162, 74, 0.08); z-index: 2; }
    .gd-tag { position: absolute; left: -1.5px; top: -1.5px; transform: translateY(-100%); pointer-events: auto;
      font: 500 11px/1 var(--font-body); color: var(--color-accent-100); background: var(--color-accent-700);
      padding: 4px 7px; border-radius: var(--radius-sm) var(--radius-sm) 0 0; white-space: nowrap; cursor: pointer; touch-action: none; user-select: none; }
    .gd-box.sel .gd-tag { background: var(--map-selected-stroke); color: var(--ink-on-fill); cursor: move; }
    .gd-h { position: absolute; width: 26px; height: 26px; margin: -13px; pointer-events: auto; touch-action: none; display: none; }
    .gd-h::after { content: ""; position: absolute; inset: 8px; background: var(--color-bg); border: 2px solid var(--map-selected-stroke); border-radius: 50%; }
    .gd-box.sel .gd-h { display: block; }
    .gd-h[data-h=n], .gd-h[data-h=s] { left: 50%; cursor: ns-resize; }
    .gd-h[data-h=e], .gd-h[data-h=w] { top: 50%; cursor: ew-resize; }
    .gd-h[data-h^=n] { top: 0; } .gd-h[data-h^=s] { top: 100%; }
    .gd-h[data-h$=w] { left: 0; } .gd-h[data-h$=e] { left: 100%; }
    .gd-h[data-h=nw], .gd-h[data-h=se] { cursor: nwse-resize; } .gd-h[data-h=ne], .gd-h[data-h=sw] { cursor: nesw-resize; }
    #gd-safe { position: absolute; border: 1.5px dashed var(--map-named-rim); border-radius: var(--radius-md); box-sizing: border-box; opacity: 0.8; }
    #gd-safe::before { content: "safe area"; position: absolute; right: 6px; top: 4px; font: 500 10px var(--font-body); letter-spacing: 0.04em; color: var(--map-named-rim); }
    #gd-panel [hidden] { display: none !important; }
    #gd-panel { position: absolute; left: 10px; top: 64px; z-index: 40; width: min(340px, calc(100% - 20px));
      font: 12.5px/1.35 var(--font-body); color: var(--ink); background: var(--panel-bg);
      border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); padding: 12px; box-sizing: border-box; }
    #gd-panel header { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
    #gd-panel header b { flex: 1; font-size: 0.95rem; font-weight: 600; }
    #gd-panel header .ic { color: var(--ink-faint); transition: transform 0.15s ease; }
    #gd-panel.folded header .ic { transform: rotate(-90deg); }
    #gd-status { margin-top: 4px; font-size: 0.75rem; color: var(--ink-soft); }
    #gd-status.dirty { color: var(--map-selected-stroke); }
    #gd-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    #gd-panel button { font: 500 0.78rem var(--font-body); padding: 6px 11px; border-radius: var(--radius-md);
      border: 1px solid var(--color-neutral-800); background: var(--color-neutral-900); color: var(--color-neutral-200); cursor: pointer; }
    #gd-panel button:hover { border-color: var(--color-accent-700); }
    #gd-panel button.primary { border-color: var(--accent); color: var(--color-accent-200); }
    #gd-panel button:disabled { opacity: 0.45; cursor: default; border-color: var(--color-neutral-800); }
    #gd-done { margin-left: auto; }
    #gd-rows { margin-top: 10px; max-height: 44vh; overflow: auto; border-top: 1px solid var(--color-neutral-800); padding-top: 6px; }
    .gd-row { display: flex; gap: 10px; padding: 5px 7px; border-radius: var(--radius-sm); cursor: pointer; white-space: nowrap; }
    .gd-row:hover { background: var(--color-neutral-900); }
    .gd-row.sel { background: rgba(201, 162, 74, 0.16); }
    .gd-row span:first-child { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
    .gd-row .n { font-variant-numeric: tabular-nums; color: var(--ink-faint); }
    .gd-row.over .n:last-child { color: var(--fb-bad); font-weight: 600; }
    @media (min-width: 901px) { #gd-panel { left: auto; right: 12px; } }
    #gd-out { display: block; width: 100%; height: 150px; margin-top: 8px; box-sizing: border-box; padding: 6px;
      font: 11px/1.35 var(--font-mono); color: var(--ink); background: var(--color-bg);
      border: 1px solid var(--color-neutral-800); border-radius: var(--radius-md); }
  `;
  document.head.appendChild(css);

  const wrap = document.getElementById('map-wrap');
  const layer = Object.assign(document.createElement('div'), { id: 'gd-layer' });
  const safe = Object.assign(document.createElement('div'), { id: 'gd-safe' });
  layer.appendChild(safe);
  const panel = Object.assign(document.createElement('div'), { id: 'gd-panel' });
  panel.innerHTML = `<header><b id="gd-title">View guides</b><svg class="ic" aria-hidden="true"><use href="icons/ph.svg#caret-down"/></svg></header>
    <p id="gd-status"></p>
    <div id="gd-actions"><button id="gd-save" class="primary">Save</button><button id="gd-copy">Copy</button><button id="gd-reset">Reset</button><button id="gd-done" hidden>Done</button></div>
    <div id="gd-rows"></div><textarea id="gd-out" hidden readonly></textarea>`;
  wrap.append(layer, panel);
  const rowsEl = panel.querySelector('#gd-rows'), outEl = panel.querySelector('#gd-out'), doneEl = panel.querySelector('#gd-done');
  const statusEl = panel.querySelector('#gd-status'), saveEl = panel.querySelector('#gd-save'), actionsEl = panel.querySelector('#gd-actions');

  // Below this a zone's buttons were not spaced to stay apart.
  const tunedFor = (n) => (ZONES[n] ? ZONES[n].minScale : 0);
  const asBox = (b) => ({ x1: b[0], y1: b[1], x2: b[2], y2: b[3] });

  function jump(n) {
    if (ZONES[n]) D.zoomToZone(ZONES[n], 200); else D.zoomToView(n, 200);
  }

  // null puts every box back to an outline: nothing to grab by accident.
  function select(n, andJump) {
    selected = n;
    doneEl.hidden = !n;
    for (const b of layer.querySelectorAll('.gd-box')) b.classList.toggle('sel', b.dataset.name === n);
    renderRows();
    if (n && andJump) jump(n);
  }

  const boxEls = {};
  for (const n of names) {
    const b = document.createElement('div');
    b.className = 'gd-box';
    b.dataset.name = n;
    b.innerHTML = `<div class="gd-tag">${n}</div>` +
      ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].map(h => `<div class="gd-h" data-h="${h}"></div>`).join('');
    layer.appendChild(b);
    boxEls[n] = b;
    for (const grip of b.children) bindGrip(grip, n, grip.dataset.h || 'move');
  }

  // `how` is which edges follow the finger: any of n/s/e/w, or the lot.
  function bindGrip(grip, n, how) {
    let from = null;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (selected !== n) { select(n, how === 'move'); if (how !== 'move') return; }
      grip.setPointerCapture(e.pointerId);
      from = { p: D.clientToMap(e.clientX, e.clientY), box: [...VIEW_BOXES[n]], moved: false };
    });
    grip.addEventListener('pointermove', (e) => {
      if (!from) return;
      const p = D.clientToMap(e.clientX, e.clientY);
      const dx = Math.round(p.x - from.p.x), dy = Math.round(p.y - from.p.y);
      if (!dx && !dy && !from.moved) return;
      from.moved = true;
      let [x1, y1, x2, y2] = from.box;
      if (how === 'move') { x1 += dx; x2 += dx; y1 += dy; y2 += dy; }
      if (how.includes('w')) x1 = Math.min(x1 + dx, x2 - 4);
      if (how.includes('e')) x2 = Math.max(x2 + dx, x1 + 4);
      if (how.includes('n')) y1 = Math.min(y1 + dy, y2 - 4);
      if (how.includes('s')) y2 = Math.max(y2 + dy, y1 + 4);
      VIEW_BOXES[n].splice(0, 4, x1, y1, x2, y2);
      renderRows();
    });
    const end = () => {
      if (!from) return;
      // A tap on the name (no drag) on the already-selected box re-jumps.
      if (from.moved) edited(); else if (how === 'move') jump(n);
      from = null;
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  function renderRows() {
    panel.classList.toggle('folded', !open);
    statusEl.textContent = status || (dirty ? 'Unsaved changes' : 'Drag a box, then Save');
    statusEl.classList.toggle('dirty', dirty && !status);
    saveEl.disabled = !dirty;
    rowsEl.hidden = actionsEl.hidden = !open;
    if (!open) { outEl.hidden = true; return; }
    rowsEl.innerHTML = '';
    for (const n of names) {
      const box = asBox(VIEW_BOXES[n]);
      const lands = D.viewScale(box);
      const over = lands < tunedFor(n);
      const row = document.createElement('div');
      row.className = `gd-row${n === selected ? ' sel' : ''}${over ? ' over' : ''}`;
      const why = over
        ? `lands below ×${tunedFor(n)}, where this zone's buttons were spaced to stay apart — some may pair up`
        : 'zoom this screen lands at, px per map unit';
      row.innerHTML = `<span>${n}</span><span class="n">${VIEW_BOXES[n].join(' ')}</span>` +
        `<span class="n" title="${why}">×${lands.toFixed(1)}${over ? ' ⚠' : ''}</span>`;
      // On a phone the list is most of the map; picking from it folds it.
      row.addEventListener('click', () => {
        if (n === selected) { select(null); return; }          // a second tap lets go of it
        if (D.size().W <= 900) open = false;
        select(n, true);
      });
      rowsEl.appendChild(row);
    }
  }

  function tableText() {
    const lines = names.map(n => `  ${`'${n}':`.padEnd(26)}[${VIEW_BOXES[n].join(', ')}],`);
    return `const VIEW_BOXES = {\n${lines.join('\n')}\n};\n`;
  }

  function copy() {
    outEl.value = tableText();
    outEl.hidden = false;
    outEl.select();
    navigator.clipboard?.writeText(outEl.value).catch(() => { /* the textarea is the fallback */ });
  }

  panel.querySelector('header').addEventListener('click', () => { open = !open; renderRows(); });
  doneEl.addEventListener('click', () => select(null));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') select(null); });
  saveEl.addEventListener('click', save);
  panel.querySelector('#gd-copy').addEventListener('click', copy);
  // Back to what the file held when this page loaded: an edit like any
  // other, so it waits for Save too.
  panel.querySelector('#gd-reset').addEventListener('click', () => {
    for (const n of names) VIEW_BOXES[n].splice(0, 4, ...ORIGINAL[n]);
    try { localStorage.removeItem(STORE); } catch { /* fine */ }
    dirty = true; status = '';
    renderRows();
  });

  function frame() {
    const { W, H } = D.size(), S = D.SAFE;
    Object.assign(safe.style, {
      left: `${S.left}px`, top: `${S.top}px`,
      width: `${W - S.left - S.right}px`, height: `${H - S.top - S.bottom}px`,
    });
    // The bank opening, the card closing, the keys folding: all move the
    // numbers in the list without anything here having been touched.
    const sig = `${W},${H},${S.top},${S.bottom},${S.left},${S.right}`;
    if (sig !== lastSig) { lastSig = sig; renderRows(); }
    for (const n of names) {
      const [x1, y1, x2, y2] = VIEW_BOXES[n];
      const a = D.mapToScreen(x1, y1), b = D.mapToScreen(x2, y2);
      Object.assign(boxEls[n].style, {
        left: `${a.x}px`, top: `${a.y}px`, width: `${b.x - a.x}px`, height: `${b.y - a.y}px`,
      });
    }
    requestAnimationFrame(frame);
  }

  // The map loads after the scripts do; nothing here means anything until
  // there is a view to project through.
  (function boot() {
    D = window.NAN_DEBUG;
    if (!D || !D.view()) { setTimeout(boot, 100); return; }
    renderRows();
    window.addEventListener('resize', () => setTimeout(renderRows, 50));
    requestAnimationFrame(frame);
  })();
})();
