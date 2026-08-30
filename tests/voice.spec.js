// Voice mode end-to-end, on top of the fake recognizer in voice-helpers.js.

const { test, expect } = require('@playwright/test');
const { boot, clickCountry } = require('./voice-helpers');

const micOn = (page) => page.locator('#mic-toggle').click();
const say = (page, text, isFinal = true) =>
  page.evaluate(([t, f]) => window.__voice.say(t, f), [text, isFinal]);
const listening = (page) => page.evaluate(() => !!window.__voice.rec?.running);

test('one utterance names the selected country', async ({ page }) => {
  await boot(page);
  await micOn(page);
  await clickCountry(page, 'BR');
  await expect(page.locator('#card')).toBeVisible();

  expect(await say(page, 'brazil')).toBe(true);
  await expect(page.locator('#answer-result')).toHaveText('✓ Correct!');
  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('1 / 195');
});

test('click ahead: the queue grades countries the player has moved past', async ({ page }) => {
  await boot(page);
  await micOn(page);

  // Click three, saying nothing — the whole point is that the player
  // never waits for the recognizer to catch up.
  await clickCountry(page, 'BR');
  await clickCountry(page, 'IN');
  await clickCountry(page, 'FR');

  // One transcript covering all three, in the order they were clicked.
  expect(await say(page, 'brazil india france')).toBe(true);

  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('3 / 195');
});

test('a wrong name in the queue misses without derailing the rest', async ({ page }) => {
  await boot(page);
  await micOn(page);

  await clickCountry(page, 'BR');
  await clickCountry(page, 'IN');
  expect(await say(page, 'brazil pakistan')).toBe(true);

  // Brazil landed; India was answered with a real (wrong) country name,
  // so it counts as a miss rather than staying untouched.
  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('1 / 195');
  await expect.poll(() =>
    page.evaluate(() => document.querySelector('#hit-layer path[data-code="IN"]')?.classList.contains('named'))
  ).toBe(false);
});

test('close spellings still count when spoken', async ({ page }) => {
  await boot(page);
  await micOn(page);
  await clickCountry(page, 'BR');
  expect(await say(page, 'brasil')).toBe(true);
  await expect(page.locator('#answer-result')).toHaveText('✓ Correct!');
});

test('an interim result banks a correct answer before the final arrives', async ({ page }) => {
  await boot(page);
  await micOn(page);
  await clickCountry(page, 'BR');

  expect(await say(page, 'brazil', false)).toBe(true);
  await expect(page.locator('#answer-result')).toHaveText('✓ Correct!');
  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('1 / 195');
});

test('noise that is not a country name costs nothing', async ({ page }) => {
  await boot(page);
  await micOn(page);
  await clickCountry(page, 'BR');

  expect(await say(page, 'umm hang on')).toBe(true);
  await expect(page.locator('#feedback')).toHaveClass('hint');
  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('0 / 195');

  // …and the country is still there to answer.
  expect(await say(page, 'brazil')).toBe(true);
  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('1 / 195');
});

// Regression: pause left recognition running. Nothing consumed results
// while paused, so the transcript banked up past its trim and graded
// itself against the queue the moment play resumed.
test('pause stops the mic, and words from the pause do not grade on resume', async ({ page }) => {
  await boot(page);
  await micOn(page);
  await clickCountry(page, 'BR');
  expect(await listening(page)).toBe(true);

  await page.locator('#pause-timer').click();
  await expect(page.locator('#pause-veil')).toBeVisible();

  // The mic is actually off, not merely ignored — nothing is listening,
  // so a would-be transcript never even lands.
  expect(await listening(page)).toBe(false);
  expect(await say(page, 'brazil')).toBe(false);

  // The veil is the resume gesture — it covers the button on purpose.
  await page.locator('#pause-veil').click();
  await expect(page.locator('#pause-veil')).toBeHidden();
  expect(await listening(page)).toBe(true);

  // Nothing banked during the pause leaked through.
  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('0 / 195');

  // And voice still works afterwards.
  expect(await say(page, 'brazil')).toBe(true);
  await expect.poll(() => page.locator('#progress-text').textContent()).toBe('1 / 195');
});

// Regression: the meter's "already running" guard tested meterStream,
// which is null while getUserMedia is still in flight — so a fast
// on/off/on put two captures in the air and leaked the first.
test('toggling the mic quickly never leaves a capture running', async ({ page }) => {
  await boot(page);
  await clickCountry(page, 'BR');

  // All in one task, so every toggle lands while the first getUserMedia is
  // still in flight — clicking through Playwright would let each capture
  // settle in between and the race would never happen. Odd count, so this
  // ends switched on: that is the case that leaked, because each late
  // capture overwrote the last instead of standing down.
  await page.evaluate(() => {
    const b = document.getElementById('mic-toggle');
    for (let i = 0; i < 5; i++) b.click();
  });
  // Let every capture that was asked for actually land before switching
  // off, or the assertion races the very promises it is about.
  await expect.poll(() => page.evaluate(() =>
    window.__voice.log.gum > 0 && window.__voice.log.streams.length === window.__voice.log.gum
  )).toBe(true);

  // Now switch off for real. However many captures got requested along the
  // way, none of them may still be holding the mic.
  await page.locator('#mic-toggle').click();
  await expect.poll(() => page.evaluate(() => window.__voice.liveStreams())).toBe(0);
  expect(await listening(page)).toBe(false);
});
