import { ART_SCALE, CHAR_FRAME_H, CHAR_FRAME_W } from '../../../../core/src/assets/constants.ts';
import type { ColorValue } from '../../components/ui/types.js';
import { SEAT_SIT_POINTS_ART_PX, SEATED_HIP_ART_PX } from '../../constants.js';
import { getColorizedSprite } from '../colorize.js';
import { SortLayer } from '../engine/isoSort.js';
import type { Point } from '../iso.js';
import { footprintSpriteOrigin, ISO_TILE_W, worldToIso } from '../iso.js';
import type {
  FurnitureInstance,
  OfficeLayout,
  PlacedFurniture,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import { DEFAULT_COLS, DEFAULT_ROWS, Direction, TILE_SIZE, TileType } from '../types.js';
import { getCatalogEntry, getOrientationInGroup } from './furnitureCatalog.js';

/** Convert flat tile array from layout into 2D grid */
export function layoutToTileMap(layout: OfficeLayout): TileTypeVal[][] {
  const map: TileTypeVal[][] = [];
  for (let r = 0; r < layout.rows; r++) {
    const row: TileTypeVal[] = [];
    for (let c = 0; c < layout.cols; c++) {
      row.push(layout.tiles[r * layout.cols + c]);
    }
    map.push(row);
  }
  return map;
}

/** Where on its seat sprite seat `index` puts its sitter's hips, in art px:
 *  its own point, or the mirrored point of the `_FRONT` or `_BACK` sprite it
 *  mirrors. Null for a seat with no measured sit point. */
function seatSitPoint(type: string, spriteW: number, index: number): Point | null {
  const own = SEAT_SIT_POINTS_ART_PX[type]?.[index];
  if (own) return own;
  const mirroredFrom = type.replace(/_RIGHT$/, '_FRONT').replace(/_LEFT$/, '_BACK');
  const point = mirroredFrom === type ? undefined : SEAT_SIT_POINTS_ART_PX[mirroredFrom]?.[index];
  return point ? { x: spriteW - point.x, y: point.y } : null;
}

/** Where a seated frame facing `facing` has its hips, in art px. */
function seatedHip(facing: Direction): Point {
  const hip =
    facing === Direction.UP || facing === Direction.LEFT
      ? SEATED_HIP_ART_PX.away
      : SEATED_HIP_ART_PX.facing;
  const mirrored = facing === Direction.RIGHT || facing === Direction.LEFT;
  return { x: mirrored ? CHAR_FRAME_W - hip.x : hip.x, y: hip.y };
}

/** Iso shift that puts the hips of a character seated on tile (col, row) of
 *  `item`, facing `facing`, on that seat's sit point. The character is drawn
 *  feet on its tile's centre (`characterSpritePlacement`), the seat at its
 *  footprint's sprite origin, both at 1 / ART_SCALE iso px per art px. */
function sitOffsetOnto(
  item: PlacedFurniture,
  index: number,
  col: number,
  row: number,
  facing: Direction,
): Point {
  const entry = getCatalogEntry(item.type)!;
  const spriteW = entry.sprite[0]?.length ?? 0;
  const point = seatSitPoint(item.type, spriteW, index);
  if (!point) return { x: 0, y: 0 };
  const origin = footprintSpriteOrigin(
    item.col,
    item.row,
    entry.footprintW,
    entry.footprintH,
    spriteW,
    entry.sprite.length,
  );
  const anchor = worldToIso((col + 0.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE);
  const hip = seatedHip(facing);
  return {
    x: origin.x + (point.x + CHAR_FRAME_W / 2 - hip.x) / ART_SCALE - anchor.x,
    y: origin.y + (point.y + CHAR_FRAME_H - hip.y) / ART_SCALE - anchor.y,
  };
}

/** A wall item is drawn flat on the face of its wall, but its sprite is wider
 *  than that face and spills over the next wall tile along. Sorting it as a
 *  zero-depth box on the face, stretched over the tiles it spills onto, puts
 *  it after every wall tile it covers and still before anything standing in
 *  front of the wall. */
function wallFaceBox(
  footprint: { minCol: number; minRow: number; maxCol: number; maxRow: number },
  orientation: string | undefined,
  spriteArtW: number,
): { minCol: number; minRow: number; maxCol: number; maxRow: number } {
  const spill = Math.max(1, Math.ceil(spriteArtW / ART_SCALE / ISO_TILE_W));
  if (orientation === 'right') {
    return {
      minCol: footprint.maxCol,
      maxCol: footprint.maxCol,
      minRow: footprint.minRow,
      maxRow: footprint.maxRow + spill,
    };
  }
  return {
    minCol: footprint.minCol,
    maxCol: footprint.maxCol + spill,
    minRow: footprint.maxRow,
    maxRow: footprint.maxRow,
  };
}

/** Convert placed furniture into renderable FurnitureInstance[] */
export function layoutToFurnitureInstances(furniture: PlacedFurniture[]): FurnitureInstance[] {
  const instances: FurnitureInstance[] = [];
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry) continue;

    let sprite = entry.sprite;
    if (item.color) {
      const { h, s, b: bv, c: cv } = item.color;
      sprite = getColorizedSprite(
        `furn-${item.type}-${h}-${s}-${bv}-${cv}-${item.color.colorize ? 1 : 0}`,
        entry.sprite,
        item.color,
      );
    }

    // Legacy flat art: a "left" variant is the mirrored "side" sprite.
    const mirrored = !!entry.mirrorSide && getOrientationInGroup(item.type) === 'left';

    let layer: number = SortLayer.FLOOR;
    if (entry.canPlaceOnSurfaces || entry.canPlaceOnWalls) layer = SortLayer.ATTACHED;
    // A seat facing away shows its backrest between the viewer and its
    // sitter, so it draws over the sitter the way a Habbo chair's backrest
    // layer does. Every other seat draws under its sitter.
    if (
      entry.category === 'chairs' &&
      (entry.orientation === 'back' || entry.orientation === 'left')
    ) {
      layer = SortLayer.ATTACHED;
    }

    const origin = footprintSpriteOrigin(
      item.col,
      item.row,
      entry.footprintW,
      entry.footprintH,
      sprite[0]?.length ?? 0,
      sprite.length,
    );
    const footprint = {
      minCol: item.col,
      minRow: item.row,
      maxCol: item.col + entry.footprintW,
      maxRow: item.row + entry.footprintH,
    };
    instances.push({
      sprite,
      x: origin.x,
      y: origin.y,
      sort: {
        ...(entry.canPlaceOnWalls
          ? wallFaceBox(footprint, entry.orientation, sprite[0]?.length ?? 0)
          : footprint),
        layer,
      },
      uid: item.uid,
      ...(mirrored ? { mirrored: true } : {}),
    });
  }
  return instances;
}

/** Get all tiles blocked by furniture footprints, optionally excluding a set of tiles.
 *  Skips top backgroundTiles rows so characters can walk through them. */
export function getBlockedTiles(
  furniture: PlacedFurniture[],
  excludeTiles?: Set<string>,
): Set<string> {
  const tiles = new Set<string>();
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry) continue;
    const bgRows = entry.backgroundTiles || 0;
    for (let dr = 0; dr < entry.footprintH; dr++) {
      if (dr < bgRows) continue; // skip background rows — characters can walk through
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const key = `${item.col + dc},${item.row + dr}`;
        if (excludeTiles && excludeTiles.has(key)) continue;
        tiles.add(key);
      }
    }
  }
  return tiles;
}

/** Map chair orientation to character facing direction */
function orientationToFacing(orientation: string): Direction {
  switch (orientation) {
    case 'front':
      return Direction.DOWN;
    case 'back':
      return Direction.UP;
    case 'left':
      return Direction.LEFT;
    case 'right':
    case 'side':
      return Direction.RIGHT;
    default:
      return Direction.DOWN;
  }
}

/** Generate seats from chair furniture.
 *  Facing priority: 1) chair orientation, 2) adjacent desk, 3) forward (DOWN). */
export function layoutToSeats(furniture: PlacedFurniture[]): Map<string, Seat> {
  const seats = new Map<string, Seat>();

  // Build set of all desk tiles
  const deskTiles = new Set<string>();
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry || !entry.isDesk) continue;
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        deskTiles.add(`${item.col + dc},${item.row + dr}`);
      }
    }
  }

  const dirs: Array<{ dc: number; dr: number; facing: Direction }> = [
    { dc: 0, dr: -1, facing: Direction.UP }, // desk is above chair → face UP
    { dc: 0, dr: 1, facing: Direction.DOWN }, // desk is below chair → face DOWN
    { dc: -1, dr: 0, facing: Direction.LEFT }, // desk is left of chair → face LEFT
    { dc: 1, dr: 0, facing: Direction.RIGHT }, // desk is right of chair → face RIGHT
  ];

  // For each chair, every footprint tile becomes a seat.
  // Multi-tile chairs (e.g. 2-tile couches) produce multiple seats.
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry || entry.category !== 'chairs') continue;

    let seatCount = 0;
    const bgRows = entry.backgroundTiles ?? 0;
    for (let dr = bgRows; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const tileCol = item.col + dc;
        const tileRow = item.row + dr;

        // Determine facing direction:
        // 1) Chair orientation takes priority
        // 2) Adjacent desk direction
        // 3) Default forward (DOWN)
        let facingDir: Direction = Direction.DOWN;
        if (entry.orientation) {
          facingDir = orientationToFacing(entry.orientation);
        } else {
          for (const d of dirs) {
            if (deskTiles.has(`${tileCol + d.dc},${tileRow + d.dr}`)) {
              facingDir = d.facing;
              break;
            }
          }
        }

        const sitOffset = sitOffsetOnto(item, seatCount, tileCol, tileRow, facingDir);
        // First seat uses chair uid (backward compat), subsequent use uid:N
        const seatUid = seatCount === 0 ? item.uid : `${item.uid}:${seatCount}`;
        seats.set(seatUid, {
          uid: seatUid,
          seatCol: tileCol,
          seatRow: tileRow,
          facingDir,
          assigned: false,
          sitOffsetX: sitOffset.x,
          sitOffsetY: sitOffset.y,
        });
        seatCount++;
      }
    }
  }

  return seats;
}

/** Get the set of tiles occupied by seats (so they can be excluded from blocked tiles)
 * @internal */
export function getSeatTiles(seats: Map<string, Seat>): Set<string> {
  const tiles = new Set<string>();
  for (const seat of seats.values()) {
    tiles.add(`${seat.seatCol},${seat.seatRow}`);
  }
  return tiles;
}

/** Default floor colors for the two rooms */
const DEFAULT_LEFT_ROOM_COLOR: ColorValue = { h: 35, s: 30, b: 15, c: 0 }; // warm beige
const DEFAULT_RIGHT_ROOM_COLOR: ColorValue = { h: 25, s: 45, b: 5, c: 10 }; // warm brown

/** Create a minimal fallback layout (used only when no default-layout.json exists) */
export function createDefaultLayout(): OfficeLayout {
  const W = TileType.WALL;
  const F1 = TileType.FLOOR_1;
  const F2 = TileType.FLOOR_2;

  const tiles: TileTypeVal[] = [];
  const tileColors: Array<ColorValue | null> = [];

  for (let r = 0; r < DEFAULT_ROWS; r++) {
    for (let c = 0; c < DEFAULT_COLS; c++) {
      if (r === 0 || r === DEFAULT_ROWS - 1 || c === 0 || c === DEFAULT_COLS - 1) {
        tiles.push(W);
        tileColors.push(null);
      } else if (c < 10) {
        tiles.push(F1);
        tileColors.push(DEFAULT_LEFT_ROOM_COLOR);
      } else {
        tiles.push(F2);
        tileColors.push(DEFAULT_RIGHT_ROOM_COLOR);
      }
    }
  }

  // Minimal fallback with no furniture — the default-layout.json provides the real default
  return { version: 1, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, tiles, tileColors, furniture: [] };
}

/** Serialize layout to JSON string
 * @internal */
export function serializeLayout(layout: OfficeLayout): string {
  return JSON.stringify(layout);
}

// ── Furniture type migration ────────────────────────────────────

/** Map old hardcoded FurnitureType values to new manifest-based IDs */
const LEGACY_TYPE_MAP: Record<string, string | null> = {
  desk: 'DESK_FRONT',
  chair: 'WOODEN_CHAIR_FRONT',
  bookshelf: 'BOOKSHELF',
  plant: 'PLANT',
  cooler: null, // no equivalent in new assets — remove
  whiteboard: 'WHITEBOARD',
  pc: 'PC_FRONT_OFF',
  lamp: null, // no equivalent in new assets — remove
};

/** Migrate old furniture type strings to new manifest IDs */
function migrateFurnitureTypes(furniture: PlacedFurniture[]): PlacedFurniture[] {
  const migrated: PlacedFurniture[] = [];
  for (const item of furniture) {
    const newType = LEGACY_TYPE_MAP[item.type];
    if (newType === undefined) {
      // Not a legacy type — keep as-is
      migrated.push(item);
    } else if (newType !== null) {
      // Migrate to new type
      migrated.push({ ...item, type: newType });
    }
    // newType === null → remove the item (no equivalent)
  }
  return migrated;
}

/** Deserialize layout from JSON string, migrating old tile types if needed
 * @internal */
export function deserializeLayout(json: string): OfficeLayout | null {
  try {
    const obj = JSON.parse(json);
    if (obj && obj.version === 1 && Array.isArray(obj.tiles) && Array.isArray(obj.furniture)) {
      return migrateLayout(obj as OfficeLayout);
    }
  } catch {
    /* ignore parse errors */
  }
  return null;
}

/**
 * Ensure layout has tileColors. If missing, generate defaults based on tile types.
 * Exported for use by message handlers that receive layouts over the wire.
 */
export function migrateLayoutColors(layout: OfficeLayout): OfficeLayout {
  return migrateLayout(layout);
}

/**
 * Migrate old layouts that use legacy tile types (TILE_FLOOR=1, WOOD_FLOOR=2, CARPET=3, DOORWAY=4)
 * to the new pattern-based system. Also migrates old furniture type strings and old VOID value.
 */
function migrateLayout(layout: OfficeLayout): OfficeLayout {
  // Migrate furniture types
  layout = { ...layout, furniture: migrateFurnitureTypes(layout.furniture) };

  // Migrate old VOID value (was 8, now 255) — only for legacy layouts since FLOOR_8 reuses value 8
  const OLD_VOID = 8;
  if (!layout.layoutRevision && layout.tiles.includes(OLD_VOID as TileTypeVal)) {
    layout = {
      ...layout,
      tiles: layout.tiles.map((t) => (t === OLD_VOID ? (TileType.VOID as TileTypeVal) : t)),
    };
  }

  // Default pets to empty array if absent (backward-compat for legacy layouts).
  if (!layout.pets) {
    layout = { ...layout, pets: [] };
  }

  if (layout.tileColors && layout.tileColors.length === layout.tiles.length) {
    return layout; // Already migrated tile colors
  }

  // Check if any tiles use old values (1-4) — these map directly to FLOOR_1-4
  // but need color assignments
  const tileColors: Array<ColorValue | null> = [];
  for (const tile of layout.tiles) {
    switch (tile) {
      case 0: // WALL
        tileColors.push(null);
        break;
      case 1: // was TILE_FLOOR → FLOOR_1 beige
        tileColors.push(DEFAULT_LEFT_ROOM_COLOR);
        break;
      case 2: // was WOOD_FLOOR → FLOOR_2 brown
        tileColors.push(DEFAULT_RIGHT_ROOM_COLOR);
        break;
      case 3: // was CARPET → FLOOR_3 purple
        tileColors.push({ h: 280, s: 40, b: -5, c: 0 });
        break;
      case 4: // was DOORWAY → FLOOR_4 tan
        tileColors.push({ h: 35, s: 25, b: 10, c: 0 });
        break;
      default:
        // Floor tile types without colors — use neutral gray
        tileColors.push(tile > 0 && tile !== TileType.VOID ? { h: 0, s: 0, b: 0, c: 0 } : null);
    }
  }

  return { ...layout, tileColors };
}
