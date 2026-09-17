// Hints, and what the end of a run says about them.
//
// A hint has always cost you the first-try credit, silently, and the
// results then filed the country under "Missed" — even though you went
// on to name it and the map still showed it green. These pin down both
// halves of the fix: the cost is said out loud when you take it, and the
// results tell a country you needed help with apart from one you never
// got at all.

const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/');
  await page.locator('#hello-close').click();
  await expect(page.locator('#map svg')).toBeAttached();
  await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
}

// Click a country the way a player does, through whatever is stacked on
// top of it.
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
  expect(pt, `no clickable point inside ${code}`).not.toBeNull();
  await page.mouse.click(pt.x, pt.y);
  // Under a loaded runner a click can land while the view is still
  // animating, so confirm the game agrees about what got selected before
  // answering for it.
  await expect.poll(() => page.evaluate(() => window.NAN_DEBUG.state.selected)).toBe(code);
}

const answer = async (page, text) => {
  await page.locator('#guess-input').fill(text);
  await page.locator('#guess-input').press('Enter');
};

test('the first hint says out loud what it costs, and there are only three', async ({ page }) => {
  await boot(page);
  await clickCountry(page, 'KZ');

  await expect(page.locator('#hint-btn')).toHaveText(/Hint 1\/3/);
  await page.locator('#hint-btn').click();
  await expect(page.locator('#feedback')).toContainText('no longer counts as first-try');
  // …and the first rung is a region and a shape, never a letter of it.
  await expect(page.locator('#feedback')).not.toContainText('K');

  await page.locator('#hint-btn').click();
  await page.locator('#hint-btn').click();
  await expect(page.locator('#hint-btn')).toBeDisabled();

  // The old ladder grew a letter at a time up to half the name, so
  // "Kazakhstan" leaked as far as "Kazak". Two letters is the ceiling now.
  const shown = await page.locator('#feedback').textContent();
  expect(shown).toContain('Ka');
  expect(shown).not.toContain('Kaz');
});

test('a hint leaves the map green but the run knows it was not first try', async ({ page }) => {
  await boot(page);
  await clickCountry(page, 'KZ');
  await page.locator('#hint-btn').click();
  await answer(page, 'kazakhstan');

  await expect(page.locator('#answer-result')).toHaveText('✓ Correct!');
  expect(await page.evaluate(() => window.NAN_DEBUG.state.status.KZ)).toBe('named');
  expect(await page.evaluate(() => window.NAN_DEBUG.state.level.result.KZ)).toBe(false);
});

test('the results tell "needed a hint" apart from "never got it"', async ({ page }) => {
  await boot(page);

  // Central America: seven countries, all big enough to click.
  await page.evaluate(() => {
    const D = window.NAN_DEBUG;
    D.startLevel(D.CHALLENGE_BY_ID['sub:Central America'], 'name');
  });
  await expect.poll(async () => {
    const a = await page.evaluate(() => window.NAN_DEBUG.view().x);
    await page.waitForTimeout(60);
    return a === await page.evaluate(() => window.NAN_DEBUG.view().x);
  }, { timeout: 5000 }).toBe(true);

  const names = {
    BZ: 'belize', CR: 'costa rica', SV: 'el salvador',
    GT: 'guatemala', HN: 'honduras', NI: 'nicaragua', PA: 'panama',
  };
  for (const [code, name] of Object.entries(names)) {
    await clickCountry(page, code);
    if (code === 'HN') {
      await page.locator('#hint-btn').click();      // needed a nudge, then got it
      await answer(page, name);
    } else if (code === 'NI') {
      await page.locator('#reveal-btn').click();    // never got it
    } else {
      await answer(page, name);
    }
    // A correct answer closes the card itself; a reveal leaves it open.
    if (await page.locator('#card').isVisible()) await page.keyboard.press('Escape');
  }

  await expect(page.locator('#results')).toBeVisible();
  const misses = page.locator('#results-misses');
  await expect(misses).toContainText('Never got it (1)');
  await expect(misses).toContainText('Got there, but not first try (1)');

  // …and each country is filed under the right one of the two.
  const sections = await misses.evaluate((box) => {
    const out = {};
    let key = null;
    for (const node of box.children) {
      if (node.tagName === 'H3') key = node.textContent.startsWith('Never') ? 'lost' : 'helped';
      else if (key) out[key] = [...node.querySelectorAll('.chip span')].map(s => s.textContent);
    }
    return out;
  });
  expect(sections.lost).toEqual(['Nicaragua']);
  expect(sections.helped).toEqual(['Honduras']);
});
