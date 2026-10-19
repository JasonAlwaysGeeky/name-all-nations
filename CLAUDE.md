# Name All Nations

**Live: https://moffatjason.github.io/name-all-nations/** (GitHub Pages,
public repo, served from `main` — pushing `main` redeploys). This is the
build to test on a real device. The pinned "Name All Nations" Artifact
(https://claude.ai/artifact/FZrCwiFHer7W8ecBiHrwKd) is a copy of the repo
kept current as the side-panel dev build: republished after each change.
It can't use the microphone or show safe-area insets; Pages can.

Repo: https://github.com/moffatjason/name-all-nations — work lands via
`jmoffat/` branches and PRs, not straight to `main`.

## Running it locally

Static site, but it can't run from `file://` (the map is fetched at runtime):

```bash
npm run serve
```

Or `npm start`: the same server, and it opens the game in Chrome, where voice
input works (an artifact can't use the mic). Either one prints the address a
phone on the same Wi-Fi can use. Claude runs it in the app's Terminal panel.

That is `tools/serve.mjs`: the files, never cached, on port 5173 — plus the
one thing a static server can't do, which is let the `?guides` editor write
the view boxes back into `js/views.js` as they are dragged (from a phone on
the LAN too). Any static server still runs the game; the editor then keeps
its edits in the browser and offers Copy instead.

`.claude/launch.json` already defines this as the `name-all-nations` preview
server, so the Browser pane can start it directly.

## Shape of it

- `index.html` — the whole DOM: map, the HUD and its menu (top left), the
  minimap (six jump zones), the bottom bar (idle / answer box / name to find
  / hardcore), and the full screens around it — home, the mode picker, the
  intro, results, stats, the heat map. The layout follows the Atlas3 design.
  A first visit opens on the intro and every later one on home;
  `?play` skips both and lands on the map. Place is the starting mode;
  `?play=name` (or `hardcore`) lands in that one instead (the tests use it)
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
  `?guides` loads `js/guides.js`, the on-map editor that sets them by eye.
  It and the globe live in the Developer panel (menu, or `` ` ``), which every
  build but the live Pages site shows, the artifact included; on Pages `?dev` switches it on for
  that browser and `?dev=0` off
- `js/minimap.js` — the minimap's picture (all land as two paths). Shared by
  the flat map and the globe
- `js/names.js` — does a guess name this country: normalise, typo budget,
  the phonetic pass for the mic. Shared by the flat map and the globe
- `js/islands.js` — the dotted outlines round an island nation's islands:
  which nations, how the islands group, and each outline's rect in map
  units at a zoom. The flat map draws them as SVG, the globe drapes the
  same rects over the sphere
- `js/globe.js` + `js/globe-play.js` + `globe.html` — the globe: a canvas
  renderer over the same borders (every frame re-projects; nothing is
  transformed) with the flat map's gesture on a sphere, and a cut-down copy
  of the game loop on top — name and place, the buttons, zones and island
  outlines, the jump keys on the same boxes — enough to judge how it plays. Not a mode of the
  game yet; nothing there is scored or saved
- `css/tokens.css` — every colour, radius and shadow: the Nocturne design
  system on its T3-O palette, plus the map's own states. `css/style.css` is
  layout and components and takes all of its colours from there
- `icons/ph.svg` — the Phosphor icons the game uses, as one sprite; generated
  by `npm run icons` from the list in `tools/gen-icons.mjs`. `fonts/` is Inter
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
