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
import type { RGBA } from '../lib/image.js';
import { PixelImage } from '../lib/image.js';
import type { Build, OutfitCut } from './outfits.js';

export type Facing = 'front' | 'back';

/** Letter for empty pixels, as in the head and hair templates. */
const EMPTY = '.';
const INK = 'o';

export class LetterCanvas {
  private readonly cells: string[];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cells = new Array<string>(width * height).fill(EMPTY);
  }

  get(x: number, y: number): string {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return EMPTY;
    return this.cells[y * this.width + x];
  }

  set(x: number, y: number, letter: string): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cells[y * this.width + x] = letter;
  }

  /** Fill every mask pixel with the letter `paint` picks for it. */
  fill(mask: Mask, paint: (x: number, y: number) => string): void {
    mask.forEach((x, y) => this.set(x, y, paint(x, y)));
  }

  /** Ink every pixel outside the mask that touches it edge to edge. */
  ring(mask: Mask): void {
    mask.forEach((x, y) => {
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (!mask.has(nx, ny)) this.set(nx, ny, INK);
      }
    });
  }

  /** Fill, then outline: one opaque, inked part. */
  part(mask: Mask, paint: (x: number, y: number) => string): void {
    this.fill(mask, paint);
    this.ring(mask);
  }

  /** Draw a letter template; `.` and space stay untouched. */
  stamp(rows: readonly string[], dx: number, dy: number): void {
    rows.forEach((row, y) => {
      [...row].forEach((letter, x) => {
        if (letter !== '.' && letter !== ' ') this.set(dx + x, dy + y, letter);
      });
    });
  }

  toImage(palette: Record<string, RGBA>): PixelImage {
    const img = new PixelImage(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const letter = this.get(x, y);
        if (letter === EMPTY) continue;
        const color = palette[letter];
        if (!color) throw new Error(`character palette has no colour for '${letter}'`);
        img.set(x, y, color);
      }
    }
    return img;
  }
}

/** A set of frame pixels. */
class Mask {
  private readonly pixels = new Set<number>();

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  has(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.pixels.has(y * this.width + x);
  }

  add(x: number, y: number): this {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.pixels.add(y * this.width + x);
    return this;
  }

  /** Pixels x0..x1 (inclusive) of row y. */
  span(y: number, x0: number, x1: number): this {
    for (let x = x0; x <= x1; x++) this.add(x, y);
    return this;
  }

  /** Pixels whose centre lies within `radius` of the segment a→b. */
  segment(a: Joint, b: Joint, radius: number): this {
    const [ax, ay] = a;
    const [bx, by] = b;
    const minX = Math.floor(Math.min(ax, bx) - radius);
    const maxX = Math.ceil(Math.max(ax, bx) + radius);
    const minY = Math.floor(Math.min(ay, by) - radius);
    const maxY = Math.ceil(Math.max(ay, by) + radius);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
        const ex = px - (ax + t * dx);
        const ey = py - (ay + t * dy);
        if (ex * ex + ey * ey <= radius * radius + 1e-9) this.add(x, y);
      }
    }
    return this;
  }

  forEach(visit: (x: number, y: number) => void): void {
    for (const i of [...this.pixels].sort((p, q) => p - q)) {
      visit(i % this.width, Math.floor(i / this.width));
    }
  }
}

/** A pixel-centre position in the frame. */
type Joint = readonly [number, number];

// ── Skeleton ────────────────────────────────────────────────────

/** Horizontal centre of the figure: the seam between pixels 15 and 16. */
export const BODY_CENTER_X = 16;
/** Top row of the shoulders. The chin of the head template sits on the row above. */
export const SHOULDER_Y = 26;
/** Bottom row of the torso: the belt line. */
const WAIST_Y = 39;
/** Bottom row of the shoes, with the ground shadow on the row below. */
export const SOLE_Y = 54;
const SHOE_ROWS = 3;
/** A raised arm and a held-up form reach up to this row, above every hairstyle. */
const REACH_TOP_Y = 2;
/** Seated figures sit this many rows lower, so the belt rests on a chair seat 6 px high. */
export const SEAT_DROP = 11;
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

function torsoShape(build: Build, top: number): Torso {
  const shoulders = BUILD_SHOULDERS[build];
  const height = WAIST_Y - SHOULDER_Y + 1;
  const rows: [number, number][] = [];
  for (let i = 0; i < height; i++) {
    const width =
      i === 0 ? shoulders - 4 : Math.round(shoulders - (2 * (i - 1)) / Math.max(1, height - 2));
    const left = BODY_CENTER_X - Math.floor(width / 2);
    rows.push([left, left + width - 1]);
  }
  const [left, right] = rows[1];
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

const HANG_LEFT: Arm = { elbow: [-1, 5], hand: [-1, 10] };
const HANG_RIGHT: Arm = { elbow: [1, 5], hand: [1, 10] };
const LAP_LEFT: Arm = { elbow: [-1, 6], hand: [4, 10] };
const LAP_RIGHT: Arm = { elbow: [1, 6], hand: [-4, 10] };
const RAISE_LEFT: Arm = { elbow: [-4, -6], hand: [-6, -19], raised: true };
const RAISE_LEFT_WAVE: Arm = { elbow: [-3, -6], hand: [-4, -19], raised: true };
const FORM_RIGHT: Arm = { elbow: [4, -4], hand: [5, -11], raised: true };

/** Front-view arm and leg positions per frame. */
const FRONT_POSES: Record<CharacterFrame, BodyPose> = {
  walk1: {
    legs: 'walkA',
    left: { elbow: [-1, 5], hand: [-2, 10] },
    right: { elbow: [1, 5], hand: [2, 9] },
  },
  walk2: { legs: 'stand', left: HANG_LEFT, right: HANG_RIGHT },
  walk3: {
    legs: 'walkB',
    left: { elbow: [-1, 5], hand: [0, 9] },
    right: { elbow: [1, 5], hand: [0, 10] },
  },
  type1: {
    legs: 'sit',
    left: { elbow: [-1, 6], hand: [-4, 8] },
    right: { elbow: [1, 6], hand: [-5, 9] },
  },
  type2: {
    legs: 'sit',
    left: { elbow: [-1, 6], hand: [-4, 9] },
    right: { elbow: [1, 6], hand: [-5, 8] },
  },
  read1: {
    legs: 'sit',
    left: { elbow: [-1, 6], hand: [-3, 9] },
    right: { elbow: [1, 6], hand: [-6, 9] },
    prop: 'sheet',
  },
  read2: {
    legs: 'sit',
    left: { elbow: [-1, 6], hand: [-3, 10] },
    right: { elbow: [1, 6], hand: [-6, 10] },
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

const WORK_BACK_LEFT_1: Arm = { elbow: [-3, 5], hand: [1, 7], behind: true };
const WORK_BACK_RIGHT_1: Arm = { elbow: [3, 4], hand: [-1, 6], behind: true };
const WORK_BACK_LEFT_2: Arm = { elbow: [-3, 4], hand: [1, 6], behind: true };
const WORK_BACK_RIGHT_2: Arm = { elbow: [3, 5], hand: [-1, 7], behind: true };

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

/** Lit left edge, shaded right edge, base in between: a limb or a shoe. */
function roundShade(mask: Mask, light: string, base: string, dark: string) {
  return (x: number, y: number): string => {
    if (!mask.has(x + 1, y)) return dark;
    if (!mask.has(x - 1, y)) return light;
    return base;
  };
}

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
  const stride: Record<Exclude<LegPose, 'sit'>, [Joint, Joint]> = {
    stand: [
      [leftX, SOLE_Y],
      [rightX, SOLE_Y],
    ],
    walkA: [
      [leftX - 3, SOLE_Y],
      [rightX + 2, SOLE_Y - 2],
    ],
    walkB: [
      [leftX + 2, SOLE_Y - 2],
      [rightX - 2, SOLE_Y],
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
  // Thighs run toward the viewer (screen lower left), the shins hang down.
  thighs
    .span(hipY, waistLeft, waistRight)
    .span(hipY + 1, waistLeft - 2, waistRight - 1)
    .span(hipY + 2, waistLeft - 4, waistRight - 5);
  const shins = new Mask(canvas.width, canvas.height);
  for (let y = hipY + 3; y < canvas.height; y++) shins.span(y, waistLeft - 4, waistLeft);
  canvas.part(shins, roundShade(shins, 'p', 'p', 'P'));
  canvas.part(thighs, (x, y) => (thighs.has(x + 2, y) ? 'p' : 'P'));
  const shoes = new Mask(canvas.width, canvas.height);
  shoes
    .span(canvas.height - 2, waistLeft - 5, waistLeft)
    .span(canvas.height - 1, waistLeft - 6, waistLeft);
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
