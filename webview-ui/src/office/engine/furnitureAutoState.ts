/**
 * Furniture auto-state and animation: an active agent facing a desk turns
 * its electronics on, and furniture with more than one animation frame (an
 * always-running espresso machine, a monitor someone is using) cycles
 * through them on a timer.
 */

import {
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  FURNITURE_ANIM_INTERVAL_SEC,
} from '../../constants.js';
import { getAnimationFrames, getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog.js';
import { layoutToFurnitureInstances } from '../layout/layoutSerializer.js';
import type { Character, FurnitureInstance, PlacedFurniture, Seat } from '../types.js';
import { Direction } from '../types.js';

/** Rebuild furniture instances with auto-state applied (active agents turn electronics ON)
 *  and animation frames cycled from `furnitureAnimTimer`. */
export function rebuildFurnitureInstances(
  layoutFurniture: PlacedFurniture[],
  characters: Iterable<Character>,
  seats: ReadonlyMap<string, Seat>,
  furnitureAnimTimer: number,
): FurnitureInstance[] {
  const autoOnTiles = new Set<string>();
  for (const ch of characters) {
    if (!ch.isActive || !ch.seatId) continue;
    const seat = seats.get(ch.seatId);
    if (!seat) continue;
    const dCol =
      seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
    const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;
    for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
      const tileCol = seat.seatCol + dCol * d;
      const tileRow = seat.seatRow + dRow * d;
      autoOnTiles.add(`${tileCol},${tileRow}`);
    }
    for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
      const baseCol = seat.seatCol + dCol * d;
      const baseRow = seat.seatRow + dRow * d;
      if (dCol !== 0) {
        autoOnTiles.add(`${baseCol},${baseRow - 1}`);
        autoOnTiles.add(`${baseCol},${baseRow + 1}`);
      } else {
        autoOnTiles.add(`${baseCol - 1},${baseRow}`);
        autoOnTiles.add(`${baseCol + 1},${baseRow}`);
      }
    }
  }

  // Items placed directly in an animated on state (an espresso machine that is
  // always running) animate regardless of who is nearby.
  const animFrame = Math.floor(furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
  const animate = (type: string): string => {
    const frames = getAnimationFrames(type);
    return frames && frames.length > 1 ? frames[animFrame % frames.length] : type;
  };
  const modifiedFurniture: PlacedFurniture[] = layoutFurniture.map((item) => {
    const entry = getCatalogEntry(item.type);
    if (!entry) return item;
    const placedAnimated = animate(item.type);
    if (placedAnimated !== item.type) return { ...item, type: placedAnimated };
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
          const onType = getOnStateType(item.type);
          return onType === item.type ? item : { ...item, type: animate(onType) };
        }
      }
    }
    return item;
  });

  return layoutToFurnitureInstances(modifiedFurniture);
}
