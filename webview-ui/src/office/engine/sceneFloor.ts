import type { Container } from 'pixi.js';
import { Graphics, Sprite } from 'pixi.js';

import type { ColorValue } from '../../components/ui/types.js';
import {
  CARPET_DEFAULT_ACCENT_COLOR,
  CARPET_DEFAULT_COLOR,
  FLOOR_SLAB_LEFT_COLOR,
  FLOOR_SLAB_RIGHT_COLOR,
} from '../../constants.js';
import { getColorizedFloorSprite } from '../floorTiles.js';
import { ISO_TILE_H, ISO_TILE_W, projectToDiamond, tileCorner } from '../iso.js';
import {
  getCarpetJunctionSprite,
  getCarpetPaletteKey,
  hasCarpetSprites,
} from '../sprites/carpetTiles.js';
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
  const isOpen = (c: number, r: number) =>
    r < 0 || c < 0 || r >= rows || c >= cols || tileMap[r][c] === TileType.VOID;

  // Slab edges where the office floor ends, so the room reads as a block.
  const slab = new Graphics();
  slab.roundPixels = true;
  const leftSlab = hexToNumber(FLOOR_SLAB_LEFT_COLOR);
  const rightSlab = hexToNumber(FLOOR_SLAB_RIGHT_COLOR);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (tileMap[r][c] === TileType.VOID) continue;
      const left = tileCorner(c, r + 1);
      const bottom = tileCorner(c + 1, r + 1);
      const right = tileCorner(c + 1, r);
      if (isOpen(c, r + 1)) {
        slab
          .poly([
            left.x,
            left.y,
            bottom.x,
            bottom.y,
            bottom.x,
            bottom.y + state.slabPx,
            left.x,
            left.y + state.slabPx,
          ])
          .fill(leftSlab);
      }
      if (isOpen(c + 1, r)) {
        slab
          .poly([
            bottom.x,
            bottom.y,
            right.x,
            right.y,
            right.x,
            right.y + state.slabPx,
            bottom.x,
            bottom.y + state.slabPx,
          ])
          .fill(rightSlab);
      }
    }
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
      const top = tileCorner(c, r);
      sprite.position.set(top.x - ISO_TILE_W / 2, top.y);
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

  for (let jy = 0; jy <= rows; jy++) {
    for (let jx = 0; jx <= cols; jx++) {
      const localGroups = new Map<
        string,
        {
          variant: number;
          color: ColorValue;
          accentColor: ColorValue;
          paletteKey: string;
          order: number;
        }
      >();

      const adjacent = [
        { col: jx - 1, row: jy - 1 },
        { col: jx, row: jy - 1 },
        { col: jx, row: jy },
        { col: jx - 1, row: jy },
      ];

      for (const pos of adjacent) {
        if (pos.col < 0 || pos.row < 0 || pos.col >= cols || pos.row >= rows) continue;
        const tile = carpetTiles[pos.row * cols + pos.col];
        if (!tile) continue;
        const color = tile.color ?? CARPET_DEFAULT_COLOR;
        const accentColor = tile.accentColor ?? CARPET_DEFAULT_ACCENT_COLOR;
        const paletteKey = getCarpetPaletteKey(color, accentColor);
        const key = `${tile.variant}:${paletteKey}`;
        const order = tile.order ?? 0;
        const existing = localGroups.get(key);
        if (!existing || order > existing.order) {
          localGroups.set(key, { variant: tile.variant, color, accentColor, paletteKey, order });
        }
      }

      if (localGroups.size === 0) continue;

      const ordered = [...localGroups.values()].sort((a, b) => a.order - b.order);
      for (const { variant, color, accentColor, paletteKey } of ordered) {
        const spriteData = getCarpetJunctionSprite(
          jx,
          jy,
          variant,
          carpetTiles,
          cols,
          rows,
          color,
          accentColor,
          paletteKey,
        );
        if (!spriteData) continue;
        const sprite = new Sprite(getTexture(projectToDiamond(spriteData)));
        sprite.roundPixels = true;
        const center = tileCorner(jx, jy);
        sprite.position.set(center.x - ISO_TILE_W / 2, center.y - ISO_TILE_H / 2);
        container.addChild(sprite);
      }
    }
  }
}
