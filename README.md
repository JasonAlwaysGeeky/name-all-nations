# 🌍 Name All Nations

A game that tests whether you can name all 195 countries — the reverse of
the usual geography quiz. Instead of being shown a name and pointing at the
map, **you click a country and name it**.

## How to play

- Click (or tap) any country and type its name. Spelling is forgiving —
  "brasil", "luxemburg", or "Cote d'Ivoire" vs "Ivory Coast" all count.
  Short names get less slack so Niger/Nigeria and Iran/Iraq can't blur.
- Turn on the 🎤 to skip typing entirely and just say the names out loud
  (uses the browser's speech recognition — Chrome and Edge support it).
- 💡 Hint gives you the first letter, length, and continent; more presses
  reveal more letters. Reveal shows the answer but marks it orange —
  it doesn't count until you can name it yourself.
- Every challenge is timed, but the clock only starts on your first move,
  and `P` pauses it — the map is hidden while paused, so no free scouting.
  Finish and you get a results screen with your time, first-try accuracy,
  the countries you missed, and whether you set a new best. Place mode is
  level one (learn the region), Name mode is the real test.
- Scroll/pinch to zoom, drag to pan. Three zoom layers on hotkeys: `0`
  is the whole world, `1`–`6` are the continents west to east, and
  `Q`/`W`/`E`/`R`/`T` are the dense areas that need a layer of their own
  (Caribbean · West African coast · Europe's micro-states · Middle East ·
  Pacific), also west to east — the jump bar at top-left shows them all.
  Fits are tight and cap how far a giant country drags the frame, so a
  continent view frames the playable mass, not the empty Arctic.
  `[` / `]` step through challenges, `Space` skips the current name in
  place mode, `?` lists the shortcuts.

### Finding the small ones

- Every country too small to click reliably (58 of them — the micro-states,
  the Caribbean and Pacific islands, Togo, Gambia, Belize, Rwanda, East
  Timor…) has a round button with a pointer wedge back to the shape
  (Seterra-style). Buttons retire once you're zoomed in far enough to
  click the country itself, and the five densest areas — the Caribbean,
  the Pacific, the Middle East, Europe's micro-states and the West African
  coast — fold into one numbered button when zoomed out; clicking it (or
  its hotkey) zooms to the layer where every member is clickable. Offsets
  are hand-laid in `BUTTON_OFFSETS` (`js/countries.js`), zones in
  `BUTTON_ZONES`, verified collision-free from a 1280px window up to deep
  zoom.
- Island nations (Fiji, the Bahamas, Micronesia, Kiribati…) get a quiet
  dotted outline around each island group — an ellipse for the halves of a
  nation split by the antimeridian — so you can see which islands belong
  together without it reading as a box. The outline is clickable too.
- Every country also has 12px of invisible click padding, so coastal
  waters and archipelago gaps still hit the right country.

## Challenges

The 🎯 button lists the whole world, each continent, and 21 bite-size
regions (the Caribbean, West Africa, Southeast Asia…). Each plays two ways:

- **Name** — the real test: countries outside the challenge dim, and you
  click and name each one (typed or spoken). Clicking a country you've
  already named just shows its answer — no penalty.
- **Place** — the warm-up: the challenge's names come up one at a time.
  Click where the current one belongs; `Space` or ⏭ skips it to the end
  of the list, 👁 Show me (or three wrong clicks) flashes where it is and
  counts it as a miss. The full list stays below so you can pick your own
  order, or collapse it out of the way.

## Stats

📊 keeps, across every game you've played, a per-country **streak** — how
many games in a row you've got it right on the first try — plus first-try
accuracy and best times per challenge (fastest finish, and fastest
*clean* run with nothing missed). Toggle the **heat map** to paint the map
by streak and see at a glance which countries you've actually memorised
and which you keep fumbling.

Flags appear next to names in place mode and on answers (never on the
question); turn them off in 📊 if you'd rather not have the hint.

## The 195

193 UN member states plus Vatican City and Palestine. Territories
(Greenland, Puerto Rico, French Guiana…) are shown on the map in gray and
identified when clicked, but don't count. Accepted names include the
common alternates — Czechia / Czech Republic, DR Congo / Democratic
Republic of the Congo, Timor-Leste / East Timor, Burma, Swaziland, etc.

## Running it

It's a static site — any web server works:

```
npx http-server -p 5173 .
```

then open http://localhost:5173. (It can't run from `file://` because the
map is fetched at runtime.) On a phone, host it anywhere static
(GitHub Pages, Netlify, Cloudflare Pages) and it works as-is — the layout
is responsive and touch/pinch are supported.

## How the map stays fast

Rewriting an SVG `viewBox` re-rasterises every path, which is far too slow
to do per frame on a 250-path world map. Instead the SVG is drawn once,
30% larger than the viewport on every side, and moved with a GPU
transform while you drag, wheel-zoom or animate; the `viewBox` is only
rewritten once the view settles (or drifts past the pre-rendered margin).
Two levels of coastline detail keep those re-renders cheap: zoomed out
the map uses `map/world-lo.json` (a quarter of the original's points —
far below what a pixel can show at that scale), and once you're past
~2.5× it swaps in `map/world.svg` (56% of the points). `map/world-full.svg`
is the untouched amCharts file; the simplifier never drops an island.

## Files

- `index.html` / `css/style.css` — page and styling
- `js/countries.js` — the 195 countries with accepted alternate names, plus
  territory labels and the region/subregion groupings
- `js/app.js` — map loading, pan/zoom + level of detail, overlay (buttons,
  island outlines), fuzzy matching, speech in/out, timer, stats, results
- `map/world-lo.json` — coarse coastlines for zoomed-out views
- `map/world.svg` — world map © [amCharts](https://www.amcharts.com)
  (free to use with attribution link, kept in the page footer)
