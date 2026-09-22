// The one rule the jump views run on (js/views.js): a view's box is the
// area that must be on screen, so it lands inside the safe area whatever
// shape the window is. The boxes themselves get retuned by eye — this
// only holds the rule, on the screens it used to break on.

const { test, expect } = require('@playwright/test');

const SCREENS = {
  'a portrait phone': { width: 375, height: 812 },
  'a phone on its side': { width: 812, height: 375 },
  'a laptop': { width: 1280, height: 800 },
  'an ultrawide': { width: 2560, height: 1080 },
};

test.describe('what the bottom of a phone costs the map', () => {
  test.use({ viewport: SCREENS['a portrait phone'] });

  test('the find bar is one row', async ({ page }) => {
    await page.goto('/');
    await page.locator('#hello-close').click();
    await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
    await page.evaluate(() => window.NAN_DEBUG.startLevel(window.NAN_DEBUG.CHALLENGE_BY_ID.world, 'place'));
    await expect(page.locator('#word-bank')).toBeVisible();

    const bar = await page.locator('#word-bank').boundingBox();
    expect(bar.height).toBeLessThan(60);

    // …and, with the pad under it, that is all the bottom costs the map.
    expect(await page.evaluate(() => window.NAN_DEBUG.SAFE.bottom)).toBeLessThan(200);
  });
});

test.describe('the desktop jump keys', () => {
  test.use({ viewport: SCREENS['a laptop'] });

  test('run down the left edge, outside the safe area, and cost it no height', async ({ page }) => {
    await page.goto('/');
    await page.locator('#hello-close').click();
    await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);

    const r = await page.evaluate(() => ({
      left: window.NAN_DEBUG.SAFE.left,
      top: window.NAN_DEBUG.SAFE.top,
      keys: document.getElementById('jump-bar').getBoundingClientRect().right - document.getElementById('map').getBoundingClientRect().left,
    }));
    expect(r.left).toBeGreaterThanOrEqual(r.keys);
    expect(r.left).toBeLessThan(100);
    expect(r.top).toBe(60);

    await page.locator('#jump-toggle').click();
    await expect(page.locator('#jump-keys')).toBeHidden();
  });
});

// The Middle East's buttons were spaced by search so that none pair up
// from the zone's minScale on — which is what lets a phone's dive land on
// the box instead of on a numbered button.
for (const [label, viewport] of Object.entries({ 'a 360px phone': { width: 360, height: 740 }, 'a laptop': SCREENS['a laptop'] })) {
  test.describe(label, () => {
    test.use({ viewport });

    test('the Middle East dive lands on seven separate buttons', async ({ page }) => {
      await page.goto('/');
      await page.locator('#hello-close').click();
      await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);

      const r = await page.evaluate(() => {
        const D = window.NAN_DEBUG, z = BUTTON_ZONES.find(z => z.name === 'Middle East');
        D.zoomToZone(z, 0);
        const singles = [...document.querySelectorAll('#overlay-layer .btn')].filter(g => g.dataset.code).map(g => g.dataset.code);
        // A member is covered by a button of its own, or — on a screen
        // whose dive lands deep enough — by being the bigger target
        // itself (buttonRedundant: TARGET_R × zoom ≥ the 18px button).
        const s = D.scale();
        return {
          scale: s,
          members: z.codes.filter(c => BUTTON_OFFSETS[c] && (singles.includes(c) || TARGET_R[c] * s >= 18)),
          // The overlay is the whole map, so other zones' folded buttons
          // are in the DOM too, off screen; only this one's matter.
          folded: [...document.querySelectorAll('#overlay-layer .btn.zone, #overlay-layer .btn.group')]
            .map(g => g.dataset.zone || g.dataset.codes)
            .filter(x => x === z.name || x.split(',').some(c => z.codes.includes(c))),
        };
      });
      expect(r.members).toEqual(['CY', 'LB', 'IL', 'PS', 'KW', 'BH', 'QA']);
      expect(r.folded).toEqual([]);
    });
  });
}

for (const [label, viewport] of Object.entries(SCREENS)) {
  test.describe(label, () => {
    test.use({ viewport });

    test('every jump view holds its whole box inside the safe area', async ({ page }) => {
      await page.goto('/');
      await page.locator('#hello-close').click();
      await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);

      const report = await page.evaluate(() => {
        const D = window.NAN_DEBUG;
        const zones = Object.fromEntries(BUTTON_ZONES.map(z => [z.name, z]));
        const out = {};
        for (const name of Object.keys(VIEW_BOXES)) {
          const z = zones[name];
          if (z) D.zoomToZone(z, 0); else D.zoomToView(name, 0);
          const [x1, y1, x2, y2] = VIEW_BOXES[name];
          const a = D.mapToScreen(x1, y1), b = D.mapToScreen(x2, y2);
          const { W, H } = D.size(), S = D.SAFE;
          out[name] = {
            inside: a.x >= S.left - 1 && a.y >= S.top - 1 && b.x <= W - S.right + 1 && b.y <= H - S.bottom + 1,
            unfolded: !z || D.scale() >= D.zoneOpenScale(z),
          };
        }
        return out;
      });

      for (const [name, r] of Object.entries(report)) {
        expect(r.inside, `${name} is cropped`).toBe(true);
        expect(r.unfolded, `${name} lands on its own folded button`).toBe(true);
      }
    });
  });
}
