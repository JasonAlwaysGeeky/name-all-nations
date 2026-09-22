/*
 * Where every jump key lands. One rule, every device:
 *
 *   the box is the area that MUST be on screen — the camera takes the
 *   tightest zoom that still holds the whole box inside the safe area
 *   (the window minus the HUD, the jump keys, the word bank…), centred.
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
 * The keys named after a BUTTON_ZONE are that zone's dive. The zone
 * unfolds wherever its box lands; below the zone's minScale (a very
 * narrow phone) a pair of its buttons may merge, and the guides mark
 * the row ⚠ when that is so.
 */
const VIEW_BOXES = {
  'North America':          [123, 243, 315, 452],
  'Central America':        [215, 406, 262, 446],
  'Europe':                 [408, 207, 590, 360],
  'European microstates':   [476, 296, 543, 360],
  'Asia':                   [552, 270, 795, 464],
  'Middle East':            [560, 345, 637, 403],
  'South America':          [247, 405, 380, 645],
  'Caribbean':              [287, 406, 312, 440],
  'Africa':                 [401, 344, 645, 572],
  'West African coast':     [401, 410, 515, 478],
  'India → New Zealand':    [727, 321, 1017, 618],
  'Pacific islands':        [840, 424, 1014, 531],
};
