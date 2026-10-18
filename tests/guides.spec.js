// ?guides is how the view boxes in js/views.js get set by eye. It is a
// tool, not the game — but one that silently stopped dragging would send
// someone back to guessing numbers.

const { test, expect } = require('@playwright/test');

test('a view box drags by its edge, the jump follows it, and Copy hands the table back', async ({ page }) => {
  await page.goto('/?guides&play=name');
  await expect(page.locator('.gd-row')).toHaveCount(12);

  await page.locator('.gd-row', { hasText: /^Europe\d/ }).click();
  const grip = page.locator('.gd-box.sel .gd-h[data-h="s"]');
  await expect(grip).toBeVisible();

  // Wait out the jump: the grip stops moving when the view does.
  let at = null;
  await expect.poll(async () => {
    const b = await grip.boundingBox(), still = at && b.y === at.y;
    at = b;
    return still;
  }, { intervals: [150] }).toBe(true);

  const before = await page.evaluate(() => [...VIEW_BOXES.Europe]);
  const scale = await page.evaluate(() => window.NAN_DEBUG.scale());
  const x = at.x + at.width / 2, y = at.y + at.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 40, { steps: 4 });
  await page.mouse.up();

  const after = await page.evaluate(() => [...VIEW_BOXES.Europe]);
  expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
  expect(after[3]).toBe(before[3] + Math.round(-40 / scale));

  // The map did not pan underneath the drag.
  const b2 = await grip.boundingBox();
  expect(Math.abs(b2.y + b2.height / 2 - (y - 40))).toBeLessThan(scale + 2);

  // A drag waits for Save, and Save says where it went (a test never
  // writes the file, so here that is this browser).
  await expect(page.locator('#gd-status')).toHaveText('Unsaved changes');
  await page.locator('#gd-save').click();
  await expect(page.locator('#gd-status')).toHaveText('Saved in this browser');
  await expect(page.locator('#gd-save')).toBeDisabled();

  // The game itself reads the dragged box, and it survives a reload.
  await page.locator('#gd-copy').click();
  await expect(page.locator('#gd-out')).toHaveValue(new RegExp(`'Europe':\\s+\\[${after.join(', ')}\\]`));
  await page.reload();
  expect(await page.evaluate(() => [...VIEW_BOXES.Europe])).toEqual(after);

  // …but only under ?guides: the game proper plays the file's boxes.
  await page.goto('/?play=name');
  expect(await page.evaluate(() => [...VIEW_BOXES.Europe])).toEqual(before);
});

test('the panel closes the editor and goes back to the game in the same mode', async ({ page }) => {
  await page.goto('/?guides&play=name');
  await expect(page.locator('.gd-row')).toHaveCount(12);
  await page.locator('#gd-close').click();
  await expect(page).toHaveURL(/\?play=name$/);
  await expect(page.locator('#gd-panel')).toHaveCount(0);
});
