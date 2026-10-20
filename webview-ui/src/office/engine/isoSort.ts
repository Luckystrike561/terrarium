/**
 * Draw order for isometric entities.
 *
 * A single depth key cannot order iso boxes of different sizes: a long desk
 * and a character standing at its front corner have no key that is right for
 * every pair. Instead each entity carries its footprint box on the grid, and
 * two entities whose screen columns overlap are ordered by a separating axis
 * (the one entirely at lower col, or entirely at lower row, is behind). Boxes
 * that genuinely overlap on the floor (a monitor on a desk, a painting on a
 * wall, a character in a chair) fall back to `layer`, then to depth.
 */

export interface SortBox {
  /** Footprint in tile units; max bounds exclusive. */
  readonly minCol: number;
  readonly minRow: number;
  readonly maxCol: number;
  readonly maxRow: number;
  /** Tie-break for overlapping footprints: higher draws later. */
  readonly layer: number;
  /** Horizontal screen extent of what is actually drawn, in the same
   *  `col - row` units as the footprint's. A sprite wider than its footprint
   *  (a character over its feet, a sofa past its tiles) overlaps neighbours
   *  its footprint alone would never reach. Defaults to the footprint's. */
  readonly screenLeft?: number;
  readonly screenRight?: number;
}

/** `layer` values: furniture on the floor, characters and pets, then things
 *  attached to another footprint (surface items, wall items). */
export const SortLayer = {
  FLOOR: 0,
  ACTOR: 1,
  ATTACHED: 2,
} as const;

const EPS = 1e-6;

function depth(b: SortBox): number {
  return b.minCol + b.maxCol + b.minRow + b.maxRow;
}

/** -1 when a draws before b, 1 when after, 0 when unordered. */
function compare(a: SortBox, b: SortBox): number {
  const aFirst = a.maxCol <= b.minCol + EPS || a.maxRow <= b.minRow + EPS;
  const bFirst = b.maxCol <= a.minCol + EPS || b.maxRow <= a.minRow + EPS;
  // Separated along one axis each way, the footprints stand side by side on
  // screen and only a sprite wider than its footprint overlaps the other:
  // the one whose front corner is nearer the viewer is in front there.
  if (aFirst && bFirst) return a.maxCol + a.maxRow <= b.maxCol + b.maxRow ? -1 : 1;
  if (aFirst) return -1;
  if (bFirst) return 1;
  if (a.layer !== b.layer) return a.layer < b.layer ? -1 : 1;
  const da = depth(a);
  const db = depth(b);
  return da === db ? 0 : da < db ? -1 : 1;
}

/** Returns indices of `boxes` in back-to-front draw order. */
export function isoDrawOrder(boxes: readonly SortBox[]): number[] {
  const n = boxes.length;
  const after: number[][] = Array.from({ length: n }, () => []);
  const pending = new Array<number>(n).fill(0);
  const left = boxes.map((b) => b.screenLeft ?? b.minCol - b.maxRow);
  const right = boxes.map((b) => b.screenRight ?? b.maxCol - b.minRow);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Screen x-ranges that do not overlap can never occlude each other.
      if (left[i] >= right[j] || left[j] >= right[i]) continue;
      const c = compare(boxes[i], boxes[j]);
      if (c < 0) {
        after[i].push(j);
        pending[j]++;
      } else if (c > 0) {
        after[j].push(i);
        pending[i]++;
      }
    }
  }

  // Kahn's algorithm, always releasing the shallowest ready box so unordered
  // pairs still come out in a stable back-to-front order.
  const depths = boxes.map(depth);
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (pending[i] === 0) ready.push(i);
  const order: number[] = [];
  const done = new Array<boolean>(n).fill(false);
  while (order.length < n) {
    if (ready.length === 0) {
      // A cycle (overlapping boxes ordered inconsistently): break it at the
      // shallowest remaining box.
      let pick = -1;
      for (let i = 0; i < n; i++) {
        if (!done[i] && (pick === -1 || depths[i] < depths[pick])) pick = i;
      }
      ready.push(pick);
    }
    let best = 0;
    for (let k = 1; k < ready.length; k++) {
      if (depths[ready[k]] < depths[ready[best]]) best = k;
    }
    const i = ready.splice(best, 1)[0];
    if (done[i]) continue;
    done[i] = true;
    order.push(i);
    for (const j of after[i]) {
      if (--pending[j] === 0 && !done[j]) ready.push(j);
    }
  }
  return order;
}
