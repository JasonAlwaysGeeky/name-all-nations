// The globe is an experiment, but it ships in the same deploy as the
// game, so it has to at least boot, draw and pick. It shares nothing
// with the flat map except the map files and the palette, so this is the
// only thing watching it.

const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/globe.html');
  await expect.poll(() => page.locator('#hud').isHidden(), { timeout: 15000 }).toBe(false);
  await page.waitForTimeout(300);
}

test('the globe boots, draws real geography, and costs a sane amount per frame', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await boot(page);

  // Something was actually drawn: most of the world's points are behind
  // the globe or too small, but a good share of them land on screen.
  const stats = await page.evaluate(() => window.GLOBE_DEBUG.stats());
  expect(stats.drawnRings).toBeGreaterThan(100);
  expect(stats.drawnVerts).toBeGreaterThan(2000);
  expect(stats.drawnVerts).toBeLessThan(stats.verts);

  expect(errors).toEqual([]);
});

test('the projection is right: clicking a known place names that place', async ({ page }) => {
  await boot(page);

  // Turn to a country big enough that the centre of the disc is
  // unambiguously inside it, and check the pick buffer agrees. This is
  // really a test of the inverse-Mercator constants: get them wrong and
  // the click lands in the wrong ocean.
  for (const [lon, lat, name] of [[-55, -10, 'Brazil'], [100, 45, 'Mongolia'], [19, 16, 'Chad'], [134, -24, 'Australia']]) {
    await page.evaluate(([lon, lat]) => window.GLOBE_DEBUG.go(lon, lat), [lon, lat]);
    await page.waitForTimeout(120);
    const box = await page.locator('#globe').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#readout')).toHaveText(name);
  }
});

test('zooming in draws less, not more', async ({ page }) => {
  await boot(page);
  const wide = await page.evaluate(() => window.GLOBE_DEBUG.stats().drawnRings);

  // The whole point of the per-ring cull: a zoomed-in globe has most of
  // the world off the side of the canvas, and must not pay for it.
  await page.evaluate(() => window.GLOBE_DEBUG.go(10, 50, 6000));
  await page.waitForTimeout(200);
  const close = await page.evaluate(() => window.GLOBE_DEBUG.stats().drawnRings);
  expect(close).toBeLessThan(wide / 2);
});
