/*
 * Generates js/targets.js: how big a target each of the 195 actually is.
 *
 * "Big enough to click" used to be read off a country's bounding box,
 * which flatters anything L-shaped, hollow or draped around a bay — the
 * box around Croatia is mostly Bosnia. The honest measure is the largest
 * circle that fits *inside* the country: the pole of inaccessibility,
 * the point furthest from any coast or border. That single radius (in
 * map units) is what app.js compares against the button's own size.
 *
 *   node tools/gen-targets.mjs           rewrite js/targets.js
 *   node tools/gen-targets.mjs --check   fail if it is out of date
 *
 * Run it whenever map/world.svg changes. tests/targets.spec.js runs the
 * --check for you on every PR, so a stale table cannot merge.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'js', 'targets.js');

// ————— the map —————

// amCharts' paths are plain M/L/z polylines, so a ring is just its
// numbers in order. (Nothing here would survive a curve; there aren't
// any, and a `C` in the map would show up as a parse failure below.)
function rings(d) {
  const out = [];
  for (const sub of d.split(/(?=M)/)) {
    const nums = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g);
    if (!nums || nums.length < 6) continue;
    const ring = [];
    for (let i = 0; i + 1 < nums.length; i += 2) ring.push([+nums[i], +nums[i + 1]]);
    out.push(ring);
  }
  return out;
}

function readCountryCodes() {
  const src = fs.readFileSync(path.join(root, 'js', 'countries.js'), 'utf8');
  const COUNTRIES = new Function(`${src}\nreturn COUNTRIES;`)();
  return COUNTRIES.map(c => c.code);
}

function readShapes() {
  const svg = fs.readFileSync(path.join(root, 'map', 'world.svg'), 'utf8');
  const shapes = {};
  for (const m of svg.matchAll(/<path\b[^>]*?\bid="([^"]+)"[^>]*?\bd="([^"]+)"/g)) shapes[m[1]] = m[2];
  for (const m of svg.matchAll(/<path\b[^>]*?\bd="([^"]+)"[^>]*?\bid="([^"]+)"/g)) shapes[m[2]] ||= m[1];
  return shapes;
}

// ————— largest inscribed circle (polylabel) —————
//
// Quadtree search: keep splitting whichever cell could still hold a
// bigger circle than the best one found so far. A cell of half-size h
// centred d from the nearest edge can do no better than d + h·√2, which
// is what orders the queue and what prunes it.

function segDistSq(px, py, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx || dy) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = px - x; dy = py - y;
  return dx * dx + dy * dy;
}

// Distance to the nearest edge, negative outside. Every ring of the
// country votes on "inside" by ray crossings, so an enclave punched out
// of a country (Lesotho in South Africa) reads as the hole it is, and a
// second island reads as inside.
function signedDist(px, py, polygon) {
  let inside = false;
  let best = Infinity;
  for (const ring of polygon) {
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > py) !== (b[1] > py) &&
          px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      const d = segDistSq(px, py, a, b);
      if (d < best) best = d;
    }
  }
  if (best === Infinity) return 0;
  return (inside ? 1 : -1) * Math.sqrt(best);
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(c) {
    const a = this.a;
    a.push(c);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].max >= a[i].max) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let big = i;
        if (l < a.length && a[l].max > a[big].max) big = l;
        if (r < a.length && a[r].max > a[big].max) big = r;
        if (big === i) break;
        [a[big], a[i]] = [a[i], a[big]];
        i = big;
      }
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;
const cell = (x, y, h, polygon) => {
  const d = signedDist(x, y, polygon);
  return { x, y, h, d, max: d + h * SQRT2 };
};

function inscribedRadius(polygon) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const ring of polygon) {
    for (const [x, y] of ring) {
      if (x < x1) x1 = x; if (x > x2) x2 = x;
      if (y < y1) y1 = y; if (y > y2) y2 = y;
    }
  }
  const w = x2 - x1, h = y2 - y1;
  const span = Math.max(w, h);
  if (!(span > 0)) return 0;
  // Relative precision: a big country is measured as finely, in
  // proportion, as a small one, and neither runs away with the clock.
  const precision = span / 800;

  let size = Math.min(w, h) / 2 || span / 2;
  const queue = new Heap();
  for (let x = x1; x < x2; x += size) {
    for (let y = y1; y < y2; y += size) queue.push(cell(x + size / 2, y + size / 2, size / 2, polygon));
  }

  // A seed at the centroid of the bounding box is often already close,
  // which prunes most of the queue before it is ever split.
  let best = cell(x1 + w / 2, y1 + h / 2, 0, polygon);

  while (queue.size) {
    const c = queue.pop();
    if (c.max - best.d <= precision) break;      // nothing left can beat it
    if (c.d > best.d) best = c;
    size = c.h / 2;
    queue.push(cell(c.x - size, c.y - size, size, polygon));
    queue.push(cell(c.x + size, c.y - size, size, polygon));
    queue.push(cell(c.x - size, c.y + size, size, polygon));
    queue.push(cell(c.x + size, c.y + size, size, polygon));
  }
  return Math.max(0, best.d);
}

// ————— the table —————

function build() {
  const codes = readCountryCodes();
  const shapes = readShapes();
  const radii = {};
  const missing = [];
  for (const code of codes) {
    const d = shapes[code];
    if (!d) { missing.push(code); continue; }
    const polygon = rings(d);
    if (!polygon.length) { missing.push(code); continue; }
    radii[code] = Math.round(inscribedRadius(polygon) * 1000) / 1000;
  }
  if (missing.length) throw new Error(`no usable shape in map/world.svg for: ${missing.join(', ')}`);

  const lines = codes.map(c => `  ${c}: ${radii[c]},`);
  return `/*
 * How big a target each country is: the radius, in map units, of the
 * largest circle that fits inside its borders.
 *
 * GENERATED by tools/gen-targets.mjs from map/world.svg — do not edit.
 * Regenerate whenever the map does (\`npm run targets\`); CI checks it.
 *
 * app.js compares radius x zoom against the button's own size: a button
 * stands in for a country only while the country is the smaller target
 * of the two. That is the whole rule — there is no per-country list.
 */

const TARGET_R = {
${lines.join('\n')}
};
`;
}

const out = build();
const check = process.argv.includes('--check');
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;

// The table's content is what has to match, not its line endings: a
// Windows checkout gets this file back with CRLF, and comparing that to
// freshly generated LF reports every line as changed.
const same = (a, b) => a !== null && a.split('\r\n').join('\n') === b;

if (check) {
  if (!same(current, out)) {
    console.error('js/targets.js is out of date — run `npm run targets`.');
    process.exit(1);
  }
  console.log('js/targets.js is up to date.');
} else {
  fs.writeFileSync(OUT, out);
  console.log(`wrote ${path.relative(root, OUT)}`);
}
