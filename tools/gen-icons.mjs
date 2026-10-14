// Builds icons/ph.svg: the handful of Phosphor icons (regular weight, MIT)
// the game uses, as one sprite of <symbol>s. The markup references them as
// <svg class="ic"><use href="icons/ph.svg#name"/></svg>, so the icons ship
// with the game and work offline like everything else — no icon font, no CDN.
//
//   npm run icons
import { readFileSync, writeFileSync } from 'node:fs';

const NAMES = [
  'arrow-counter-clockwise', 'arrow-left', 'arrow-right', 'caret-down', 'caret-left', 'caret-right', 'caret-up',
  'chart-bar', 'corners-out', 'cursor-click', 'eye', 'flag-checkered', 'flask',
  'globe-hemisphere-west', 'hand-tap', 'info', 'keyboard', 'lightbulb', 'list',
  'magnifying-glass', 'microphone', 'minus', 'pause', 'pencil-simple', 'play', 'plus',
  'puzzle-piece', 'skip-forward', 'skull', 'speaker-high', 'squares-four',
  'thermometer-simple', 'trophy', 'x',
];

const symbols = NAMES.map((name) => {
  const svg = readFileSync(new URL(`../node_modules/@phosphor-icons/core/assets/regular/${name}.svg`, import.meta.url), 'utf8');
  const m = svg.match(/<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>/);
  if (!m) throw new Error(`${name}: not the SVG shape this expects`);
  return `<symbol id="${name}" viewBox="${m[1]}">${m[2].trim()}</symbol>`;
});

writeFileSync(new URL('../icons/ph.svg', import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg">\n${symbols.join('\n')}\n</svg>\n`);
console.log(`icons/ph.svg: ${NAMES.length} icons`);
