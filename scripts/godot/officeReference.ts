/**
 * The current client's static office, rasterised in Node as the reference the
 * Godot client must match: the same asset cache the server sends, the
 * webview's own layout migration, colouring, wall tracer, carpet autotiling,
 * furniture placement and iso draw order. Only the final compositing (the
 * part WebGL does in the browser) is reimplemented: nearest-neighbour scaling
 * and source-over blending at whole-pixel offsets.
 */
import { buildAssetCache } from '../../server/src/assetReload.js';
import {
  FLOOR_SLAB_LEFT_COLOR,
  FLOOR_SLAB_PX,
  FLOOR_SLAB_RIGHT_COLOR,
} from '../../webview-ui/src/constants.js';
import { floorSlabFaces } from '../../webview-ui/src/office/floorSlab.js';
import type { SlabFace } from '../../webview-ui/src/office/floorSlab.js';
import {
  getColorizedFloorSprite,
  setFloorSprites,
  WALL_COLOR,
} from '../../webview-ui/src/office/floorTiles.js';
import { isoDrawOrder, SortLayer } from '../../webview-ui/src/office/engine/isoSort.js';
import type { SortBox } from '../../webview-ui/src/office/engine/isoSort.js';
import {
  ISO_TILE_H,
  ISO_TILE_W,
  projectToDiamond,
  tileCorner,
} from '../../webview-ui/src/office/iso.js';
import { getWallSprite } from '../../webview-ui/src/office/isoWalls.js';
import { buildDynamicCatalog } from '../../webview-ui/src/office/layout/furnitureCatalog.js';
import {
  layoutToFurnitureInstances,
  layoutToTileMap,
  migrateLayoutColors,
} from '../../webview-ui/src/office/layout/layoutSerializer.js';
import {
  carpetJunctionSprites,
  hasCarpetSprites,
  setCarpetSprites,
} from '../../webview-ui/src/office/sprites/carpetTiles.js';
import type { OfficeLayout, SpriteData } from '../../webview-ui/src/office/types.js';
import { TileType } from '../../webview-ui/src/office/types.js';
import { wallColorToHex } from '../../webview-ui/src/office/wallTiles.js';

type Drawable =
  | { kind: 'sprite'; x: number; y: number; sprite: SpriteData }
  | { kind: 'slab'; face: SlabFace; rgba: Rgba };

type Rgba = [number, number, number, number];

export interface Raster {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8Array;
}

export interface ReferenceOffice {
  /** Layout furniture types the catalog does not know, which neither client draws. */
  unknownFurniture: string[];
  /** The office at `zoom`, its iso origin at (offsetX, offsetY), on `background`. */
  render(view: {
    zoom: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    background: Rgba;
  }): Raster;
}

function parseHex(hex: string): Rgba {
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [channel(1), channel(3), channel(5), hex.length > 7 ? channel(7) : 255];
}

/** The office the server would send with this layout (its bundled default when null). */
export async function loadReferenceOffice(
  distRoot: string,
  rawLayout: OfficeLayout | null,
): Promise<ReferenceOffice> {
  const cache = await buildAssetCache(distRoot);
  if (!cache.furniture || !cache.floorTiles || !cache.carpetTiles) {
    throw new Error(`no furniture, floor or carpet assets under ${distRoot}`);
  }
  buildDynamicCatalog({
    catalog: cache.furniture.catalog,
    sprites: Object.fromEntries(cache.furniture.sprites),
  });
  setFloorSprites(cache.floorTiles);
  setCarpetSprites(cache.carpetTiles);
  const layout = migrateLayoutColors(rawLayout ?? (cache.defaultLayout as unknown as OfficeLayout));
  const known = new Set(cache.furniture.catalog.map((entry) => entry.id));
  return {
    unknownFurniture: layout.furniture.map((f) => f.type).filter((type) => !known.has(type)),
    render: (view) => composite(drawables(layout), view),
  };
}

function drawables(layout: OfficeLayout): Drawable[] {
  const tileMap = layoutToTileMap(layout);
  const items: Drawable[] = floorSlabFaces(tileMap, FLOOR_SLAB_PX).map((face) => ({
    kind: 'slab',
    face,
    rgba: parseHex(face.side === 'left' ? FLOOR_SLAB_LEFT_COLOR : FLOOR_SLAB_RIGHT_COLOR),
  }));

  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      const tile = tileMap[r][c];
      if (tile === TileType.VOID || tile === TileType.WALL) continue;
      const color = layout.tileColors?.[r * layout.cols + c] ?? { h: 0, s: 0, b: 0, c: 0 };
      const top = tileCorner(c, r);
      const sprite = projectToDiamond(getColorizedFloorSprite(tile, color));
      items.push({ kind: 'sprite', x: top.x - ISO_TILE_W / 2, y: top.y, sprite });
    }
  }

  if (hasCarpetSprites() && layout.carpetTiles?.length) {
    for (const { jx, jy, sprite } of carpetJunctionSprites(
      layout.carpetTiles,
      layout.cols,
      layout.rows,
    )) {
      const center = tileCorner(jx, jy);
      items.push({
        kind: 'sprite',
        x: center.x - ISO_TILE_W / 2,
        y: center.y - ISO_TILE_H / 2,
        sprite: projectToDiamond(sprite),
      });
    }
  }

  const entities: Array<{ box: SortBox; item: Drawable }> = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      if (tileMap[r][c] !== TileType.WALL) continue;
      const color = layout.tileColors?.[r * layout.cols + c];
      const { sprite, height } = getWallSprite(
        tileMap,
        c,
        r,
        color ? wallColorToHex(color) : WALL_COLOR,
      );
      const top = tileCorner(c, r);
      entities.push({
        box: { minCol: c, minRow: r, maxCol: c + 1, maxRow: r + 1, layer: SortLayer.FLOOR },
        item: { kind: 'sprite', x: top.x - ISO_TILE_W / 2, y: top.y - height, sprite },
      });
    }
  }
  for (const f of layoutToFurnitureInstances(layout.furniture)) {
    entities.push({ box: f.sort, item: { kind: 'sprite', x: f.x, y: f.y, sprite: f.sprite } });
  }
  for (const i of isoDrawOrder(entities.map((e) => e.box))) items.push(entities[i].item);
  return items;
}

function composite(items: Drawable[], view: Parameters<ReferenceOffice['render']>[0]): Raster {
  const { zoom, offsetX, offsetY, width, height, background } = view;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(background, i * 4);
  const blend = (px: number, py: number, rgba: Rgba) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const i = (py * width + px) * 4;
    const alpha = rgba[3] / 255;
    for (let k = 0; k < 3; k++)
      data[i + k] = Math.round(rgba[k] * alpha + data[i + k] * (1 - alpha));
  };
  for (const item of items) {
    if (item.kind === 'slab') {
      fillQuad(item.face.corners, item.rgba, zoom, offsetX, offsetY, blend);
      continue;
    }
    item.sprite.forEach((row, sy) =>
      row.forEach((hex, sx) => {
        if (hex === '') return;
        const rgba = parseHex(hex);
        const left = offsetX + (item.x + sx) * zoom;
        const top = offsetY + (item.y + sy) * zoom;
        for (let dy = 0; dy < zoom; dy++)
          for (let dx = 0; dx < zoom; dx++) blend(left + dx, top + dy, rgba);
      }),
    );
  }
  return { width, height, data };
}

/** Fills the screen pixels whose centre lies inside a convex quad, as a GPU rasterises it. */
function fillQuad(
  corners: SlabFace['corners'],
  rgba: Rgba,
  zoom: number,
  offsetX: number,
  offsetY: number,
  blend: (px: number, py: number, rgba: Rgba) => void,
): void {
  const screen = corners.map((p) => ({ x: offsetX + p.x * zoom, y: offsetY + p.y * zoom }));
  const xs = screen.map((p) => p.x);
  const ys = screen.map((p) => p.y);
  for (let py = Math.floor(Math.min(...ys)); py < Math.ceil(Math.max(...ys)); py++) {
    for (let px = Math.floor(Math.min(...xs)); px < Math.ceil(Math.max(...xs)); px++) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      let sign = 0;
      let inside = true;
      for (let k = 0; k < 4; k++) {
        const a = screen[k];
        const b = screen[(k + 1) % 4];
        const cross = (b.x - a.x) * (cy - a.y) - (b.y - a.y) * (cx - a.x);
        if (cross === 0) continue;
        if (sign === 0) sign = Math.sign(cross);
        else if (Math.sign(cross) !== sign) inside = false;
      }
      if (inside) blend(px, py, rgba);
    }
  }
}
