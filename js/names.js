/*
 * Does a guess name this country? Shared by the flat map and the globe.
 *
 * A classic script over countries.js: the answer table is every name and
 * alias, normalised, and a guess is right when the country is (one of)
 * its closest matches within a typo budget. The phonetic pass on top of
 * that is for the microphone only — see bestMatches.
 */

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')      // strip accents
    .replace(/[^a-z0-9]+/g, ' ')          // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

// How many typos we forgive, by answer length. Short names get no
// slack so Iran/Iraq and Niger/Nigeria can't blur together.
function typoBudget(len) {
  if (len <= 4) return 0;
  if (len <= 6) return 1;
  if (len <= 11) return 2;
  return 3;
}

const ANSWERS = [];
for (const c of COUNTRIES) {
  for (const raw of [c.name, ...c.aliases]) ANSWERS.push({ norm: normalize(raw), code: c.code });
}

// How a word sounds, roughly: the spellings English is inconsistent
// about folded together, and every vowel folded to one placeholder.
//
// This exists because a speech recognizer is guessing at English, not
// at geography, and it will happily hand back a common word that
// sounds like the country you said: "molly" for Mali, "cypress" for
// Cyprus. Those are nowhere near each other as letters — Levenshtein
// never gets there — but they are the same sound, which is the thing
// that was actually right about what you said.
//
// Vowels fold rather than drop. Dropping them is the classic trick and
// it is too lossy on short names: without the placeholders "people"
// comes out as Palau.
function soundKey(s) {
  const t = normalize(s).replace(/ /g, '')
    .replace(/ph/g, 'f')
    .replace(/gh/g, 'g')
    .replace(/ck/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/sch/g, 'sk')
    .replace(/ch/g, 'q')          // q stands in for the ch / sh sound
    .replace(/sh/g, 'q')
    .replace(/c([eiy])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/w/g, 'v')
    .replace(/j/g, 'y');
  return t ? t.replace(/[aeiouy]/g, 'a').replace(/(.)\1+/g, '$1') : '';
}

// key -> the countries that sound like it. Two keys are shared (Ghana
// with Guinea and Guyana; Oman with Yemen) and those are refused
// outright: a sound that could be either is not evidence of one.
const BY_SOUND = new Map();
for (const a of ANSWERS) {
  const k = soundKey(a.norm);
  if (!k) continue;
  if (!BY_SOUND.has(k)) BY_SOUND.set(k, new Set());
  BY_SOUND.get(k).add(a.code);
}

// Words a player says *at* the game rather than *to* it. Only one of
// them collides with a country by sound ("sorry" lands on Syria), but
// none of them should ever be an answer, so they never reach the
// phonetic pass at all.
const FILLER = new Set(['sorry', 'oops', 'wait', 'hang on', 'hold on', 'um', 'uh', 'erm', 'hmm',
  'okay', 'ok', 'right', 'next', 'skip', 'what', 'damn', 'oh no', 'no idea', 'dunno',
  'i dont know', 'no', 'yes', 'yeah', 'nope', 'hello', 'testing']);

// The country codes whose names are the closest match to the guess,
// within the typo budget; empty when it doesn't sound like any country.
//
// `heard` opens the phonetic fallback, and only the voice path sets it.
// Typing is exact enough that the typo budget is the right amount of
// forgiveness; a microphone is not, and the same leniency applied to
// the keyboard would start accepting spellings nobody typed.
function bestMatches(guess, heard = false) {
  const bestCodes = new Set();
  const g = normalize(guess);
  if (!g) return bestCodes;
  let best = Infinity;
  for (const a of ANSWERS) {
    const d = levenshtein(g, a.norm);
    if (d > typoBudget(a.norm.length)) continue;
    if (d < best) { best = d; bestCodes.clear(); }
    if (d <= best) bestCodes.add(a.code);
  }
  if (bestCodes.size || !heard || FILLER.has(g)) return bestCodes;
  // Nothing looked like a country. Does it sound like exactly one?
  const codes = BY_SOUND.get(soundKey(g));
  if (codes && codes.size === 1) bestCodes.add([...codes][0]);
  return bestCodes;
}

// A guess is correct for `code` when that country is (one of) the
// closest matches overall and within the typo budget.
function matchGuess(guess, code, heard = false) {
  return bestMatches(guess, heard).has(code);
}
