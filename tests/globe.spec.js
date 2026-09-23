// The globe turns the way the flat map pans: the point you grabbed stays
// under the pointer (aim, in globe.js — bindMapEvents' anchor on a
// sphere), and a mouse lets go without a fling, as it does on the map.

const { test, expect } = require('@playwright/test');

// Wrap-safe difference of two longitudes.
const dlon = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('a drag keeps the grabbed point under the pointer', async ({ page }) => {
  await page.goto('/globe.html');
  await expect.poll(() => page.evaluate(() => !!window.GLOBE)).toBe(true);

  const box = await page.locator('#globe').boundingBox();
  const r = await page.evaluate(() => window.GLOBE_DEBUG.view.r);
  const under = (p) => page.evaluate(([x, y]) => window.GLOBE_DEBUG.under(x, y), [p.x - box.x, p.y - box.y]);

  // Grab off centre, on the disc.
  const grab = { x: box.x + box.width / 2 + r * 0.4, y: box.y + box.height / 2 - r * 0.3 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  // The gesture anchors where the drag breaks loose of the tap slop, not
  // at the press — the same as the map — so that is the point to hold.
  const loose = { x: grab.x + 8, y: grab.y };
  await page.mouse.move(loose.x, loose.y, { steps: 2 });
  const held = await under(loose);

  const to = { x: loose.x - r * 0.5, y: loose.y + r * 0.35 };
  await page.mouse.move(to.x, to.y, { steps: 12 });
  const now = await under(to);
  expect(dlon(now.lon, held.lon)).toBeLessThan(0.5);
  expect(Math.abs(now.lat - held.lat)).toBeLessThan(0.5);

  // …and lets go where it is: a mouse never flings.
  await page.mouse.up();
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => window.GLOBE_DEBUG.settled())).toBe(true);
  const after = await under(to);
  expect(dlon(after.lon, held.lon)).toBeLessThan(0.5);
});
