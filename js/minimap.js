/*
 * The minimap's picture — the world in a corner, under the six jump zones.
 * Shared by the flat map and the globe, which lay the same zones over it.
 *
 * Two paths, not two hundred and fifty: every country's outline run
 * together into one `d`, every territory's into another. It is drawn once
 * and never restyled, so it costs nothing while the map is moving.
 */
function drawMiniMap(paths, isCountry, box) {
  const svg = document.getElementById('mini-map');
  if (!svg) return;
  let land = '', terr = '';
  for (const id of Object.keys(paths)) {
    if (id === 'AQ') continue;          // not on the map either, and it wrecks the frame
    if (isCountry(id)) land += paths[id]; else terr += paths[id];
  }
  if (box) svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  svg.querySelector('#mini-land').setAttribute('d', land);
  svg.querySelector('#mini-terr').setAttribute('d', terr);
}
