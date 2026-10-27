import type { Point } from './iso.js';
import { tileCorner } from './iso.js';
import type { TileType as TileTypeVal } from './types.js';
import { TileType } from './types.js';

/** One exposed edge of the floor slab: `left` is the +row face, `right` the +col face. */
export interface SlabFace {
  readonly side: 'left' | 'right';
  /** Quad corners in iso local px, clockwise from the floor edge's left end. */
  readonly corners: readonly [Point, Point, Point, Point];
}

/** The slab faces where the office floor ends (a void or off-grid tile beside a floor), so the room reads as a block. */
export function floorSlabFaces(tileMap: readonly TileTypeVal[][], slabPx: number): SlabFace[] {
  const rows = tileMap.length;
  const cols = rows > 0 ? tileMap[0].length : 0;
  const isOpen = (c: number, r: number) =>
    r < 0 || c < 0 || r >= rows || c >= cols || tileMap[r][c] === TileType.VOID;
  const drop = (p: Point): Point => ({ x: p.x, y: p.y + slabPx });
  const faces: SlabFace[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (tileMap[r][c] === TileType.VOID) continue;
      const left = tileCorner(c, r + 1);
      const bottom = tileCorner(c + 1, r + 1);
      const right = tileCorner(c + 1, r);
      if (isOpen(c, r + 1)) {
        faces.push({ side: 'left', corners: [left, bottom, drop(bottom), drop(left)] });
      }
      if (isOpen(c + 1, r)) {
        faces.push({ side: 'right', corners: [bottom, right, drop(right), drop(bottom)] });
      }
    }
  }
  return faces;
}
