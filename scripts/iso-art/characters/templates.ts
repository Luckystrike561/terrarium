/**
 * Body-part templates shared by every worker sheet: faces, hair, torsos (one
 * per pose) and legs. Letters are looked up in the worker's palette, and `.`
 * and space are transparent.
 *
 * Legend: o outline, s/S/r skin light/shade/deep, w eye white, e pupil,
 * C/c/k top light/base/shade, W collar, t centre accent (tie/zip/button),
 * v vest/cardigan trim, p/P trouser light/shade, f/F shoe light/shade,
 * h/H/d hair base/light/dark, n paper base, l paper ink text, g the amber
 * sign-here mark, x ground shadow.
 *
 * Standing torsos are stamped at TORSO_Y. Raise/hold poses need room for an
 * arm or a held-up form reaching above the shoulder, so their templates
 * prepend `ARM_REACH` rows and are stamped `ARM_REACH` rows higher, which
 * keeps the shoulders on TORSO_Y.
 */

export const TORSO_Y = 17;
export const LEGS_Y = 29;
/** Seated figures sit this many rows lower than standing ones. */
export const SEAT_DROP = 7;
/** Extra rows prepended to the raise/hold torso templates for the raised
 *  arm or held-up form, tall enough that the hand clears every hairstyle's
 *  top, including the afro and the beanie. */
export const ARM_REACH = 16;

export const OUTLINE = '#1a1426';
export const EYE_WHITE = '#f4f0ea';
export const PUPIL = '#2a1e1a';
export const PAPER = { n: '#f6f1e2', l: '#2b2433' };
export const SHADOW = '#00000040';
export const SIGN_MARK = '#cca700';

export function replaceChars(row: string, at: readonly [number, string][]): string {
  const chars = row.split('');
  for (const [i, c] of at) chars[i] = c;
  return chars.join('');
}

export const FACE_FRONT = [
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

export const FACE_BACK = [
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

/** Eyes shut: used only by `rest2` (a slow, drowsy exhale on the lounge). */
export const FACE_FRONT_BLINK = FACE_FRONT.map((row, i) =>
  i === 12
    ? replaceChars(row, [
        [8, 'o'],
        [9, 's'],
        [13, 'o'],
        [14, 's'],
      ])
    : i === 13
      ? replaceChars(row, [
          [8, 'o'],
          [9, 'S'],
          [13, 'o'],
          [14, 'S'],
        ])
      : row,
);

export interface HairSet {
  readonly front: readonly string[];
  readonly back: readonly string[];
}

export const HAIR: Record<string, HairSet> = {
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
  long: {
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
      'oddo........ohhhhhdddo..',
      'oddo..........hhh.dddo..',
      '.ddo...............ddo..',
      '.ddo...............ddo..',
      '.ddo...............ddo..',
      '.ddo...............ddo..',
      '.odo...............odo..',
      '..o.................o...',
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
      '....ohddddddddddddddddo.',
      '....oddddddddddddddddo..',
      '....oddddddddddddddddo..',
      '....oddddddddddddddddo..',
      '.....odddddddddddddodo..',
      '......oooooooooooooooo..',
    ],
  },
  afro: {
    front: [
      '......ooooooooooo.......',
      '....oohhhhhhhhhhhoo.....',
      '...ohhhhhhhhhhhhhhhoo...',
      '..ohhhhhhhhhhhhhhhhhdo..',
      '.ohhhhhhhhhhhhhhhhhhhdo.',
      '.ohhhhhhhhhhhhhhhhhhhdo.',
      'ohhhhhhhhhhhhhhhhhhhhhdo',
      'ohhhhhhhhhhhhhhhhhhhhhdo',
      'ohhhhhhhhhhhhhhhhhhhhhdo',
      '.ohhhhhhhhhhhhhhhhhhddo.',
      '..ohhhoooooohhhhhhddo...',
      '...oo.........hh.ddo....',
    ],
    back: [
      '....ooooooooooo.........',
      '..oohhhhhhhhhhhoo.......',
      '.ohhhhhhhhhhhhhhhoo.....',
      'ohhhhhhhhhhhhhhhhhdo....',
      'ohhhhhhhhhhhhhhhhhhdo...',
      'ohhhhhhhhhhhhhhhhhhhdo..',
      'ohhhhhhhhhhhhhhhhhhhhdo.',
      'ohhhhhhhhhhhhhhhhhhhhddo',
      'ohhhhhhhhhhhhhhhhhhhhddo',
      'ohhhhhhhhhhhhhhhhhhhhddo',
      '.ohhhhhhhhhhhhhhhhhhddo.',
      '..ohhhhhhhhhhhhhhhhddo..',
      '...oohhhhhhhhhhhhhddo...',
      '.....ooooooooooooddo....',
    ],
  },
  mohawk: {
    front: [
      '..........ooo...........',
      '..........oHo...........',
      '..........ohoo..........',
      '.........ohHho..........',
      '.........ohhho..........',
      '........ohHhhho.........',
      '........ohhhhho.........',
      '.......ohhhhhhho........',
      '.......oohhhhhoo........',
      '........oo...oo.........',
    ],
    back: [
      '............ooo.........',
      '............oHo.........',
      '............oho.........',
      '...........ohHho........',
      '...........ohhho........',
      '..........ohHhhho.......',
      '..........ohhhhho.......',
      '.........ohhhhhhho......',
      '.........oohhhhhoo......',
      '..........oo...oo.......',
    ],
  },
  bald: {
    front: [
      '........................',
      '........................',
      '........................',
      '........................',
      '.......ooooooo..........',
      '......oh.....o..........',
    ],
    back: [
      '........................',
      '........................',
      '........................',
      '........................',
      '.........ooooooo........',
      '........oh.....o........',
    ],
  },
  sidePart: {
    front: [
      '........................',
      '........................',
      '........................',
      '........................',
      '.......oooooooo.........',
      '.....oohhhHHHHHoo.......',
      '....ohhhhohHHHHHHoo.....',
      '...ohhhhhohhHHHHHddo....',
      '...ohhhhhohhhhHHHddo....',
      '...ohoooooohhhhhhddo....',
      '...oo.........hh.ddo....',
    ],
    back: [
      '........................',
      '........................',
      '........................',
      '........................',
      '.........oooooooo.......',
      '.......oohhhHHHHHoo.....',
      '.....oohhhhohHHHHHHoo...',
      '....ohhhhhohhHHHHHddo...',
      '....ohhhhhohhhhHHHddo...',
      '....ohhhhhhhhhhhhhddo...',
      '....ohhhhhhhhhhhhhddo...',
      '.....oohhhhhhhhhhddo....',
    ],
  },
  beanie: {
    front: [
      '........................',
      '.......oooooooo.........',
      '.....ooHHHHHHHHoo.......',
      '....oHHHHHHHHHHHHoo.....',
      '....oHHHHHHHHHHHHHdo....',
      '....ohhhhhhhhhhhhhddo...',
      '....oddddddddddddddo....',
      '....oHHHHHHHHHHHHHHo....',
      '.....oo............oo...',
    ],
    back: [
      '.........oooooooo.......',
      '.......ooHHHHHHHHoo.....',
      '......oHHHHHHHHHHHHoo...',
      '......oHHHHHHHHHHHHHdo..',
      '......ohhhhhhhhhhhhhddo.',
      '......oddddddddddddddo..',
      '......oHHHHHHHHHHHHHHo..',
      '.......oo............oo.',
    ],
  },
};

export const TORSO_FRONT_IDLE = [
  '.........osssSo.........',
  '.......ooWWsSWWoo.......',
  '.....ooCCCWWtWckkoo.....',
  '....osoCCCCcctcckkoo....',
  '...ossoCCCCcctccckoso...',
  '...ossoCCCccctccckoSso..',
  '...ossoCCCcccctcckoSSo..',
  '...osooCCccccctcckoSSo..',
  '...ossoCCcccccccckoSSo..',
  '...osssoCcccccccckkoSSo.',
  '...osssoooooooooooosSso.',
  '....ooo.oppppppPPPoooo..',
];

export const TORSO_FRONT_TYPE_1 = [
  '.........osssSo.........',
  '.......ooWWsSWWoo.......',
  '.....ooCCCWWtWckkoo.....',
  '....oCoCCCCcctcckkoo....',
  '...oCCoCCCCcctccckoko...',
  '..oCCoCCCccctccckokko..',
  '.oCCooCCCccctcckokkko..',
  'ossooCCCcccctcckoSSso..',
  'osssooCCccccccckoSsso..',
  '.ooooCCccccccckkooooo..',
  '....oooooooooooooo......',
  '....ooo.oppppppPPPo.....',
];

export const TORSO_FRONT_TYPE_2 = [
  '.........osssSo.........',
  '.......ooWWsSWWoo.......',
  '.....ooCCCWWtWckkoo.....',
  '....oCoCCCCcctcckkoo....',
  '...oCCoCCCCcctccckoko...',
  '...oCCoCCccctccckokko..',
  '..oCCooCCccctcckokkko..',
  '.osssoCCCcccctcoSSso...',
  '.ossssoCCcccccckoSsso...',
  '..ooooCCcccccckkoooo....',
  '....oooooooooooooo......',
  '....ooo.oppppppPPPo.....',
];

export const TORSO_FRONT_READ_1 = [
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

export const TORSO_FRONT_READ_2 = [
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

/** Leaning back, hands folded in the lap. Reused for `rest1` and `rest2`
 *  (the second frame is the same torso drawn one row lower). */
export const TORSO_FRONT_REST = [
  '.........osssSo.........',
  '.......ooWWsSWWoo.......',
  '.....ooCCCWWtWckkoo.....',
  '....osoCCCCCCCCckkoo....',
  '...ossoCCCCCCCCCckoso...',
  '...ossoCCcccccccckoSso..',
  '...ossoCccssssscckoSSo..',
  '...osooCccsssssscckoSo..',
  '...ossoCcccssssccckoSSo.',
  '...osssoocccccccoosSso..',
  '...osssoooooooooooosSso.',
  '....ooo.oppppppPPPoooo..',
];

export const TORSO_BACK_IDLE = [
  '...........osSSo........',
  '.........ooCCcckoo......',
  '.......ooCCCcccckkoo....',
  '.....oosoCCCccccckkoo..',
  '....ossoCCCccccccckkso.',
  '....ossoCCCccccccckoSso',
  '....ossoCCccccccccckoSo',
  '....osooCCccccccccckoSo',
  '....ossoCCccccccccckoSo',
  '....ossoCccccccccckkoSo',
  '....osssoooooooooooooSso',
  '.....oooooppppppPPPPoo..',
];

export const TORSO_BACK_WORK_1 = [
  '...........osSSo........',
  '.........ooCCcckoo......',
  '.......ooCCCcccckkoo....',
  '.....oooCCCCccccckkoo..',
  '....oCCoCCCccccccckkoo.',
  '....oCCoCCCcccccccckkko',
  '....oCCoCCccccccccckkko',
  '....oCooCCccccccccccokko',
  '.....ooCCCccccccccckoo.',
  '......oCCcccccccckkko..',
  '......ooooooooooooooo...',
  '.......ooppppppPPPPo....',
];

export const TORSO_BACK_WORK_2 = [
  '...........osSSo........',
  '.........ooCCcckoo......',
  '.......ooCCCcccckkoo....',
  '.....oooCCCCccccckkoo..',
  '....oCCoCCCccccccckkoo.',
  '....oCCoCCCcccccccckkko',
  '.....oCoCCccccccccckkko',
  '.....oooCCccccccccccokko',
  '......oCCCccccccccckoo.',
  '......oCCcccccccckkko..',
  '......ooooooooooooooo...',
  '.......ooppppppPPPPo....',
];

export const TORSO_BACK_REST = [
  '...........osSSo........',
  '.........ooCCcckoo......',
  '.......ooCCCcccckkoo....',
  '.....oosoCCCCCCCCkkoo..',
  '....ossoCCCCCCCCCCkkso.',
  '....ossoCCcccccccckoSso',
  '....ossoCCccccccccckoSo',
  '....osooCCccccccccckoSo',
  '....ossoCCccccccccckoSo',
  '....ossoCccccccccckkoSo',
  '....osssoooooooooooooSso',
  '.....oooooppppppPPPPoo..',
];

/** One arm raised straight up beside the head on the frame's left side, a
 *  solid 2 px sleeve with an outlined skin fist reaching to the very top of
 *  the frame so it clears every hairstyle, including the afro and the
 *  beanie. `ARM_REACH` rows are prepended. The body rows below are the
 *  plain idle torso, the raised shoulder blending into its near sleeve.
 *  `raiseHand2` shifts the fist 1 px sideways for the wave. */
export const TORSO_FRONT_RAISE_A = [
  '.oSSo....................',
  '.oSSo....................',
  '.oSSo....................',
  '.oSSo....................',
  '.occo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCco...................',
  '.oCCCo...................',
  '.oCCCCo..................',
  ...TORSO_FRONT_IDLE,
];

export const TORSO_FRONT_RAISE_B = [
  '..oSSo...................',
  '..oSSo...................',
  '..oSSo...................',
  '..oSSo...................',
  '.occo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCco...................',
  '.oCCCo...................',
  '.oCCCCo..................',
  ...TORSO_FRONT_IDLE,
];

export const TORSO_BACK_RAISE_A = [
  '.osSo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.occo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCco...................',
  '.oCCCo...................',
  '.oCCCCo..................',
  ...TORSO_BACK_IDLE,
];

export const TORSO_BACK_RAISE_B = [
  '..osSo...................',
  '..oCCo...................',
  '..oCCo...................',
  '..oCCo...................',
  '.occo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCo....................',
  '.oCCco...................',
  '.oCCCo...................',
  '.oCCCCo..................',
  ...TORSO_BACK_IDLE,
];

/** A sheet of paper held up beside the head on the frame's right side (the
 *  side opposite the raised hand, so the two never collide and their
 *  silhouettes read apart: a thin arm on one side, a wide sheet on the
 *  other). Paper fill, ink border and two ink text lines, the amber
 *  sign-here mark near the bottom. Visible the same way from the front and
 *  the back. `holdForm2` lifts the whole reach 1 px. */
const HOLD_SHEET = [
  '..............ooooooooo.',
  '..............onnnnnnno.',
  '..............onnnnnnno.',
  '..............onlllllno.',
  '..............onnnnnnno.',
  '..............onlllllno.',
  '..............onnnnnnno.',
  '..............on.gggg.o.',
  '..............on.gggg.o.',
  '..............onnnnnnno.',
  '..............ooooooooo.',
];

export const TORSO_FRONT_HOLD = [
  ...HOLD_SHEET,
  '...............oSo.......',
  '...............oSo.......',
  '..............oCCo.......',
  '.............oCCCo.......',
  '............oCCCCo.......',
  ...TORSO_FRONT_IDLE,
];

export const TORSO_BACK_HOLD = [
  ...HOLD_SHEET,
  '...............oCo.......',
  '...............oCo.......',
  '..............oCCo.......',
  '.............oCCCo.......',
  '............oCCCCo.......',
  ...TORSO_BACK_IDLE,
];

export const LEGS_STAND = [
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

export const LEGS_WALK_A = [
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

export const LEGS_WALK_B = [
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
export const LEGS_SIT_FRONT = [
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
export const LEGS_SIT_BACK = [
  '.......opppppppPPPPPo...',
  '.......oppppppppPPPPPo..',
  '........ooooooooooooo...',
];
