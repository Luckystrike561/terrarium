/**
 * Isometric conventions shared by every generated sprite and by the webview
 * renderer (`webview-ui/src/office/iso.ts` mirrors these numbers).
 *
 * World units: one grid tile = 16 units along +col (gx) and +row (gy); z is
 * height in screen pixels. A tile renders as a 32×16 diamond, so
 *   screenX = gx - gy,   screenY = (gx + gy) / 2 - z.
 *
 * Light comes from the viewer's upper left: TOP faces are brightest, faces
 * whose normal points along +row ("left" faces, on the lower left of a box)
 * are mid, faces whose normal points along +col ("right" faces) are darkest.
 *
 * Sprite anchor contract (furniture): an item with footprint fw (cols) × fh
 * (rows) is an image (fw + fh) * 16 wide. Its footprint diamond touches the
 * image's left, right and bottom edges: bottom vertex at (fw*16, H), left
 * vertex at (0, H - fw*8), right vertex at (W, H - fh*8). Everything above the
 * diamond is the item's height. `heightAbove` is the room left for that.
 */

export const TILE = 16;
export const WALL_HEIGHT = 40;
export const DESK_SURFACE_Z = 12;
export const CHAIR_SEAT_Z = 6;

export function footprintImageSize(
  fw: number,
  fh: number,
  heightAbove: number,
): { width: number; height: number } {
  return { width: (fw + fh) * TILE, height: (fw + fh) * (TILE / 2) + heightAbove };
}
