/**
 * The head of a worker, turned 3/4 like a Habbo figure: a skull, a face on
 * the front, one of twelve hairstyles and one accessory. Every part is a
 * hand-placed template on one 18-column grid whose column 9 sits on the
 * body's centre, so a skull, a hairstyle and an accessory stamped with the
 * same origin line up.
 *
 * Rows count down from the skull's top row (0) to its chin line (14). A
 * hairstyle starts `top` rows above the skull. The front faces screen lower
 * left: eyes, nose and mouth on the left half, the ear on the right. The
 * back faces upper right: the ear on the left, the neck below the hair.
 *
 * Letters: o ink, s/S/r skin light/shade/deep, w eye white, e pupil,
 * h/H/d hair base/highlight/dark, j headphone plastic, y gold.
 */

import type { Facing } from './body.js';
import type { LetterCanvas } from './canvas.js';
import type { Accessory } from './outfits.js';

interface Layer {
  readonly top: number;
  readonly rows: readonly string[];
}

export interface HairStyle {
  readonly front: Layer;
  readonly back: Layer;
}

/** Column of the template grid that lands on the body's centre line. */
const GRID_CENTER_COL = 9;
/** Template row of the chin line. */
const CHIN_ROW = 14;

const SKULL_FRONT = [
  '......oooooo......',
  '....oossssssoo....',
  '...osssssssssso...',
  '..osssssssssssSo..',
  '..ossssssssssSSo..',
  '..ossssssssssSSo..',
  '..ossssssssssSSSo.',
  '..oewsewsssssSrSo.',
  '..oewsewsssssSrSo.',
  '..osrssssssssSSo..',
  '..osssssssssSSSo..',
  '..osrrssssssSSo...',
  '..ossssssssSSo....',
  '...ossssssSSo.....',
  '....ooooooo.......',
];

const SKULL_BACK = [
  '......oooooo......',
  '....oossssssoo....',
  '...osssssssssso...',
  '..osssssssssssSo..',
  '..ossssssssssSSo..',
  '..ossssssssssSSo..',
  '.oSossssssssSSSo..',
  '.oSrssssssssSSSo..',
  '.oSSssssssssSSSo..',
  '..oSsssssssssSSo..',
  '..ossssssssssSSo..',
  '...osssssssssSo...',
  '.....osssssSo.....',
  '.....ossssSSo.....',
  '.....ossssSSo.....',
];

export const HAIR: Record<string, HairStyle> = {
  spiky: {
    front: {
      top: -3,
      rows: [
        '.....o..o.o.......',
        '....ohooHohoo.....',
        '...ohHHhHhhhhoo...',
        '..ohHHhhhhhhhhhoo.',
        '..ohHhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohdhhhdhhhhhhhddo',
        '..ohoohohohhhhhddo',
        '..o..o...ohhhhddo.',
        '..........ohhhddo.',
        '...........ohhdo..',
        '............odo...',
      ],
    },
    back: {
      top: -3,
      rows: [
        '.......o..o.o.....',
        '.....ooHohooho....',
        '...oohhhhHhHHho...',
        '..ohhhhhhhhhHHho..',
        '.ohhhhhhhhhhhhhdo.',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhhddo',
        '...ohhhhhhhhhhddo.',
        '...ohdhhhhdhhhddo.',
        '....ooddoodoodoo..',
      ],
    },
  },
  buzz: {
    front: {
      top: -1,
      rows: [
        '......oooooo......',
        '....oohHHhhhoo....',
        '...ohHhhhhhhhho...',
        '..ohhhhhhhhhhhdo..',
        '..ohhhhhhhhhhhddo.',
        '..ooooooohhhhhddo.',
        '.........ohhhddo..',
        '..........ohdo....',
        '...........oo.....',
      ],
    },
    back: {
      top: -1,
      rows: [
        '......oooooo......',
        '....oohHHhhhoo....',
        '...ohhhhhhhhhho...',
        '..ohhhhhhhhhhhdo..',
        '..ohhhhhhhhhhhddo.',
        '..ohhhhhhhhhhhddo.',
        '..ohhhhhhhhhhhddo.',
        '..ohhhhhhhhhhhddo.',
        '..ohhhhhhhhhhhddo.',
        '...ohhhhhhhhhddo..',
        '...ooooooooooo....',
      ],
    },
  },
  sidePart: {
    front: {
      top: -2,
      rows: [
        '.....oooooooo.....',
        '...oohhhHHHHHoo...',
        '..ohhhhoHHHHhhho..',
        '..ohhhhohhhhhhhdo.',
        '..ohhhhohhhhhhhddo',
        '..ohhhhohhhhhhhddo',
        '..ohooooohhhhhhddo',
        '..o......ohhhhddo.',
        '..........ohhddo..',
        '..........ohddo...',
        '...........oo.....',
      ],
    },
    back: {
      top: -2,
      rows: [
        '.....oooooooo.....',
        '...oohhhhHHHHoo...',
        '..ohhhhhhhhHHHho..',
        '..ohhhhhhhhhhhhdo.',
        '..ohhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhhddo',
        '...ohhhhhhhhhhddo.',
        '....oooooooooooo..',
      ],
    },
  },
  bob: {
    front: {
      top: -2,
      rows: [
        '.....oooooooo.....',
        '...oohHHHhhhhoo...',
        '..ohHHhhhhhhhhhoo.',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhoooooohhhhhddo',
        '.oho......ohhhhddo',
        '.oho.......ohhhddo',
        '.oho.......ohhhddo',
        '.oho.......ohhhddo',
        '.oho.......ohhhddo',
        '.oddo.....ohhhdddo',
        '..oo......oddddoo.',
        '...........oooo...',
      ],
    },
    back: {
      top: -2,
      rows: [
        '.....oooooooo.....',
        '...oohhhhHHHHoo...',
        '..ohhhhhhhhhhHHho.',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhdddo',
        '.oddhhhhhhhhhddddo',
        '..oddddddddddddoo.',
        '...oooooooooooo...',
      ],
    },
  },
  curly: {
    front: {
      top: -3,
      rows: [
        '.....oo.oo.oo.....',
        '...oohhohhohhoo...',
        '..ohHhhHhhHhhhho..',
        '.ohHhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhhdo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhdhhdhhdhhhhhhddo',
        '.ohoohoohohhhhhhddo',
        '..o..o..o.ohhhhhddo',
        '..........ohhhhddo.',
        '..........ohdhdddo.',
        '...........ooodoo..',
      ],
    },
    back: {
      top: -3,
      rows: [
        '.....oo.oo.oo.....',
        '...oohhohhohhoo...',
        '..ohhhhhhhhhHhho..',
        '.ohhhhhhhhhhhHhhdo',
        '.ohhhhhhhhhhhhhhdo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhhddo',
        '.ohhdhhhdhhhdhhddo.',
        '..ohdhohdhhohdhddo.',
        '...oo.oo.oo.oo.oo..',
      ],
    },
  },
  afro: {
    front: {
      top: -5,
      rows: [
        '.....oooooooo.....',
        '...oohhhhHHhhoo...',
        '..ohhhhHHHhhhhho..',
        '.ohhhhhHhhhhhhhhdo',
        'ohhhhhhhhhhhhhhhhdo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhhhddo',
        '..ooooooohhhhhhddo.',
        '.........ohhhhhddo.',
        '..........ohhhddo..',
        '...........ohddo...',
        '............oo.....',
      ],
    },
    back: {
      top: -5,
      rows: [
        '.....oooooooo.....',
        '...oohhhhHHhhoo...',
        '..ohhhhhhhHHhhho..',
        '.ohhhhhhhhhhHhhhdo',
        'ohhhhhhhhhhhhhhhhdo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        'ohhhhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo.',
        '.ohhhhhhhhhhhhhddo.',
        '..ohhhhhhhhhhhddo..',
        '...oodddddddddoo...',
        '.....oooooooooo....',
      ],
    },
  },
  mohawk: {
    front: {
      top: -5,
      rows: [
        '........oo........',
        '.......oHho.......',
        '.......ohho.......',
        '......oHhhho......',
        '......ohhhdo......',
        '......ohhhdo......',
        '.....oohhhdoo.....',
        '......ohhhdo......',
      ],
    },
    back: {
      top: -5,
      rows: [
        '........oo........',
        '.......oHho.......',
        '.......ohho.......',
        '......oHhhho......',
        '......ohhhdo......',
        '......ohhhdo......',
        '.....oohhhdoo.....',
        '......ohhhdo......',
        '......ohhhdo......',
        '......ohhhdo......',
        '......ohhhdo......',
        '......ohhddo......',
        '......ohddo.......',
        '.......ooo........',
      ],
    },
  },
  bald: {
    front: { top: 0, rows: ['......oooooo......', '....oo.HH...oo....'] },
    back: { top: 0, rows: ['......oooooo......', '....oo....HH.oo...'] },
  },
  beanie: {
    front: {
      top: -3,
      rows: [
        '......oooooo......',
        '....oohHHHHhoo....',
        '...ohHHhhhhhhho...',
        '..ohHhhhhhhhhhhdo.',
        '..ohhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhhddo',
        '.odddddddddddddddo',
        '.oHHHHHHHHHHHHHHdo',
        '.ooooooooooooooooo',
      ],
    },
    back: {
      top: -3,
      rows: [
        '......oooooo......',
        '....oohhhHHhoo....',
        '...ohhhhhhHHhho...',
        '..ohhhhhhhhhhHhdo.',
        '..ohhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhhddo',
        '.odddddddddddddddo',
        '.oHHHHHHHHHHHHHHdo',
        '.ooooooooooooooooo',
      ],
    },
  },
  long: {
    front: {
      top: -2,
      rows: [
        '.....oooooooo.....',
        '...oohHHHhhhhoo...',
        '..ohHHhhhhhhhhhoo.',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhoooooohhhhhddo',
        '.oho......ohhhhddo',
        '.oho.......ohhhddo',
        '.oho.......ohhhddo',
        '.oho.......ohhhddo',
        '.oho.......ohhhddo',
        '.ohho.....ohhhhddo',
        '.ohho.....ohhhhddo',
        '.ohho.....ohhhhddo',
        '.ohddo....ohhhdddo',
        '..oddo....oddddoo.',
        '...oo......oooo...',
      ],
    },
    back: {
      top: -2,
      rows: [
        '.....oooooooo.....',
        '...oohhhhHHHHoo...',
        '..ohhhhhhhhhhHHho.',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhdddo',
        '..oddddddddddddoo.',
        '...oooooooooooo...',
      ],
    },
  },
  ponytail: {
    front: {
      top: -2,
      rows: [
        '.....oooooooo.....',
        '...oohHHHhhhhoo...',
        '..ohHHhhhhhhhhhoo.',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhhdoo',
        '.ohhhhhhhhhhhhhddhdo',
        '.ohhoooooohhhhhddhdo',
        '.oho......ohhhhdohdo',
        '..o........ohhdo.ohdo',
        '............ooo..ohdo',
        '..................oddo',
        '...................oo.',
      ],
    },
    back: {
      top: -2,
      rows: [
        '.....oooooooo.....',
        '...oohhhhHHHHoo...',
        '..ohhhhhhhhhhHHho.',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhddo.',
        '...oohhhhdddhdoo..',
        '.....oohhdhdoo....',
        '.......ohhddo.....',
        '.......ohhddo.....',
        '.......ohhdo......',
        '........ohdo......',
        '........ooo.......',
      ],
    },
  },
  bun: {
    front: {
      top: -5,
      rows: [
        '.........oooo.....',
        '........oHhhdo....',
        '........ohhhdo....',
        '.....ooooooooooo..',
        '...oohHHHhhhhhoo..',
        '..ohHHhhhhhhhhhhoo',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhhddo',
        '.ohhoooooohhhhhhddo',
        '.oo.......ohhhhddo',
        '...........ohhddo.',
        '............ooo...',
      ],
    },
    back: {
      top: -5,
      rows: [
        '.......oooo.......',
        '......oHhhdo......',
        '......ohhhdo......',
        '.....ooooooooo....',
        '...oohhhhHHHHoo...',
        '..ohhhhhhhhhhHHho.',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhhdo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '.ohhhhhhhhhhhhhddo',
        '..ohhhhhhhhhhhddo.',
        '...oohhhhhhhhdoo..',
        '.....oooooooooo...',
      ],
    },
  },
};

const BLINK: Layer = { top: 7, rows: ['..ossssssss', '..ooo.oo...'] };

const ACCESSORIES: Record<Accessory, Partial<Record<Facing, Layer>>> = {
  none: {},
  lanyard: {},
  glasses: {
    front: {
      top: 6,
      rows: ['..oooooooo', '.........oooo', '.....o..o', '...oo..oo'],
    },
  },
  headphones: {
    front: {
      top: -2,
      rows: [
        '.....oooooooo.....',
        '...oojjjjjjjjoo...',
        '...............oo.',
        '...............ojo',
        '...............ojo',
        '...............ojo',
        '...............ojo',
        '..............oooo',
        '..............ojjo',
        '..............ojjo',
        '..............ojjo',
        '..............oooo',
      ],
    },
    back: {
      top: -2,
      rows: [
        '.....oooooooo.....',
        '...oojjjjjjjjoo...',
        '.oo...............',
        'ojo...............',
        'ojo...............',
        'ojo...............',
        'ojo...............',
        'oooo..............',
        'ojjo..............',
        'ojjo..............',
        'ojjo..............',
        'oooo..............',
      ],
    },
  },
  beard: {
    front: {
      top: 10,
      rows: ['...hhhhhhh', '..ohrrhhhhho', '..ohhhhhhhho', '...ohhhhhho'],
    },
  },
  earrings: {
    front: { top: 10, rows: ['..............y'] },
    back: { top: 10, rows: ['.y'] },
  },
};

export interface HeadSpec {
  readonly hair: keyof typeof HAIR;
  readonly accessory: Accessory;
}

/** Draws the skull, the face (front only), the hairstyle and the
 *  accessory, chin line at `chinY`. */
export function drawHead(
  canvas: LetterCanvas,
  chinY: number,
  facing: Facing,
  spec: HeadSpec,
  blink: boolean,
): void {
  const originX = canvas.width / 2 - GRID_CENTER_COL;
  const skullTop = chinY - CHIN_ROW;
  const stamp = (layer: Layer) => canvas.stamp(layer.rows, originX, skullTop + layer.top);
  stamp({ top: 0, rows: facing === 'front' ? SKULL_FRONT : SKULL_BACK });
  if (blink) stamp(BLINK);
  const hair = HAIR[spec.hair];
  stamp(facing === 'front' ? hair.front : hair.back);
  const accessory = ACCESSORIES[spec.accessory][facing];
  if (accessory) stamp(accessory);
}
