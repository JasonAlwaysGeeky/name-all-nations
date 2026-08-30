// The merge gate: proves the game still boots and the core quiz loop
// still plays before anything lands on main (= deploys to Pages).
// Deliberately shallow — gestures, framerate, and how it feels on a
// phone stay a human's job, on the live build.

const { test, expect } = require('@playwright/test');

// Console errors anywhere during a test mean a broken deploy, whatever
// the assertions say. pageerror catches uncaught exceptions.
function watchErrors(page, errors) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
}

async function boot(page) {
  await page.goto('/');
  await page.locator('#hello-close').click();
  // The map SVG is fetched at runtime; the hit layer is built after it lands.
  await expect(page.locator('#map svg')).toBeAttached();
  await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
}

// Click a country the way a player does — through whatever is stacked on
// top. A country's bounding-box centre can sit under a neighbour's
// assist-button pad, so sample points inside the shape and ask the page's
// own hit-testing which country a click there would actually select.
async function clickCountry(page, code) {
  const pt = await page.evaluate((code) => {
    const r = document.querySelector(`#map svg path#${code}`).getBoundingClientRect();
    for (let fy = 0.25; fy <= 0.75; fy += 0.05) {
      for (let fx = 0.25; fx <= 0.75; fx += 0.05) {
        const x = r.x + r.width * fx, y = r.y + r.height * fy;
        const t = document.elementFromPoint(x, y)?.closest?.('[data-code], path[id]');
        if ((t?.dataset?.code || t?.id) === code) return { x, y };
      }
    }
    return null;
  }, code);
  expect(pt, `no clickable point found inside ${code}`).not.toBeNull();
  await page.mouse.click(pt.x, pt.y);
}

test('boots: map renders, every playable country is clickable, no console errors', async ({ page }) => {
  const errors = [];
  watchErrors(page, errors);
  await boot(page);

  // Every code the game plays must have a hit path, or that country is
  // simply unwinnable. COUNTRIES is the global from js/countries.js.
  const missing = await page.evaluate(() =>
    COUNTRIES.filter(c => !document.querySelector(`#hit-layer path[data-code="${c.code}"]`))
      .map(c => c.code));
  expect(missing).toEqual([]);

  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('0 / 195');
  expect(errors).toEqual([]);
});

test('name mode: click a country, type its name, score it', async ({ page }) => {
  const errors = [];
  watchErrors(page, errors);
  await boot(page);

  await clickCountry(page, 'BR');
  await expect(page.locator('#card')).toBeVisible();

  // "brasil", not "brazil" — the close-spellings-count promise is part
  // of the contract, not a nicety.
  await page.locator('#guess-input').fill('brasil');
  await page.locator('#guess-input').press('Enter');

  await expect(page.locator('#answer-result')).toHaveText('✓ Correct!');
  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('1 / 195');
  expect(errors).toEqual([]);
});

test('aliases count as answers', async ({ page }) => {
  await boot(page);

  await clickCountry(page, 'CD');
  await expect(page.locator('#card')).toBeVisible();
  await page.locator('#guess-input').fill('drc');
  await page.locator('#guess-input').press('Enter');

  await expect(page.locator('#answer-result')).toHaveText('✓ Correct!');
});

test('wrong guess is rejected, reveal shows the answer without scoring', async ({ page }) => {
  await boot(page);

  await clickCountry(page, 'IN');
  await expect(page.locator('#card')).toBeVisible();
  await page.locator('#guess-input').fill('pakistan');
  await page.locator('#guess-input').press('Enter');

  await expect(page.locator('#feedback')).toHaveClass('bad');
  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('0 / 195');

  await page.locator('#reveal-btn').click();
  await expect(page.locator('#answer-name')).toContainText('India');
  // Revealed is not named: name mode progress must not move.
  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('0 / 195');
});
