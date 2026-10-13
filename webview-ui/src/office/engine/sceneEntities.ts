import type { Container, Graphics, Sprite } from 'pixi.js';

import {
  CHARACTER_SITTING_OFFSET_PX,
  HOVERED_OUTLINE_ALPHA,
  SELECTED_OUTLINE_ALPHA,
} from '../../constants.js';
import { WALL_COLOR } from '../floorTiles.js';
import { ISO_TILE_W, tileCorner, worldToIso } from '../iso.js';
import { getWallSprite } from '../isoWalls.js';
import { getPetSprites } from '../sprites/petSpriteData.js';
import { getCharacterSprites, getCtoSprites } from '../sprites/spriteData.js';
import { getOutlineSprite, getTexture } from '../sprites/textureCache.js';
import { CharacterState, TileType } from '../types.js';
import { wallColorToHex } from '../wallTiles.js';
import { getCharacterSprite } from './characters.js';
import type { SortBox } from './isoSort.js';
import { isoDrawOrder, SortLayer } from './isoSort.js';
import { drawMatrixEffect } from './matrixEffect.js';
import { getPetSpriteData } from './petEntity.js';
import { actorBox, getOrCreateGraphics, getOrCreateSprite, pruneStale } from './scenePools.js';
import type { FloorRenderState } from './sceneRenderer.js';

export interface EntityPools {
  furniture: Map<string, Sprite>;
  wall: Map<string, Sprite>;
  character: Map<number, Sprite>;
  outline: Map<number, Sprite>;
  matrix: Map<number, Graphics>;
  pet: Map<string, Sprite>;
}

export function createEntityPools(): EntityPools {
  return {
    furniture: new Map(),
    wall: new Map(),
    character: new Map(),
    outline: new Map(),
    matrix: new Map(),
    pet: new Map(),
  };
}

/** Walls, furniture, characters and pets: retained sprite pools diffed every frame, then ordered with isoDrawOrder. */
export function updateEntities(
  pools: EntityPools,
  container: Container,
  state: FloorRenderState,
): void {
  const liveFurniture = new Set<string>();
  const liveWalls = new Set<string>();
  const liveBodies = new Set<number>();
  const liveOutlines = new Set<number>();
  const liveMatrix = new Set<number>();
  const livePets = new Set<string>();
  const drawables: Array<{ box: SortBox; nodes: Container[] }> = [];

  const tileMap = state.tileMap;
  const layoutCols = state.layoutCols ?? tileMap[0]?.length ?? 0;
  for (let r = 0; r < tileMap.length; r++) {
    for (let c = 0; c < tileMap[r].length; c++) {
      if (tileMap[r][c] !== TileType.WALL) continue;
      const key = `${r}:${c}`;
      liveWalls.add(key);
      const color = state.tileColors?.[r * layoutCols + c];
      const { sprite: wallSprite, height } = getWallSprite(
        tileMap,
        c,
        r,
        color ? wallColorToHex(color) : WALL_COLOR,
      );
      const sprite = getOrCreateSprite(pools.wall, key, container);
      sprite.texture = getTexture(wallSprite);
      const top = tileCorner(c, r);
      sprite.position.set(top.x - ISO_TILE_W / 2, top.y - height);
      sprite.scale.set(1, 1);
      sprite.visible = true;
      drawables.push({
        box: { minCol: c, minRow: r, maxCol: c + 1, maxRow: r + 1, layer: SortLayer.FLOOR },
        nodes: [sprite],
      });
    }
  }

  for (const f of state.furniture) {
    liveFurniture.add(f.uid);
    const sprite = getOrCreateSprite(pools.furniture, f.uid, container);
    const texture = getTexture(f.sprite);
    sprite.texture = texture;
    sprite.visible = true;
    if (f.mirrored) {
      sprite.scale.set(-1, 1);
      sprite.position.set(f.x + texture.width, f.y);
    } else {
      sprite.scale.set(1, 1);
      sprite.position.set(f.x, f.y);
    }
    drawables.push({ box: f.sort, nodes: [sprite] });
  }

  for (const ch of state.characters) {
    const sprites = ch.isCto ? getCtoSprites() : getCharacterSprites(ch.palette, ch.hueShift);
    const spriteData = getCharacterSprite(ch, sprites);
    const texture = getTexture(spriteData);
    const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const anchor = worldToIso(ch.x, ch.y);
    const localX = Math.round(anchor.x - texture.width / 2);
    const localY = Math.round(anchor.y + sittingOffset - texture.height);
    const box = actorBox(ch.x, ch.y);

    if (ch.matrixEffect) {
      liveMatrix.add(ch.id);
      const gfx = getOrCreateGraphics(pools.matrix, ch.id, container);
      gfx.clear();
      gfx.alpha = 1;
      gfx.visible = true;
      drawMatrixEffect(gfx, ch, spriteData, localX, localY, 1);
      drawables.push({ box, nodes: [gfx] });
      continue;
    }

    liveBodies.add(ch.id);
    const body = getOrCreateSprite(pools.character, ch.id, container);
    body.texture = texture;
    body.position.set(localX, localY);
    body.scale.set(1, 1);
    body.alpha = 1;
    body.visible = true;
    const nodes: Container[] = [body];

    const isSelected = state.selection?.selectedAgentId === ch.id;
    const isHovered = state.selection?.hoveredAgentId === ch.id;
    if (isSelected || isHovered) {
      liveOutlines.add(ch.id);
      const outlineData = getOutlineSprite(spriteData);
      const outline = getOrCreateSprite(pools.outline, ch.id, container);
      outline.texture = getTexture(outlineData);
      outline.position.set(localX - 1, localY - 1);
      outline.scale.set(1, 1);
      outline.alpha = isSelected ? SELECTED_OUTLINE_ALPHA : HOVERED_OUTLINE_ALPHA;
      outline.visible = true;
      nodes.unshift(outline);
    }
    drawables.push({ box, nodes });
  }

  for (const pet of state.pets ?? []) {
    const petSprites = getPetSprites(pet.petType);
    const spriteData = getPetSpriteData(pet, petSprites);
    if (!spriteData) continue;
    const texture = getTexture(spriteData);
    livePets.add(pet.id);
    const anchor = worldToIso(pet.x, pet.y);
    const sprite = getOrCreateSprite(pools.pet, pet.id, container);
    sprite.texture = texture;
    sprite.position.set(
      Math.round(anchor.x - texture.width / 2),
      Math.round(anchor.y - texture.height),
    );
    sprite.scale.set(1, 1);
    sprite.visible = true;
    drawables.push({ box: actorBox(pet.x, pet.y), nodes: [sprite] });
  }

  let z = 0;
  for (const i of isoDrawOrder(drawables.map((d) => d.box))) {
    for (const node of drawables[i].nodes) node.zIndex = z++;
  }

  pruneStale(pools.furniture, container, liveFurniture);
  pruneStale(pools.wall, container, liveWalls);
  pruneStale(pools.character, container, liveBodies);
  pruneStale(pools.outline, container, liveOutlines);
  pruneStale(pools.matrix, container, liveMatrix);
  pruneStale(pools.pet, container, livePets);
}
