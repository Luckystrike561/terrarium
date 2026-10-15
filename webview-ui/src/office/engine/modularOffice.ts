/**
 * Runtime office growth: how many team modules a floor needs for its agent
 * count, and the pure grow/shrink decision `Building` drives per floor. Kept
 * DOM- and OfficeState-free so it is cheap to unit test directly.
 */

import type { ComposedOfficeLayout, TileRect } from '../../../../core/src/officeModules.js';
import { composeOffice } from '../../../../core/src/officeModules.js';
import type { OfficeLayout, Seat } from '../types.js';

export { composeOffice };
export type { ComposedOfficeLayout, TileRect };

export const AGENTS_PER_TEAM_MODULE = 10;

/** Truthy `layoutRevision` for a runtime-composed layout: it is always
 *  generated in the current tile encoding, so `migrateLayout`'s legacy
 *  VOID(8) check (gated on a falsy revision) never needs to run on it. */
const COMPOSED_LAYOUT_REVISION = 1;

/** Team modules a floor needs for `topLevelAgentCount` seated agents (10 desk
 *  seats each), at least 1 so an empty floor still shows a starting office. */
export function neededTeamModules(topLevelAgentCount: number): number {
  return Math.max(1, Math.ceil(topLevelAgentCount / AGENTS_PER_TEAM_MODULE));
}

/** The team-module count a floor should move to. Grows straight to whatever
 *  `neededTeamModules` needs — an 11th, 21st, 31st, ... agent attaches one
 *  more module each. Shrinks only one module at a time, outermost first
 *  (`isModuleEmpty`'s `ringIndex` is 0-based, the order `teamModules` grew
 *  them in), and only while that module is actually empty: a module never
 *  disappears out from under someone seated or resting in it, even once the
 *  headcount alone would allow a smaller office. */
export function nextTeamModuleCount(
  current: number,
  topLevelAgentCount: number,
  isModuleEmpty: (ringIndex: number) => boolean,
): number {
  const needed = neededTeamModules(topLevelAgentCount);
  if (needed >= current) return needed;
  let count = current;
  while (count > needed && isModuleEmpty(count - 1)) count--;
  return count;
}

/** Whether any desk or rest seat inside `rect` is claimed. */
export function rectOccupied(seats: ReadonlyMap<string, Seat>, rect: TileRect): boolean {
  for (const seat of seats.values()) {
    if (
      seat.assigned &&
      seat.seatCol >= rect.c0 &&
      seat.seatCol <= rect.c1 &&
      seat.seatRow >= rect.r0 &&
      seat.seatRow <= rect.r1
    ) {
      return true;
    }
  }
  return false;
}

/** `composeOffice`'s result, shaped as a loadable `OfficeLayout`. */
export function composedToLayout(composed: ComposedOfficeLayout): OfficeLayout {
  return {
    version: 1,
    cols: composed.cols,
    rows: composed.rows,
    layoutRevision: COMPOSED_LAYOUT_REVISION,
    tiles: composed.tiles as OfficeLayout['tiles'],
    tileColors: composed.tileColors,
    carpetTiles: composed.carpetTiles,
    furniture: composed.furniture,
    ctoOfficeArea: composed.ctoOfficeArea as OfficeLayout['ctoOfficeArea'],
  };
}
