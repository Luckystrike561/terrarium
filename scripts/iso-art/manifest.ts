/**
 * Build the office manifest from the furniture specs, the shared asset
 * constants and the sheets on disk.
 */

import * as fs from 'fs';
import * as path from 'path';

import { buildAssetIndex } from '../../core/src/assets/build.js';
import {
  CARPET_CORNER_BITS,
  CARPET_GRID_COLS,
  CARPET_MARCHING_SQUARES_COUNT,
  CARPET_TILE_SIZE,
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHARACTER_ANIMATIONS,
  CHARACTER_DIRECTIONS,
  CHARACTER_FRAMES,
  CTO_CHARACTER_FILE,
  FIRST_FLOOR_TILE,
  FLOOR_TILE_SIZE,
  FURNITURE_FRAME_DURATION_SEC,
  PET_ANIMATIONS,
  PET_FRAME_H,
  PET_FRAME_W_LARGE,
  PET_FRAME_W_SMALL,
  PET_IDLE_FRAMES_VERT,
  PET_IMAGE_HEIGHT,
  PET_IMAGE_WIDTH,
  PET_WALK_FRAMES_HORIZ,
  PET_WALK_FRAMES_VERT,
  TILE_SIZE,
  VOID_TILE,
  WALL_GLASS_HEIGHT_PX,
  WALL_HEIGHT_PX,
  WALL_TILE,
} from '../../core/src/assets/constants.js';
import type {
  Characters,
  FurnitureItem,
  OfficeManifest,
  Pets,
  PetStrip,
  Tiles,
} from '../../core/src/assets/officeManifest.js';
import {
  footprintAnchor,
  OFFICE_MANIFEST_SCHEMA_VERSION,
} from '../../core/src/assets/officeManifest.js';
import { SEATED_HIP_Y } from './characters/templates.js';
import type { FurnitureSpec } from './lib/furniture.js';
import { furnitureAssetId } from './lib/furniture.js';

const PROJECTED_TILE = { width: TILE_SIZE * 2, height: TILE_SIZE };

function furnitureItem(spec: FurnitureSpec): FurnitureItem {
  const [first] = spec.variants;
  const placement = spec.canPlaceOnWalls ? 'wall' : spec.canPlaceOnSurfaces ? 'surface' : 'floor';
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    placement,
    footprint: { width: first.footprintW, depth: first.footprintH },
    heightZ: Math.max(...spec.variants.flatMap((v) => v.images.map((im) => im.topZ))),
    seatZ: spec.seatZ ?? null,
    occlusionSplitZ: spec.occlusionSplitZ ?? null,
    variants: spec.variants.map((variant) => {
      const footprint = { width: variant.footprintW, depth: variant.footprintH };
      const [image] = variant.images;
      const animated = variant.images.length > 1;
      return {
        id: furnitureAssetId(spec, variant),
        orientation: variant.orientation ?? null,
        state: variant.state ?? null,
        footprint,
        frameSize: { width: image.width, height: image.height },
        anchor: footprintAnchor(footprint, image.height, TILE_SIZE),
        frames: variant.images.map((_, i) => {
          const id = furnitureAssetId(spec, variant, animated ? i : undefined);
          return { id, file: `furniture/${spec.id}/${id}.png` };
        }),
        frameDurationSec: animated ? FURNITURE_FRAME_DURATION_SEC : null,
      };
    }),
  };
}

function characters(assetsDir: string): Characters {
  const index = buildAssetIndex(assetsDir);
  const anchor = { x: CHAR_FRAME_W / 2, y: CHAR_FRAME_H };
  return {
    frameSize: { width: CHAR_FRAME_W, height: CHAR_FRAME_H },
    anchor,
    seatedAnchor: { x: anchor.x, y: SEATED_HIP_Y },
    frameNames: [...CHARACTER_FRAMES],
    facings: [
      { facing: 'down', row: CHARACTER_DIRECTIONS.indexOf('down'), mirrored: false },
      { facing: 'up', row: CHARACTER_DIRECTIONS.indexOf('up'), mirrored: false },
      { facing: 'right', row: CHARACTER_DIRECTIONS.indexOf('right'), mirrored: false },
      { facing: 'left', row: CHARACTER_DIRECTIONS.indexOf('up'), mirrored: true },
    ],
    animations: Object.entries(CHARACTER_ANIMATIONS).map(([name, animation]) => ({
      name,
      frames: animation.frames.map((frame) => CHARACTER_FRAMES.indexOf(frame)),
      frameDurationSec: animation.frameDurationSec,
      seated: animation.seated,
    })),
    sheets: [
      ...index.characters.map((file) => ({
        id: path.basename(file, '.png'),
        file: `characters/${file}`,
        role: 'agent' as const,
      })),
      {
        id: path.basename(CTO_CHARACTER_FILE, '.png'),
        file: `characters/${CTO_CHARACTER_FILE}`,
        role: 'cto' as const,
      },
    ],
  };
}

function numberedFiles(dir: string, pattern: RegExp): Array<{ index: number; file: string }> {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .flatMap((file) => {
      const match = pattern.exec(file);
      return match ? [{ index: parseInt(match[1], 10), file }] : [];
    })
    .sort((a, b) => a.index - b.index);
}

function tiles(assetsDir: string): Tiles {
  return {
    voidTile: VOID_TILE,
    floor: {
      textureSize: { width: FLOOR_TILE_SIZE, height: FLOOR_TILE_SIZE },
      projectedSize: PROJECTED_TILE,
      textures: numberedFiles(path.join(assetsDir, 'floors'), /^floor_(\d+)\.png$/i).map(
        ({ index, file }) => ({ tile: FIRST_FLOOR_TILE + index, file: `floors/${file}` }),
      ),
    },
    wall: { tile: WALL_TILE, solidHeight: WALL_HEIGHT_PX, glassHeight: WALL_GLASS_HEIGHT_PX },
    carpet: {
      pieceSize: { width: CARPET_TILE_SIZE, height: CARPET_TILE_SIZE },
      projectedSize: PROJECTED_TILE,
      grid: {
        columns: CARPET_GRID_COLS,
        rows: CARPET_MARCHING_SQUARES_COUNT / CARPET_GRID_COLS,
      },
      cornerBits: { ...CARPET_CORNER_BITS },
      textures: numberedFiles(path.join(assetsDir, 'carpets'), /^carpet_(\d+)\.png$/i).map(
        ({ index, file }) => ({ variant: index, file: `carpets/${file}` }),
      ),
    },
  };
}

function petStrip(x: number, y: number, width: number, count: number): PetStrip {
  return {
    x,
    y,
    frameSize: { width, height: PET_FRAME_H },
    count,
    anchor: { x: width / 2, y: PET_FRAME_H },
  };
}

function pets(assetsDir: string): Pets {
  const walkDown = petStrip(0, 0, PET_FRAME_W_SMALL, PET_WALK_FRAMES_VERT);
  const walkUp = petStrip(0, PET_FRAME_H, PET_FRAME_W_SMALL, PET_WALK_FRAMES_VERT);
  const walkRight = petStrip(0, PET_FRAME_H * 2, PET_FRAME_W_LARGE, PET_WALK_FRAMES_HORIZ);
  const idleX = PET_WALK_FRAMES_VERT * PET_FRAME_W_SMALL;
  const idleDown = petStrip(idleX, 0, PET_FRAME_W_SMALL, PET_IDLE_FRAMES_VERT);
  const idleUp = petStrip(idleX, PET_FRAME_H, PET_FRAME_W_SMALL, PET_IDLE_FRAMES_VERT);
  const petsDir = path.join(assetsDir, 'pets');
  const ids = fs.existsSync(petsDir)
    ? fs
        .readdirSync(petsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];
  return {
    sheetSize: { width: PET_IMAGE_WIDTH, height: PET_IMAGE_HEIGHT },
    animations: [
      {
        name: 'walk',
        sequence: [...PET_ANIMATIONS.walk.sequence],
        frameDurationSec: PET_ANIMATIONS.walk.frameDurationSec,
        facings: [
          { facing: 'down', strip: walkDown, mirrored: false },
          { facing: 'up', strip: walkUp, mirrored: false },
          { facing: 'right', strip: walkRight, mirrored: false },
          { facing: 'left', strip: walkRight, mirrored: true },
        ],
      },
      {
        // Side-on idle frames are not drawn: a pet idling sideways shows its
        // front or back idle.
        name: 'idle',
        sequence: [...PET_ANIMATIONS.idle.sequence],
        frameDurationSec: PET_ANIMATIONS.idle.frameDurationSec,
        facings: [
          { facing: 'down', strip: idleDown, mirrored: false },
          { facing: 'up', strip: idleUp, mirrored: false },
          { facing: 'right', strip: idleDown, mirrored: false },
          { facing: 'left', strip: idleUp, mirrored: false },
        ],
      },
    ],
    sheets: ids.map((id) => {
      const meta = JSON.parse(
        fs.readFileSync(path.join(petsDir, id, 'manifest.json'), 'utf-8'),
      ) as { name: string };
      return { id, name: meta.name, file: `pets/${id}/pet.png` };
    }),
  };
}

export function buildOfficeManifest(specs: FurnitureSpec[], assetsDir: string): OfficeManifest {
  return {
    schemaVersion: OFFICE_MANIFEST_SCHEMA_VERSION,
    projection: {
      tileSize: TILE_SIZE,
      isoTileWidth: PROJECTED_TILE.width,
      isoTileHeight: PROJECTED_TILE.height,
    },
    tiles: tiles(assetsDir),
    furniture: specs.map(furnitureItem),
    characters: characters(assetsDir),
    pets: pets(assetsDir),
  };
}
