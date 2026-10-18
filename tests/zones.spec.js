// The minimap's six zones have to agree with where their keys land: a
// nation drawn inside a zone should be on screen when that zone's key (or a
// tap on it) takes you there. They drifted apart once — Japan sat in the
// Asia zone while the Asia view stopped west of it — so this holds them
// together. Retune a view box in js/views.js and this says which zone
// edges to move.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const VIEW_OF = { 1: 'North America', q: 'South America', 2: 'Europe', w: 'Africa', 3: 'Asia', e: 'South Asia' };

// Where a nation's bounding-box centre is a poor stand-in for "is it on
// screen", and why that is fine:
const EXCUSED = {
  Canada: 'its centre is in the far north, which the North America view leaves out on purpose',
  Chile: 'its centre is a few units west of the South America box; the country is on screen',
  Ecuador: 'as Chile',
  'Marshall Islands': 'reached through the South Asia key\'s Pacific pocket',
  Micronesia: 'as the Marshall Islands',
};

test('every nation in a minimap zone is on screen when that zone is used', () => {
  const VIEW_BOXES = new Function(read('js/views.js') + '; return VIEW_BOXES;')();
  const COUNTRIES = new Function(read('js/countries.js') + '; return COUNTRIES;')();
  const lo = JSON.parse(read('map/world-lo.json'));
  const html = read('index.html');

  // the zones as the minimap draws them, back in map units (1010 × 666)
  const zones = [...html.matchAll(/<button data-key="([1-3qwe])"[^>]*?style="left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%;height:([\d.]+)%"/g)]
    .map(([, key, l, t, w, h]) => ({ key, x0: l * 10.1, y0: t * 6.66, x1: (+l + +w) * 10.1, y1: (+t + +h) * 6.66 }));
  expect(zones.map(z => z.key)).toEqual(['1', 'q', '2', 'w', '3', 'e']);

  const wrong = [];
  for (const c of COUNTRIES) {
    const n = (lo[c.code] || '').match(/-?\d+(\.\d+)?/g)?.map(Number);
    if (!n) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < n.length; i += 2) {
      x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]); y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
    }
    if (x1 - x0 > 400) continue;                       // split across the date line: no one centre
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const z = zones.find(z => cx >= z.x0 - 0.5 && cx < z.x1 + 0.5 && cy >= z.y0 - 0.5 && cy < z.y1 + 0.5);
    if (!z) { wrong.push(`${c.name} is in no zone`); continue; }
    const b = VIEW_BOXES[VIEW_OF[z.key]];
    const seen = cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3];
    if (!seen && !EXCUSED[c.name]) wrong.push(`${c.name} is in zone ${z.key.toUpperCase()}, but the ${VIEW_OF[z.key]} view does not show it`);
  }
  expect(wrong).toEqual([]);
});
