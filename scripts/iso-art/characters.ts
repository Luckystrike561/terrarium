/**
 * Isometric office workers, hand-placed pixel templates in a chunky
 * RPG style: bold dark outline, big heads with spiky volume, 3/4 view.
 *
 * Sheet format (consumed by core/src/assets/pngDecoder.ts): 7 frames of
 * CHAR_FRAME_W × CHAR_FRAME_H per row, 3 rows. Row 0 faces DOWN (+row,
 * screen lower-left: 3/4 front), row 1 faces UP (-row, screen upper-right:
 * 3/4 back), row 2 faces RIGHT (+col, screen lower-right) and is row 0
 * mirrored frame by frame. Frames: walk1, walk2 (neutral), walk3, type1,
 * type2, read1, read2. The feet touch the bottom-center of the frame; seated
 * frames sit on a chair seat 6 px up.
 *
 * A frame is layered from parts: legs, torso (arm pose), face, hair. Each part
 * is a template whose letters index the worker's palette, so six workers share
 * the poses and differ in hair style, skin and outfit.
 */

import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
} from '../../core/src/assets/constants.js';
import type { RGBA } from './lib/image.js';
import { hex, PixelImage } from './lib/image.js';

/** Seated figures sit this many rows lower than standing ones. */
const SEAT_DROP = 7;
const TORSO_Y = 17;
const LEGS_Y = 29;

// Template letters: o outline, s/S/r skin light/shade/deep, w eye white,
// e pupil, C/c/k top light/base/shade, W collar, t centre detail (tie, zip),
// p/P trousers light/shade, f/F shoe light/shade, h/H/d hair base/light/dark,
// n paper, l paper ink, x ground shadow.

const FACE_FRONT = [
  '........................',
  '........................',
  '........................',
  '........................',
  '.......oooooooo.........',
  '.....oossssssssoo.......',
  '....ossssssssssssoo.....',
  '...ossssssssssssssSo....',
  '...osssssssssssssSSo....',
  '...ossssssssssssssSSo...',
  '...osssssssssssssSSSo...',
  '...osssssssssssssSSSo...',
  '....oswesssweSssssSro...',
  '....osweSssweSsssSSro...',
  '....osssssssssssSSSo....',
  '....osssssrrssssSSSo....',
  '.....ossssssssSSSo......',
  '......ooossssSSoo.......',
];

const FACE_BACK = [
  '........................',
  '........................',
  '........................',
  '........................',
  '.........oooooooo.......',
  '.......oossssssssoo.....',
  '.....oossssssssssssoo...',
  '....osssssssssssssssSo..',
  '....osssssssssssssssSo..',
  '....ossssssssssssssSSo..',
  '....ossssssssssssssSSo..',
  '....ossssssssssssssSSo..',
  '....ossssssssssssssSSo..',
  '.....osssssssssssssSo...',
  '.....ossssssssssssSSo...',
  '......osssssssssssSo....',
  '.......ossssssssSSo.....',
  '........oooossSSoo......',
];

type HairStyle = 'spiky' | 'bob' | 'buzz' | 'ponytail' | 'bun' | 'curly';

const HAIR: Record<HairStyle, { front: readonly string[]; back: readonly string[] }> = {
  spiky: {
    front: [
      '..........o.............',
      '.......o.oho.oo.........',
      '......ohoohhohho........',
      '.....ohHHhhhhhhhoo......',
      '....ohHHHHhhhhhhhdo.....',
      '...ohhHHhhhhhhhhhhdo....',
      '..oohhhhhhhhhhhhhhddo...',
      '...ohhhhhhhhhhhhhhhddo..',
      '..ohhhhohhhhohhhhhhddo..',
      '..oohho..oh..hhhhhdddo..',
      '...oho.........hh.ddo...',
      '...oh.............do....',
    ],
    back: [
      '............o...........',
      '.........o.oho.oo.......',
      '........ohoohhohho......',
      '.......ohHHhhhhhhhoo....',
      '......ohHHhhhhhhhhhdo...',
      '.....ohHHhhhhhhhhhhhdo..',
      '....oohhhhhhhhhhhhhhddo.',
      '....ohhhhhhhhhhhhhhhhdo.',
      '....ohhhhhhhhhhhhhhhhddo',
      '....ohhhhhhhhhhhhhhhddo.',
      '....ohhhhhhhhhhhhhhhddo.',
      '....ohhhhhhhhhhhhhhdddo.',
      '....ohhhhhhhhhhhhhhddo..',
      '.....ohhhhohhhhhohddo...',
      '.....oho..o.hho.oddo....',
    ],
  },
  bob: {
    front: [
      '........................',
      '........................',
      '.........oooooo.........',
      '......oooHHHhhhoo.......',
      '.....oHHHHHhhhhhhoo.....',
      '....oHHHhhhhhhhhhhdo....',
      '...ohhhhhhhhhhhhhhhdo...',
      '...ohhhhhhhhhhhhhhhddo..',
      '..ohhhhhhhhhhhhhhhhddo..',
      '..ohhhoooooohhhhhhdddo..',
      '..ohho......ohhhhhdddo..',
      '..ohho........hhh.dddo..',
      '..ohho............dddo..',
      '..ohho............dddo..',
      '..ohdo............dddo..',
      '..oddo............oddo..',
      '...oo..............oo...',
    ],
    back: [
      '........................',
      '........................',
      '...........oooooo.......',
      '........oooHHHhhhoo.....',
      '.......oHHHHHhhhhhhoo...',
      '......oHHHhhhhhhhhhhdo..',
      '.....ohhhhhhhhhhhhhhhdo.',
      '....ohhhhhhhhhhhhhhhhddo',
      '....ohhhhhhhhhhhhhhhhddo',
      '....ohhhhhhhhhhhhhhhhddo',
      '....ohhhhhhhhhhhhhhhhddo',
      '....ohhhhhhhhhhhhhhhdddo',
      '....ohhhhhhhhhhhhhhhdddo',
      '....ohhhhhhhhhhhhhhhdddo',
      '....ohddhhhhhhhhhhhddddo',
      '....oddddddddddddddddddo',
      '.....oooooooooooooooooo.',
    ],
  },
  buzz: {
    front: [
      '........................',
      '........................',
      '........................',
      '........................',
      '.......oooooooo.........',
      '.....oohhhhhhhhoo.......',
      '....ohhHhhhhhhhhhoo.....',
      '...ohhhhhhhhhhhhhhdo....',
      '...ohhhhhhhhhhhhhhddo...',
      '...ohoooooooohhhhhddo...',
      '...oo.........hh.ddo....',
    ],
    back: [
      '........................',
      '........................',
      '........................',
      '........................',
      '.........oooooooo.......',
      '.......oohhhhhhhhoo.....',
      '.....oohhHhhhhhhhhhoo...',
      '....ohhhhhhhhhhhhhhhdo..',
      '....ohhhhhhhhhhhhhhhdo..',
      '....ohhhhhhhhhhhhhhddo..',
      '....ohhhhhhhhhhhhhhddo..',
      '....ohhhhhhhhhhhhhhddo..',
      '....oohhhhhhhhhhhhhddo..',
      '.....oohhhhhhhhhhhddo...',
    ],
  },
  ponytail: {
    front: [
      '........................',
      '........................',
      '.........oooooo.........',
      '......oooHHHhhhoo.......',
      '.....oHHHHHhhhhhhoo.....',
      '....oHHHhhhhhhhhhhdo....',
      '...ohhhhhhhhhhhhhhhdoo..',
      '...ohhhhhhhhhhhhhhhddhdo',
      '..ohhhhhhhhhhhhhhhhddhdo',
      '..ohhhooohhhoohhhhdddhdo',
      '...oo....oo....hhhddohdo',
      '...............hh.do.ohdo',
      '...................o.ohdo',
      '......................odo',
      '......................oo.',
    ],
    back: [
      '........................',
      '........................',
      '...........oooooo.......',
      '........oooHHHhhhoo.....',
      '.......oHHHHHhhhhhhoo...',
      '......oHHHhhhhhhhhhhdo..',
      '.....ohhhhhhhhhhhhhhhdo.',
      '....ohhhhhhhhhhhhhhhhddo',
      '....ohhhhhhhhhhhhhhhhddo',
      '....ohhhhhhhhhhhhhhhhddo',
      '....ohhhhhhhhhhhhhhhdddo',
      '.....ohhhhhhhhhhhhhhddo.',
      '......ohhhhhddhhhhhddo..',
      '.......oohhdoodhhhdoo...',
      '.........oodhhdooo......',
      '..........ohhhdo........',
      '..........ohhddo........',
      '...........ohdo.........',
      '...........ooo..........',
    ],
  },
  bun: {
    front: [
      '..........oooo..........',
      '.........oHhhdo.........',
      '.........ohhhdo.........',
      '......oooooooooo........',
      '.....oHHHHHhhhhhoo......',
      '....oHHHhhhhhhhhhhdo....',
      '...ohhhhhhhhhhhhhhhdo...',
      '...ohhhhhhhhhhhhhhhddo..',
      '..ohhhhhhhhhhhhhhhhddo..',
      '..ohhooohhhhoohhhhhdddo.',
      '...oo...ooo....hhhhddo..',
      '...............hh..do...',
    ],
    back: [
      '............oooo........',
      '...........oHhhdo.......',
      '...........ohhhdo.......',
      '........oooooooooo......',
      '.......oHHHHHhhhhhoo....',
      '......oHHHhhhhhhhhhhdo..',
      '.....ohhhhhhhhhhhhhhhdo.',
      '....ohhhhhhhhhhhhhhhhddo',
      '....ohhhhhhhhhhhhhhhhddo',
      '....ohhhhhhhhhhhhhhhhddo',
      '....ohhhhhhhhhhhhhhhdddo',
      '.....ohhhhhhhhhhhhhhddo.',
      '.....ohhhhhhhhhhhhhhddo.',
      '......oohhhhhhhhhhhdoo..',
      '........oooooooooooo....',
    ],
  },
  curly: {
    front: [
      '......oo.ooo.oo.........',
      '....oohhohhhohhoo.......',
      '...ohHHhhHHhhHhhhoo.....',
      '..ohHHhhHHhhhhhhhhhdo...',
      '..ohhhhhhhhhhhhhhhhhdo..',
      '.ohhhhhhhhhhhhhhhhhhddo.',
      '.ohhhhhhhhhhhhhhhhhhddo.',
      '.ohhhhhhhhhhhhhhhhhhddo.',
      '.ohhhohhhohhhohhhhhdddo.',
      '..ohho.oo.ooo.ohhhhddo..',
      '..oho..........hhh.ddo..',
      '...o...............do...',
    ],
    back: [
      '........oo.ooo.oo.......',
      '......oohhohhhohhoo.....',
      '.....ohHHhhHHhhHhhhoo...',
      '....ohHHhhHHhhhhhhhhhdo.',
      '....ohhhhhhhhhhhhhhhhhdo',
      '...ohhhhhhhhhhhhhhhhhhdo',
      '...ohhhhhhhhhhhhhhhhhhdo',
      '...ohhhhhhhhhhhhhhhhhddo',
      '...ohhhhhhhhhhhhhhhhhddo',
      '...ohhhhhhhhhhhhhhhhhddo',
      '...ohhhhhhhhhhhhhhhhdddo',
      '....ohhhhhhhhhhhhhhhddo.',
      '....ohhhohhhhohhhhohddo.',
      '.....oho.ohho.oohho.oo..',
      '......o...oo....oo......',
    ],
  },
};

const TORSO_FRONT_IDLE = [
  '.........osssSo.........',
  '.......ooWWsSWWoo.......',
  '.....ooCCCWWtWckkoo.....',
  '....osoCCCCcctcckkoo....',
  '...ossoCCCCcctccckoso...',
  '...ossoCCCcccctcckoSso..',
  '...ossoCCCcccctcckoSSo..',
  '...osooCCccccctcckoSSo..',
  '...ossoCCcccccccckoSSo..',
  '...osssoCccccccckkoSSo..',
  '...osssoooooooooooosSso.',
  '....ooo.oppppppPPPoooo..',
];

const TORSO_FRONT_TYPE_1 = [
  '.........osssSo.........',
  '.......ooWWsSWWoo.......',
  '.....ooCCCWWtWckkoo.....',
  '....oCoCCCCcctcckkoo....',
  '...oCCoCCCCcctccckoko...',
  '..oCCoCCCcccctccckokko..',
  '.oCCooCCCcccctcckokkko..',
  'ossooCCCccccctcckoSSso..',
  'osssooCCcccccccckoSsso..',
  '.ooooCCcccccccckkooooo..',
  '....oooooooooooooo......',
  '....ooo.oppppppPPPo.....',
];

const TORSO_FRONT_TYPE_2 = [
  '.........osssSo.........',
  '.......ooWWsSWWoo.......',
  '.....ooCCCWWtWckkoo.....',
  '....oCoCCCCcctcckkoo....',
  '...oCCoCCCCcctccckoko...',
  '...oCCoCCcccctccckokko..',
  '..oCCooCCcccctcckokkko..',
  '.osssoCCCccccctcoSSso...',
  '.ossssoCCcccccckoSsso...',
  '..ooooCCcccccckkoooo....',
  '....oooooooooooooo......',
  '....ooo.oppppppPPPo.....',
];

const TORSO_FRONT_READ_1 = [
  '.........osssSo.........',
  '.......ooWWsSWWoo.......',
  '.....ooCCCWWtWckkoo.....',
  '....osoCCCCcctcckkoo....',
  '...ossoCCoooooooooko....',
  '...ossoCConnnnnnnnoko...',
  '...ossoCConlllllnnokko..',
  '...osooooonnnnnnnnoSSo..',
  '...osssssonlllllnnosso..',
  '...oossssonnnnnnnnossso.',
  '....ooooooooooooooooo...',
  '....ooo.oppppppPPPo.....',
];

const TORSO_FRONT_READ_2 = [
  '.........osssSo.........',
  '.......ooWWsSWWoo.......',
  '.....ooCCCWWtWckkoo.....',
  '....osoCCCCcctcckkoo....',
  '...ossoCCCoooooooooo....',
  '...ossoCCConnnnnnnnoko..',
  '...ossoCCConllllnnnokko.',
  '...osooooooonnnnnnnoSSo.',
  '...osssssssonllllnnosso.',
  '...oosssssssonnnnnnnosso',
  '....oooooooooooooooooo..',
  '....ooo.oppppppPPPo.....',
];

const TORSO_BACK_IDLE = [
  '...........osSSo........',
  '.........ooCCcckoo......',
  '.......ooCCCcccckkoo....',
  '.....oosoCCCcccccckkoo..',
  '....ossoCCCcccccccckkso.',
  '....ossoCCCcccccccckoSso',
  '....ossoCCcccccccccckoSo',
  '....osooCCcccccccccckoSo',
  '....ossoCCcccccccccckoSo',
  '....ossoCcccccccccckkoSo',
  '....osssoooooooooooooSso',
  '.....oooooppppppPPPPoo..',
];

const TORSO_BACK_WORK_1 = [
  '...........osSSo........',
  '.........ooCCcckoo......',
  '.......ooCCCcccckkoo....',
  '.....oooCCCCcccccckkoo..',
  '....oCCoCCCcccccccckkoo.',
  '....oCCoCCCccccccccckkko',
  '....oCCoCCcccccccccckkko',
  '....oCooCCccccccccccokko',
  '.....ooCCCcccccccccckoo.',
  '......oCCccccccccckkko..',
  '......ooooooooooooooo...',
  '.......ooppppppPPPPo....',
];

const TORSO_BACK_WORK_2 = [
  '...........osSSo........',
  '.........ooCCcckoo......',
  '.......ooCCCcccckkoo....',
  '.....oooCCCCcccccckkoo..',
  '....oCCoCCCcccccccckkoo.',
  '....oCCoCCCccccccccckkko',
  '.....oCoCCcccccccccckkko',
  '.....oooCCccccccccccokko',
  '......oCCCcccccccccckoo.',
  '......oCCccccccccckkko..',
  '......ooooooooooooooo...',
  '.......ooppppppPPPPo....',
];

const LEGS_STAND = [
  '........opppppoPPPo.....',
  '........opppppoPPPo.....',
  '........oppppo.oPPPo....',
  '........oppppo.oPPPo....',
  '........oppppo.oPPPo....',
  '........oppppo.oPPPo....',
  '.......offffo..offFo....',
  '......offfffo..ofFFFo...',
  '......oFFFFo...oFFFFo...',
  '.......oooo.....oooo....',
  '.......xxxxxxxxxxxx.....',
];

const LEGS_WALK_A = [
  '........opppppoPPPo.....',
  '.......opppppo.oPPPo....',
  '.......oppppo...oPPPo...',
  '......oppppo....oPPPo...',
  '......opppo.....oPPPo...',
  '.....opppo......oPPPo...',
  '....offffo......offFo...',
  '...offfffo......ofFFFo..',
  '...oFFFFo.......oFFFFo..',
  '....oooo.........oooo...',
  '.....xxxxxxxxxxxxxxx....',
];

const LEGS_WALK_B = [
  '........opppppoPPPo.....',
  '........oppppo.oPPPPo...',
  '.........opppo..oPPPo...',
  '.........opppo..oPPPPo..',
  '.........oppppo..oPPPo..',
  '.........oppppo..oPPPo..',
  '........offffo...offFFo.',
  '.......offfffo...ofFFFo.',
  '.......oFFFFo....oFFFFo.',
  '........oooo......oooo..',
  '........xxxxxxxxxxxxx...',
];

/** Seated, facing lower-left: thighs run toward the viewer, shins hang. */
const LEGS_SIT_FRONT = [
  '......opppppppPPPPo.....',
  '....opppppppppPPPPo.....',
  '...oppppppooooooooo.....',
  '..opppppo...............',
  '..oppppo................',
  '.offffo.................',
  'offfffo.................',
  'oFFFFo..................',
  '.oooo...................',
];

/** Seated, facing away: the seat of the trousers and the heels show. */
const LEGS_SIT_BACK = [
  '.......opppppppPPPPPo...',
  '.......oppppppppPPPPPo..',
  '........ooooooooooooo...',
];

interface Worker {
  hair: HairStyle;
  colors: Record<string, string>;
}

const OUTLINE = '#14101c';
const EYE_WHITE = '#f4f0ea';
const PUPIL = '#2a1e1a';
const PAPER = { n: '#f6f1e2', l: '#8a8496' };
const SHADOW = '#00000040';

const WORKERS: Worker[] = [
  {
    hair: 'spiky',
    colors: {
      s: '#f7c79c',
      S: '#d9946b',
      r: '#b8714f',
      C: '#ffffff',
      c: '#e9e6ee',
      k: '#bdb8c8',
      W: '#ffffff',
      t: '#3fb59f',
      p: '#4a5a78',
      P: '#36405a',
      f: '#7a4a2c',
      F: '#55311c',
      h: '#8a5532',
      H: '#b07444',
      d: '#5e361f',
    },
  },
  {
    hair: 'buzz',
    colors: {
      s: '#c98f62',
      S: '#a46e48',
      r: '#87553a',
      C: '#86aee6',
      c: '#5b84c6',
      k: '#41639e',
      W: '#eef2fa',
      t: '#c43d3d',
      p: '#2f3650',
      P: '#232839',
      f: '#2a2226',
      F: '#17121a',
      h: '#2b2328',
      H: '#4a3e45',
      d: '#17121a',
    },
  },
  {
    hair: 'bob',
    colors: {
      s: '#fbd9c0',
      S: '#e0aa8a',
      r: '#c4876a',
      C: '#ef7466',
      c: '#cf4a40',
      k: '#99302c',
      W: '#f6e8d0',
      t: '#99302c',
      p: '#3b3030',
      P: '#2a2222',
      f: '#3a2b26',
      F: '#241a16',
      h: '#e88a38',
      H: '#f8b260',
      d: '#b25f22',
    },
  },
  {
    hair: 'curly',
    colors: {
      s: '#8a5a3c',
      S: '#6b432c',
      r: '#55331f',
      C: '#82c690',
      c: '#559a66',
      k: '#3b7149',
      W: '#d8e8c6',
      t: '#3b7149',
      p: '#6d6560',
      P: '#544d49',
      f: '#4a3a30',
      F: '#2e241e',
      h: '#2a1c1f',
      H: '#4a3438',
      d: '#140c0e',
    },
  },
  {
    hair: 'bun',
    colors: {
      s: '#efbd96',
      S: '#cf926c',
      r: '#b07352',
      C: '#bcb7c6',
      c: '#8d889a',
      k: '#6b6679',
      W: '#e05656',
      t: '#e05656',
      p: '#3c3a48',
      P: '#2c2a36',
      f: '#5a2e2e',
      F: '#3a1c1c',
      h: '#9a4428',
      H: '#c46a44',
      d: '#682b1a',
    },
  },
  {
    hair: 'ponytail',
    colors: {
      s: '#e0a87c',
      S: '#bd8058',
      r: '#9e6545',
      C: '#f5cc60',
      c: '#d9a63c',
      k: '#a87b26',
      W: '#fbf7ee',
      t: '#fbf7ee',
      p: '#4d4560',
      P: '#3a3449',
      f: '#5a3826',
      F: '#3c2417',
      h: '#5e3a26',
      H: '#86563a',
      d: '#3c2417',
    },
  },
];

function paletteOf(worker: Worker): Record<string, RGBA> {
  const pal: Record<string, RGBA> = {
    o: hex(OUTLINE),
    w: hex(EYE_WHITE),
    e: hex(PUPIL),
    n: hex(PAPER.n),
    l: hex(PAPER.l),
    x: hex(SHADOW),
  };
  for (const [key, value] of Object.entries(worker.colors)) pal[key] = hex(value);
  return pal;
}

type Facing = 'front' | 'back';
type Pose = 'walkA' | 'stand' | 'walkB' | 'type1' | 'type2' | 'read1' | 'read2';
const POSES: readonly Pose[] = ['walkA', 'stand', 'walkB', 'type1', 'type2', 'read1', 'read2'];
const STANDING: ReadonlySet<Pose> = new Set(['walkA', 'stand', 'walkB']);

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
  const img = new PixelImage(CHAR_FRAME_W, CHAR_FRAME_H);
  const seated = !STANDING.has(pose);
  const drop = seated ? SEAT_DROP : 0;
  // Walking frames lift the upper body one pixel.
  const bob = pose === 'walkA' || pose === 'walkB' ? -1 : 0;
  img.stamp(legsFor(facing, pose), pal, 0, LEGS_Y + drop + (seated ? -2 : 0));
  img.stamp(torsoFor(facing, pose), pal, 0, TORSO_Y + drop + bob);
  img.stamp(facing === 'front' ? FACE_FRONT : FACE_BACK, pal, 0, drop + bob);
  img.stamp(HAIR[worker.hair][facing], pal, 0, drop + bob);
  return img;
}

export function renderCharacterSheets(): PixelImage[] {
  return WORKERS.map((worker) => {
    const pal = paletteOf(worker);
    const sheet = new PixelImage(CHAR_FRAME_W * CHAR_FRAMES_PER_ROW, CHAR_FRAME_H * 3);
    POSES.forEach((pose, i) => {
      const front = drawFrame(worker, pal, 'front', pose);
      sheet.blit(front, i * CHAR_FRAME_W, 0);
      sheet.blit(drawFrame(worker, pal, 'back', pose), i * CHAR_FRAME_W, CHAR_FRAME_H);
      sheet.blit(front.mirrored(), i * CHAR_FRAME_W, CHAR_FRAME_H * 2);
    });
    return sheet;
  });
}
