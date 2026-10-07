/**
 * SpriteData → PIXI.Texture, for the Pixi world renderer.
 *
 * Unlike the old canvas-based cache (sprites/spriteCache.ts, still used by the
 * 2D widget previews), a sprite needs exactly one texture regardless of zoom:
 * it's built at 1 texture-pixel-per-sprite-pixel with nearest-neighbor
 * sampling (set globally in sceneRenderer.ts via TextureStyle.defaultOptions),
 * and Pixi scales it crisply by setting `sprite.scale`. That drops the old
 * per-zoom WeakMap entirely.
 *
 * A plain Map (not WeakMap) so `destroyAllTextures` can walk every entry and
 * free its GPU-side resource on asset reload. JS GC alone only reclaims the
 * JS-side Texture wrapper, not the uploaded texture.
 */

import { Texture } from 'pixi.js';

import type { SpriteData } from '../types.js';

const textureCache = new Map<SpriteData, Texture>();
const outlineSpriteCache = new WeakMap<SpriteData, SpriteData>();

function spriteToCanvas(sprite: SpriteData): HTMLCanvasElement {
  const rows = sprite.length;
  const cols = sprite[0].length;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = sprite[r][c];
      if (color === '') continue;
      ctx.fillStyle = color;
      ctx.fillRect(c, r, 1, 1);
    }
  }
  return canvas;
}

export function getTexture(sprite: SpriteData): Texture {
  const cached = textureCache.get(sprite);
  if (cached) return cached;
  const texture = Texture.from(spriteToCanvas(sprite));
  textureCache.set(sprite, texture);
  return texture;
}

/** Destroy every cached GPU texture and clear the cache. Call after any asset
 *  reload (`set*Sprites` / `setCharacterTemplates` / `setPetTemplates`),
 *  since those replace the underlying SpriteData arrays wholesale. */
export function destroyAllTextures(): void {
  for (const texture of textureCache.values()) {
    texture.destroy(true);
  }
  textureCache.clear();
}

/** Generate a 1px white outline SpriteData (2px larger in each dimension),
 *  mirroring sprites/spriteCache.ts's version for the 2D preview path. */
export function getOutlineSprite(sprite: SpriteData): SpriteData {
  const cached = outlineSpriteCache.get(sprite);
  if (cached) return cached;

  const rows = sprite.length;
  const cols = sprite[0].length;
  const outline: string[][] = [];
  for (let r = 0; r < rows + 2; r++) {
    outline.push(new Array<string>(cols + 2).fill(''));
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] === '') continue;
      const er = r + 1;
      const ec = c + 1;
      if (outline[er - 1][ec] === '') outline[er - 1][ec] = '#FFFFFF';
      if (outline[er + 1][ec] === '') outline[er + 1][ec] = '#FFFFFF';
      if (outline[er][ec - 1] === '') outline[er][ec - 1] = '#FFFFFF';
      if (outline[er][ec + 1] === '') outline[er][ec + 1] = '#FFFFFF';
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] !== '') {
        outline[r + 1][c + 1] = '';
      }
    }
  }

  outlineSpriteCache.set(sprite, outline);
  return outline;
}
