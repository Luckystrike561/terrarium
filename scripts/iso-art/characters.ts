/**
 * Isometric office workers in Habbo Hotel's proportions: about 40 px
 * crown to sole, a big 3/4-turned head over a block body on short legs,
 * every part outlined in ink.
 *
 * Sheet format (decoded by `decodeCharacterPng`): one row of
 * CHAR_FRAME_W x CHAR_FRAME_H frames per facing, in `CHARACTER_FRAMES`
 * order, 3 rows tall. Row 0 faces DOWN (+row, screen lower-left: 3/4
 * front), row 1 faces UP (-row, screen upper-right: 3/4 back), row 2 faces
 * RIGHT (+col, screen lower-right) and is row 0 mirrored frame by frame.
 * The feet touch the bottom-centre of the frame. Seated frames sit
 * `SEAT_DROP` px lower, on a chair seat.
 *
 * A frame is composed from parts the way a Habbo figure is: the posed body
 * (legs, torso with the outfit's cut, arms and whatever the hands hold),
 * then the head (skull, face, hair and one accessory). Every worker shares
 * the same poses and differs in build, hair, outfit cut and accessory.
 */

import type { CharacterFrame } from '../../core/src/assets/constants.js';
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_FRAMES,
} from '../../core/src/assets/constants.js';
import { LetterCanvas } from './characters/canvas.js';
import type { Facing } from './characters/body.js';
import {
  BODY_CENTER_X,
  BUILD_LEG_DELTA,
  drawBody,
  isSeated,
  SEAT_DROP,
  SHOULDER_Y,
  SOLE_Y,
} from './characters/body.js';
import { drawHead } from './characters/head.js';
import { OUTLINE, PAPER, SHADOW, SIGN_MARK } from './characters/templates.js';
import type { Worker } from './characters/workers.js';
import { CTO, WORKERS } from './characters/workers.js';
import type { RGBA } from './lib/image.js';
import { hex, PixelImage } from './lib/image.js';

/** 1 px vertical shift of the upper body for the pose's second half-cycle:
 *  walking lifts it, idle and rest sink into a one-pixel exhale, a raised
 *  hand or a held-up form lifts between the two animation frames. */
const BOB: Partial<Record<CharacterFrame, number>> = {
  walk1: -1,
  walk3: -1,
  idle2: 1,
  rest2: 1,
  raiseHand2: -1,
  raiseHandSeated2: -1,
  holdForm2: -1,
  holdFormSeated2: -1,
};

const SHADOW_ROW = ['..xxxxxxxxxxxx..'];

function paletteOf(worker: Worker): Record<string, RGBA> {
  const pal: Record<string, RGBA> = {
    o: hex(OUTLINE),
    w: hex('#f4f0ea'),
    e: hex('#2a1e1a'),
    n: hex(PAPER.n),
    l: hex(PAPER.l),
    g: hex(SIGN_MARK),
    j: hex('#3a3440'),
    y: hex('#e0b95a'),
    x: hex(SHADOW),
  };
  for (const [key, value] of Object.entries(worker.colors)) pal[key] = hex(value);
  return pal;
}

function drawFrame(
  worker: Worker,
  pal: Record<string, RGBA>,
  facing: Facing,
  frame: CharacterFrame,
): PixelImage {
  const canvas = new LetterCanvas(CHAR_FRAME_W, CHAR_FRAME_H);
  const seated = isSeated(frame);
  const upperShift = (seated ? SEAT_DROP : 0) + (BOB[frame] ?? 0) - BUILD_LEG_DELTA[worker.build];
  if (!seated) canvas.stamp(SHADOW_ROW, BODY_CENTER_X - SHADOW_ROW[0].length / 2, SOLE_Y + 1);

  const { drawRaised } = drawBody(
    canvas,
    { build: worker.build, outfit: worker.outfit, lanyard: worker.accessory === 'lanyard' },
    facing,
    frame,
    upperShift,
  );

  const chinY = SHOULDER_Y + upperShift - 1;
  const blink = facing === 'front' && frame === 'rest2';
  drawHead(canvas, chinY, facing, { hair: worker.hair, accessory: worker.accessory }, blink);
  drawRaised();

  return canvas.toImage(pal);
}

function renderSheet(worker: Worker): PixelImage {
  const pal = paletteOf(worker);
  const sheet = new PixelImage(CHAR_FRAME_W * CHAR_FRAMES_PER_ROW, CHAR_FRAME_H * 3);
  CHARACTER_FRAMES.forEach((frame, i) => {
    const front = drawFrame(worker, pal, 'front', frame);
    sheet.blit(front, i * CHAR_FRAME_W, 0);
    sheet.blit(drawFrame(worker, pal, 'back', frame), i * CHAR_FRAME_W, CHAR_FRAME_H);
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
