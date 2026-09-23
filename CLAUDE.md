# Name All Nations

**Live: https://jasonalwaysgeeky.github.io/name-all-nations/** (GitHub Pages,
public repo, served from `main` — pushing `main` redeploys). This is the
build to test on a real device; there is an old published Artifact floating
around that is stale and unmaintained.

Repo: https://github.com/JasonAlwaysGeeky/name-all-nations — work lands via
`jmoffat/` branches and PRs, not straight to `main`.

## Running it locally

Static site, but it can't run from `file://` (the map is fetched at runtime):

```bash
npx http-server -p 5173 -c-1 .
```

`.claude/launch.json` already defines this as the `name-all-nations` preview
server, so the Browser pane can start it directly.

## Shape of it

- `index.html` — the whole DOM: map, jump bar, quiz card, word bank, panels
- `js/app.js` — everything else. Transform-based SVG pan/zoom (the viewBox
  is only rewritten once a gesture settles), three levels of border detail,
  the rings/boxes/clusters overlay, timed Name/Place modes, stats + heat map
- `js/countries.js` — the 195 (193 UN + Vatican + Palestine), aliases, regions,
  and where each assist button stands (never how long it lasts)
- `js/targets.js` — generated: how big a target each country really is, as the
  radius of the largest circle that fits inside its borders. One rule decides
  every button's life from it, so there are no per-country exceptions
- `js/views.js` — where each jump key lands: twelve hand-set boxes, each the
  area that must be on screen. One rule fits them (tightest zoom that holds
  the box in the safe area), so a wrong view is a box to drag, not code.
  `?guides` loads `js/guides.js`, the on-map editor that sets them by eye
- `js/names.js` — does a guess name this country: normalise, typo budget,
  the phonetic pass for the mic. Shared by the flat map and the globe
- `js/globe.js` + `js/globe-play.js` + `globe.html` — the globe: a canvas
  renderer over the same borders (every frame re-projects; nothing is
  transformed) with the flat map's gesture on a sphere, and a cut-down copy
  of the game loop on top — name and place, the buttons and zones, the jump
  keys on the same boxes — enough to judge how it plays. Not a mode of the
  game yet; nothing there is scored or saved
- `flags/` — the 195 flags, SVG, from flag-icons (MIT). Cache-first like `map/`
- `map/` — the simplified amCharts world map, plus the 1.4MB full-detail
  version fetched lazily for deep zoom
- `sw.js` — offline play. **Network-first for app code on purpose**, so a
  push to Pages is never masked by a stale cache; only `map/*` is cache-first

## Notes

- The map view rect follows the *window's* aspect, not the map's — pinning
  it to the map's shape letterboxed portrait phones down to a 250px band.
- Mic input has never been tested outside a sandbox.
- **Regenerating anything in `map/` means bumping `CACHE` in `sw.js`.** Those
  files are the one cache-first exception, so an installed phone keeps
  serving the old borders forever otherwise — and it looks like the deploy
  simply didn't happen. Nothing enforces this; the version string is manual.
- Regenerating `map/world.svg` also means `npm run targets`, which rewrites
  `js/targets.js` from it. That one *is* enforced — CI fails on a stale table.
