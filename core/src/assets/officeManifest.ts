/**
 * The office manifest: one versioned JSON document the art pipeline writes
 * beside the sprite sheets (`assets/office-manifest.json`). It is the only
 * geometry source a client needs to draw the office: no per-item constant
 * and no filename convention.
 *
 * Conventions shared by every field:
 * - File paths are relative to the assets directory.
 * - Sprite coordinates are pixels from the image's (or frame's) top-left.
 * - The grid is `tileSize` world px per tile along +col (x) and +row (y). A
 *   world point (x, y) at height z projects to the iso point
 *   (x - y, (x + y) / 2 - z), so a tile is an `isoTileWidth` × `isoTileHeight`
 *   diamond and z is height in screen px.
 * - Facings name the grid direction a character faces: down = +row (screen
 *   lower-left), right = +col (lower-right), up = -row, left = -col.
 */

/** Bump on any change a client written against the previous version would
 *  misread. A client rejects a manifest whose version it does not know. */
export const OFFICE_MANIFEST_SCHEMA_VERSION = 1;
export const OFFICE_MANIFEST_FILE = 'office-manifest.json';

export type Facing = 'down' | 'up' | 'right' | 'left';
export const FACINGS: readonly Facing[] = ['down', 'up', 'right', 'left'];
export type FurnitureOrientation = 'front' | 'right' | 'back' | 'left';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Tiles covered along +col (width) and +row (depth). */
export interface Footprint {
  width: number;
  depth: number;
}

export interface Projection {
  tileSize: number;
  isoTileWidth: number;
  isoTileHeight: number;
}

/** Layout tile value → texture. Each square texture is projected onto the
 *  tile's diamond (`projectedSize`), its top-left corner on the tile's top
 *  vertex. */
export interface FloorTiles {
  textureSize: Size;
  projectedSize: Size;
  textures: Array<{ tile: number; file: string }>;
}

/** Walls are procedural boxes on the wall tile value: solid on the office's
 *  far edges, glass partitions inside. */
export interface WallTiles {
  tile: number;
  solidHeight: number;
  glassHeight: number;
}

/** Marching-squares carpet sheets: `grid` pieces of `pieceSize`, piece index
 *  = OR of `cornerBits` for each carpeted tile around a grid corner, drawn
 *  as a diamond centred on that corner. The corner (col, row) is the top
 *  corner of tile (col, row), and each key names the tile at this
 *  (dCol, dRow) from it: `nw` (-1, -1), `ne` (0, -1), `se` (0, 0), `sw`
 *  (-1, 0). On screen those tiles sit up, right, down and left of the
 *  corner, not at its compass corners. */
export interface CarpetTiles {
  pieceSize: Size;
  projectedSize: Size;
  grid: { columns: number; rows: number };
  cornerBits: { nw: number; ne: number; se: number; sw: number };
  textures: Array<{ variant: number; file: string }>;
}

export interface Tiles {
  voidTile: number;
  floor: FloorTiles;
  wall: WallTiles;
  carpet: CarpetTiles;
}

export interface FurnitureFrame {
  /** Catalog id a layout may place (`PC_FRONT_ON_1`). */
  id: string;
  file: string;
}

export interface FurnitureVariant {
  /** Catalog id of the variant (`DESK_FRONT`, or `PC_FRONT_ON` for an
   *  animation whose frames carry their own ids). */
  id: string;
  /** Which way the item faces. A sitter faces the same way as its chair. */
  orientation: FurnitureOrientation | null;
  state: 'on' | 'off' | null;
  footprint: Footprint;
  frameSize: Size;
  /** Sprite pixel on the top vertex of the footprint's first tile (the
   *  item's col, row) at floor level. Surface and wall items carry their
   *  lift in the art, so every placement anchors on the floor. */
  anchor: Point;
  /** One frame for a still, several for an animation. */
  frames: FurnitureFrame[];
  frameDurationSec: number | null;
}

export interface FurnitureItem {
  id: string;
  name: string;
  category: string;
  /** Floor items stand on the floor, surface items on a desk tile, wall items
   *  hang on a wall tile. */
  placement: 'floor' | 'surface' | 'wall';
  /** Footprint of the first variant. Rotated variants transpose it. */
  footprint: Footprint;
  /** Top of the item above the floor. */
  heightZ: number;
  /** Seat surface above the floor, when a character sits on the item. */
  seatZ: number | null;
  /** Height that splits the item into a lower part, drawn under its sitter,
   *  and an upper part (a backrest) that occludes by depth. */
  occlusionSplitZ: number | null;
  variants: FurnitureVariant[];
}

export interface CharacterFacing {
  facing: Facing;
  /** Sheet row holding the frames. */
  row: number;
  /** Draw the row flipped horizontally. */
  mirrored: boolean;
}

export interface CharacterAnimation {
  name: string;
  /** Sheet columns in play order. */
  frames: number[];
  frameDurationSec: number;
  /** Seated animations anchor on the seat, not the floor. */
  seated: boolean;
}

export interface Characters {
  frameSize: Size;
  /** Frame pixel on the floor point under the character's feet. */
  anchor: Point;
  /** Frame pixel on the seat point (the seat tile's centre at the seat's
   *  `seatZ`) for a seated animation. */
  seatedAnchor: Point;
  /** Sheet columns, left to right. */
  frameNames: string[];
  facings: CharacterFacing[];
  animations: CharacterAnimation[];
  sheets: Array<{ id: string; file: string; role: 'agent' | 'cto' }>;
}

/** A run of `count` equal frames left to right from (x, y). */
export interface PetStrip {
  x: number;
  y: number;
  frameSize: Size;
  count: number;
  /** Frame pixel on the floor point under the pet. */
  anchor: Point;
}

export interface PetAnimation {
  name: string;
  /** Strip frame indices in play order. */
  sequence: number[];
  frameDurationSec: number;
  facings: Array<{ facing: Facing; strip: PetStrip; mirrored: boolean }>;
}

export interface Pets {
  sheetSize: Size;
  animations: PetAnimation[];
  sheets: Array<{ id: string; name: string; file: string }>;
}

export interface OfficeManifest {
  schemaVersion: number;
  projection: Projection;
  tiles: Tiles;
  furniture: FurnitureItem[];
  characters: Characters;
  pets: Pets;
}

/** Sprite pixel of a footprint sprite's anchor (see `FurnitureVariant`):
 *  the footprint diamond touches the image's left, right and bottom edges. */
export function footprintAnchor(
  footprint: Footprint,
  spriteHeight: number,
  tileSize: number,
): Point {
  return {
    x: footprint.depth * tileSize,
    y: spriteHeight - ((footprint.width + footprint.depth) * tileSize) / 2,
  };
}
