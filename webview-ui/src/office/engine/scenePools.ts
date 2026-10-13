import type { Container } from 'pixi.js';
import { Graphics, Sprite } from 'pixi.js';

import type { Point } from '../iso.js';
import { tileCorner } from '../iso.js';

export function getOrCreateSprite<K>(pool: Map<K, Sprite>, key: K, container: Container): Sprite {
  let sprite = pool.get(key);
  if (!sprite) {
    sprite = new Sprite();
    sprite.roundPixels = true;
    container.addChild(sprite);
    pool.set(key, sprite);
  }
  return sprite;
}

export function getOrCreateGraphics<K>(
  pool: Map<K, Graphics>,
  key: K,
  container: Container,
): Graphics {
  let gfx = pool.get(key);
  if (!gfx) {
    gfx = new Graphics();
    gfx.roundPixels = true;
    container.addChild(gfx);
    pool.set(key, gfx);
  }
  return gfx;
}

export function pruneStale<K, V extends Container>(
  pool: Map<K, V>,
  container: Container,
  liveKeys: Set<K>,
): void {
  for (const [key, child] of pool) {
    if (liveKeys.has(key)) continue;
    container.removeChild(child);
    pool.delete(key);
  }
}

/** Iso corners of a tile rectangle, clockwise from the top vertex. */
export function footprintDiamond(col: number, row: number, w = 1, h = 1): Point[] {
  return [
    tileCorner(col, row),
    tileCorner(col + w, row),
    tileCorner(col + w, row + h),
    tileCorner(col, row + h),
  ];
}

export function polyCoords(points: readonly Point[]): number[] {
  return points.flatMap((p) => [p.x, p.y]);
}
