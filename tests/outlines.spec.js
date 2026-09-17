// An island nation's dotted outline is its click target, and it is also
// the only thing on screen saying "the country is in here". If it cuts a
// corner off one of the islands it stands for, it is lying about both.
//
// Trinidad was losing a corner, and so was Saint Vincent, because the
// padding around the islands shrank as you zoomed in until the rounded
// end of the outline reached the island behind it. Rather than fix those
// two, this walks every island group of every archipelago at a spread of
// zooms and checks the drawn shape — rotation, corner radius and all —
// actually contains the islands.

const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/');
  await page.locator('#hello-close').click();
  await expect(page.locator('#map svg')).toBeAttached();
  await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
}

// Every island corner that falls outside the outline drawn around it,
// at the current view.
const clipped = (page) => page.evaluate(() => {
  const D = window.NAN_DEBUG;

  // Is (px, py) inside a rounded rect of size w x h centred at (cx, cy),
  // turned by `deg`, with corner radius r?
  const inside = (px, py, cx, cy, w, h, deg, r) => {
    const th = -deg * Math.PI / 180;
    const dx = (px - cx) * Math.cos(th) - (py - cy) * Math.sin(th);
    const dy = (px - cx) * Math.sin(th) + (py - cy) * Math.cos(th);
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const hw = w / 2, hh = h / 2;
    const slack = 1e-6;
    if (ax > hw + slack || ay > hh + slack) return false;
    // Outside the straight part on both axes: check the corner arc.
    if (ax <= hw - r || ay <= hh - r) return true;
    const ox = ax - (hw - r), oy = ay - (hh - r);
    return ox * ox + oy * oy <= r * r + slack;
  };

  const bad = [];
  for (const g of document.querySelectorAll('#overlay-layer g.ov-box')) {
    const code = g.dataset.code;
    const rect = g.querySelector('rect');
    const w = +rect.getAttribute('width'), h = +rect.getAttribute('height');
    const cx = +rect.getAttribute('x') + w / 2, cy = +rect.getAttribute('y') + h / 2;
    const r = +rect.getAttribute('rx');
    const m = /rotate\(([-\d.]+)/.exec(rect.getAttribute('transform') || '');
    const deg = m ? +m[1] : 0;

    // Which of this country's island groups is this outline drawn for?
    // The one whose islands it is nearest to.
    const groups = D.geom[code]?.groups || [];
    let best = null, bestD = Infinity;
    for (const grp of groups) {
      const d = Math.hypot(grp.raw.x + grp.raw.w / 2 - cx, grp.raw.y + grp.raw.h / 2 - cy);
      if (d < bestD) { bestD = d; best = grp; }
    }
    if (!best) continue;

    // The islands themselves, not the group's upright bounding box: a
    // tilted pill is allowed to leave that box's corners out in the sea,
    // because there is no island in them.
    const q = best.raw;
    const slack = 0.02;
    const islands = (D.geom[code].boxes || []).filter(i =>
      i.x >= q.x - slack && i.y >= q.y - slack &&
      i.x + i.w <= q.x + q.w + slack && i.y + i.h <= q.y + q.h + slack);
    for (const i of islands) {
      for (const [px, py] of [[i.x, i.y], [i.x + i.w, i.y], [i.x, i.y + i.h], [i.x + i.w, i.y + i.h]]) {
        if (!inside(px, py, cx, cy, w, h, deg, r)) {
          bad.push(`${code} island corner (${px.toFixed(1)}, ${py.toFixed(1)}) outside its outline`);
        }
      }
    }
  }
  return bad;
});

// A spread of zooms: the world, a continent, a dense zone, and deep in.
const VIEWS = [
  ['the whole world', () => window.NAN_DEBUG.animateView(window.NAN_DEBUG.worldView(), 0)],
  ['the Caribbean arc', () => window.NAN_DEBUG.zoomToZone(
    { name: 'Caribbean', at: [299, 422], minScale: 12, squareScale: 12, codes: ['AG', 'KN', 'DM', 'LC', 'BB', 'VC', 'GD', 'TT', 'JM'] }, 0)],
  ['the Pacific', () => window.NAN_DEBUG.zoomToCodes(['PW', 'FM', 'MH', 'NR', 'KI', 'TV', 'SB', 'VU', 'FJ', 'WS', 'TO'], 0)],
  ['Trinidad, close up', () => window.NAN_DEBUG.zoomToCodes(['TT'], 0)],
  ['the Bahamas, close up', () => window.NAN_DEBUG.zoomToCodes(['BS'], 0)],
  ['Micronesia, close up', () => window.NAN_DEBUG.zoomToCodes(['FM'], 0)],
];

for (const [name, go] of VIEWS) {
  test(`no island outline cuts a corner off its islands — ${name}`, async ({ page }) => {
    await boot(page);
    await page.evaluate(go);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.NAN_DEBUG.bake());
    expect(await clipped(page)).toEqual([]);
  });
}

test('an outline is the same shape on the map however far you are zoomed in', async ({ page }) => {
  await boot(page);

  // The outline used to hug its islands closer the further you zoomed
  // in, so the one fixed thing on the map quietly changed shape as you
  // moved around. Growth to stay clickable is still allowed — it can
  // only ever get bigger than the islands, never smaller or tighter.
  const shapeAt = (codes) => page.evaluate(async (codes) => {
    const D = window.NAN_DEBUG;
    D.zoomToCodes(codes, 0);
    await new Promise(r => setTimeout(r, 60));
    D.bake();
    const g = document.querySelector('#overlay-layer g.ov-box[data-code="TT"] rect');
    return g && { w: +g.getAttribute('width'), h: +g.getAttribute('height') };
  }, codes);

  const near = await shapeAt(['TT']);
  const wide = await shapeAt(['TT', 'VE', 'GY', 'SR']);
  expect(near, 'no outline drawn for Trinidad').not.toBeNull();
  expect(wide).not.toBeNull();

  // Zoomed further out the outline may have grown to stay clickable, but
  // it must never have been tighter when you were close.
  expect(near.w).toBeLessThanOrEqual(wide.w + 0.01);
  expect(near.h).toBeLessThanOrEqual(wide.h + 0.01);
});
