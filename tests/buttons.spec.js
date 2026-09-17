// One rule decides how long a country's assist button lasts: it retires
// when a disc the size of the button's own face fits inside the country
// on screen. These are the cases that rule exists to get right — the
// ones a bounding box gets wrong, and used to need naming by hand.

const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/');
  await page.locator('#hello-close').click();
  await expect(page.locator('#map svg')).toBeAttached();
  await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
}

// Frame a sub-region the way its own challenge does, then report which
// countries the overlay drew a button for (numbered buttons count for
// every country folded into them).
async function buttonsAt(page, sub) {
  return page.evaluate(async (sub) => {
    const D = window.NAN_DEBUG;
    D.zoomToCodes(D.SUB_CODES[sub], 0);
    await new Promise(r => setTimeout(r, 50));
    D.bake();
    const codes = new Set();
    for (const g of document.querySelectorAll('#overlay-layer .btn')) {
      if (g.dataset.code) codes.add(g.dataset.code);
      if (g.dataset.codes) for (const c of g.dataset.codes.split(',')) codes.add(c);
    }
    return { scale: D.scale(), codes: [...codes] };
  }, sub);
}

test('a sliver keeps its button far past the zoom its bounding box would retire it at', async ({ page }) => {
  await boot(page);

  // The Gambia is ~8 map units long and barely 2 through: its box says
  // "big enough" long before the country is. It has to still be there in
  // its own sub-region, and in a view zoomed twice as far again.
  for (const sub of ['West Africa', 'The Balkans']) {
    const { codes } = await buttonsAt(page, sub);
    expect(codes, `the Gambia at the ${sub} zoom`).toContain('GM');
  }
});

test('a small country keeps its button through its own sub-region view', async ({ page }) => {
  await boot(page);

  // Burundi is the case that started this: compact enough that its box
  // called it clickable a whole layer before its borders did.
  const { codes, scale } = await buttonsAt(page, 'East Africa & the Horn');
  expect(scale).toBeGreaterThan(5);
  expect(codes).toContain('BI');
  expect(codes).toContain('RW');
});

test('a button does go away once the country is the bigger target', async ({ page }) => {
  await boot(page);

  // The rule has to retire buttons too, or it is just "always on". By
  // the time the Balkans fill the window, Albania and Montenegro are
  // both far larger than the button that used to stand in for them.
  const { codes, scale } = await buttonsAt(page, 'The Balkans');
  expect(scale).toBeGreaterThan(12);
  expect(codes).not.toContain('AL');
  expect(codes).not.toContain('ME');
  expect(codes).not.toContain('MK');
});

test('every country with a button has a measured target size', async ({ page }) => {
  await boot(page);

  // A missing entry fails safe (the button never retires) but silently,
  // so the table and the offset list have to agree.
  const missing = await page.evaluate(() =>
    Object.keys(BUTTON_OFFSETS).filter(c => typeof TARGET_R[c] !== 'number'));
  expect(missing).toEqual([]);
});
