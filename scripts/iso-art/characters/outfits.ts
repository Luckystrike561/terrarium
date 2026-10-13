/**
 * Outfit cuts, accessories and builds: what makes one worker's silhouette
 * differ from another's, not just its colours. The outfit cut and the
 * build shape the body. Accessories are small head templates stamped after
 * the hair.
 */

export type OutfitCut = 'collarTie' | 'turtleneck' | 'vest' | 'hoodie' | 'crewTee';
export type Accessory = 'none' | 'glasses' | 'headphones' | 'beard' | 'earrings' | 'lanyard';
export type Build = 'regular' | 'stocky' | 'slim' | 'short' | 'tall';

interface AccessoryStamp {
  readonly dx: number;
  readonly dy: number;
  readonly rows: readonly string[];
}

/** Head accessories, positioned like the face template they sit on (0, 0
 *  is its top-left corner), so one shape fits every pose. */
const GLASSES: AccessoryStamp = {
  dx: 6,
  dy: 11,
  rows: ['oo.oo.oo', 'oSo.oSo.'],
};

const HEADPHONES: AccessoryStamp = {
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

/** Gold studs under both ear lobes. */
const EARRINGS: AccessoryStamp = {
  dx: 4,
  dy: 14,
  rows: ['y...............y'],
};

/** The head template of an accessory, or null when it has none from this
 *  side. A lanyard hangs on the body instead. */
export function accessoryStamp(
  accessory: Accessory,
  facing: 'front' | 'back',
): AccessoryStamp | null {
  switch (accessory) {
    case 'glasses':
      return facing === 'front' ? GLASSES : null;
    case 'headphones':
      return HEADPHONES;
    case 'beard':
      return facing === 'front' ? BEARD : null;
    case 'earrings':
      return EARRINGS;
    default:
      return null;
  }
}
