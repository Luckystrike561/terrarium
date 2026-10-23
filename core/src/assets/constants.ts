/**
 * Asset parsing, geometry and animation constants shared by every reader of
 * the bundled art.
 */

// ── Iso geometry ────────────────────────────────────────────
/** World px per grid tile along +col and +row. A tile renders as a
 *  (2 × TILE_SIZE) × TILE_SIZE diamond, and z is height in screen px. */
export const TILE_SIZE = 16;
/** Height of a solid back wall. */
export const WALL_HEIGHT_PX = 40;
/** Height of an interior glass partition. */
export const WALL_GLASS_HEIGHT_PX = 30;
/** Seconds per frame of a furniture animation (an electronic item's on state). */
export const FURNITURE_FRAME_DURATION_SEC = 0.2;
export const WALL_TILE = 0;
/** A floor tile N draws the office manifest's tiles.floor.textures[N - FIRST_FLOOR_TILE]. */
export const FIRST_FLOOR_TILE = 1;
export const VOID_TILE = 255;

// ── PNG / Asset Parsing ─────────────────────────────────────
export const PNG_ALPHA_THRESHOLD = 2;
export const WALL_PIECE_WIDTH = 16;
export const WALL_PIECE_HEIGHT = 32;
export const WALL_GRID_COLS = 4;
export const WALL_BITMASK_COUNT = 16;
export const FLOOR_TILE_SIZE = 16;
export const CHARACTER_DIRECTIONS = ['down', 'up', 'right'] as const;
export const CHAR_FRAME_W = 24;
export const CHAR_FRAME_H = 40;
/** Frame order of every character sheet row. The generator, the decoder and
 *  the webview all index frames by it. */
export const CHARACTER_FRAMES = [
  'walk1',
  'walk2',
  'walk3',
  'type1',
  'type2',
  'read1',
  'read2',
  'idle1',
  'idle2',
  'rest1',
  'rest2',
  'raiseHand1',
  'raiseHand2',
  'raiseHandSeated1',
  'raiseHandSeated2',
  'holdForm1',
  'holdForm2',
  'holdFormSeated1',
  'holdFormSeated2',
] as const;
export type CharacterFrame = (typeof CHARACTER_FRAMES)[number];
export const CHAR_FRAMES_PER_ROW = CHARACTER_FRAMES.length;

export interface CharacterAnimationSpec {
  /** Sheet frames in play order. A frame may repeat (the walk cycle passes
   *  through walk2 twice). */
  readonly frames: readonly CharacterFrame[];
  readonly frameDurationSec: number;
  /** Drawn on a seat rather than standing on the floor. */
  readonly seated: boolean;
}

export const CHARACTER_ANIMATIONS = {
  walk: { frames: ['walk1', 'walk2', 'walk3', 'walk2'], frameDurationSec: 0.15, seated: false },
  typing: { frames: ['type1', 'type2'], frameDurationSec: 0.3, seated: true },
  reading: { frames: ['read1', 'read2'], frameDurationSec: 0.3, seated: true },
  idle: { frames: ['idle1', 'idle2'], frameDurationSec: 1.0, seated: false },
  rest: { frames: ['rest1', 'rest2'], frameDurationSec: 1.4, seated: true },
  raiseHand: { frames: ['raiseHand1', 'raiseHand2'], frameDurationSec: 0.4, seated: false },
  raiseHandSeated: {
    frames: ['raiseHandSeated1', 'raiseHandSeated2'],
    frameDurationSec: 0.4,
    seated: true,
  },
  holdForm: { frames: ['holdForm1', 'holdForm2'], frameDurationSec: 0.6, seated: false },
  holdFormSeated: {
    frames: ['holdFormSeated1', 'holdFormSeated2'],
    frameDurationSec: 0.6,
    seated: true,
  },
} as const satisfies Record<string, CharacterAnimationSpec>;
export type CharacterAnimationName = keyof typeof CHARACTER_ANIMATIONS;

/** Bundled agent sheets, char_0.png to char_11.png. */
export const CHAR_COUNT = 12;
/** The CTO's own sheet, beside the agent sheets. No agent is drawn with it. */
export const CTO_CHARACTER_FILE = 'cto.png';

// ── Pet Sprite Dimensions (96×96 spritesheet) ──────────────
export const PET_FRAME_W_SMALL = 16;
export const PET_FRAME_H = 32;
export const PET_FRAME_W_LARGE = 32;
export const PET_IMAGE_WIDTH = 96;
export const PET_IMAGE_HEIGHT = 96;
export const PET_WALK_FRAMES_VERT = 3;
export const PET_IDLE_FRAMES_VERT = 3;
export const PET_WALK_FRAMES_HORIZ = 3;
export const MAX_PET_PNG_SIZE = 512 * 1024; // 512 KB cap per pet PNG

/** Pet animations: the strip frame shown at each step, and how long each step shows. */
export const PET_ANIMATIONS = {
  walk: { sequence: [0, 1, 0, 2], frameDurationSec: 0.15 },
  idle: { sequence: [0, 1, 2, 1], frameDurationSec: 0.3 },
} as const;

// ── Carpet auto-tile parsing ────────────────────────────────
export const CARPET_TILE_SIZE = 16;
export const CARPET_GRID_COLS = 4;
export const CARPET_MARCHING_SQUARES_COUNT = 16;
/** Bit of each carpeted tile around a grid corner in the marching-squares
 *  case, which indexes the carpet sheet's pieces. */
export const CARPET_CORNER_BITS = { nw: 1, ne: 2, se: 4, sw: 8 } as const;
