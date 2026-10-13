/**
 * Character hit-testing: which character sits under an iso screen point.
 * Pet hit-testing lives next to pet state, in the pets module.
 */

import {
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  CHARACTER_SITTING_OFFSET_PX,
} from '../../constants.js';
import { worldToIso } from '../iso.js';
import type { Character } from '../types.js';
import { CharacterState } from '../types.js';

/** Get the character drawn at an iso screen point (unscaled sprite px).
 *  Returns id or null. Agents only: clicks pass straight through the consent
 *  greeter, which is a prop, not something to select or follow. */
export function getCharacterAt(
  characters: ReadonlyMap<number, Character>,
  isoX: number,
  isoY: number,
): number | null {
  const chars = Array.from(characters.values()).sort((a, b) => b.x + b.y - (a.x + a.y));
  for (const ch of chars) {
    if (ch.matrixEffect === 'despawn') continue;
    const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const anchor = worldToIso(ch.x, ch.y);
    const bottom = anchor.y + sittingOffset;
    if (
      Math.abs(isoX - anchor.x) <= CHARACTER_HIT_HALF_WIDTH &&
      isoY >= bottom - CHARACTER_HIT_HEIGHT &&
      isoY <= bottom
    ) {
      return ch.id;
    }
  }
  return null;
}
