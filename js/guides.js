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
 *   · on the local server (npm run serve) every change is written
 *     straight into js/views.js, from whatever device made it — the
 *     panel's title says so. Nothing to copy
 *   · anywhere else there is nowhere to write to: edits live in this
 *     browser's storage (and only apply in ?guides), so a half-tuned set
 *     survives a reload on the phone it was tuned on, and Copy hands back
 *     the table to paste over VIEW_BOXES
 */
(() => {
  'use strict';
  const STORE = 'nan.viewBoxes';
  const ORIGINAL = JSON.parse(JSON.stringify(VIEW_BOXES));
  const ZONES = Object.fromEntries(BUTTON_ZONES.map(z => [z.name, z]));
  const names = Object.keys(VIEW_BOXES);
  let D = null, selected = null, open = true, lastSig = '';

  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    for (const n of names) {
      if (Array.isArray(saved[n]) && saved[n].length === 4 && saved[n].every(Number.isFinite)) {
        VIEW_BOXES[n].splice(0, 4, ...saved[n]);      // in place: the game reads this same array
      }
    }
  } catch { /* private window, corrupt entry — start from the file */ }

  // Where an edit goes. The local server takes it and rewrites the file;
  // once it has, the file is the truth and the browser's copy is dropped,
  // so an old one can never come back over a newer file. A host with no
  // such endpoint (a plain static server, the live site) answers with an
  // error once and is not asked again — there the browser's copy is all
  // there is. A test driving the page never writes the file at all.
  let toFile = !navigator.webdriver, fileTimer = null, saved = '';
  const keep = () => { try { localStorage.setItem(STORE, JSON.stringify(VIEW_BOXES)); } catch { /* fine */ } };
  function save() {
    keep();
    if (!toFile) return;
    clearTimeout(fileTimer);
    fileTimer = setTimeout(async () => {
      try {
        const r = await fetch('__views', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(VIEW_BOXES) });
        if (!r.ok) throw new Error(r.status);
        try { localStorage.removeItem(STORE); } catch { /* fine */ }
        saved = 'saved to js/views.js';
      } catch {
        toFile = false;
        saved = 'saved in this browser';
      }
      renderRows();
    }, 350);
  }

  const css = document.createElement('style');
  css.textContent = `
    #gd-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; overflow: hidden; }
    .gd-box { position: absolute; border: 2px solid rgba(255, 140, 0, 0.55); box-sizing: border-box; }
    .gd-box.sel { border-color: #ff3d7f; background: rgba(255, 61, 127, 0.07); z-index: 2; }
    .gd-tag { position: absolute; left: -2px; top: -2px; transform: translateY(-100%); pointer-events: auto;
      font: 600 11px/1 system-ui, sans-serif; color: #fff; background: rgba(255, 140, 0, 0.85);
      padding: 4px 6px; border-radius: 4px 4px 0 0; white-space: nowrap; cursor: pointer; touch-action: none; user-select: none; }
    .gd-box.sel .gd-tag { background: #ff3d7f; cursor: move; }
    .gd-h { position: absolute; width: 26px; height: 26px; margin: -13px; pointer-events: auto; touch-action: none; display: none; }
    .gd-h::after { content: ""; position: absolute; inset: 8px; background: #fff; border: 2px solid #ff3d7f; border-radius: 50%; }
    .gd-box.sel .gd-h { display: block; }
    .gd-h[data-h=n], .gd-h[data-h=s] { left: 50%; cursor: ns-resize; }
    .gd-h[data-h=e], .gd-h[data-h=w] { top: 50%; cursor: ew-resize; }
    .gd-h[data-h^=n] { top: 0; } .gd-h[data-h^=s] { top: 100%; }
    .gd-h[data-h$=w] { left: 0; } .gd-h[data-h$=e] { left: 100%; }
    .gd-h[data-h=nw], .gd-h[data-h=se] { cursor: nwse-resize; } .gd-h[data-h=ne], .gd-h[data-h=sw] { cursor: nesw-resize; }
    #gd-safe { position: absolute; border: 2px dashed rgba(0, 170, 90, 0.9); box-sizing: border-box; }
    #gd-safe::before { content: "safe area"; position: absolute; right: 4px; top: 2px; font: 600 10px system-ui, sans-serif; color: rgb(0, 130, 70); }
    #gd-done[hidden] { display: none; }
    #gd-panel { position: absolute; left: 8px; top: 64px; z-index: 40; max-width: min(330px, calc(100% - 16px));
      font: 12px/1.3 system-ui, sans-serif; color: #122236; background: rgba(255, 255, 255, 0.94);
      border-radius: 10px; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.25); padding: 6px; }
    #gd-panel header { display: flex; gap: 6px; align-items: center; }
    #gd-panel header b { flex: 1; cursor: pointer; padding: 4px; }
    #gd-panel button { font: inherit; padding: 5px 9px; border-radius: 6px; border: 1px solid #b8c4d2; background: #fff; cursor: pointer; }
    #gd-rows { margin-top: 4px; max-height: 46vh; overflow: auto; }
    .gd-row { display: flex; gap: 8px; padding: 4px 5px; border-radius: 5px; cursor: pointer; white-space: nowrap; }
    .gd-row.sel { background: rgba(255, 61, 127, 0.14); }
    .gd-row span:first-child { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
    .gd-row .n { font-variant-numeric: tabular-nums; color: #4a5b70; }
    .gd-row.over .n:last-child { color: #d00000; font-weight: 700; }
    @media (min-width: 901px) { #gd-panel { left: auto; right: 12px; } }
    #gd-out[hidden] { display: none; }
    #gd-out { display: block; width: 100%; height: 150px; margin-top: 6px; box-sizing: border-box; font: 11px/1.35 ui-monospace, monospace; }
  `;
  document.head.appendChild(css);

  const wrap = document.getElementById('map-wrap');
  const layer = Object.assign(document.createElement('div'), { id: 'gd-layer' });
  const safe = Object.assign(document.createElement('div'), { id: 'gd-safe' });
  layer.appendChild(safe);
  const panel = Object.assign(document.createElement('div'), { id: 'gd-panel' });
  panel.innerHTML = `<header><b id="gd-title"></b><button id="gd-done" hidden>Done</button><button id="gd-copy">Copy</button><button id="gd-reset">Reset</button></header>
    <div id="gd-rows"></div><textarea id="gd-out" hidden readonly></textarea>`;
  wrap.append(layer, panel);
  const rowsEl = panel.querySelector('#gd-rows'), outEl = panel.querySelector('#gd-out'), titleEl = panel.querySelector('#gd-title'), doneEl = panel.querySelector('#gd-done');

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
      if (from.moved) save(); else if (how === 'move') jump(n);
      from = null;
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  function renderRows() {
    titleEl.textContent = `${open ? '▾' : '▸'} View guides${saved ? ' · ' + saved : ''}`;
    rowsEl.hidden = !open;
    if (!open) return;
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

  titleEl.addEventListener('click', () => { open = !open; outEl.hidden = true; renderRows(); });
  doneEl.addEventListener('click', () => select(null));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') select(null); });
  panel.querySelector('#gd-copy').addEventListener('click', () => {
    outEl.value = tableText();
    outEl.hidden = false;
    outEl.select();
    navigator.clipboard?.writeText(outEl.value).catch(() => { /* the textarea is the fallback */ });
  });
  panel.querySelector('#gd-reset').addEventListener('click', () => {
    for (const n of names) VIEW_BOXES[n].splice(0, 4, ...ORIGINAL[n]);
    try { localStorage.removeItem(STORE); } catch { /* fine */ }
    if (toFile) save();               // back to what the file held when this page loaded
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
