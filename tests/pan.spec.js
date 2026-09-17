// Dragging the map means one thing: the point you grabbed stays under
// your finger. Everything else about the gesture — momentum, pinch,
// re-anchoring — is a refinement on top of that, and none of it is worth
// testing if the basic promise is broken.
//
// It was, off-centre and worst on a phone, because the pan solved the
// view with the *map's* aspect while every other reader of the view used
// the *window's*. A 90x60px drag on a portrait phone slid 134 map units
// out from under the finger. So these check the grab holds at several
// places on the glass, in both orientations, with a finger as well as a
// mouse.
//
// The gesture is driven by dispatching pointer events inside the page
// rather than through the CDP mouse: the whole drag then happens in one
// synchronous turn, so a loaded machine cannot slip a re-layout or an
// animation frame into the middle of it and turn the measurement into a
// coin flip.

const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/');
  await page.locator('#hello-close').click();
  await expect(page.locator('#map svg')).toBeAttached();
  await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
}

// Grab at (fx, fy) of the map, break past the tap slop, then drag by
// (dx, dy) — and report how far the grabbed map point slid out from
// under the pointer, in screen pixels.
const dragSlip = (page, grab, by, pointerType) => page.evaluate(([grab, by, pointerType]) => {
  const D = window.NAN_DEBUG;
  const map = document.getElementById('map');
  const r = map.getBoundingClientRect();

  // The map point under a client point, worked out from the view the app
  // says it has — deliberately not via the app's own helper, so this
  // measures the contract rather than agreeing with the code.
  const under = (cx, cy) => {
    const v = D.view(), s = D.size().W / v.w;
    return { x: v.x + (cx - r.left) / s, y: v.y + (cy - r.top) / s, s };
  };

  const at = (type, x, y) => map.dispatchEvent(new PointerEvent(type, {
    pointerId: 7, pointerType, bubbles: true, cancelable: true,
    clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
  }));

  const x0 = r.left + r.width * grab.fx, y0 = r.top + r.height * grab.fy;
  at('pointerdown', x0, y0);
  // The first move only breaks the tap slop; the gesture re-anchors there.
  at('pointermove', x0 + 16, y0 + 16);
  const held = under(x0 + 16, y0 + 16);

  at('pointermove', x0 + 16 + by.dx, y0 + 16 + by.dy);
  const now = under(x0 + 16 + by.dx, y0 + 16 + by.dy);
  at('pointerup', x0 + 16 + by.dx, y0 + 16 + by.dy);

  return { slip: Math.hypot(now.x - held.x, now.y - held.y) * held.s, held, now };
}, [grab, by, pointerType]);

for (const [name, size, pointerType] of [
  ['a desktop window', { width: 1280, height: 800 }, 'mouse'],
  ['a portrait phone', { width: 412, height: 780 }, 'touch'],
  ['a landscape phone', { width: 780, height: 412 }, 'touch'],
]) {
  test(`the map holds the point you grabbed — ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await boot(page);

    // Zoomed all the way out the whole map is on screen and the view is
    // pinned, so a drag correctly does nothing. Give it somewhere to go.
    await page.evaluate(() => window.NAN_DEBUG.zoomToCodes(window.NAN_DEBUG.CODES_BY_REGION['Europe'], 0));

    // Dead centre used to be the one place this worked, so the corners
    // are the point of it.
    for (const grab of [{ fx: 0.5, fy: 0.5 }, { fx: 0.2, fy: 0.3 }, { fx: 0.78, fy: 0.62 }]) {
      const { slip, held, now } = await dragSlip(page, grab, { dx: 90, dy: -60 }, pointerType);
      expect(slip, `grabbed at ${grab.fx}/${grab.fy} on ${name} — held ${JSON.stringify(held)} now ${JSON.stringify(now)}`)
        .toBeLessThan(2);
    }
  });
}
