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
    await page.goto('/?play=name');
    await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
    await page.evaluate(() => window.NAN_DEBUG.startLevel(window.NAN_DEBUG.CHALLENGE_BY_ID.world, 'place'));
    await expect(page.locator('#word-bank')).toBeVisible();

    const bar = await page.locator('#word-bank').boundingBox();
    expect(bar.height).toBeLessThan(80);

    // …and, with the minimap sitting on top of it, that is all the bottom
    // costs the map. The safe area is re-read a frame after anything
    // docked there changes size, so give it that frame; and if it is
    // still wrong, say what was measured.
    const bottom = () => page.evaluate(() => {
      const D = window.NAN_DEBUG, map = document.getElementById('map').getBoundingClientRect();
      const rect = id => { const e = document.getElementById(id); return e.hidden ? 'hidden' : [Math.round(e.getBoundingClientRect().top - map.top), Math.round(e.getBoundingClientRect().height)]; };
      return { bottom: D.SAFE.bottom, size: D.size(), map: Math.round(map.height), bank: rect('word-bank'), keys: rect('jump-bar'), card: rect('card'), hc: rect('hardcore-bar') };
    });
    await expect.poll(async () => (await bottom()).bottom, { timeout: 2000, message: JSON.stringify(await bottom()) }).toBeLessThan(240);
  });
});

for (const [label, viewport] of Object.entries({ 'a laptop': SCREENS['a laptop'], 'a portrait phone': SCREENS['a portrait phone'] })) {
  test.describe(label, () => {
    test.use({ viewport });

    // The minimap is six zones in a corner. Where it spans a real share
    // of the width (a phone) a fit has to clear it, so the safe area
    // reaches above it; on a wide window it is only a corner, and the
    // safe area stops at the bar instead of giving up the minimap's
    // whole height across the screen.
    test('the minimap has six zones, and the safe area clears it only where it is wide', async ({ page }) => {
      await page.goto('/?play=name');
      await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);

      const r = await page.evaluate(() => {
        const mini = document.getElementById('jump-bar').getBoundingClientRect();
        const bar = document.getElementById('idle-bar').getBoundingClientRect();
        const map = document.getElementById('map').getBoundingClientRect();
        return {
          keys: document.querySelectorAll('#jump-bar button').length,
          wide: mini.width >= map.width * 0.4,
          aboveMini: map.bottom - mini.top,
          aboveBar: map.bottom - bar.top,
          bottom: window.NAN_DEBUG.SAFE.bottom,
        };
      });
      expect(r.keys).toBe(6);
      expect(r.bottom).toBeGreaterThanOrEqual(r.aboveBar);
      if (r.wide) expect(r.bottom).toBeGreaterThanOrEqual(r.aboveMini);
      else expect(r.bottom).toBeLessThan(r.aboveMini);
    });
  });
}

// The Middle East's buttons were spaced by search so that none pair up
// from the zone's minScale on — which is what lets a phone's dive land on
// the box instead of on a numbered button.
for (const [label, viewport] of Object.entries({ 'a 360px phone': { width: 360, height: 740 }, 'a laptop': SCREENS['a laptop'] })) {
  test.describe(label, () => {
    test.use({ viewport });

    test('the Middle East dive lands on seven separate buttons', async ({ page }) => {
      await page.goto('/?play=name');
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
      await page.goto('/?play=name');
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
