import type { Container } from 'pixi.js';
import { Graphics, Sprite } from 'pixi.js';

import { FLOOR_SLAB_LEFT_COLOR, FLOOR_SLAB_RIGHT_COLOR } from '../../constants.js';
import { floorSlabFaces } from '../floorSlab.js';
import { getColorizedFloorSprite } from '../floorTiles.js';
import { carpetPieceOrigin, projectToDiamond, tileSpriteOrigin } from '../iso.js';
import { carpetJunctionSprites, hasCarpetSprites } from '../sprites/carpetTiles.js';
import { getTexture } from '../sprites/textureCache.js';
import { TileType } from '../types.js';
import { hexToNumber } from './pixiColor.js';
import type { FloorRenderState } from './sceneRenderer.js';

/** Floor tiles and the slab edges where the office floor ends, rebuilt only when the layout or slab height changes. */
export function rebuildFloor(container: Container, state: FloorRenderState): void {
  container.removeChildren();
  const tileMap = state.tileMap;
  const rows = tileMap.length;
  const cols = rows > 0 ? tileMap[0].length : 0;
  const layoutCols = state.layoutCols ?? cols;

  const slab = new Graphics();
  slab.roundPixels = true;
  const leftSlab = hexToNumber(FLOOR_SLAB_LEFT_COLOR);
  const rightSlab = hexToNumber(FLOOR_SLAB_RIGHT_COLOR);
  for (const face of floorSlabFaces(tileMap, state.slabPx)) {
    slab
      .poly(face.corners.flatMap((p) => [p.x, p.y]))
      .fill(face.side === 'left' ? leftSlab : rightSlab);
  }
  container.addChild(slab);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = tileMap[r][c];
      // Walls are boxes drawn with the entities.
      if (tile === TileType.VOID || tile === TileType.WALL) continue;
      const color = state.tileColors?.[r * layoutCols + c] ?? { h: 0, s: 0, b: 0, c: 0 };
      const sprite = new Sprite(getTexture(projectToDiamond(getColorizedFloorSprite(tile, color))));
      sprite.roundPixels = true;
      const origin = tileSpriteOrigin(c, r);
      sprite.position.set(origin.x, origin.y);
      container.addChild(sprite);
    }
  }
}

export function rebuildCarpet(
  container: Container,
  state: FloorRenderState,
  cols: number,
  rows: number,
): void {
  container.removeChildren();
  if (!hasCarpetSprites()) return;
  const carpetTiles = state.carpetTiles;
  if (!carpetTiles || carpetTiles.length === 0) return;

  for (const { jx, jy, sprite: spriteData } of carpetJunctionSprites(carpetTiles, cols, rows)) {
    const sprite = new Sprite(getTexture(projectToDiamond(spriteData)));
    sprite.roundPixels = true;
    const origin = carpetPieceOrigin(jx, jy);
    sprite.position.set(origin.x, origin.y);
    container.addChild(sprite);
  }
}
