// A speech recognizer is guessing at English, not at geography. Asked
// for one answer it hands back the common word that sounds like the
// country you said — "molly" for Mali, "cypress" for Cyprus, "everybody"
// for Kiribati — and none of those are close enough as *letters* for the
// typo budget to reach. Two things answer that: read every alternative
// the recognizer offers, and fall back to matching on sound.
//
// The risk being guarded here is the mirror image: matching on sound is
// looser than matching on letters, so it must not start handing out
// countries for words that were never an answer.

const { test, expect } = require('@playwright/test');
const { boot, clickCountry } = require('./voice-helpers');

const micOn = (page) => page.locator('#mic-toggle').click();
const say = (page, text, isFinal = true) =>
  page.evaluate(([t, f]) => window.__voice.say(t, f), [text, isFinal]);
const statusOf = (page, code) => page.evaluate((c) => window.NAN_DEBUG.state.status[c], code);

test('a country misheard as a word that sounds like it still counts', async ({ page }) => {
  await boot(page);
  await micOn(page);

  await clickCountry(page, 'ML');
  await say(page, 'molly');
  await expect.poll(() => statusOf(page, 'ML')).toBe('named');
});

test('Cyprus, which the recognizer hears as a tree', async ({ page }) => {
  await boot(page);
  await micOn(page);

  // Cyprus is too small to click at world zoom; the buttons are how you
  // reach it there, and that is beside the point of this test.
  await page.evaluate(() => window.NAN_DEBUG.zoomToCodes(['CY'], 0));
  await page.waitForTimeout(200);
  await clickCountry(page, 'CY');
  await say(page, 'cypress');
  await expect.poll(() => statusOf(page, 'CY')).toBe('named');
});

test('the country wins over the recognizer\'s favourite English', async ({ page }) => {
  await boot(page);
  await micOn(page);

  // Ranked the way the real thing ranks them: whichever reads best as a
  // sentence first, the country further down. Asked for a single answer
  // the recognizer returned "everybody" and kept Kiribati in second
  // place — this is that shape, on a country big enough to click.
  await clickCountry(page, 'TD');
  await say(page, ['every body', 'nobody at all', 'chad']);
  await expect.poll(() => statusOf(page, 'TD')).toBe('named');
});

test('muttering at the game is not an answer', async ({ page }) => {
  await boot(page);
  await micOn(page);

  // "sorry" and "Syria" are the same sound, and it is the one English
  // word in common use that collides with a country. It is on the filler
  // list for exactly that reason.
  await clickCountry(page, 'SY');
  await say(page, 'sorry');
  await page.waitForTimeout(250);
  expect(await statusOf(page, 'SY')).toBeUndefined();
  expect(await page.evaluate(() => window.NAN_DEBUG.state.level.result.SY)).toBeUndefined();
});

test('a sound two countries share is not evidence of either', async ({ page }) => {
  await boot(page);
  await micOn(page);

  // Oman and Yemen fold to the same key, so the phonetic pass has to
  // refuse it rather than pick one. "amen" is nowhere near either as
  // letters, so nothing else can rescue it.
  // Too small to click at world zoom; the buttons are how you reach it
  // there, and that is beside the point of this test.
  await page.evaluate(([c]) => window.NAN_DEBUG.zoomToCodes([c], 0), ['OM']);
  await page.waitForTimeout(200);
  await clickCountry(page, 'OM');
  await say(page, 'amen');
  await page.waitForTimeout(250);
  expect(await statusOf(page, 'OM')).toBeUndefined();
});

test('sounding like a country is still only good for that country', async ({ page }) => {
  await boot(page);
  await micOn(page);

  // Said while Chad is on screen, "molly" is a wrong answer, not a free
  // pass — and it must not quietly name Mali instead.
  await clickCountry(page, 'TD');
  await say(page, 'molly');
  await expect.poll(() => page.evaluate(() => window.NAN_DEBUG.state.level.result.TD)).toBe(false);
  expect(await statusOf(page, 'ML')).toBeUndefined();
});
