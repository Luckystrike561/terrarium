/**
 * Isometric office workers, hand-placed pixel templates.
 *
 * Sheet format (consumed by core/src/assets/pngDecoder.ts): 112×96, 7 frames
 * of 16×32 per row. Row 0 faces DOWN (+row, screen lower-left: 3/4 front),
 * row 1 faces UP (-row, screen upper-right: 3/4 back), row 2 faces RIGHT
 * (+col, screen lower-right) and is row 0 mirrored frame by frame. Frames:
 * walk1, walk2 (neutral), walk3, type1, type2, read1, read2. The feet touch
 * the bottom-center of the frame; seated frames sit on a chair seat 6 px up.
 *
 * A frame is layered from parts: legs, torso (arm pose), head, hair. Each
 * part is a template whose letters index the worker's palette, so six
 * workers share the poses and differ in hair style, skin and outfit.
 */

import type { RGBA } from './lib/image.js';
import { hex, PixelImage } from './lib/image.js';

const FRAME_W = 16;
const FRAME_H = 32;
const FRAMES = 7;
/** Seated figures sit this many rows lower than standing ones. */
const SEAT_DROP = 5;
const HEAD_Y = 3;
const TORSO_Y = 15;
const LEGS_Y = 23;

// Template letters: o outline, s/S skin/shade, e eye, b blush, C/c/k top
// light/base/shade, a collar accent, t centre strip (tie, zip, buttons),
// p/P trousers/shade, f shoe, w/l paper/ink, h/H/d hair base/light/dark.

const HEAD_FRONT = [
  '..oooooo..',
  '.osssssso.',
  'osssssssso',
  'osssssssso',
  'osssssssso',
  'osessessSo',
  'osessessSo',
  'obssssssSo',
  '.osssssSo.',
  '..oooooo..',
  '...oSSo...',
];

const HEAD_BACK = [
  '..oooooo..',
  '.osssssso.',
  'osssssssso',
  'osssssssso',
  'osssssssso',
  'osssssssso',
  'osssssssso',
  'osssssssSo',
  '.osssssSo.',
  '..oooooo..',
  '...oSSo...',
];

const TORSO_FRONT_IDLE = [
  '....oCCaakko....',
  '...oCCCatckko...',
  '..osoCCctckoSo..',
  '..osoCcctckoSo..',
  '..osoCcctckoSo..',
  '..ossoccckkoSo..',
  '...oooccckkooo..',
  '....occcckkko...',
];

const TORSO_FRONT_TYPE_1 = [
  '....oCCaakko....',
  '...oCCCatckko...',
  '..oCoCCctckoko..',
  '.oCCoCcctckoko..',
  'osssoCcctckoSso.',
  '.ooooccckkkooo..',
  '....occcckkko...',
];

const TORSO_FRONT_TYPE_2 = [
  '....oCCaakko....',
  '...oCCCatckko...',
  '..oCoCCctckoko..',
  '..oCoCcctckokko.',
  '.osssoccckkoSso.',
  '..oooocccckkoo..',
  '....occcckkko...',
];

const TORSO_FRONT_READ_1 = [
  '....oCCaakko....',
  '...oCCCatckko...',
  '..osoowwwwwoSo..',
  '..osowllllwoSo..',
  '..ossowllllwso..',
  '...ooowwwwwoo...',
  '....occcckkko...',
];

const TORSO_FRONT_READ_2 = [
  '....oCCaakko....',
  '...oCCCatckko...',
  '..osoCowwwwwoo..',
  '..osoowlllwwSo..',
  '..ossowwllllso..',
  '...ooooowwwwo...',
  '....occcckkko...',
];

const TORSO_BACK_IDLE = [
  '....oCCcckko....',
  '...oCCCcckkko...',
  '..oSoCCcckkoso..',
  '..oSoCcccckoso..',
  '..oSoCcccckoso..',
  '..oSSoccckkoso..',
  '..ooooccckkooo..',
  '....occcckkko...',
];

const TORSO_BACK_WORK_1 = [
  '....oCCcckko....',
  '...oCCCcckkko...',
  '..ooCCCcckkkoo..',
  '..oCoCcccckoko..',
  '..oCoCcccckoko..',
  '...ooccccckoo...',
  '....occcckkko...',
];

const TORSO_BACK_WORK_2 = [
  '....oCCcckko....',
  '...oCCCcckkko...',
  '..ooCCCcckkkoo..',
  '..oCoCcccckkoo..',
  '...oCoccccckoko.',
  '...ooccccckkoo..',
  '....occcckkko...',
];

const LEGS_STAND = [
  '....oppppPPPo...',
  '....opppoPPPo...',
  '....opppoPPPo...',
  '....opppoPPPo...',
  '....opppoPPPo...',
  '....opppoPPPo...',
  '...offfo.offfo..',
  '...offfo.offfo..',
  '....ooo...ooo...',
];

const LEGS_WALK_A = [
  '....oppppPPPo...',
  '....opppoPPPo...',
  '...opppo.oPPPo..',
  '...oppo..oPPPo..',
  '..opppo...oPPo..',
  '..oppo....oPPo..',
  '.offfo....offfo.',
  '.offfo....offfo.',
  '..ooo......ooo..',
];

const LEGS_WALK_B = [
  '....oppppPPPo...',
  '....opppoPPPo...',
  '....opppooPPPo..',
  '.....oppo.oPPPo.',
  '.....oppo..oPPo.',
  '....opppo..oPPo.',
  '...offfo...offfo',
  '...offfo...offfo',
  '....ooo.....ooo.',
];

/** Seated, facing lower-left: thighs run toward the viewer, shins hang. */
const LEGS_SIT_FRONT = [
  '...opppppPPPo...',
  '..oppppppPPPPo..',
  '.oppppooooooo...',
  '.opppo..........',
  'offfo...........',
];

/** Seated, facing away: only the seat of the trousers shows. */
const LEGS_SIT_BACK = ['....oPPPPPPPo...', '....oPPPPPPPPo..', '.....ooooooooo..'];

type HairStyle = 'short' | 'bob' | 'ponytail' | 'buzz' | 'curly' | 'bun';

/** Hair overlays over the head part, in head-local coordinates shifted so
 *  column 0 is frame column 1 (hair is 12 wide, the head 10). Rows start two
 *  above the head so tall styles have room. */
const HAIR: Record<HairStyle, { front: readonly string[]; back: readonly string[] }> = {
  short: {
    front: [
      '............',
      '............',
      '...oooooo...',
      '..oHHHhhho..',
      '.oHHhhhhhhoo',
      'ohhhhhhhhhdo',
      'ohhohhhhhhdo',
      'oo..ohhohhdo',
      '........ohdo',
      '........odo.',
      '.........o..',
    ],
    back: [
      '............',
      '............',
      '...oooooo...',
      '..oHHHhhho..',
      '.oHHhhhhhhoo',
      'ohHhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhhhhhdso',
      '.ohhhhhhddo.',
      '..ohhhhddo..',
      '...oooooo...',
    ],
  },
  bob: {
    front: [
      '............',
      '............',
      '..oooooooo..',
      '.oHHHHhhhho.',
      'oHHhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohoooohhohdo',
      'oh.......hdo',
      'oh.......hdo',
      'oh.......odo',
      '.o........o.',
    ],
    back: [
      '............',
      '............',
      '..oooooooo..',
      '.oHHHHhhhho.',
      'oHHhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhhhhhddo',
      '.oooooooooo.',
    ],
  },
  ponytail: {
    front: [
      '............',
      '............',
      '...oooooo...',
      '..oHHHhhho..',
      '.oHHhhhhhhoo',
      'ohhhhhhhhhdo',
      'ohhohhhhhhddo',
      'oo..ohhohhdhdo',
      '........ohdhdo',
      '........ododdo',
      '.........o.odo',
      '...........oo.',
    ],
    back: [
      '............',
      '............',
      '...oooooo...',
      '..oHHHhhho..',
      '.oHHhhhhhhoo',
      'ohHhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhdhhhdso',
      '.ohhhdhhddo.',
      '..ohhdhddo..',
      '...oodhdoo..',
      '.....odo....',
      '.....odo....',
      '......o.....',
    ],
  },
  buzz: {
    front: [
      '............',
      '............',
      '............',
      '...oooooo...',
      '..odddddo...',
      '.odhhhhhhdo.',
      '.odhhhhhhdo.',
      '.o.......do.',
    ],
    back: [
      '............',
      '............',
      '............',
      '...oooooo...',
      '..odddddo...',
      '.odhhhhhhdo.',
      '.odhhhhhhdo.',
      '.odhhhhhhdo.',
      '.odhhhhhhso.',
      '..odhhhhdo..',
    ],
  },
  curly: {
    front: [
      '...oooooo...',
      '..oHhHhhho..',
      '.oHhHhhhhhoo',
      'ohHhhhhhhhhdo',
      'ohhhhhhhhhhdo',
      'ohhhhhhhhhhdo',
      'ohhohhhhohhdo',
      'oo..oohho.ddo',
      '.........oddo',
      '.........ooo.',
    ],
    back: [
      '...oooooo...',
      '..oHhHhhho..',
      '.oHhHhhhhhoo',
      'ohHhhhhhhhhdo',
      'ohhhhhhhhhhdo',
      'ohhhhhhhhhhdo',
      'ohhhhhhhhhhdo',
      'ohhhhhhhhhhdo',
      'ohhhhhhhhhdso',
      '.ohhhhhhhddo.',
      '..ooooooooo..',
    ],
  },
  bun: {
    front: [
      '....oooo....',
      '...oHhhdo...',
      '...ohhhdo...',
      '..oooooooo..',
      '.oHHhhhhhhoo',
      'ohhhhhhhhhdo',
      'ohhohhhhhhdo',
      'oo..ohhhhhdo',
      '........ohdo',
      '.........oo.',
    ],
    back: [
      '....oooo....',
      '...oHhhdo...',
      '...ohhhdo...',
      '..oooooooo..',
      '.oHHhhhhhhoo',
      'ohHhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhhhhhhdo',
      'ohhhhhhhhdso',
      '.ohhhhhhddo.',
      '..oooooooo..',
    ],
  },
};

interface Worker {
  hair: HairStyle;
  colors: Record<string, string>;
}

const OUTLINE = '#1a1426';
const EYE = '#2a1e2e';
const PAPER = { w: '#f6f1e2', l: '#8a8496' };

const WORKERS: Worker[] = [
  {
    // Lab coat, teal collar.
    hair: 'short',
    colors: {
      s: '#f2c29b',
      S: '#d39773',
      b: '#e7a184',
      C: '#ffffff',
      c: '#eeeaf0',
      k: '#c4bfd0',
      a: '#3fb59f',
      t: '#eeeaf0',
      p: '#4a5a78',
      P: '#36405a',
      f: '#2e2630',
      h: '#8a5a36',
      H: '#b07a4a',
      d: '#5e3b24',
    },
  },
  {
    // Blue shirt and red tie.
    hair: 'buzz',
    colors: {
      s: '#c98f62',
      S: '#a46e48',
      b: '#b97a55',
      C: '#7fa6e0',
      c: '#5b84c6',
      k: '#41639e',
      a: '#e9eef7',
      t: '#c43d3d',
      p: '#2f3650',
      P: '#232839',
      f: '#1e1a22',
      h: '#2b2328',
      H: '#4a3e45',
      d: '#17121a',
    },
  },
  {
    // Red hoodie with drawstrings.
    hair: 'bob',
    colors: {
      s: '#f6d2b8',
      S: '#dca88a',
      b: '#eeaf98',
      C: '#e66a5c',
      c: '#c9463d',
      k: '#97302d',
      a: '#f2e3c8',
      t: '#97302d',
      p: '#3b3030',
      P: '#2a2222',
      f: '#3a2b26',
      h: '#e3893c',
      H: '#f4ad5c',
      d: '#b25f22',
    },
  },
  {
    // Green sweater.
    hair: 'curly',
    colors: {
      s: '#8a5a3c',
      S: '#6b432c',
      b: '#7a4c33',
      C: '#7cc08a',
      c: '#559a66',
      k: '#3b7149',
      a: '#d8e8c6',
      t: '#559a66',
      p: '#6d6560',
      P: '#544d49',
      f: '#2a2226',
      h: '#24191c',
      H: '#3c2b2f',
      d: '#120c0e',
    },
  },
  {
    // Grey cardigan over a red top.
    hair: 'bun',
    colors: {
      s: '#e9b892',
      S: '#c98f6c',
      b: '#de9a7c',
      C: '#b3aebd',
      c: '#8d889a',
      k: '#6b6679',
      a: '#cf4b4b',
      t: '#cf4b4b',
      p: '#3c3a48',
      P: '#2c2a36',
      f: '#2a2228',
      h: '#93432a',
      H: '#b8603f',
      d: '#682b1a',
    },
  },
  {
    // Mustard vest over a white shirt.
    hair: 'ponytail',
    colors: {
      s: '#dca47a',
      S: '#b97f58',
      b: '#cf8e69',
      C: '#f0c55a',
      c: '#d4a33c',
      k: '#a87b26',
      a: '#f7f3ea',
      t: '#f7f3ea',
      p: '#4d4560',
      P: '#3a3449',
      f: '#2b2330',
      h: '#5a3826',
      H: '#7d5238',
      d: '#3c2417',
    },
  },
];

function paletteOf(worker: Worker): Record<string, RGBA> {
  const pal: Record<string, RGBA> = {
    o: hex(OUTLINE),
    e: hex(EYE),
    w: hex(PAPER.w),
    l: hex(PAPER.l),
  };
  for (const [key, value] of Object.entries(worker.colors)) pal[key] = hex(value);
  return pal;
}

type Facing = 'front' | 'back';
type Pose = 'walkA' | 'stand' | 'walkB' | 'type1' | 'type2' | 'read1' | 'read2';
const POSES: readonly Pose[] = ['walkA', 'stand', 'walkB', 'type1', 'type2', 'read1', 'read2'];

function torsoFor(facing: Facing, pose: Pose): readonly string[] {
  if (facing === 'back') {
    if (pose === 'type1' || pose === 'read1') return TORSO_BACK_WORK_1;
    if (pose === 'type2' || pose === 'read2') return TORSO_BACK_WORK_2;
    return TORSO_BACK_IDLE;
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
    default:
      return TORSO_FRONT_IDLE;
  }
}

function legsFor(facing: Facing, pose: Pose): readonly string[] {
  if (pose === 'walkA') return LEGS_WALK_A;
  if (pose === 'walkB') return LEGS_WALK_B;
  if (pose === 'stand') return LEGS_STAND;
  return facing === 'front' ? LEGS_SIT_FRONT : LEGS_SIT_BACK;
}

function drawFrame(
  worker: Worker,
  pal: Record<string, RGBA>,
  facing: Facing,
  pose: Pose,
): PixelImage {
  const img = new PixelImage(FRAME_W, FRAME_H);
  const seated = !POSES.slice(0, 3).includes(pose);
  const drop = seated ? SEAT_DROP : 0;
  // A small bob: walking frames lift the upper body one pixel.
  const bob = pose === 'walkA' || pose === 'walkB' ? -1 : 0;
  const legs = legsFor(facing, pose);
  const legsY = seated ? LEGS_Y + SEAT_DROP + (torsoFor(facing, pose).length - 8) : LEGS_Y;
  img.stamp(legs, pal, 0, legsY);
  img.stamp(torsoFor(facing, pose), pal, 0, TORSO_Y + drop + bob);
  img.stamp(facing === 'front' ? HEAD_FRONT : HEAD_BACK, pal, 3, HEAD_Y + 1 + drop + bob);
  img.stamp(HAIR[worker.hair][facing], pal, 2, HEAD_Y - 2 + drop + bob);
  return img;
}

export function renderCharacterSheets(): PixelImage[] {
  return WORKERS.map((worker) => {
    const pal = paletteOf(worker);
    const sheet = new PixelImage(FRAME_W * FRAMES, FRAME_H * 3);
    POSES.forEach((pose, i) => {
      const front = drawFrame(worker, pal, 'front', pose);
      sheet.blit(front, i * FRAME_W, 0);
      sheet.blit(drawFrame(worker, pal, 'back', pose), i * FRAME_W, FRAME_H);
      sheet.blit(front.mirrored(), i * FRAME_W, FRAME_H * 2);
    });
    return sheet;
  });
}
