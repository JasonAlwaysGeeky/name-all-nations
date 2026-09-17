// Hardcore mode is name mode with the safety net taken away, so what
// matters is that the net is really gone — no hints, no reveal, and no
// way to finish except knowing them or stopping — and that the one thing
// it does offer, taking you to a country you have not named, does not
// quietly tell you which country it is.

const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/');
  await page.locator('#hello-close').click();
  await expect(page.locator('#map svg')).toBeAttached();
  await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
}

async function hardcore(page, id = 'sub:Central America') {
  await page.evaluate((id) => {
    const D = window.NAN_DEBUG;
    D.startLevel(D.CHALLENGE_BY_ID[id], 'hardcore');
  }, id);
  await expect(page.locator('#hardcore-bar')).toBeVisible();
  // startLevel animates the camera into place. Under a loaded runner
  // that animation can stall for longer than any sensible wait, and a
  // click landing mid-flight hits whatever is sliding past — so re-issue
  // the same fit with no animation and be certain where things are.
  await page.evaluate(() => window.NAN_DEBUG.zoomToCodes(window.NAN_DEBUG.state.level.codes, 0));
}

// Selects a country the way a click does, without hunting for a pixel
// that is not under a button, an island outline or the mode's own bar.
// What a click resolves to is covered in smoke.spec.js and hover.spec.js;
// none of these tests are about that.
const pick = (page, code) => page.evaluate((code) => {
  const D = window.NAN_DEBUG;
  D.selectCountry(code, D.mapToScreen(D.geom[code].anchor.x, D.geom[code].anchor.y));
}, code);

const answer = async (page, text) => {
  await page.locator('#guess-input').fill(text);
  await page.locator('#guess-input').press('Enter');
};

test('there is no way to be told the answer', async ({ page }) => {
  await boot(page);
  await hardcore(page);
  await pick(page, 'GT');

  await expect(page.locator('#card')).toBeVisible();
  await expect(page.locator('#card-actions')).toBeHidden();

  // Not merely hidden: calling them does nothing either, so a stray
  // keystroke or an old click handler cannot let one through.
  const before = await page.evaluate(() => window.NAN_DEBUG.state.status.GT);
  await page.evaluate(() => {
    document.getElementById('hint-btn').click();
    document.getElementById('reveal-btn').click();
  });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.NAN_DEBUG.state.status.GT)).toBe(before);
  expect(await page.evaluate(() => window.NAN_DEBUG.state.level.result.GT)).toBeUndefined();
});

test('"find a gap" lands on one you have not named, and does not name it', async ({ page }) => {
  await boot(page);
  await hardcore(page);

  await pick(page, 'GT');
  await answer(page, 'guatemala');
  await expect.poll(() => page.evaluate(() => window.NAN_DEBUG.state.status.GT)).toBe('named');

  // It pans first and selects when it lands, so wait for the selection
  // to actually move off the one we just answered.
  await page.locator('#hc-find').click();
  await expect.poll(() => page.evaluate(() => window.NAN_DEBUG.state.selected), { timeout: 5000 })
    .not.toBe('GT');

  const picked = await page.evaluate(() => window.NAN_DEBUG.state.selected);
  const level = await page.evaluate(() => window.NAN_DEBUG.state.level.codes);
  expect(level).toContain(picked);
  expect(picked).not.toBe('GT');                       // never one already named
  expect(await page.evaluate(() => window.NAN_DEBUG.state.status[window.NAN_DEBUG.state.selected]))
    .toBeUndefined();                                  // and it is still unanswered

  // It asks the question rather than answering it.
  await expect(page.locator('#card-question')).toBeVisible();
  await expect(page.locator('#card-answer')).toBeHidden();
});

test('giving up asks once, then ends the run', async ({ page }) => {
  await boot(page);
  await hardcore(page);

  await pick(page, 'GT');
  await answer(page, 'guatemala');

  // One click only arms it — a misclick mid-run must not end the run.
  await page.locator('#hc-giveup').click();
  await expect(page.locator('#hc-giveup')).toHaveClass(/arming/);
  await expect(page.locator('#results')).toBeHidden();

  await page.locator('#hc-giveup').click();
  await expect(page.locator('#results')).toBeVisible();

  // What you did get is kept; the rest is filed as never got it.
  await expect(page.locator('#results-misses')).toContainText('Never got it (6)');
  await expect(page.locator('#results-misses')).not.toContainText('Guatemala');
});

test('the mode button cycles name, place, hardcore', async ({ page }) => {
  await boot(page);

  const cycle = async () => {
    await page.locator('#progress-wrap').click();
    await page.locator('#level-mode').click();
    await page.waitForTimeout(250);
    return page.evaluate(() => window.NAN_DEBUG.state.level.mode);
  };
  expect(await page.evaluate(() => window.NAN_DEBUG.state.level.mode)).toBe('name');
  expect(await cycle()).toBe('place');
  expect(await cycle()).toBe('hardcore');
  expect(await cycle()).toBe('name');
});
