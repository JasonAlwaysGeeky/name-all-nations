// Files-on-disk checks: a typo'd path in the precache list or a missing
// icon doesn't throw anywhere visible — offline install just silently
// degrades. Catch it here instead.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

test('manifest parses and its icons exist', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) expect(exists(icon.src), icon.src).toBe(true);
});

test('every file the service worker precaches exists', () => {
  const core = read('sw.js').match(/const CORE = \[([^\]]*)\]/)[1];
  const files = [...core.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
  expect(files.length).toBeGreaterThan(5);
  for (const f of files) expect(exists(f), f).toBe(true);
});

test('index.html only references files that exist', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)].map(m => m[1]);
  expect(refs.length).toBeGreaterThan(3);
  for (const f of refs) expect(exists(f), f).toBe(true);
});
