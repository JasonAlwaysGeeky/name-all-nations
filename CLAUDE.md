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
- `js/countries.js` — the 195 (193 UN + Vatican + Palestine), aliases, regions
- `map/` — the simplified amCharts world map, plus the 1.4MB full-detail
  version fetched lazily for deep zoom
- `sw.js` — offline play. **Network-first for app code on purpose**, so a
  push to Pages is never masked by a stale cache; only `map/*` is cache-first

## Notes

- The map view rect follows the *window's* aspect, not the map's — pinning
  it to the map's shape letterboxed portrait phones down to a 250px band.
- Mic input has never been tested outside a sandbox.
