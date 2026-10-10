/**
 * Isometric office workers, hand-placed pixel templates in a chunky RPG
 * style: bold dark outline, big heads with spiky volume, 3/4 view.
 *
 * Sheet format (decoded by `decodeCharacterPng`): one row of
 * CHAR_FRAME_W x CHAR_FRAME_H frames per facing, in `CHARACTER_FRAMES`
 * order, 3 rows tall. Row 0 faces DOWN (+row, screen lower-left: 3/4
 * front), row 1 faces UP (-row, screen upper-right: 3/4 back), row 2 faces
 * RIGHT (+col, screen lower-right) and is row 0 mirrored frame by frame.
 * The feet touch the bottom-centre of the frame. Seated frames sit on a
 * chair seat `SEAT_DROP` px lower.
 *
 * A frame is layered from parts: legs, torso (arm pose, carrying the
 * outfit's collar/sleeve shape), face, hair, then any accessory. Each part
 * is a template whose letters index the worker's palette, so
 * every worker shares the same poses and differs in build, hair, outfit cut
 * and accessory.
 */

import type { CharacterFrame } from '../../core/src/assets/constants.js';
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_FRAMES,
} from '../../core/src/assets/constants.js';
import {
  accessoryStamp,
  BUILD_LEG_DELTA,
  BUILD_WIDTH_DELTA,
  COLLAR_OVERLAY,
  LANYARD_FRONT,
  stretchLegs,
  widenBody,
} from './characters/outfits.js';
import {
  ARM_REACH,
  FACE_BACK,
  FACE_FRONT,
  FACE_FRONT_BLINK,
  HAIR,
  LEGS_SIT_BACK,
  LEGS_SIT_FRONT,
  LEGS_STAND,
  LEGS_WALK_A,
  LEGS_WALK_B,
  LEGS_Y,
  OUTLINE,
  PAPER,
  SEAT_DROP,
  SHADOW,
  SIGN_MARK,
  TORSO_BACK_HOLD,
  TORSO_BACK_IDLE,
  TORSO_BACK_RAISE_A,
  TORSO_BACK_RAISE_B,
  TORSO_BACK_REST,
  TORSO_BACK_WORK_1,
  TORSO_BACK_WORK_2,
  TORSO_FRONT_HOLD,
  TORSO_FRONT_IDLE,
  TORSO_FRONT_RAISE_A,
  TORSO_FRONT_RAISE_B,
  TORSO_FRONT_READ_1,
  TORSO_FRONT_READ_2,
  TORSO_FRONT_REST,
  TORSO_FRONT_TYPE_1,
  TORSO_FRONT_TYPE_2,
  TORSO_Y,
} from './characters/templates.js';
import type { Worker } from './characters/workers.js';
import { CTO, WORKERS } from './characters/workers.js';
import type { RGBA } from './lib/image.js';
import { hex, PixelImage } from './lib/image.js';

type Facing = 'front' | 'back';

type Pose = CharacterFrame;

const SEATED: Partial<Record<Pose, true>> = {
  type1: true,
  type2: true,
  read1: true,
  read2: true,
  rest1: true,
  rest2: true,
  raiseHandSeated1: true,
  raiseHandSeated2: true,
  holdFormSeated1: true,
  holdFormSeated2: true,
};

/** 1 px vertical shift for the pose's second half-cycle: walking lifts the
 *  upper body, idle/rest sink into a one-pixel exhale, raise/hold lift and
 *  drop the arm reach between the two animation frames. */
const BOB: Partial<Record<Pose, number>> = {
  walk1: -1,
  walk3: -1,
  idle2: 1,
  rest1: 0,
  rest2: 1,
  raiseHand1: 0,
  raiseHand2: -1,
  raiseHandSeated1: 0,
  raiseHandSeated2: -1,
  holdForm1: 0,
  holdForm2: -1,
  holdFormSeated1: 0,
  holdFormSeated2: -1,
};

/** How many rows the pose's torso template prepends for a raised arm
 *  (`raiseHand*`) or a held-up sheet (`holdForm*`). It is stamped that many
 *  rows higher so the hand or the sheet clears the hairline. */
const REACH: Partial<Record<Pose, number>> = {
  raiseHand1: ARM_REACH,
  raiseHand2: ARM_REACH,
  raiseHandSeated1: ARM_REACH,
  raiseHandSeated2: ARM_REACH,
  holdForm1: ARM_REACH,
  holdForm2: ARM_REACH,
  holdFormSeated1: ARM_REACH,
  holdFormSeated2: ARM_REACH,
};

function legsFor(facing: Facing, pose: Pose): readonly string[] {
  if (SEATED[pose]) return facing === 'front' ? LEGS_SIT_FRONT : LEGS_SIT_BACK;
  if (pose === 'walk1') return LEGS_WALK_A;
  if (pose === 'walk3') return LEGS_WALK_B;
  return LEGS_STAND;
}

function torsoFor(facing: Facing, pose: Pose): readonly string[] {
  if (facing === 'back') {
    switch (pose) {
      case 'type1':
      case 'read1':
        return TORSO_BACK_WORK_1;
      case 'type2':
      case 'read2':
        return TORSO_BACK_WORK_2;
      case 'rest1':
      case 'rest2':
        return TORSO_BACK_REST;
      case 'raiseHand1':
      case 'raiseHandSeated1':
        return TORSO_BACK_RAISE_A;
      case 'raiseHand2':
      case 'raiseHandSeated2':
        return TORSO_BACK_RAISE_B;
      case 'holdForm1':
      case 'holdForm2':
      case 'holdFormSeated1':
      case 'holdFormSeated2':
        return TORSO_BACK_HOLD;
      default:
        return TORSO_BACK_IDLE;
    }
  }
  switch (pose) {
    case 'type1':
      return TORSO_FRONT_TYPE_1;
    case 'type2':
      return TORSO_FRONT_TYPE_2;
    case 'read1':
      return TORSO_FRONT_READ_1;
    case 'read2':
      return TORSO_FRONT_READ_2;
    case 'rest1':
    case 'rest2':
      return TORSO_FRONT_REST;
    case 'raiseHand1':
    case 'raiseHandSeated1':
      return TORSO_FRONT_RAISE_A;
    case 'raiseHand2':
    case 'raiseHandSeated2':
      return TORSO_FRONT_RAISE_B;
    case 'holdForm1':
    case 'holdForm2':
    case 'holdFormSeated1':
    case 'holdFormSeated2':
      return TORSO_FRONT_HOLD;
    default:
      return TORSO_FRONT_IDLE;
  }
}

function faceFor(facing: Facing, pose: Pose): readonly string[] {
  if (facing === 'back') return FACE_BACK;
  return pose === 'rest2' ? FACE_FRONT_BLINK : FACE_FRONT;
}

function paletteOf(worker: Worker): Record<string, RGBA> {
  const pal: Record<string, RGBA> = {
    o: hex(OUTLINE),
    w: hex('#f4f0ea'),
    e: hex('#2a1e1a'),
    n: hex(PAPER.n),
    l: hex(PAPER.l),
    g: hex(SIGN_MARK),
    j: hex('#3a3440'),
    x: hex(SHADOW),
  };
  for (const [key, value] of Object.entries(worker.colors)) pal[key] = hex(value);
  return pal;
}

/** Builds the torso and legs for this worker's build: width for
 *  stocky/slim, leg length (and the matching torso/head shift) for
 *  short/tall. Returns the adjusted templates plus the vertical offset to
 *  stamp torso/face/hair at. */
function buildParts(
  worker: Worker,
  facing: Facing,
  pose: Pose,
): { legs: readonly string[]; torso: readonly string[]; yOffset: number } {
  const legDelta = BUILD_LEG_DELTA[worker.build];
  const widthDelta = BUILD_WIDTH_DELTA[worker.build];
  const reach = REACH[pose] ?? 0;
  const legs = widenBody(stretchLegs(legsFor(facing, pose), legDelta), widthDelta);
  const torso = widenBody(torsoFor(facing, pose), widthDelta, reach);
  return { legs, torso, yOffset: -legDelta };
}

function drawFrame(
  worker: Worker,
  pal: Record<string, RGBA>,
  facing: Facing,
  pose: Pose,
): PixelImage {
  const img = new PixelImage(CHAR_FRAME_W, CHAR_FRAME_H);
  const seated = Boolean(SEATED[pose]);
  const drop = seated ? SEAT_DROP : 0;
  const bob = BOB[pose] ?? 0;
  const { legs, torso, yOffset } = buildParts(worker, facing, pose);
  const headY = drop + bob + yOffset;
  const torsoY = TORSO_Y + drop + bob + yOffset;
  const legsY = LEGS_Y + drop + yOffset + (seated ? -2 : 0);

  const reach = REACH[pose] ?? 0;
  img.stamp(legs, pal, 0, legsY);
  img.stamp(reach > 0 ? torso.slice(reach) : torso, pal, 0, torsoY);

  const collarShape = COLLAR_OVERLAY[worker.outfit][facing];
  img.stamp(collarShape, pal, 0, torsoY);

  img.stamp(faceFor(facing, pose), pal, 0, headY);
  img.stamp(HAIR[worker.hair][facing], pal, 0, headY);

  const wearsLanyard =
    worker.accessory === 'lanyard' &&
    facing === 'front' &&
    pose !== 'read1' &&
    pose !== 'read2' &&
    !pose.startsWith('holdForm');
  if (wearsLanyard) img.stamp(LANYARD_FRONT, pal, 0, torsoY);

  const stamp = accessoryStamp(worker.accessory, facing);
  if (stamp && worker.accessory !== 'lanyard')
    img.stamp(stamp.rows, pal, stamp.dx, headY + stamp.dy);

  if (reach > 0) img.stamp(torso.slice(0, reach), pal, 0, torsoY - reach);

  return img;
}

function renderSheet(worker: Worker): PixelImage {
  const pal = paletteOf(worker);
  const sheet = new PixelImage(CHAR_FRAME_W * CHAR_FRAMES_PER_ROW, CHAR_FRAME_H * 3);
  CHARACTER_FRAMES.forEach((pose, i) => {
    const front = drawFrame(worker, pal, 'front', pose);
    sheet.blit(front, i * CHAR_FRAME_W, 0);
    sheet.blit(drawFrame(worker, pal, 'back', pose), i * CHAR_FRAME_W, CHAR_FRAME_H);
    sheet.blit(front.mirrored(), i * CHAR_FRAME_W, CHAR_FRAME_H * 2);
  });
  return sheet;
}

export function renderCharacterSheets(): PixelImage[] {
  return WORKERS.map(renderSheet);
}

export function renderCtoSheet(): PixelImage {
  return renderSheet(CTO);
}
