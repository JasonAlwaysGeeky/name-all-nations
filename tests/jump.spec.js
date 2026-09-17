// The jump keys are the whole navigation model for anyone playing at
// speed, and the second floor of each key is the half that's easy to
// break: Shift has to reach it in one move, and the plain key has to go
// on stepping in and out of it exactly as before.

const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/');
  await page.locator('#hello-close').click();
  await expect(page.locator('#map svg')).toBeAttached();
  await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
}

// Where the view has settled once the jump's animation is done: centre
// point in map units, and zoom in px per map unit.
const view = (page) => page.evaluate(() => {
  const v = window.NAN_DEBUG.view();
  return { x: v.x + v.w / 2, y: v.y + v.h / 2, s: window.NAN_DEBUG.scale() };
});

// Polls, because a jump animates for ~220ms and the assertion is about
// where it lands, not where it passes through.
const settles = (page, ok) => expect.poll(async () => ok(await view(page)), { timeout: 5000 }).toBe(true);

const near = (v, [x, y], slack) => Math.abs(v.x - x) <= slack && Math.abs(v.y - y) <= slack;

test('Shift lands on a key\'s second floor in one jump, and the plain key steps back out', async ({ page }) => {
  await boot(page);

  // W alone is the continent. The West African coast sits at [450, 470]
  // and its layer starts at 3x, so neither number can be mistaken for
  // the Africa view's.
  await page.keyboard.press('w');
  await expect(page.locator('#jump-flash')).toHaveText(/Africa/);
  await settles(page, v => v.s < 3);

  await page.keyboard.press('0');
  await settles(page, v => v.s < 2);

  // Shift+W: straight there, no stop at the continent on the way.
  await page.keyboard.press('Shift+W');
  await expect(page.locator('#jump-flash')).toHaveText(/West African coast/);
  await settles(page, v => v.s >= 3 && near(v, [450, 470], 60));

  // …and the same key without Shift is still the way back out.
  await page.keyboard.press('w');
  await expect(page.locator('#jump-flash')).toHaveText('WAfrica');
  await settles(page, v => v.s < 3);
});

test('Shift works on the number keys, whatever the shifted digit arrives as', async ({ page }) => {
  await boot(page);

  // Shift+1 is '!' on this layout (and something else again on others),
  // so the handler has to fall back to the physical key.
  await page.keyboard.press('Shift+Digit1');
  await expect(page.locator('#jump-flash')).toHaveText(/Central America/);

  await page.keyboard.press('Shift+Digit2');
  await expect(page.locator('#jump-flash')).toHaveText(/micro-states/);

  await page.keyboard.press('Shift+Digit3');
  await expect(page.locator('#jump-flash')).toHaveText(/Middle East/);
});

test('shift-clicking a jump button does the same as the Shift key', async ({ page }) => {
  await boot(page);

  await page.locator('#jump-bar button[data-key="q"]').click({ modifiers: ['Shift'] });
  await expect(page.locator('#jump-flash')).toHaveText(/Caribbean/);
  await expect(page.locator('#jump-bar button[data-key="q"]')).toHaveClass(/deep/);
});
