/*
 * The dotted outline around an island nation's islands. Shared by the
 * flat map and the globe.
 *
 * A classic script, all in map units: which nations get outlines, how
 * their islands split into groups, and — for a zoom — where each
 * group's outline goes, how big, and how round. The flat map draws the
 * result as SVG rects; the globe projects the same rects onto the
 * sphere. Neither decides anything about the shape itself.
 */

// Island nations drawn with a dotted outline per island group — the
// Pacific ones, plus the Caribbean micro-islands so they get the same
// look once you're zoomed into the arc.
const ARCHIPELAGOS = new Set(['TV', 'FM', 'TO', 'MH', 'PW', 'KI', 'NR', 'CV', 'KM', 'VU', 'BS', 'FJ', 'SB', 'ST', 'WS', 'TT', 'MV',
  'AG', 'KN', 'DM', 'LC', 'BB', 'VC', 'GD']);
const ARCH_GAP = 45;         // map units between islands before they split into separate groups

const SQ_MIN = 56;           // min on-screen size of an island outline once it replaces the button, px
const SQ_THIN = 30;          // …except across a tilted pill, which is long enough to be an easy target, px
const SQ_ROUND = 0.3;        // corner radius of an island outline, as a share of its short side
const SQ_GAP = 7;            // clearance two island outlines keep from each other, px
// An island chain strung out on a diagonal (the Bahamas down towards
// Cuba, Micronesia across the Pacific) is badly served by an upright
// box: the box has to swallow whole neighbours to reach the far
// island. Where a tilted fit is this much smaller than the upright
// one, the outline becomes a tilted pill along the chain instead.
const ROT_MAX = 0.75;        // tilted-fit area / upright-fit area, at or below which the pill wins
const ROT_THIN = 14;         // a pill never draws thinner than this on screen, px — a hairline reads as a coastline

// Islands no further apart than ARCH_GAP are one group, and one outline.
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
    // The padded box is what the rest of the app treats as the island
    // group (where to look, how big a target it already is); `raw` and
    // `pad` are kept so the drawn outline can hug the islands closer
    // as you zoom in.
    const pad = Math.max(1.4, Math.max(x2 - x1, y2 - y1) * 0.12);
    const raw = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    return { x: x1 - pad, y: y1 - pad, w: raw.w + 2 * pad, h: raw.h + 2 * pad, raw, pad, tilt: tiltFit(list, raw) };
  });
}

// The smallest tilted box that still holds every island of a group.
// Rotating calipers over the islands' corners, one degree at a time —
// cheap, and it only runs once at load. `tight` is how much smaller
// that box is than the upright one: near 1 the islands cluster and an
// upright outline is honest, well under it they run in a line and the
// upright box is mostly other people's sea.
function tiltFit(list, raw) {
  const pts = [];
  for (const b of list) pts.push([b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]);
  let best = null;
  for (let deg = 0; deg < 180; deg++) {
    const th = deg * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
    let u1 = Infinity, v1 = Infinity, u2 = -Infinity, v2 = -Infinity;
    for (const [px, py] of pts) {
      const u = px * c + py * sn, v = py * c - px * sn;
      if (u < u1) u1 = u; if (u > u2) u2 = u;
      if (v < v1) v1 = v; if (v > v2) v2 = v;
    }
    const w = u2 - u1, h = v2 - v1;
    const area = Math.max(w, 1e-4) * Math.max(h, 1e-4);
    if (!best || area < best.area) best = { area, w, h, deg, cu: (u1 + u2) / 2, cv: (v1 + v2) / 2, c, sn };
  }
  const box = Math.max(raw.w, 1e-4) * Math.max(raw.h, 1e-4);
  return {
    angle: best.deg,
    w: best.w, h: best.h,
    cx: best.cu * best.c - best.cv * best.sn,
    cy: best.cu * best.sn + best.cv * best.c,
    tight: best.area / box,
  };
}

// Island outlines that would overlap first slide apart — each as far
// as it can while still keeping its own islands inside, so the outline
// never wanders off the land it stands for — and then, if that isn't
// enough, give back the growth that caused it, slide again with the
// room that frees, and repeat. Islands whose bounding boxes genuinely
// interleave (Grenada and Trinidad, Antigua and Barbuda) still touch;
// no layout can separate those.
function spreadBoxes(list, gap) {
  // How far a box can slide and still cover its own islands, keeping
  // half its breathing room on the trailing side. A tilted pill has no
  // such freedom — slide it sideways and the chain walks out of the end
  // of it — so it holds still and the neighbour moves.
  const room = (b, axis) => b.fixed ? 0
    : Math.max(0, (axis === 'x' ? b.w - b.raw.w : b.h - b.raw.h) / 2 - b.pad / 2);
  const over = (a, b, axis) => axis === 'x'
    ? Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2)
    : Math.min(a.cy + a.h / 2, b.cy + b.h / 2) - Math.max(a.cy - a.h / 2, b.cy - b.h / 2);
  // A half of a split nation stands for islands on the far side of the
  // map, so sliding it means nothing — like a tilted pill, it holds
  // still and its neighbours make way for it instead.
  for (const b of list) if (b.split) b.fixed = true;
  const pairs = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    pairs.push([list[i], list[j]]);
  }
  // A tilted pill already hugs its chain, so there is no slack in it to
  // give back; the shrink pass leaves those pairs alone.
  const shrinkable = pairs.filter(([a, b]) => !a.tilt && !b.tilt);

  const slide = (passes) => {
    for (let pass = 0; pass < passes; pass++) {
      let moved = false;
      for (const [a, b] of pairs) {
        const ox = over(a, b, 'x'), oy = over(a, b, 'y');
        if (ox <= 0 || oy <= 0) continue;                   // clear on one axis is clear
        const axis = ox <= oy ? 'x' : 'y';                  // part along whichever they're closest to clearing
        const c = axis === 'x' ? 'cx' : 'cy', home = axis === 'x' ? 'hx' : 'hy';
        const dir = Math.sign(a[c] - b[c]) || 1;
        const ra = Math.max(0, room(a, axis) - dir * (a[c] - a[home]));
        const rb = Math.max(0, room(b, axis) + dir * (b[c] - b[home]));
        if (ra + rb <= 0) continue;
        const move = Math.min(Math.min(ox, oy) + gap, ra + rb);
        a[c] += dir * move * (ra / (ra + rb));
        b[c] -= dir * move * (rb / (ra + rb));
        moved = true;
      }
      if (!moved) return;
    }
  };

  // Give back the growth that caused the overlap — and, past that, half
  // the breathing room too, because two outlines this close are better
  // off snug than crossed. As much as there is, even when that alone
  // won't clear the pair: the slide that follows usually finishes the
  // job with the room it frees.
  const shrink = () => {
    for (const [a, b] of shrinkable) {
      const ox = over(a, b, 'x'), oy = over(a, b, 'y');
      if (ox <= 0 || oy <= 0) continue;
      const axis = ox <= oy ? 'x' : 'y', d = axis === 'x' ? 'w' : 'h';
      const ca = Math.max(0, a[d] - (a.raw[d] + a.pad)), cb = Math.max(0, b[d] - (b.raw[d] + b.pad));
      if (ca + cb <= 0) continue;
      const cut = Math.min(Math.min(ox, oy) + gap, ca + cb);
      a[d] -= cut * (ca / (ca + cb));
      b[d] -= cut * (cb / (ca + cb));
    }
  };

  slide(8);
  for (let round = 0; round < 4; round++) { shrink(); slide(4); }

  // A box that both slid and shrank could have left its islands
  // behind; pull it back over them.
  for (const b of list) {
    const rx = room(b, 'x'), ry = room(b, 'y');
    b.cx = Math.min(Math.max(b.cx, b.hx - rx), b.hx + rx);
    b.cy = Math.min(Math.max(b.cy, b.hy - ry), b.hy + ry);
  }
}

// Dense-zone island nations past their zone's squareScale: the dotted
// outline (grown to a comfortable click size below) replaces the button
// entirely. `groupsOf(code)` is the nation's island groups, or nothing.
function squaredAt(s, groupsOf) {
  const squared = new Set();
  for (const z of BUTTON_ZONES) {
    if (!z.squareScale || s < z.squareScale) continue;
    for (const c of z.codes) if (groupsOf(c)) squared.add(c);
  }
  return squared;
}

// Dotted outline around each island group — a rounded box when the
// islands cluster, a tilted pill along the chain when they don't (the
// Bahamas running down past Cuba, Micronesia strung across the
// Pacific): an upright box around either of those is mostly someone
// else's sea.
//
// The outline is a fixed *geographic* shape: the islands plus a pad
// that is a share of the group's own size. It used to hug closer the
// further you zoomed in, which meant the outline quietly changed shape
// under you as you moved around — the one thing on the map that did.
// The only thing zoom still decides is growth: once the outline stands
// in for the button it inflates to a comfortable click size when it
// would otherwise be a speck, and spreadBoxes keeps that growth from
// swallowing the neighbouring island.
//
// Each outline comes back as a rect in map units: centre, size, corner
// radius, and the angle it is turned by about its centre.
function layoutOutlines(codes, s, groupsOf, squared) {
  const outlines = [];
  for (const code of codes) {
    const groups = groupsOf(code);
    if (!groups) continue;
    const takeover = squared.has(code);
    for (const b of groups) {
      if (!takeover && Math.max(b.w, b.h) * s < 12) continue;
      const r = b.raw, pad = b.pad;
      const box = { code, split: groups.length > 1, raw: r, pad };
      const t = b.tilt;
      if (t && t.tight <= ROT_MAX) {
        // Long side gets the full comfortable size, short side only
        // enough to stay a pill you can hit.
        const il = Math.max(t.w, t.h), iw = Math.min(t.w, t.h);   // the islands' own rect
        const across = Math.max(iw + 2 * pad, (takeover ? SQ_THIN : ROT_THIN) / s);
        let along = Math.max(il + 2 * pad, takeover ? SQ_MIN / s : 0);
        // A pill has semicircular ends, and a semicircle no wider than
        // the chain cuts the corners off the rect the chain sits in —
        // which is exactly where the island at the end of the chain
        // is. The pad above is usually enough to save it, but "usually"
        // is what lost Trinidad a corner; solving the end cap against
        // the corner gives the length that always clears it.
        const R = across / 2, half = Math.min(iw / 2, R);
        along = Math.max(along, il + 2 * (R - Math.sqrt(Math.max(0, R * R - half * half))));
        const flip = t.w < t.h;                             // the tilt's own long axis
        box.tilt = { angle: t.angle, w: flip ? across : along, h: flip ? along : across };
        box.fixed = true;
        box.cx = t.cx; box.cy = t.cy;
        const th = t.angle * Math.PI / 180, c = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
        box.w = box.tilt.w * c + box.tilt.h * sn;           // upright bounds, for keeping neighbours clear
        box.h = box.tilt.w * sn + box.tilt.h * c;
      } else {
        box.cx = r.x + r.w / 2; box.cy = r.y + r.h / 2;
        box.w = Math.max(r.w + 2 * pad, takeover ? SQ_MIN / s : 0);
        box.h = Math.max(r.h + 2 * pad, takeover ? SQ_MIN / s : 0);
      }
      box.hx = box.cx; box.hy = box.cy;
      outlines.push(box);
    }
  }
  spreadBoxes(outlines, SQ_GAP / s);
  return outlines.map(b => {
    const t = b.tilt;
    const w = t ? t.w : b.w, h = t ? t.h : b.h;
    // Fully rounded ends on a pill (its length already accounts for
    // them); on a square, a radius that stops where the islands start.
    // The same corner-cutting arithmetic as above, read the other way:
    // with margins a and b around the islands, a corner radius up to
    // a + b + sqrt(2ab) still leaves the island corner inside.
    let rx = Math.min(w, h) * (t ? 0.5 : SQ_ROUND);
    if (!t) {
      const a = Math.max(0, (w - b.raw.w) / 2), c = Math.max(0, (h - b.raw.h) / 2);
      rx = Math.min(rx, a + c + Math.sqrt(2 * a * c));
    }
    return { code: b.code, cx: b.cx, cy: b.cy, w, h, rx, angle: t ? t.angle : 0 };
  });
}
