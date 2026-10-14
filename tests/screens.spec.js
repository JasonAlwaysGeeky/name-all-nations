// The screens around the map: the intro, home, the mode picker, the
// results and the heat map. What matters is the way through them — that
// each one leads where it says, and that a run under way is paused while
// one of them is up and picks itself back up afterwards.

const { test, expect } = require('@playwright/test');

const ready = (page) => expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
const level = (page) => page.evaluate(() => {
  const L = window.NAN_DEBUG.state.level;
  return { id: L.id, mode: L.mode, paused: L.pausedAt != null, n: L.codes.length };
});

test('a first visit goes intro, home, mode, map — and a second goes straight home', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#onboard')).toBeVisible();
  await page.locator('#onboard-next').click();
  await page.locator('#onboard-next').click();
  await expect(page.locator('#onboard-next')).toHaveText('Choose a challenge');
  await page.locator('#onboard-next').click();

  // Home lists the whole world first, then the six continents.
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('.home-card')).toHaveCount(7);
  await expect(page.locator('.home-card b').first()).toHaveText('The whole world');

  await page.locator('.home-card', { hasText: 'Europe' }).locator('.home-card-head').click();
  await expect(page.locator('#mode-for')).toHaveText('Europe');
  await page.locator('#mode-opts [data-mode="place"]').click();
  await page.locator('#mode-start').click();
  await expect(page.locator('#home')).toBeHidden();
  await expect(page.locator('#word-bank')).toBeVisible();
  expect(await level(page)).toMatchObject({ id: 'cont:Europe', mode: 'place' });

  await page.reload();
  await ready(page);
  await expect(page.locator('#onboard')).toBeHidden();
  await expect(page.locator('#home')).toBeVisible();
});

test('?play skips the screens', async ({ page }) => {
  await page.goto('/?play=name');
  await ready(page);
  await expect(page.locator('#home')).toBeHidden();
  await expect(page.locator('#onboard')).toBeHidden();
  await expect(page.locator('#idle-bar')).toBeVisible();
});

test('home pauses a run under way, and Continue resumes it', async ({ page }) => {
  await page.goto('/?play=name');
  await ready(page);
  await page.evaluate(() => {
    const D = window.NAN_DEBUG;
    D.startLevel(D.CHALLENGE_BY_ID['sub:Central America'], 'name');
    D.selectCountry('GT', { x: 300, y: 300 });
  });
  await page.locator('#guess-input').fill('guatemala');
  await page.locator('#guess-input').press('Enter');

  await page.locator('#progress-wrap').click();
  await expect(page.locator('#home')).toBeVisible();
  expect((await level(page)).paused).toBe(true);
  await expect(page.locator('#home-continue')).toContainText('1 of 7');

  await page.locator('#home-continue').click();
  await expect(page.locator('#home')).toBeHidden();
  await expect(page.locator('#pause-veil')).toBeHidden();
  expect((await level(page)).paused).toBe(false);
});

test('the results offer the misses as a challenge of their own', async ({ page }) => {
  await page.goto('/?play=name');
  await ready(page);
  await page.evaluate(() => {
    const D = window.NAN_DEBUG;
    D.startLevel(D.CHALLENGE_BY_ID['sub:Central America'], 'hardcore');
    D.selectCountry('GT', { x: 300, y: 300 });
  });
  await page.locator('#guess-input').fill('guatemala');
  await page.locator('#guess-input').press('Enter');
  await page.keyboard.press('g');
  await page.keyboard.press('g');

  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#results-title')).toHaveText('Run ended');
  // a run that was stopped short sets no record
  expect(await page.evaluate(() => Object.keys(window.NAN_DEBUG.stats().bests))).toEqual([]);

  await page.locator('#results-practise').click();
  await expect(page.locator('#results')).toBeHidden();
  expect(await level(page)).toMatchObject({ id: 'custom', mode: 'name', n: 6 });
});

test('the heat map is a view of its own, and a tap there asks about a country', async ({ page }) => {
  await page.goto('/?play=name');
  await ready(page);
  await page.locator('#menu-btn').click();
  await page.locator('#heat-btn').click();
  await expect(page.locator('#heat-panel')).toBeVisible();
  await expect(page.locator('#level-banner')).toBeHidden();
  await expect(page.locator('#jump-bar')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.NAN_DEBUG.settled())).toBe(true);

  const br = await page.evaluate(() => {
    const f = window.NAN_DEBUG.geom.BR.anchor;
    const m = document.getElementById('map').getBoundingClientRect();
    const p = window.NAN_DEBUG.mapToScreen(f.x, f.y);
    return { x: m.left + p.x, y: m.top + p.y };
  });
  await page.mouse.click(br.x, br.y);
  await expect(page.locator('#heat-name')).toHaveText('Brazil');
  await expect(page.locator('#heat-text')).toHaveText('Not tried yet');
  // nothing was selected in the game underneath
  expect(await page.evaluate(() => window.NAN_DEBUG.state.selected)).toBeNull();

  await page.keyboard.press('Escape');
  await expect(page.locator('#heat-panel')).toBeHidden();
  await expect(page.locator('#level-banner')).toBeVisible();
});

// Regression: a tab opened in the background loads with a 0x0 window.
// Every fit made then is finite but meaningless — clamped to the deepest
// zoom — so the map came up showing a few pixels of one coastline.
test('a page that loads with no size frames the world once it has one', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { document.getElementById('map-wrap').style.cssText = 'flex: none; width: 0; height: 0'; });
  });
  await page.goto('/?play=name');
  await ready(page);
  expect(await page.evaluate(() => window.NAN_DEBUG.size().W)).toBe(0);

  await page.evaluate(() => { document.getElementById('map-wrap').style.cssText = ''; });
  await expect.poll(() => page.evaluate(() => {
    const D = window.NAN_DEBUG;
    const v = D.view();
    return v ? v.w / D.fullVB().w : 0;
  })).toBeGreaterThan(0.9);
});

test('the developer panel holds the globe and the view editor, and stays out of the shortcuts', async ({ page }) => {
  await page.goto('/?play');
  await ready(page);
  await expect(page.locator('#help a[href="globe.html"]')).toHaveCount(0);
  await page.locator('#menu-btn').click();
  await page.locator('#dev-btn').click();
  await expect(page.locator('#dev')).toBeVisible();
  await expect(page.locator('#dev-globe')).toHaveAttribute('href', 'globe.html');
  await page.keyboard.press('Escape');
  await expect(page.locator('#dev')).toBeHidden();
  await page.keyboard.press('`');
  await expect(page.locator('#dev')).toBeVisible();
  await page.locator('#dev-guides').click();
  await expect(page).toHaveURL(/guides=1/);
});
