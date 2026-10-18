// The game on the globe (js/globe-play.js): the two modes' basic moves,
// the buttons for the small countries and the zones they fold into —
// by the flat map's rules, on the sphere.

const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/globe.html');
  await expect.poll(() => page.evaluate(() => !!window.GLOBE_PLAY)).toBe(true);
}

// Where a country's landmass is on the canvas right now, in page
// coordinates, once the camera has stopped moving.
async function screenPoint(page, code) {
  await expect.poll(() => page.evaluate(() => window.GLOBE.settled()), { timeout: 5000 }).toBe(true);
  const box = await page.locator('#globe').boundingBox();
  const p = await page.evaluate((code) => { const f = window.GLOBE.focus(code); return window.GLOBE.project(f.lon, f.lat); }, code);
  expect(p.front, `${code} faces the camera`).toBe(true);
  return { x: box.x + p.x, y: box.y + p.y };
}

test('place mode: tap the right country and it is placed', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const P = window.GLOBE_PLAY;
    P.startLevel(P.LEVELS.find(l => l.name === 'Europe'), 'place');
    P.armChip('FR');
  });
  const fr = await screenPoint(page, 'FR');
  await page.mouse.click(fr.x, fr.y);
  await expect.poll(() => page.evaluate(() => window.GLOBE.status.FR)).toBe('placed');
  await expect(page.locator('#progress-text')).toHaveText(/^1 \//);
  // and the next name has come up
  expect(await page.locator('#bank-name').textContent()).not.toBe('France');
});

test('name mode: tap a country, type its name, and it is named', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const P = window.GLOBE_PLAY;
    P.startLevel(P.LEVELS.find(l => l.name === 'Europe'), 'name');
  });
  const de = await screenPoint(page, 'DE');
  await page.mouse.click(de.x, de.y);
  await expect(page.locator('#card')).toBeVisible();
  await page.locator('#guess-input').fill('germany');
  await page.locator('#guess-input').press('Enter');
  await expect(page.locator('#answer-result')).toHaveText('✓ Correct!');
  expect(await page.evaluate(() => window.GLOBE.status.DE)).toBe('named');
});

test('the micro-states fold into one numbered button on the Europe view and unfold on the dive', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.GLOBE_PLAY.zoomToView('Europe'));
  await expect.poll(() => page.evaluate(() => window.GLOBE.settled()), { timeout: 5000 }).toBe(true);
  const folded = await page.evaluate(() => window.GLOBE_PLAY.drawn().filter(b => b.zone).map(b => b.zone.name));
  expect(folded).toContain('European microstates');

  await page.evaluate(() => window.GLOBE_PLAY.zoomToZone(BUTTON_ZONES.find(z => z.name === 'European microstates')));
  await expect.poll(() => page.evaluate(() => window.GLOBE.settled()), { timeout: 5000 }).toBe(true);
  const singles = await page.evaluate(() => window.GLOBE_PLAY.drawn().filter(b => b.code).map(b => b.code));
  for (const c of ['VA', 'SM', 'MC', 'MT', 'AD', 'LI']) expect(singles, `${c} has its own button after the dive`).toContain(c);
  expect(await page.evaluate(() => window.GLOBE_PLAY.drawn().some(b => b.zone?.name === 'European microstates'))).toBe(false);
});

// A click looks at the buttons before the countries behind them, so the
// hover has to as well: the button under the cursor is the one that
// lights up, not whichever nation happens to be drawn underneath it.
test('hovering a button highlights that button, not the nation behind it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.GLOBE_PLAY.zoomToView('Europe'));
  await expect.poll(() => page.evaluate(() => window.GLOBE.settled()), { timeout: 5000 }).toBe(true);
  await page.evaluate(() => window.GLOBE_PLAY.zoomToZone(BUTTON_ZONES.find(z => z.name === 'European microstates')));
  await expect.poll(() => page.evaluate(() => window.GLOBE.settled()), { timeout: 5000 }).toBe(true);

  const box = await page.locator('#globe').boundingBox();
  const b = await page.evaluate(() => window.GLOBE_PLAY.drawn().find(b => b.code === 'SM'));
  await page.mouse.move(box.x + b.x, box.y + b.y);
  await expect.poll(() => page.evaluate(() => window.GLOBE_PLAY.hot())).toBe('SM');

  await page.mouse.move(box.x + 5, box.y + 5);
  await expect.poll(() => page.evaluate(() => window.GLOBE_PLAY.hot())).toBeNull();
});

// The click padding claims water, never a neighbour's land — the flat map's
// rule. The Vatican is a pixel inside Italy on this view: painted as one
// layer, its 12px of padding was a 24px hole in Rome that answered "Vatican".
test('land belongs to the nation it is on, however small its neighbour', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.GLOBE_PLAY.zoomToView('Europe'));
  await expect.poll(() => page.evaluate(() => window.GLOBE.settled()), { timeout: 5000 }).toBe(true);

  const around = await page.evaluate(() => {
    const G = window.GLOBE, f = G.focus('VA'), p = G.project(f.lon, f.lat);
    return [[7, 0], [-7, 0], [0, -7]].map(([dx, dy]) => G.codeAt(p.x + dx, p.y + dy));
  });
  expect(around).toEqual(['IT', 'IT', 'IT']);

  // …and the sea just off a coast still belongs to it: Iceland, alone in the Atlantic
  const offshore = await page.evaluate(() => {
    const G = window.GLOBE, f = G.focus('IS'), p = G.project(f.lon, f.lat);
    let x = p.x;
    while (G.codeAt(x, p.y) === 'IS') x -= 1;      // walk west off the land and through the padding
    return { reach: p.x - x, beyond: G.codeAt(x - 3, p.y) };
  });
  expect(offshore.reach).toBeGreaterThan(12);
  expect(offshore.beyond).toBeNull();
});

test('island nations get the dotted outline on the globe, and a tap inside one is that nation', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const P = window.GLOBE_PLAY;
    P.startLevel(P.LEVELS[0], 'place');
    P.armChip('BB');
    window.GLOBE.animateTo(P.fitBox(VIEW_BOXES.Caribbean), 0);
  });
  await expect.poll(() => page.evaluate(() => window.GLOBE.settled()), { timeout: 5000 }).toBe(true);
  // the same outlines the flat map draws on the Caribbean view
  await expect.poll(() => page.evaluate(() => window.GLOBE_PLAY.outlines().map(o => o.code).sort()))
    .toEqual(expect.arrayContaining(['AG', 'BB', 'DM', 'GD', 'KN', 'LC', 'TT', 'VC']));
  // and a tap in Barbados's outline, off the island itself, places it
  const box = await page.locator('#globe').boundingBox();
  const at = await page.evaluate(() => {
    const o = window.GLOBE_PLAY.outlines().find(o => o.code === 'BB');
    const xs = o.pts.map(p => p.x), ys = o.pts.map(p => p.y);
    return { x: Math.min(...xs) + 6, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  });
  expect(await page.evaluate(({ x, y }) => window.GLOBE.codeAt(x, y), at)).not.toBe('BB');
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await expect.poll(() => page.evaluate(() => window.GLOBE.status.BB)).toBe('placed');
});
