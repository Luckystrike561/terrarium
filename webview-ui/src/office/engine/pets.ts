/**
 * Pet roster orchestration: reconciling the runtime pet list against a
 * layout's placed-pet roster, relocation after a layout change, hit-testing,
 * and the heart bubble. The per-frame FSM itself lives in petEntity.
 */

import {
  DISMISS_BUBBLE_FAST_FADE_SEC,
  MAX_PET_ID_LENGTH,
  PET_HIT_HALF_WIDTH,
  PET_HIT_HEIGHT,
  WAITING_BUBBLE_DURATION_SEC,
} from '../../constants.js';
import { worldToIso } from '../iso.js';
import { isWalkable } from '../layout/tileMap.js';
import { getPetCount, getPetName } from '../sprites/petSpriteData.js';
import type { OfficeLayout, Pet, PlacedPet, TileType as TileTypeVal } from '../types.js';
import { PetState, TILE_SIZE } from '../types.js';
import { createPet } from './petEntity.js';

/**
 * Spawn a placed pet at a uniformly-random walkable tile. Bounds-checks
 * petType against the loaded sprite count to defend against stale layouts.
 * Mutates `pets` in place; no-op when the pet already exists or there is no
 * walkable tile to spawn on.
 */
function spawnPet(
  placedPet: PlacedPet,
  pets: Pet[],
  walkableTiles: Array<{ col: number; row: number }>,
): void {
  if (
    typeof placedPet.id !== 'string' ||
    placedPet.id.length === 0 ||
    placedPet.id.length > MAX_PET_ID_LENGTH
  ) {
    return;
  }
  if (
    !Number.isInteger(placedPet.petType) ||
    placedPet.petType < 0 ||
    placedPet.petType >= getPetCount()
  ) {
    return;
  }
  if (pets.some((p) => p.id === placedPet.id)) return;
  if (walkableTiles.length === 0) return;

  const spawn = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
  const pet = createPet(placedPet.id, placedPet.petType, spawn.col, spawn.row);
  pet.name = getPetName(placedPet.petType);
  pets.push(pet);
}

/**
 * Reconcile `pets` to match the layout's placed-pet roster.
 * - Pets in layout but not in runtime → spawn via spawnPet().
 * - Pets in runtime but not in layout → remove.
 * - Pets in both → keep existing runtime state (position, FSM).
 *
 * Called from the constructor and rebuildFromLayout. Always runs AFTER
 * walkableTiles is populated. Returns the reconciled pet list.
 */
export function rebuildPetsFromLayout(
  layout: OfficeLayout,
  pets: Pet[],
  walkableTiles: Array<{ col: number; row: number }>,
): Pet[] {
  const placed = layout.pets ?? [];
  const placedIds = new Set(placed.map((p) => p.id));

  const kept = pets.filter((p) => placedIds.has(p.id));

  const existingIds = new Set(kept.map((p) => p.id));
  for (const p of placed) {
    if (existingIds.has(p.id)) continue;
    spawnPet(p, kept, walkableTiles);
  }
  return kept;
}

/**
 * Hit-test pets at an iso screen point (unscaled sprite px). Front-most
 * (largest x + y) first so the visually-frontmost pet receives the click.
 * Returns the pet id or null.
 */
export function getPetAt(pets: Pet[], isoX: number, isoY: number): string | null {
  const ordered = pets.slice().sort((a, b) => b.x + b.y - (a.x + a.y));
  for (const pet of ordered) {
    const anchor = worldToIso(pet.x, pet.y);
    if (
      Math.abs(isoX - anchor.x) <= PET_HIT_HALF_WIDTH &&
      isoY >= anchor.y - PET_HIT_HEIGHT &&
      isoY <= anchor.y
    ) {
      return pet.id;
    }
  }
  return null;
}

/** Show the heart bubble on a pet for WAITING_BUBBLE_DURATION_SEC. */
export function showPetBubble(pets: Pet[], petId: string): void {
  const pet = pets.find((p) => p.id === petId);
  if (!pet) return;
  pet.bubbleType = 'heart';
  pet.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
}

/** Dismiss the heart bubble on click; collapses timer to a fast fade. */
export function dismissPetBubble(pets: Pet[], petId: string): void {
  const pet = pets.find((p) => p.id === petId);
  if (!pet || !pet.bubbleType) return;
  pet.bubbleTimer = Math.min(pet.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
}

/** Relocate pets an edited layout left outside its bounds or off a walkable tile, to a
 *  fresh random walkable tile. No-op (per pet) when there is nowhere to put them. */
export function relocateOutOfBoundsPets(
  pets: Pet[],
  layout: OfficeLayout,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  walkableTiles: Array<{ col: number; row: number }>,
): void {
  for (const pet of pets) {
    const inBounds =
      pet.tileCol >= 0 &&
      pet.tileCol < layout.cols &&
      pet.tileRow >= 0 &&
      pet.tileRow < layout.rows &&
      isWalkable(pet.tileCol, pet.tileRow, tileMap, blockedTiles);
    if (inBounds || walkableTiles.length === 0) continue;
    const spawn = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
    pet.tileCol = spawn.col;
    pet.tileRow = spawn.row;
    pet.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    pet.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    pet.path = [];
    pet.moveProgress = 0;
    pet.state = PetState.IDLE;
    pet.frame = 0;
    pet.frameTimer = 0;
    pet.followTargetId = null;
  }
}
