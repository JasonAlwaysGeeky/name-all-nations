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
