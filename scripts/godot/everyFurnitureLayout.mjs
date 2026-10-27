/**
 * A layout placing every furniture frame of the office manifest once, for
 * `npm run godot:check`: wall items along the back walls and a glass wall,
 * everything else packed on the floor with a tile between neighbours. It also
 * uses every floor texture, wall colours with and without a tile colour,
 * carpets in their default colours and stacked over one another, and both
 * furniture colour modes.
 */

const COLS = 44;
const ROWS = 30;
const WALL = 0;
/** The glass wall that takes the right-facing wall items the back wall has no room for. */
const GLASS_WALL_COL = COLS - 1;
const FIRST_FLOOR_COL = 2;
const FIRST_FLOOR_ROW = 2;
const LAST_FLOOR_COL = GLASS_WALL_COL - 1;
const ROWS_PER_FLOOR_TEXTURE = 3;
/** Every this many floor items, one is recoloured, alternating the two colour modes. */
const RECOLOR_EVERY = 7;
const ADJUSTED = { h: 120, s: 20, b: 10, c: 5 };
const COLORIZED = { h: 200, s: 50, b: 0, c: 0, colorize: true };
const WALL_TINT = { h: 210, s: 25, b: 20, c: -10 };
const FLOOR_TINTS = [
  { h: 35, s: 30, b: 15, c: 0 },
  { h: 200, s: 10, b: 35, c: -55 },
];
const CARPETS = [
  { variant: 1, cols: [26, 33], rows: [18, 24] },
  { variant: 2, cols: [30, 38], rows: [21, 27], order: 1, color: { h: 120, s: 40, b: -20, c: 0 } },
];

function inRange(value, [from, to]) {
  return value >= from && value < to;
}

export function everyFurnitureLayout(manifest) {
  const floorTiles = manifest.tiles.floor.textures.map((texture) => texture.tile);
  if (floorTiles.length > Math.ceil(ROWS / ROWS_PER_FLOOR_TEXTURE)) {
    throw new Error('every floor texture no longer fits the check layout: enlarge ROWS');
  }
  const tiles = [];
  const tileColors = [];
  const carpetTiles = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const wall = row === 0 || col === 0 || col === GLASS_WALL_COL;
      tiles.push(
        wall ? WALL : floorTiles[Math.floor(row / ROWS_PER_FLOOR_TEXTURE) % floorTiles.length],
      );
      tileColors.push(
        wall ? (col === 0 ? WALL_TINT : null) : FLOOR_TINTS[Math.floor(col / 11) % 2],
      );
      const carpet = CARPETS.find((c) => inRange(col, c.cols) && inRange(row, c.rows));
      carpetTiles.push(
        carpet
          ? {
              variant: carpet.variant,
              ...(carpet.order ? { order: carpet.order } : {}),
              ...(carpet.color ? { color: carpet.color } : {}),
            }
          : null,
      );
    }
  }

  const furniture = [];
  const place = (type, col, row, color) =>
    furniture.push({
      uid: `every-${furniture.length}`,
      type,
      col,
      row,
      ...(color ? { color } : {}),
    });

  let frontCol = 1;
  let rightRow = 1;
  let rightWallCol = 0;
  let shelf = { col: FIRST_FLOOR_COL, row: FIRST_FLOOR_ROW, depth: 0 };
  let floorItems = 0;
  for (const item of manifest.furniture) {
    for (const variant of item.variants) {
      const { width, depth } = variant.footprint;
      for (const frame of variant.frames) {
        if (item.placement === 'wall' && variant.orientation === 'front') {
          place(frame.id, frontCol, 0);
          frontCol += width + 1;
        } else if (item.placement === 'wall') {
          if (rightRow + depth > ROWS) {
            if (rightWallCol === GLASS_WALL_COL) {
              throw new Error('the wall items no longer fit the check layout: enlarge ROWS');
            }
            rightWallCol = GLASS_WALL_COL;
            rightRow = 1;
          }
          place(frame.id, rightWallCol, rightRow);
          rightRow += depth + 1;
        } else {
          if (shelf.col + width > LAST_FLOOR_COL) {
            shelf = { col: FIRST_FLOOR_COL, row: shelf.row + shelf.depth, depth: 0 };
          }
          floorItems++;
          const recolor = floorItems % RECOLOR_EVERY === 0;
          const color = recolor
            ? floorItems % (2 * RECOLOR_EVERY) === 0
              ? COLORIZED
              : ADJUSTED
            : null;
          place(frame.id, shelf.col, shelf.row, color);
          shelf.col += width + 1;
          shelf.depth = Math.max(shelf.depth, depth + 1);
        }
      }
    }
  }
  if (frontCol > COLS || shelf.row + shelf.depth > ROWS) {
    throw new Error('every furniture frame no longer fits the check layout: enlarge COLS or ROWS');
  }
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    layoutRevision: 1,
    tiles,
    tileColors,
    carpetTiles,
    furniture,
  };
}
