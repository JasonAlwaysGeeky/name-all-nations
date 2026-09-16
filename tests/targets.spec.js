// js/targets.js is generated from map/world.svg, and nothing at runtime
// would notice if it drifted — buttons would simply retire at the wrong
// zoom on the countries that changed shape. Regenerate it here and fail
// on any difference, so a map change can't merge without the table that
// goes with it.

const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

test('js/targets.js matches the map it was generated from', () => {
  let out;
  try {
    out = execFileSync(process.execPath, ['tools/gen-targets.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  } catch (err) {
    throw new Error(`${err.stdout || ''}${err.stderr || ''}`.trim() || String(err));
  }
  expect(out).toContain('up to date');
});
