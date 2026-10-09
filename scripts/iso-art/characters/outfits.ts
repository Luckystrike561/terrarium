/**
 * Outfit cuts, accessories and build variety. Outfit cuts and accessories
 * are small overlays stamped after the torso/hair so they read as a shape
 * change rather than a recolour. Build is a row/column transform applied to
 * the torso and leg templates, so a stocky or slim worker keeps the same
 * head size (about 2.2 heads tall) in a different frame.
 */

export type OutfitCut = 'collarTie' | 'turtleneck' | 'vest' | 'hoodie' | 'crewTee';
export type Accessory = 'none' | 'glasses' | 'headphones' | 'beard' | 'earrings' | 'lanyard';
export type Build = 'regular' | 'stocky' | 'slim' | 'short' | 'tall';

/** Replaces the collar/neckline rows (0-4) of every torso template so the
 *  outfit's silhouette differs, not just its colour. Row 0 of the overlay
 *  lands on row 0 of the torso it is stamped over. */
export const COLLAR_OVERLAY: Record<
  OutfitCut,
  { front: readonly string[]; back: readonly string[] }
> = {
  collarTie: {
    front: [
      '.........osssSo.........',
      '.......ooWWsSWWoo.......',
      '.....ooCCCWWtWckkoo.....',
      '....osoCCCCmmtmckkoo....',
    ],
    back: [
      '...........osSSo........',
      '.........ooCCcckoo......',
      '.......ooCCCcccckkoo....',
      '.....oosoCCCmmmmmkkoo..',
    ],
  },
  turtleneck: {
    front: [
      '.........osssSo.........',
      '........oCCCCCoo........',
      '.....ooCCCCCCCckkoo.....',
      '....osoCCCCCCCmckkoo....',
    ],
    back: [
      '...........osSSo........',
      '..........oCCCCoo.......',
      '.......ooCCCCCCCkkoo....',
      '.....oosoCCCmmmmmkkoo..',
    ],
  },
  vest: {
    front: [
      '.........osssSo.........',
      '.......ooWWsSWWoo.......',
      '.....ooCCCvvvvckkoo.....',
      '....osoCCCvvvmckkoo....',
    ],
    back: [
      '...........osSSo........',
      '.........ooCCcckoo......',
      '.......ooCCvvvvkkoo....',
      '.....oosoCCvmmmmkkoo..',
    ],
  },
  hoodie: {
    front: [
      '.........osssSo.........',
      '......oCCCCCCCCoo.......',
      '.....oCCCttCCCCkkoo.....',
      '....osoCCCCttmckkoo....',
    ],
    back: [
      '.........oCCCCCoo.......',
      '.......oCCCCCCCCCoo.....',
      '......oCCCCCCCCCCkoo....',
      '.....oosoCCCmmmmmkkoo..',
    ],
  },
  crewTee: {
    front: [
      '.........osssSo.........',
      '........oCCCCCoo........',
      '.....ooCCCCCCCCkkoo.....',
      '....osoCCCCmmtmckkoo....',
    ],
    back: [
      '...........osSSo........',
      '..........oCCCCoo.......',
      '.......ooCCCCCCCkkoo....',
      '.....oosoCCCmmmmmkkoo..',
    ],
  },
};

interface AccessoryStamp {
  readonly dx: number;
  readonly dy: number;
  readonly rows: readonly string[];
}

/** Small shapes stamped on top of the finished frame. `dy` is relative to
 *  the head (0 = the face template's own top row), so the same shape works
 *  for every pose since the head never moves relative to the face stamp. */
const GLASSES: AccessoryStamp = {
  dx: 6,
  dy: 11,
  rows: ['oo.oo.oo', 'oSo.oSo.'],
};

const HEADPHONES_FRONT: AccessoryStamp = {
  dx: 5,
  dy: 3,
  rows: ['.oooooooooooo.', 'oo..........oo', 'o............o'],
};

const HEADPHONES_BACK: AccessoryStamp = {
  dx: 5,
  dy: 3,
  rows: ['.oooooooooooo.', 'oo..........oo', 'o............o'],
};

/** A jaw-line beard below the mouth, in the hair base and light shades: over
 *  the mouth or in the near-black dark shade it reads as an open mouth. */
const BEARD: AccessoryStamp = {
  dx: 7,
  dy: 15,
  rows: ['.hHh..hHh.', '..hhhhhh..', '...ohho...'],
};

const EARRINGS: AccessoryStamp = {
  dx: 4,
  dy: 12,
  rows: ['o......................o'],
};

export function accessoryStamp(
  accessory: Accessory,
  facing: 'front' | 'back',
): AccessoryStamp | null {
  switch (accessory) {
    case 'glasses':
      return facing === 'front' ? GLASSES : null;
    case 'headphones':
      return facing === 'front' ? HEADPHONES_FRONT : HEADPHONES_BACK;
    case 'beard':
      return facing === 'front' ? BEARD : null;
    case 'earrings':
      return EARRINGS;
    default:
      return null;
  }
}

/** A lanyard hangs over the chest in every front pose that isn't holding a
 *  form in front of it (reusing `n`/`l` paper letters would clash, so it
 *  gets its own `j` cord / `g` card letters). Stamped at the torso offset. */
export const LANYARD_FRONT: readonly string[] = [
  '..........jj............',
  '..........jj............',
  '..........jj............',
  '.........gggg...........',
  '.........gggg...........',
];

export function insertColumn(rows: readonly string[], at: number): string[] {
  return rows.map((row) => {
    if (at >= row.length) return row;
    return row.slice(0, at) + row[at] + row.slice(at);
  });
}

export function removeColumn(rows: readonly string[], at: number): string[] {
  return rows.map((row) => {
    if (at >= row.length) return row;
    return row.slice(0, at) + row.slice(at + 1);
  });
}

/** Duplicates (or drops) one thigh row near the bottom of a leg template so
 *  a `tall`/`short` build changes leg length while the feet stay anchored to
 *  the template's last row (and the caller shifts the stamp position by the
 *  same delta so the feet stay at the bottom of the frame). */
export function stretchLegs(rows: readonly string[], deltaRows: number): string[] {
  if (deltaRows === 0) return [...rows];
  const thighRow = Math.min(2, rows.length - 2);
  if (deltaRows > 0) {
    const out = [...rows];
    for (let i = 0; i < deltaRows; i++) out.splice(thighRow, 0, rows[thighRow]);
    return out;
  }
  const out = [...rows];
  for (let i = 0; i < -deltaRows; i++) out.splice(thighRow, 1);
  return out;
}

/** Build-driven width change applied to torso and leg templates. Widens or
 *  narrows around the template's horizontal centre, leaving the first
 *  `skipRows` rows (the raise/hold reach rows) untouched so the lifted arm
 *  doesn't shift. */
export function widenBody(rows: readonly string[], deltaCols: number, skipRows = 0): string[] {
  if (deltaCols === 0) return [...rows];
  return rows.map((row, i) => {
    if (i < skipRows || row.length === 0) return row;
    const center = Math.floor(row.length / 2);
    let out = row;
    for (let n = 0; n < Math.abs(deltaCols); n++) {
      out =
        deltaCols > 0
          ? out.slice(0, center) + out[center] + out.slice(center)
          : out.slice(0, center) + out.slice(center + 1);
    }
    return out;
  });
}

export const BUILD_LEG_DELTA: Record<Build, number> = {
  regular: 0,
  stocky: 0,
  slim: 0,
  short: -1,
  tall: 1,
};

export const BUILD_WIDTH_DELTA: Record<Build, number> = {
  regular: 0,
  stocky: 2,
  slim: -1,
  short: 0,
  tall: 0,
};
