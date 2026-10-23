/**
 * Checks the office manifest against the sheets it describes. Every issue
 * names the offending asset and the expected vs actual value, so a sheet
 * that disagrees with the manifest fails loudly instead of rendering a few
 * pixels off.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

import { buildAssetIndex } from './build.js';
import { PNG_ALPHA_THRESHOLD } from './constants.js';
import type {
  Characters,
  FurnitureItem,
  OfficeManifest,
  Pets,
  Point,
  Size,
  Tiles,
} from './officeManifest.js';
import {
  FACINGS,
  footprintAnchor,
  OFFICE_MANIFEST_FILE,
  OFFICE_MANIFEST_SCHEMA_VERSION,
} from './officeManifest.js';
import { sanitizePngBuffer } from './pngDecoder.js';

export interface ManifestIssue {
  asset: string;
  message: string;
}

type Report = (asset: string, message: string) => void;

const MANIFEST_SECTIONS = [
  'projection',
  'tiles',
  'furniture',
  'characters',
  'pets',
] as const satisfies readonly (keyof OfficeManifest)[];

function sizeText(size: Size): string {
  return `${size.width}×${size.height}`;
}

function isInside(point: Point, size: Size): boolean {
  return point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height;
}

/** Reads each sheet once, reporting a missing or unreadable file. */
class Sheets {
  private readonly cache = new Map<string, PNG | null>();
  private readonly assetsDir: string;
  private readonly report: Report;

  constructor(assetsDir: string, report: Report) {
    this.assetsDir = assetsDir;
    this.report = report;
  }

  load(file: string): PNG | null {
    if (this.cache.has(file)) return this.cache.get(file) ?? null;
    let png: PNG | null = null;
    const full = path.join(this.assetsDir, file);
    if (!fs.existsSync(full)) {
      this.report(file, 'file not found');
    } else {
      try {
        png = PNG.sync.read(sanitizePngBuffer(fs.readFileSync(full)));
      } catch (err) {
        this.report(file, `unreadable PNG: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.cache.set(file, png);
    return png;
  }
}

function isEmpty(png: PNG, x0: number, y0: number, size: Size): boolean {
  for (let y = y0; y < y0 + size.height; y++) {
    for (let x = x0; x < x0 + size.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] >= PNG_ALPHA_THRESHOLD) return false;
    }
  }
  return true;
}

function checkSize(file: string, png: PNG, expected: Size, report: Report): boolean {
  if (png.width === expected.width && png.height === expected.height) return true;
  report(file, `size is ${png.width}×${png.height}, expected ${sizeText(expected)}`);
  return false;
}

function checkFurniture(manifest: OfficeManifest, sheets: Sheets, report: Report): void {
  const { tileSize } = manifest.projection;
  const { anchor, seatedAnchor } = manifest.characters;
  const seatedRise = anchor.y - seatedAnchor.y;
  for (const item of manifest.furniture) {
    checkFurnitureItem(item, tileSize, seatedRise, sheets, report);
  }
}

function checkFurnitureItem(
  item: FurnitureItem,
  tileSize: number,
  seatedRise: number,
  sheets: Sheets,
  report: Report,
): void {
  if (item.category === 'chairs' && item.seatZ === null) {
    report(item.id, 'is a chair but has no seatZ');
  }
  if (item.seatZ !== null && item.seatZ !== seatedRise) {
    report(
      item.id,
      `seatZ is ${item.seatZ}, expected ${seatedRise} (the seated character frames' seatedAnchor sits ${seatedRise} px above their anchor)`,
    );
  }
  if (
    item.occlusionSplitZ !== null &&
    (item.occlusionSplitZ <= 0 || item.occlusionSplitZ >= item.heightZ)
  ) {
    report(
      item.id,
      `occlusionSplitZ is ${item.occlusionSplitZ}, expected between 0 and heightZ ${item.heightZ}`,
    );
  }
  if (item.variants.length === 0) report(item.id, 'has no variants');

  for (const variant of item.variants) {
    const { footprint, frameSize } = variant;
    const width = (footprint.width + footprint.depth) * tileSize;
    if (frameSize.width !== width) {
      report(
        variant.id,
        `frame width is ${frameSize.width}, expected ${width} for a ${footprint.width}×${footprint.depth} footprint`,
      );
    }
    const expectedAnchor = footprintAnchor(footprint, frameSize.height, tileSize);
    if (!isInside(variant.anchor, frameSize)) {
      report(
        variant.id,
        `anchor (${variant.anchor.x}, ${variant.anchor.y}) is outside the ${sizeText(frameSize)} frame`,
      );
    } else if (variant.anchor.x !== expectedAnchor.x || variant.anchor.y !== expectedAnchor.y) {
      report(
        variant.id,
        `anchor is (${variant.anchor.x}, ${variant.anchor.y}), expected (${expectedAnchor.x}, ${expectedAnchor.y}), the footprint's top vertex`,
      );
    }
    if (variant.frames.length === 0) report(variant.id, 'has no frames');
    if (variant.frames.length > 1 !== (variant.frameDurationSec !== null)) {
      report(
        variant.id,
        `has ${variant.frames.length} frame(s) and frameDurationSec ${variant.frameDurationSec}, expected a duration exactly when animated`,
      );
    }
    for (const frame of variant.frames) {
      const png = sheets.load(frame.file);
      if (!png || !checkSize(frame.file, png, frameSize, report)) continue;
      if (isEmpty(png, 0, 0, frameSize)) report(frame.file, 'is fully transparent');
    }
  }
}

function checkCharacters(characters: Characters, sheets: Sheets, report: Report): void {
  const { frameSize, frameNames, facings } = characters;
  for (const facing of FACINGS) {
    if (!facings.some((f) => f.facing === facing)) {
      report('characters', `facing '${facing}' is missing`);
    }
  }
  for (const [name, point] of [
    ['anchor', characters.anchor],
    ['seatedAnchor', characters.seatedAnchor],
  ] as const) {
    if (!isInside(point, frameSize)) {
      report(
        'characters',
        `${name} (${point.x}, ${point.y}) is outside the ${sizeText(frameSize)} frame`,
      );
    }
  }
  for (const animation of characters.animations) {
    for (const column of animation.frames) {
      if (column < 0 || column >= frameNames.length) {
        report(
          'characters',
          `animation '${animation.name}' uses column ${column}, expected 0 to ${frameNames.length - 1}`,
        );
      }
    }
  }

  const rows = [...new Set(facings.map((f) => f.row))].sort((a, b) => a - b);
  const rowCount = rows.length === 0 ? 0 : rows[rows.length - 1] + 1;
  const rowNames = (row: number) =>
    facings
      .filter((f) => f.row === row && !f.mirrored)
      .map((f) => f.facing)
      .join('/') || `row ${row}`;
  const expected = {
    width: frameSize.width * frameNames.length,
    height: frameSize.height * rowCount,
  };

  for (const sheet of characters.sheets) {
    const png = sheets.load(sheet.file);
    if (!png) continue;
    if (png.width !== expected.width || png.height !== expected.height) {
      const details: string[] = [];
      if (png.width !== expected.width) {
        details.push(
          png.width % frameSize.width === 0
            ? `${png.width / frameSize.width} frames per row, expected ${frameNames.length}`
            : `width is not a whole number of ${frameSize.width} px frames`,
        );
      }
      if (png.height !== expected.height) {
        details.push(
          png.height % frameSize.height === 0
            ? `${png.height / frameSize.height} facing rows, expected ${rowCount} (${rows.map(rowNames).join(', ')})`
            : `height is not a whole number of ${frameSize.height} px rows`,
        );
      }
      report(
        sheet.file,
        `size is ${png.width}×${png.height}, expected ${sizeText(expected)}: ${details.join('; ')}`,
      );
      continue;
    }
    for (const row of rows) {
      const empty = frameNames.filter((_, column) =>
        isEmpty(png, column * frameSize.width, row * frameSize.height, frameSize),
      );
      if (empty.length === frameNames.length) {
        report(
          sheet.file,
          `facing '${rowNames(row)}' (row ${row}) is missing: every frame is empty`,
        );
      } else if (empty.length > 0) {
        report(
          sheet.file,
          `facing '${rowNames(row)}' (row ${row}) has empty frames: ${empty.join(', ')}`,
        );
      }
    }
  }
}

function checkTiles(tiles: Tiles, sheets: Sheets, report: Report): void {
  const { floor, carpet } = tiles;
  if (floor.textureSize.width !== floor.textureSize.height) {
    report('tiles.floor', `textureSize ${sizeText(floor.textureSize)} is not square`);
  }
  for (const texture of floor.textures) {
    const png = sheets.load(texture.file);
    if (png) checkSize(texture.file, png, floor.textureSize, report);
  }
  const carpetSheet = {
    width: carpet.pieceSize.width * carpet.grid.columns,
    height: carpet.pieceSize.height * carpet.grid.rows,
  };
  for (const texture of carpet.textures) {
    const png = sheets.load(texture.file);
    if (png) checkSize(texture.file, png, carpetSheet, report);
  }
}

function checkPets(pets: Pets, sheets: Sheets, report: Report): void {
  for (const animation of pets.animations) {
    for (const { facing, strip } of animation.facings) {
      const where = `pet animation '${animation.name}' facing '${facing}'`;
      const right = strip.x + strip.frameSize.width * strip.count;
      const bottom = strip.y + strip.frameSize.height;
      if (right > pets.sheetSize.width || bottom > pets.sheetSize.height) {
        report(
          'pets',
          `${where} reaches (${right}, ${bottom}), outside the ${sizeText(pets.sheetSize)} sheet`,
        );
      }
      if (!isInside(strip.anchor, strip.frameSize)) {
        report(
          'pets',
          `${where} anchor (${strip.anchor.x}, ${strip.anchor.y}) is outside the ${sizeText(strip.frameSize)} frame`,
        );
      }
      if (animation.sequence.some((i) => i < 0 || i >= strip.count)) {
        report(
          'pets',
          `${where} sequence ${animation.sequence.join(',')} exceeds its ${strip.count} frames`,
        );
      }
    }
  }
  for (const sheet of pets.sheets) {
    const png = sheets.load(sheet.file);
    if (!png || !checkSize(sheet.file, png, pets.sheetSize, report)) continue;
    for (const animation of pets.animations) {
      for (const { facing, strip } of animation.facings) {
        for (let i = 0; i < strip.count; i++) {
          if (isEmpty(png, strip.x + i * strip.frameSize.width, strip.y, strip.frameSize)) {
            report(
              sheet.file,
              `pet animation '${animation.name}' facing '${facing}' frame ${i} is empty`,
            );
          }
        }
      }
    }
  }
}

function listFiles(dir: string, pattern: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => pattern.test(f));
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/** Every sheet on disk and everything the default layout places must be in
 *  the manifest. */
function checkCoverage(manifest: OfficeManifest, assetsDir: string, report: Report): void {
  const described = new Set<string>([
    ...manifest.characters.sheets.map((s) => s.file),
    ...manifest.tiles.floor.textures.map((t) => t.file),
    ...manifest.tiles.carpet.textures.map((t) => t.file),
    ...manifest.pets.sheets.map((s) => s.file),
  ]);
  const onDisk = [
    ...listFiles(path.join(assetsDir, 'characters'), /\.png$/i).map((f) => `characters/${f}`),
    ...listFiles(path.join(assetsDir, 'floors'), /\.png$/i).map((f) => `floors/${f}`),
    ...listFiles(path.join(assetsDir, 'carpets'), /\.png$/i).map((f) => `carpets/${f}`),
    ...listDirs(path.join(assetsDir, 'pets')).map((d) => `pets/${d}/pet.png`),
  ];
  for (const file of onDisk) {
    if (!described.has(file)) report(file, 'is on disk but not in the manifest');
  }
  const furnitureIds = new Set(manifest.furniture.map((f) => f.id));
  for (const dir of listDirs(path.join(assetsDir, 'furniture'))) {
    if (!furnitureIds.has(dir)) report(`furniture/${dir}`, 'is on disk but not in the manifest');
  }

  const layoutFile = buildAssetIndex(assetsDir).defaultLayout;
  if (!layoutFile) return;
  const layout = JSON.parse(fs.readFileSync(path.join(assetsDir, layoutFile), 'utf-8')) as {
    tiles?: number[];
    carpetTiles?: Array<{ variant: number } | null>;
    furniture?: Array<{ type: string }>;
  };
  const types = new Set(
    manifest.furniture.flatMap((item) =>
      item.variants.flatMap((v) => [v.id, ...v.frames.map((f) => f.id)]),
    ),
  );
  for (const placed of layout.furniture ?? []) {
    if (!types.has(placed.type)) {
      report(layoutFile, `places '${placed.type}', which the manifest does not describe`);
    }
  }
  const { tiles } = manifest;
  const floorTiles = new Set(tiles.floor.textures.map((t) => t.tile));
  for (const tile of new Set(layout.tiles ?? [])) {
    if (tile !== tiles.voidTile && tile !== tiles.wall.tile && !floorTiles.has(tile)) {
      report(layoutFile, `uses tile value ${tile}, which has no floor texture`);
    }
  }
  const carpetVariants = new Set(tiles.carpet.textures.map((t) => t.variant));
  for (const carpet of layout.carpetTiles ?? []) {
    if (carpet && !carpetVariants.has(carpet.variant)) {
      report(layoutFile, `uses carpet variant ${carpet.variant}, which has no texture`);
    }
  }
}

/** Validate `office-manifest.json` in `assetsDir` against the sheets beside
 *  it. An empty result means the manifest and every sheet agree. */
export function validateOfficeManifest(assetsDir: string): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const report: Report = (asset, message) => issues.push({ asset, message });
  const manifestPath = path.join(assetsDir, OFFICE_MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    report(OFFICE_MANIFEST_FILE, 'file not found');
    return issues;
  }
  let manifest: OfficeManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as OfficeManifest;
  } catch (err) {
    report(
      OFFICE_MANIFEST_FILE,
      `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    return issues;
  }
  if (manifest.schemaVersion !== OFFICE_MANIFEST_SCHEMA_VERSION) {
    report(
      OFFICE_MANIFEST_FILE,
      `schemaVersion is ${JSON.stringify(manifest.schemaVersion)}, expected ${OFFICE_MANIFEST_SCHEMA_VERSION}`,
    );
    return issues;
  }
  const missing = MANIFEST_SECTIONS.filter(
    (section) => manifest[section] === undefined || manifest[section] === null,
  );
  if (missing.length > 0) {
    for (const section of missing) report(OFFICE_MANIFEST_FILE, `missing '${section}'`);
    return issues;
  }
  const sheets = new Sheets(assetsDir, report);
  checkFurniture(manifest, sheets, report);
  checkCharacters(manifest.characters, sheets, report);
  checkTiles(manifest.tiles, sheets, report);
  checkPets(manifest.pets, sheets, report);
  checkCoverage(manifest, assetsDir, report);
  return issues;
}
