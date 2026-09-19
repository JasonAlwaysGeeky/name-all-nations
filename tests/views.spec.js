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

  test('the find bar is one row, and a place run reserves no quiz card on top of it', async ({ page }) => {
    await page.goto('/');
    await page.locator('#hello-close').click();
    await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
    await page.evaluate(() => window.NAN_DEBUG.startLevel(window.NAN_DEBUG.CHALLENGE_BY_ID.world, 'place'));
    await expect(page.locator('#word-bank')).toBeVisible();

    const bar = await page.locator('#word-bank').boundingBox();
    expect(bar.height).toBeLessThan(60);

    // The bar is measured into the safe area; the card it would have made
    // room for never opens in this mode.
    const r = await page.evaluate(() => {
      const D = window.NAN_DEBUG;
      return { bottom: D.SAFE.bottom, clear: D.cardClear(BUTTON_ZONES.find(z => z.name === 'European microstates')) };
    });
    expect(r.clear).toBe(0);
    expect(r.bottom).toBeLessThan(200);
  });
});

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
          const { W, H } = D.size(), S = D.SAFE, clear = z ? D.cardClear(z) : 0;
          out[name] = {
            inside: a.x >= S.left - 1 && a.y >= S.top - 1 && b.x <= W - S.right + 1 && b.y <= H - S.bottom - clear + 1,
            // A zone dive may overflow only because it is pinned at the
            // zoom where its buttons unfold — never for any other reason.
            pinned: !!z && Math.abs(D.scale() - z.minScale * 1.1) < 0.01,
            unfolded: !z || D.scale() >= z.minScale,
          };
        }
        return out;
      });

      for (const [name, r] of Object.entries(report)) {
        expect(r.inside || r.pinned, `${name} is cropped`).toBe(true);
        expect(r.unfolded, `${name} lands below the zoom its buttons unfold at`).toBe(true);
      }
    });
  });
}
