// The jump keys are the whole navigation model for anyone playing at
// speed, and the second floor of each key is the half that's easy to
// break: Shift has to reach it in one move, and the plain key has to go
// on stepping in and out of it exactly as before.

const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/');
  await page.locator('#hello-close').click();
  await expect(page.locator('#map svg.world')).toBeAttached();
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

// For a landing with no number to aim at: wherever the view stops moving.
async function landed(page) {
  let last = null;
  await expect.poll(async () => {
    const v = await view(page), still = last && v.x === last.x && v.y === last.y && v.s === last.s;
    last = v;
    return still;
  }, { intervals: [150], timeout: 5000 }).toBe(true);
  return last;
}

const near = (v, [x, y], slack) => Math.abs(v.x - x) <= slack && Math.abs(v.y - y) <= slack;

test('Shift lands on a key\'s second floor in one jump, and the plain key steps back out', async ({ page }) => {
  await boot(page);

  // W alone is the continent. Both floors are hand-set boxes (js/views.js)
  // that get retuned by eye, so the zooms are compared with each other
  // rather than with a number: the coast's layer starts at 3.3x and sits
  // around [455, 440], which the continent's view is never mistaken for.
  await page.keyboard.press('w');
  await expect(page.locator('#jump-flash')).toHaveText(/Africa/);
  const africa = (await landed(page)).s;

  await page.keyboard.press('0');
  await settles(page, v => v.s < 2);

  // Shift+W: straight there, no stop at the continent on the way.
  await page.keyboard.press('Shift+W');
  await expect(page.locator('#jump-flash')).toHaveText(/West African coast/);
  await settles(page, v => v.s >= 3.3 && v.s > africa * 1.05 && near(v, [450, 470], 60));

  // …and the same key without Shift is still the way back out.
  await page.keyboard.press('w');
  await expect(page.locator('#jump-flash')).toHaveText('WAfrica');
  await settles(page, v => Math.abs(v.s - africa) < 0.01);
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

test('each key says where its next tap goes', async ({ page }) => {
  await boot(page);
  const key = page.locator('#jump-bar button[data-key="2"]');
  const label = key.locator('.jump-to');

  await expect(label).toHaveText('Europe');
  await page.keyboard.press('2');                 // standing on the area: the next tap dives
  await expect(label).toHaveText('Micro-states');
  await expect(key).toHaveClass(/armed/);
  await page.keyboard.press('2');                 // standing in the pocket: the next tap climbs out
  await expect(label).toHaveText('Europe');
  await expect(key).toHaveClass(/deep/);
  await page.keyboard.press('0');                 // the world: nowhere in particular
  await expect(key).not.toHaveClass(/armed|deep/);
  await expect(label).toHaveText('Europe');
});

test('shift-clicking a jump button does the same as the Shift key', async ({ page }) => {
  await boot(page);

  await page.locator('#jump-bar button[data-key="q"]').click({ modifiers: ['Shift'] });
  await expect(page.locator('#jump-flash')).toHaveText(/Caribbean/);
  await expect(page.locator('#jump-bar button[data-key="q"]')).toHaveClass(/deep/);
});
