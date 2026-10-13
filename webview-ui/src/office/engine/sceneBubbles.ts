import type { Container, Sprite } from 'pixi.js';

import {
  BUBBLE_FADE_DURATION_SEC,
  BUBBLE_SITTING_OFFSET_PX,
  BUBBLE_VERTICAL_OFFSET_PX,
  STATUS_BADGE_HORIZONTAL_OFFSET_PX,
  STATUS_BADGE_VERTICAL_OFFSET_PX,
} from '../../constants.js';
import { worldToIso } from '../iso.js';
import {
  BUBBLE_HEART_SPRITE,
  BUBBLE_PERMISSION_SPRITE,
  BUBBLE_WAITING_SPRITE,
  STATUS_DONE_SPRITE,
  STATUS_IDLE_SPRITE,
  STATUS_PERMISSION_SPRITE,
  STATUS_WAITING_INPUT_SPRITE,
  STATUS_WORKING_SPRITE,
} from '../sprites/spriteData.js';
import { getTexture } from '../sprites/textureCache.js';
import type { Character, SpriteData } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';
import { getOrCreateSprite, pruneStale } from './scenePools.js';
import type { FloorRenderState } from './sceneRenderer.js';

export interface BubblePools {
  bubble: Map<number, Sprite>;
  badge: Map<number, Sprite>;
  petBubble: Map<string, Sprite>;
}

export function createBubblePools(): BubblePools {
  return { bubble: new Map(), badge: new Map(), petBubble: new Map() };
}

function statusBadgeSprite(ch: Character): SpriteData {
  if (ch.bubbleType === 'permission') return STATUS_PERMISSION_SPRITE;
  if (ch.isActive) return STATUS_WORKING_SPRITE;
  if (ch.bubbleType === 'waiting') {
    return ch.waitingAwaitingInput ? STATUS_WAITING_INPUT_SPRITE : STATUS_DONE_SPRITE;
  }
  return STATUS_IDLE_SPRITE;
}

export function updateBubblesAndBadges(
  pools: BubblePools,
  bubbleContainer: Container,
  badgeContainer: Container,
  petBubbleContainer: Container,
  state: FloorRenderState,
): void {
  const liveBubbles = new Set<number>();
  const liveBadges = new Set<number>();
  const livePetBubbles = new Set<string>();

  for (const ch of state.characters) {
    if (ch.bubbleType && !(ch.bubbleType === 'waiting' && ch.waitingAwaitingInput)) {
      liveBubbles.add(ch.id);
      const spriteData =
        ch.bubbleType === 'permission' ? BUBBLE_PERMISSION_SPRITE : BUBBLE_WAITING_SPRITE;
      let alpha = 1.0;
      if (ch.bubbleType === 'waiting' && ch.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
        alpha = ch.bubbleTimer / BUBBLE_FADE_DURATION_SEC;
      }
      const texture = getTexture(spriteData);
      const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
      const anchor = worldToIso(ch.x, ch.y);
      const sprite = getOrCreateSprite(pools.bubble, ch.id, bubbleContainer);
      sprite.texture = texture;
      sprite.position.set(
        Math.round(anchor.x - texture.width / 2),
        Math.round(anchor.y + sittingOff - BUBBLE_VERTICAL_OFFSET_PX - texture.height - 1),
      );
      sprite.alpha = alpha;
      sprite.visible = true;
    }

    if (!ch.isSubagent && !ch.isGreeter && !ch.isCto) {
      liveBadges.add(ch.id);
      const texture = getTexture(statusBadgeSprite(ch));
      const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
      const anchor = worldToIso(ch.x, ch.y);
      const sprite = getOrCreateSprite(pools.badge, ch.id, badgeContainer);
      sprite.texture = texture;
      sprite.position.set(
        Math.round(anchor.x + STATUS_BADGE_HORIZONTAL_OFFSET_PX - texture.width / 2),
        Math.round(anchor.y + sittingOff - STATUS_BADGE_VERTICAL_OFFSET_PX - texture.height / 2),
      );
      sprite.visible = true;
    }
  }

  for (const pet of state.pets ?? []) {
    if (!pet.bubbleType) continue;
    livePetBubbles.add(pet.id);
    let alpha = 1.0;
    if (pet.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
      alpha = Math.max(0, pet.bubbleTimer / BUBBLE_FADE_DURATION_SEC);
    }
    const texture = getTexture(BUBBLE_HEART_SPRITE);
    const sprite = getOrCreateSprite(pools.petBubble, pet.id, petBubbleContainer);
    sprite.texture = texture;
    const anchor = worldToIso(pet.x, pet.y);
    sprite.position.set(
      Math.round(anchor.x - texture.width / 2),
      Math.round(anchor.y - TILE_SIZE - texture.height - 1),
    );
    sprite.alpha = alpha;
    sprite.visible = true;
  }

  pruneStale(pools.bubble, bubbleContainer, liveBubbles);
  pruneStale(pools.badge, badgeContainer, liveBadges);
  pruneStale(pools.petBubble, petBubbleContainer, livePetBubbles);
}
