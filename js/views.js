/*
 * Where every jump key lands. One rule, every device:
 *
 *   the box is the area that MUST be on screen — the camera takes the
 *   tightest zoom that still holds the whole box inside the safe area
 *   (the window minus the HUD, the jump pad, the word bank…), centred.
 *
 * So a box never gets cropped by a narrow phone or a squat laptop; the
 * window's shape only decides where the slack goes (above and below on a
 * portrait phone, left and right on a wide monitor). A smaller box is a
 * closer view everywhere — leave out what a view can live without
 * (Alaska, Iceland, Svalbard) and the phone stops paying for it.
 *
 * Boxes are [x1, y1, x2, y2] in map units. Set them by eye: open the game
 * with ?guides on the end of the address, drag the boxes, tap the jump
 * keys to see where they land, then Copy and paste the result over this
 * table. Nothing in here is derived from country shapes.
 *
 * The keys named after a BUTTON_ZONE are that zone's dive. Those never
 * zoom out past the layer where the zone's buttons unfold, so on a very
 * narrow screen a wide one (the Middle East) can still overflow — the
 * guides flag it in red when it does.
 */
const VIEW_BOXES = {
  'North America':          [165, 290, 322, 452],
  'Central America':        [215, 406, 262, 446],
  'Europe':                 [408, 200, 590, 360],
  'European microstates':   [476, 296, 521, 360],
  'Asia':                   [552, 270, 876, 490],
  'Middle East':            [563, 352, 637, 402],
  'South America':          [247, 405, 380, 645],
  'Caribbean':              [254, 406, 312, 440],
  'Africa':                 [398, 344, 643, 572],
  'West African coast':     [401, 410, 510, 467],
  'India → New Zealand':    [662, 368, 1042, 618],
  'Pacific islands':        [840, 424, 1014, 531],
};
