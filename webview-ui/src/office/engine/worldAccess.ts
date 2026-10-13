/**
 * The office fields the engine modules read and mutate: the layout, the seat
 * graph, the pathing grid and the live character roster. `OfficeState`
 * satisfies it structurally and passes itself, so every read is live.
 */

import type { Character, OfficeLayout, Seat, TileType as TileTypeVal } from '../types.js';

export interface WorldAccess {
  layout: OfficeLayout;
  seats: Map<string, Seat>;
  tileMap: TileTypeVal[][];
  blockedTiles: Set<string>;
  restSeatUids: ReadonlySet<string>;
  restSeatClaims: Map<string, number>;
  characters: Map<number, Character>;
  walkableTiles: Array<{ col: number; row: number }>;
  areaMappings: Record<string, string[]>;
}
