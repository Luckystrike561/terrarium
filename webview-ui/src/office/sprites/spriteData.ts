import type { CharacterFrame } from '../../../../core/src/assets/constants.ts';
import {
  CHAR_COUNT,
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHARACTER_FRAMES,
} from '../../../../core/src/assets/constants.ts';
import type { ColorValue } from '../../components/ui/types.js';
import { adjustSprite } from '../colorize.js';
import type { Direction, SpriteData } from '../types.js';
import { Direction as Dir } from '../types.js';
import bubblePermissionData from './bubble-permission.json';
import bubblePetData from './bubble-pet.json';
import bubbleWaitingData from './bubble-waiting.json';
import statusDoneData from './status-done.json';
import statusIdleData from './status-idle.json';
import statusPermissionData from './status-permission.json';
import statusWaitingInputData from './status-waiting-input.json';
import statusWorkingData from './status-working.json';

// ── Speech Bubble Sprites ───────────────────────────────────────

interface BubbleSpriteJson {
  palette: Record<string, string>;
  pixels: string[][];
}

function resolveBubbleSprite(data: BubbleSpriteJson): SpriteData {
  return data.pixels.map((row) => row.map((key) => data.palette[key] ?? key));
}

/** Permission bubble: white square with "..." in amber, and a tail pointer (11x13) */
export const BUBBLE_PERMISSION_SPRITE: SpriteData = resolveBubbleSprite(bubblePermissionData);

/** Waiting bubble: white square with green checkmark, and a tail pointer (11x13) */
export const BUBBLE_WAITING_SPRITE: SpriteData = resolveBubbleSprite(bubbleWaitingData);

/** Heart bubble: pet petting feedback (11x13) */
export const BUBBLE_HEART_SPRITE: SpriteData = resolveBubbleSprite(bubblePetData);

// ── Persistent Agent Status Badges ─────────────────────────────

/** Status badge: actively working (blue, play-triangle glyph) (9x9) */
export const STATUS_WORKING_SPRITE: SpriteData = resolveBubbleSprite(statusWorkingData);

/** Status badge: turn finished (green, checkmark glyph) (9x9) */
export const STATUS_DONE_SPRITE: SpriteData = resolveBubbleSprite(statusDoneData);

/** Status badge: idle, waiting on the user (purple, question-mark glyph) (9x9) */
export const STATUS_WAITING_INPUT_SPRITE: SpriteData = resolveBubbleSprite(statusWaitingInputData);

/** Status badge: idle/resting, no turn in flight (gray-blue, Z glyph) (9x9) */
export const STATUS_IDLE_SPRITE: SpriteData = resolveBubbleSprite(statusIdleData);

/** Status badge: blocked on a permission request (amber, exclamation glyph) (9x9) */
export const STATUS_PERMISSION_SPRITE: SpriteData = resolveBubbleSprite(statusPermissionData);

// ════════════════════════════════════════════════════════════════
// Loaded character sprites (from PNG assets)
// ════════════════════════════════════════════════════════════════

interface CharacterSheet {
  down: SpriteData[];
  up: SpriteData[];
  right: SpriteData[];
}

let loadedCharacters: CharacterSheet[] | null = null;
let loadedCto: CharacterSheet | null = null;

/** Set the pre-colored agent sheets and the CTO's sheet. Call this when the
 *  characterSpritesLoaded message arrives. */
export function setCharacterTemplates(characters: CharacterSheet[], cto: CharacterSheet): void {
  loadedCharacters = characters;
  loadedCto = cto;
  spriteCache.clear();
}

/** Return the number of loaded agent palettes, or CHAR_COUNT before the sheets load. */
export function getLoadedCharacterCount(): number {
  return loadedCharacters ? loadedCharacters.length : CHAR_COUNT;
}

function flipSpriteHorizontal(sprite: SpriteData): SpriteData {
  return sprite.map((row) => [...row].reverse());
}

// ════════════════════════════════════════════════════════════════
// Sprite resolution + caching
// ════════════════════════════════════════════════════════════════

type FramePair = readonly [SpriteData, SpriteData];
type WalkCycle = readonly [SpriteData, SpriteData, SpriteData, SpriteData];

/** Two-frame poses and the sheet frames they alternate between. */
const POSE_FRAMES = {
  typing: ['type1', 'type2'],
  reading: ['read1', 'read2'],
  idle: ['idle1', 'idle2'],
  rest: ['rest1', 'rest2'],
  raiseHand: ['raiseHand1', 'raiseHand2'],
  raiseHandSeated: ['raiseHandSeated1', 'raiseHandSeated2'],
  holdForm: ['holdForm1', 'holdForm2'],
  holdFormSeated: ['holdFormSeated1', 'holdFormSeated2'],
} as const satisfies Record<string, readonly [CharacterFrame, CharacterFrame]>;

export type LoopingPose = keyof typeof POSE_FRAMES;
export type CharacterPose = 'walk' | LoopingPose;

export type CharacterSprites = { walk: Record<Direction, WalkCycle> } & Record<
  LoopingPose,
  Record<Direction, FramePair>
>;

const spriteCache = new Map<string, CharacterSprites>();

function byDirection<T>(build: (dir: Direction) => T): Record<Direction, T> {
  return {
    [Dir.DOWN]: build(Dir.DOWN),
    [Dir.UP]: build(Dir.UP),
    [Dir.RIGHT]: build(Dir.RIGHT),
    [Dir.LEFT]: build(Dir.LEFT),
  } as Record<Direction, T>;
}

/** LEFT (-col) faces screen upper-left, which is the mirrored UP (upper-right)
 *  back view. */
function sheetFrame(sheet: CharacterSheet, dir: Direction, frame: CharacterFrame): SpriteData {
  const index = CHARACTER_FRAMES.indexOf(frame);
  if (dir === Dir.DOWN) return sheet.down[index];
  if (dir === Dir.RIGHT) return sheet.right[index];
  if (dir === Dir.UP) return sheet.up[index];
  return flipSpriteHorizontal(sheet.up[index]);
}

function buildCharacterSprites(sheet: CharacterSheet): CharacterSprites {
  const pairs = {} as Record<LoopingPose, Record<Direction, FramePair>>;
  for (const pose of Object.keys(POSE_FRAMES) as LoopingPose[]) {
    const [first, second] = POSE_FRAMES[pose];
    pairs[pose] = byDirection((dir) => [
      sheetFrame(sheet, dir, first),
      sheetFrame(sheet, dir, second),
    ]);
  }
  return {
    walk: byDirection((dir) => {
      const passing = sheetFrame(sheet, dir, 'walk2');
      return [sheetFrame(sheet, dir, 'walk1'), passing, sheetFrame(sheet, dir, 'walk3'), passing];
    }),
    ...pairs,
  };
}

function hueShiftSheet(sheet: CharacterSheet, hueShift: number): CharacterSheet {
  const color: ColorValue = { h: hueShift, s: 0, b: 0, c: 0 };
  const shift = (frames: SpriteData[]) => frames.map((frame) => adjustSprite(frame, color));
  return { down: shift(sheet.down), up: shift(sheet.up), right: shift(sheet.right) };
}

/** Transparent frames shown until the sheets arrive. */
function placeholderSheet(): CharacterSheet {
  const empty: SpriteData = Array.from({ length: CHAR_FRAME_H }, () =>
    new Array<string>(CHAR_FRAME_W).fill(''),
  );
  const frames = new Array<SpriteData>(CHARACTER_FRAMES.length).fill(empty);
  return { down: frames, up: frames, right: frames };
}

export function getCharacterSprites(paletteIndex: number, hueShift = 0): CharacterSprites {
  const cacheKey = `${paletteIndex}:${hueShift}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;
  const base = loadedCharacters
    ? loadedCharacters[paletteIndex % loadedCharacters.length]
    : placeholderSheet();
  const sprites = buildCharacterSprites(hueShift === 0 ? base : hueShiftSheet(base, hueShift));
  spriteCache.set(cacheKey, sprites);
  return sprites;
}

/** The CTO's own sprites. No agent palette resolves to them. */
export function getCtoSprites(): CharacterSprites {
  const cacheKey = 'cto';
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;
  const sprites = buildCharacterSprites(loadedCto ?? placeholderSheet());
  spriteCache.set(cacheKey, sprites);
  return sprites;
}
