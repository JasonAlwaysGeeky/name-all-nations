// Every country carries a fat invisible stroke of click padding under
// the map, so a click just offshore still selects it. The highlight used
// to come from CSS `:hover` on the visible shape, which knows nothing
// about that padding — so there was a ring of sea around every country
// where a click would select it and nothing on screen said so. On the
// small countries that ring is most of the target.

const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/');
  await page.locator('#hello-close').click();
  await expect(page.locator('#map svg')).toBeAttached();
  await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
  // Somewhere the padding is a meaningful share of the target.
  await page.evaluate(() => window.NAN_DEBUG.zoomToCodes(window.NAN_DEBUG.SUB_CODES['Southern Europe'], 0));
  await page.waitForTimeout(250);
}

// A point in open water that the game's own hit-testing says belongs to
// some country — somewhere a click selects it while the cursor is not
// over its shape. The hit layer sits *under* the map, so
// elementFromPoint only reaches it where there is no land.
const offshorePoint = (page) => page.evaluate(() => {
  const m = document.getElementById('map').getBoundingClientRect();
  for (let y = m.top + 30; y < m.bottom - 30; y += 7) {
    for (let x = m.left + 30; x < m.right - 30; x += 7) {
      const hit = document.elementFromPoint(x, y);
      if (hit?.classList?.contains('hit') && hit.dataset.code) return { x, y, code: hit.dataset.code };
    }
  }
  return null;
});

test('hovering the sea inside a country\'s click padding highlights that country', async ({ page }) => {
  await boot(page);

  const pt = await offshorePoint(page);
  expect(pt, 'no offshore click padding found anywhere on screen').not.toBeNull();

  await page.mouse.move(pt.x, pt.y);
  const shape = page.locator(`#map svg path#${pt.code}`);
  await expect(shape).toHaveClass(/\bhot\b/);

  // …and it lets go again.
  await page.mouse.move(2, 2);
  await expect(shape).not.toHaveClass(/\bhot\b/);
});

test('exactly one country is highlighted at a time', async ({ page }) => {
  await boot(page);

  const pt = await offshorePoint(page);
  expect(pt).not.toBeNull();
  await page.mouse.move(pt.x, pt.y);
  await expect.poll(() => page.locator('#map svg path.hot').count()).toBe(1);
  await expect(page.locator(`#map svg path#${pt.code}`)).toHaveClass(/\bhot\b/);
});
