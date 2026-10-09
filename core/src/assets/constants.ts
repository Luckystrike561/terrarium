/**
 * Shared constants — used by the server and Vite build scripts.
 *
 * Only asset parsing and layout-related values.
 */

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

// ── Carpet auto-tile parsing ────────────────────────────────
export const CARPET_TILE_SIZE = 16;
export const CARPET_GRID_COLS = 4;
export const CARPET_MARCHING_SQUARES_COUNT = 16;
