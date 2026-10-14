/**
 * The posed body of a worker: legs, torso, arms and the props the hands
 * hold, drawn from joint positions instead of per-pose templates so every
 * build, outfit and pose shares one rule set.
 *
 * Everything is drawn as palette letters on a `LetterCanvas`. Each part is
 * a pixel mask: it is filled with its colours, then ringed in ink, and the
 * ring lands on whatever was drawn before it. Drawing back to front
 * therefore gives the inner line where an arm crosses the torso or the
 * torso meets the hips, the way Habbo outlines the parts of a figure.
 *
 * Coordinates are frame pixels (CHAR_FRAME_W × CHAR_FRAME_H). A joint is a
 * pixel-centre position, so a limb from (9.5, 27.5) runs through the centre
 * of pixel (9, 27).
 */

import type { CharacterFrame } from '../../../core/src/assets/constants.js';
import { LetterCanvas, Mask, roundShade } from './canvas.js';
import type { Joint } from './canvas.js';
import type { Build, OutfitCut } from './outfits.js';

export type Facing = 'front' | 'back';

// ── Skeleton ────────────────────────────────────────────────────

/** Horizontal centre of the figure: the seam between pixels 15 and 16. */
export const BODY_CENTER_X = 16;
/** Top row of the shoulders. A block body: the torso is a straight-sided
 *  box this many rows deep, not a taper. The chin sits on the row above. */
export const SHOULDER_Y = 32;
/** Bottom row of the torso: the belt line. Shoulder to waist is 15 px,
 *  Habbo's torso halved. */
const WAIST_Y = 46;
/** Bottom row of the shoes, with the ground shadow on the row below. Waist
 *  to sole is 8 px: short Habbo legs on 2 px flat shoes, halved. */
export const SOLE_Y = 54;
const SHOE_ROWS = 2;
/** A raised arm and a held-up form reach up to this row, clear of every
 *  hairstyle's tallest crown. */
const REACH_TOP_Y = 2;
/** Seated figures sit this many rows lower: standing legs carry the waist
 *  8 px above the sole, a chair seat is 6, so sitting drops it 2. */
export const SEAT_DROP = 2;
const LIMB_RADIUS = 1.5;
const HAND_RADIUS = 1.5;
const LEG_WIDTH = 5;

/** Shoulder width and leg length per build. The head never changes size. */
const BUILD_SHOULDERS: Record<Build, number> = {
  regular: 14,
  stocky: 16,
  slim: 12,
  short: 14,
  tall: 14,
};

export const BUILD_LEG_DELTA: Record<Build, number> = {
  regular: 0,
  stocky: 0,
  slim: 0,
  short: -2,
  tall: 2,
};

interface Torso {
  /** Leftmost and rightmost torso column of every row, top to bottom. */
  readonly rows: readonly (readonly [number, number])[];
  readonly top: number;
  readonly leftShoulder: Joint;
  readonly rightShoulder: Joint;
}

/** A block body under a block head: the torso is a straight-sided box, not
 *  a taper, with a 1 px shoulder cap at the top and the shirt hem stepped
 *  down the iso slope on its shaded (right) edge over the last 3 rows. */
function torsoShape(build: Build, top: number): Torso {
  const shoulders = BUILD_SHOULDERS[build];
  const height = WAIST_Y - SHOULDER_Y + 1;
  const left = BODY_CENTER_X - Math.floor(shoulders / 2);
  const right = left + shoulders - 1;
  const rows: [number, number][] = [];
  for (let i = 0; i < height; i++) {
    const capped = i === 0 ? left + 1 : left;
    const hemStep = Math.max(0, i - (height - 3));
    rows.push([capped, right - hemStep]);
  }
  return {
    rows,
    top,
    leftShoulder: [left + 1.5, top + 2.5],
    rightShoulder: [right - 0.5, top + 2.5],
  };
}

// ── Poses ───────────────────────────────────────────────────────

type LegPose = 'stand' | 'walkA' | 'walkB' | 'sit';

/** An arm as offsets from its shoulder joint. */
interface Arm {
  readonly elbow: Joint;
  readonly hand: Joint;
  /** Drawn before the torso, so only what pokes out at the side shows. */
  readonly behind?: boolean;
  /** Drawn after the head: an arm raised above it. */
  readonly raised?: boolean;
}

type Prop = 'sheet' | 'form';

interface BodyPose {
  readonly legs: LegPose;
  readonly left: Arm;
  readonly right: Arm;
  readonly prop?: Prop;
  /** Second-frame nudge of the held sheet, in px. */
  readonly nudge?: Joint;
}

const HANG_LEFT: Arm = { elbow: [-1, 4], hand: [-1, 8] };
const HANG_RIGHT: Arm = { elbow: [1, 4], hand: [1, 8] };
const LAP_LEFT: Arm = { elbow: [-1, 5], hand: [3, 7] };
const LAP_RIGHT: Arm = { elbow: [1, 5], hand: [-3, 7] };
const RAISE_LEFT: Arm = { elbow: [-4, -5], hand: [-6, -17], raised: true };
const RAISE_LEFT_WAVE: Arm = { elbow: [-3, -5], hand: [-4, -17], raised: true };
const FORM_RIGHT: Arm = { elbow: [4, -3], hand: [5, -10], raised: true };

/** Front-view arm and leg positions per frame. */
const FRONT_POSES: Record<CharacterFrame, BodyPose> = {
  walk1: {
    legs: 'walkA',
    left: { elbow: [-1, 4], hand: [-2, 8] },
    right: { elbow: [1, 4], hand: [2, 7] },
  },
  walk2: { legs: 'stand', left: HANG_LEFT, right: HANG_RIGHT },
  walk3: {
    legs: 'walkB',
    left: { elbow: [-1, 4], hand: [0, 7] },
    right: { elbow: [1, 4], hand: [0, 8] },
  },
  type1: {
    legs: 'sit',
    left: { elbow: [-1, 5], hand: [-4, 7] },
    right: { elbow: [1, 5], hand: [-5, 8] },
  },
  type2: {
    legs: 'sit',
    left: { elbow: [-1, 5], hand: [-4, 8] },
    right: { elbow: [1, 5], hand: [-5, 7] },
  },
  read1: {
    legs: 'sit',
    left: { elbow: [-1, 5], hand: [-3, 8] },
    right: { elbow: [1, 5], hand: [-6, 8] },
    prop: 'sheet',
  },
  read2: {
    legs: 'sit',
    left: { elbow: [-1, 5], hand: [-3, 9] },
    right: { elbow: [1, 5], hand: [-6, 9] },
    prop: 'sheet',
    nudge: [0, 1],
  },
  idle1: { legs: 'stand', left: HANG_LEFT, right: HANG_RIGHT },
  idle2: { legs: 'stand', left: HANG_LEFT, right: HANG_RIGHT },
  rest1: { legs: 'sit', left: LAP_LEFT, right: LAP_RIGHT },
  rest2: { legs: 'sit', left: LAP_LEFT, right: LAP_RIGHT },
  raiseHand1: { legs: 'stand', left: RAISE_LEFT, right: HANG_RIGHT },
  raiseHand2: { legs: 'stand', left: RAISE_LEFT_WAVE, right: HANG_RIGHT },
  raiseHandSeated1: { legs: 'sit', left: RAISE_LEFT, right: LAP_RIGHT },
  raiseHandSeated2: { legs: 'sit', left: RAISE_LEFT_WAVE, right: LAP_RIGHT },
  holdForm1: { legs: 'stand', left: HANG_LEFT, right: FORM_RIGHT, prop: 'form' },
  holdForm2: { legs: 'stand', left: HANG_LEFT, right: FORM_RIGHT, prop: 'form' },
  holdFormSeated1: { legs: 'sit', left: LAP_LEFT, right: FORM_RIGHT, prop: 'form' },
  holdFormSeated2: { legs: 'sit', left: LAP_LEFT, right: FORM_RIGHT, prop: 'form' },
};

const WORK_BACK_LEFT_1: Arm = { elbow: [-3, 4], hand: [1, 6], behind: true };
const WORK_BACK_RIGHT_1: Arm = { elbow: [3, 3], hand: [-1, 5], behind: true };
const WORK_BACK_LEFT_2: Arm = { elbow: [-3, 3], hand: [1, 5], behind: true };
const WORK_BACK_RIGHT_2: Arm = { elbow: [3, 4], hand: [-1, 6], behind: true };

/** From behind, working hands are hidden in front of the body and the
 *  elbows stick out at the sides. Hands in the lap and a reader's sheet
 *  are hidden too, so those arms hang. */
function backPose(frame: CharacterFrame): BodyPose {
  const front = FRONT_POSES[frame];
  switch (frame) {
    case 'type1':
    case 'read1':
      return { legs: 'sit', left: WORK_BACK_LEFT_1, right: WORK_BACK_RIGHT_1 };
    case 'type2':
    case 'read2':
      return { legs: 'sit', left: WORK_BACK_LEFT_2, right: WORK_BACK_RIGHT_2 };
    default:
      return {
        ...front,
        left: front.left === LAP_LEFT ? HANG_LEFT : front.left,
        right: front.right === LAP_RIGHT ? HANG_RIGHT : front.right,
      };
  }
}

export function isSeated(frame: CharacterFrame): boolean {
  return FRONT_POSES[frame].legs === 'sit';
}

// ── Drawing ─────────────────────────────────────────────────────

function legMask(
  canvas: LetterCanvas,
  hipY: number,
  left: number,
  ankle: Joint,
  soleY: number,
): { leg: Mask; shoe: Mask } {
  const leg = new Mask(canvas.width, canvas.height);
  const shoe = new Mask(canvas.width, canvas.height);
  const [ankleX] = ankle;
  const shoeTop = soleY - SHOE_ROWS + 1;
  for (let y = hipY; y < shoeTop; y++) {
    const t = (y - hipY) / Math.max(1, shoeTop - 1 - hipY);
    const x0 = Math.round(left + (ankleX - left) * t);
    leg.span(y, x0, x0 + LEG_WIDTH - 1);
  }
  const x0 = Math.round(ankleX);
  shoe.span(shoeTop, x0, x0 + LEG_WIDTH - 1);
  for (let y = shoeTop + 1; y <= soleY; y++) shoe.span(y, x0 - 1, x0 + LEG_WIDTH - 1);
  return { leg, shoe };
}

function drawStandingLegs(canvas: LetterCanvas, pose: LegPose, hipY: number, torso: Torso): void {
  const [waistLeft, waistRight] = torso.rows[torso.rows.length - 1];
  const leftX = waistLeft + 1;
  const rightX = waistRight - LEG_WIDTH;
  const lift = Math.min(2, Math.max(1, Math.floor((SOLE_Y - hipY) / 4)));
  const stride: Record<Exclude<LegPose, 'sit'>, [Joint, Joint]> = {
    stand: [
      [leftX, SOLE_Y],
      [rightX, SOLE_Y],
    ],
    walkA: [
      [leftX - 2, SOLE_Y],
      [rightX + 1, SOLE_Y - lift],
    ],
    walkB: [
      [leftX + 1, SOLE_Y - lift],
      [rightX - 1, SOLE_Y],
    ],
  };
  const [leftAnkle, rightAnkle] = stride[pose as Exclude<LegPose, 'sit'>];
  // The leg farther back is drawn first so the nearer one overlaps it.
  const legs = [
    { left: leftX, ankle: leftAnkle, near: true },
    { left: rightX, ankle: rightAnkle, near: false },
  ].sort((a, b) => a.ankle[1] - b.ankle[1] || (a.near ? 1 : -1));
  for (const { left, ankle, near } of legs) {
    const { leg, shoe } = legMask(canvas, hipY, left, ankle, ankle[1]);
    canvas.part(leg, (x, y) => {
      if (!leg.has(x + 1, y)) return 'P';
      return near ? 'p' : leg.has(x - 1, y) ? 'P' : 'p';
    });
    canvas.part(shoe, roundShade(shoe, 'f', 'f', 'F'));
  }
}

function drawSeatedLegs(canvas: LetterCanvas, facing: Facing, hipY: number, torso: Torso): void {
  const [waistLeft, waistRight] = torso.rows[torso.rows.length - 1];
  const thighs = new Mask(canvas.width, canvas.height);
  if (facing === 'back') {
    thighs.span(hipY, waistLeft, waistRight).span(hipY + 1, waistLeft, waistRight);
    canvas.part(thighs, (x, y) => (thighs.has(x + 2, y) ? 'p' : 'P'));
    return;
  }
  // Thighs are a chunky block at the hip's full width, coming toward the
  // viewer (shifting down-left) for 2 rows; the shins hang from their
  // leading edge, centred under the body, down to the visible shoes.
  // Habbo's short legs leave only a few rows once the hip sits at
  // chair-seat height.
  thighs.span(hipY, waistLeft, waistRight).span(hipY + 1, waistLeft - 2, waistRight - 2);
  canvas.part(thighs, (x, y) => (thighs.has(x + 2, y) ? 'p' : 'P'));
  const front = Math.round((waistLeft + waistRight) / 2) - 2;
  const shins = new Mask(canvas.width, canvas.height);
  const shoeTop = SOLE_Y - SHOE_ROWS + 1;
  for (let y = hipY + 2; y < shoeTop; y++) shins.span(y, front - 3, front + 2);
  canvas.part(shins, roundShade(shins, 'p', 'p', 'P'));
  const shoes = new Mask(canvas.width, canvas.height);
  shoes.span(shoeTop, front - 4, front + 3).span(SOLE_Y, front - 5, front + 3);
  canvas.part(shoes, roundShade(shoes, 'f', 'f', 'F'));
}

/** Lit band on the left, a dithered seam, the shaded band on the right. */
function torsoPaint(torso: Torso) {
  return (x: number, y: number): string => {
    const [left, right] = torso.rows[y - torso.top];
    const fromRight = right - x;
    if (fromRight <= 1) return 'k';
    if (fromRight === 2) return (x + y) % 2 === 0 ? 'k' : 'c';
    if (x - left <= 2) return 'C';
    return 'c';
  };
}

function drawNeck(canvas: LetterCanvas, top: number): void {
  const neck = new Mask(canvas.width, canvas.height);
  for (let y = top - 2; y <= top; y++) neck.span(y, BODY_CENTER_X - 2, BODY_CENTER_X + 1);
  canvas.fill(neck, (x) => (x >= BODY_CENTER_X + 1 ? 'S' : 's'));
}

function drawTorso(canvas: LetterCanvas, torso: Torso, outfit: OutfitCut, facing: Facing): void {
  const mask = new Mask(canvas.width, canvas.height);
  torso.rows.forEach(([left, right], i) => mask.span(torso.top + i, left, right));
  const openNeck = facing === 'front' && outfit !== 'turtleneck' && outfit !== 'hoodie';
  canvas.part(mask, torsoPaint(torso));
  if (openNeck) {
    for (let x = BODY_CENTER_X - 1; x <= BODY_CENTER_X; x++) canvas.set(x, torso.top, 's');
  }
  drawOutfit(canvas, torso, outfit, facing);
}

function drawOutfit(canvas: LetterCanvas, torso: Torso, outfit: OutfitCut, facing: Facing): void {
  const top = torso.top;
  const cx = BODY_CENTER_X;
  if (facing === 'back') {
    if (outfit === 'collarTie') canvas.stamp(['WWWWWW'], cx - 3, top);
    if (outfit === 'turtleneck') canvas.stamp(['cccc'], cx - 2, top - 1);
    if (outfit === 'hoodie') {
      canvas.stamp(['.oooooo.', 'ocCCCcko', 'occcccko', '.okkkko.'], cx - 4, top - 1);
    }
    return;
  }
  switch (outfit) {
    case 'collarTie':
      canvas.stamp(
        [
          'WW....WW',
          '.WWttWW.',
          '...tt...',
          '...tt...',
          '...tt...',
          '...tt...',
          '...tt...',
          '..tttt..',
          '...tt...',
        ],
        cx - 4,
        top,
      );
      break;
    case 'turtleneck':
      canvas.stamp(['.oooooo.', 'oCCCcckc', '.cccckk.'], cx - 4, top - 2);
      break;
    case 'vest':
      for (let y = top + 1; y <= WAIST_Y + (top - SHOULDER_Y) - 1; y++) {
        canvas.set(cx - 2, y, 'v');
        canvas.set(cx + 1, y, 'v');
      }
      canvas.stamp(['WW....WW', '.WW..WW.'], cx - 4, top);
      break;
    case 'hoodie':
      canvas.stamp(
        ['.oooooooo.', 'oCCCCccckc', '.ocCccckko', '...t..t...', '...t..t...', '...t..t...'],
        cx - 5,
        top - 2,
      );
      canvas.stamp(['oooooooo'], cx - 4, top + 9);
      break;
    case 'crewTee':
      canvas.stamp(['k....k', '.kkkk.'], cx - 3, top);
      break;
  }
}

function drawLanyard(canvas: LetterCanvas, top: number): void {
  const cx = BODY_CENTER_X;
  canvas.stamp(
    ['j....j', 'j....j', '.j..j.', '.j..j.', '.gggg.', '.gggg.', '.gggg.'],
    cx - 3,
    top + 1,
  );
}

function drawArm(canvas: LetterCanvas, shoulder: Joint, arm: Arm, sleeve: 'long' | 'short'): void {
  const [sx, sy] = shoulder;
  const elbow: Joint = [sx + arm.elbow[0], sy + arm.elbow[1]];
  const hand: Joint = [sx + arm.hand[0], sy + arm.hand[1]];
  const upper = new Mask(canvas.width, canvas.height).segment(shoulder, elbow, LIMB_RADIUS);
  const lower = new Mask(canvas.width, canvas.height).segment(elbow, hand, LIMB_RADIUS);
  const fist = new Mask(canvas.width, canvas.height).segment(hand, hand, HAND_RADIUS);
  const whole = new Mask(canvas.width, canvas.height);
  for (const m of [upper, lower, fist]) m.forEach((x, y) => whole.add(x, y));
  const cloth = roundShade(whole, 'C', 'c', 'k');
  const skin = roundShade(whole, 's', 's', 'S');
  canvas.part(whole, (x, y) => {
    if (fist.has(x, y)) return skin(x, y);
    if (sleeve === 'short' && lower.has(x, y) && !upper.has(x, y)) return skin(x, y);
    return cloth(x, y);
  });
}

/** The hand alone, drawn again over something the arm reaches behind. */
function drawHand(canvas: LetterCanvas, shoulder: Joint, arm: Arm): void {
  const hand: Joint = [shoulder[0] + arm.hand[0], shoulder[1] + arm.hand[1]];
  const fist = new Mask(canvas.width, canvas.height).segment(hand, hand, HAND_RADIUS);
  canvas.part(fist, roundShade(fist, 's', 's', 'S'));
}

function drawSheet(canvas: LetterCanvas, x0: number, y0: number): void {
  const sheet = new Mask(canvas.width, canvas.height);
  for (let y = y0; y < y0 + 8; y++) sheet.span(y, x0, x0 + 9);
  canvas.part(sheet, (x, y) =>
    (y - y0) % 2 === 1 && y < y0 + 7 && x > x0 && x < x0 + 8 ? 'l' : 'n',
  );
}

function drawForm(canvas: LetterCanvas, x0: number, y0: number): void {
  const form = new Mask(canvas.width, canvas.height);
  for (let y = y0; y < y0 + 11; y++) form.span(y, x0, x0 + 7);
  canvas.part(form, (x, y) => {
    const row = y - y0;
    const inner = x > x0 && x < x0 + 7;
    if (row >= 7 && row <= 8 && x > x0 + 1 && x < x0 + 6) return 'g';
    if ((row === 2 || row === 4) && inner) return 'l';
    return 'n';
  });
}

export interface BodySpec {
  readonly build: Build;
  readonly outfit: OutfitCut;
  readonly lanyard: boolean;
}

/**
 * Draws the body of one frame and returns the hooks the head is drawn
 * between: the head goes on after `drawBody` and before `drawRaised`, so
 * hair covers the shoulders and a raised arm or form covers the hair.
 */
export function drawBody(
  canvas: LetterCanvas,
  spec: BodySpec,
  facing: Facing,
  frame: CharacterFrame,
  upperShift: number,
): { drawRaised: () => void } {
  const pose = facing === 'front' ? FRONT_POSES[frame] : backPose(frame);
  const torso = torsoShape(spec.build, SHOULDER_Y + upperShift);
  const hipY = WAIST_Y + upperShift + 1;
  const sleeve = spec.outfit === 'crewTee' ? 'short' : 'long';
  const nudge = pose.nudge ?? [0, 0];
  const arms = [
    { shoulder: torso.leftShoulder, arm: pose.left },
    { shoulder: torso.rightShoulder, arm: pose.right },
  ];

  for (const { shoulder, arm } of arms) if (arm.behind) drawArm(canvas, shoulder, arm, sleeve);
  if (pose.legs === 'sit') drawSeatedLegs(canvas, facing, hipY, torso);
  else drawStandingLegs(canvas, pose.legs, hipY, torso);
  drawNeck(canvas, torso.top);
  drawTorso(canvas, torso, spec.outfit, facing);
  if (spec.lanyard && facing === 'front' && pose.prop === undefined) {
    drawLanyard(canvas, torso.top);
  }
  for (const { shoulder, arm } of arms) {
    if (!arm.behind && !arm.raised) drawArm(canvas, shoulder, arm, sleeve);
  }
  if (pose.prop === 'sheet' && facing === 'front') {
    const [lx, ly] = torso.leftShoulder;
    drawSheet(canvas, Math.floor(lx) - 4 + nudge[0], Math.floor(ly) + 2 + nudge[1]);
    for (const { shoulder, arm } of arms) drawHand(canvas, shoulder, arm);
  }

  return {
    drawRaised: () => {
      if (pose.prop === 'form') {
        const [rx, ry] = torso.rightShoulder;
        drawForm(canvas, Math.floor(rx) + 2, Math.max(REACH_TOP_Y, Math.floor(ry) - 24));
      }
      for (const { shoulder, arm } of arms) {
        if (arm.raised) drawArm(canvas, shoulder, arm, sleeve);
      }
    },
  };
}
