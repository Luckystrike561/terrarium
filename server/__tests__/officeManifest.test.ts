import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CHAR_FRAME_H, CHAR_FRAME_W } from '../../core/src/assets/constants.js';
import type { OfficeManifest } from '../../core/src/assets/officeManifest.js';
import { OFFICE_MANIFEST_FILE } from '../../core/src/assets/officeManifest.js';
import { validateOfficeManifest } from '../../core/src/assets/officeManifestValidation.js';

const ROOT = path.join(__dirname, '../..');
const BUNDLED_ASSETS = path.join(ROOT, 'webview-ui/public/assets');
const VALIDATE_SCRIPT = path.join(ROOT, 'scripts/validate-assets.ts');
const SHEET = 'characters/char_3.png';
const LAYOUT = 'default-layout-3.json';

let assetsDir: string;

function readPng(file: string): PNG {
  return PNG.sync.read(fs.readFileSync(path.join(assetsDir, file)));
}

function writePng(file: string, png: PNG): void {
  fs.writeFileSync(path.join(assetsDir, file), PNG.sync.write(png));
}

function cropPng(file: string, width: number, height: number): void {
  const src = readPng(file);
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    src.data.copy(out.data, y * width * 4, y * src.width * 4, (y * src.width + width) * 4);
  }
  writePng(file, out);
}

function clearRows(file: string, y0: number, y1: number): void {
  const png = readPng(file);
  png.data.fill(0, y0 * png.width * 4, y1 * png.width * 4);
  writePng(file, png);
}

function clearRect(file: string, x0: number, y0: number, width: number, height: number): void {
  const png = readPng(file);
  for (let y = y0; y < y0 + height; y++) {
    png.data.fill(0, (y * png.width + x0) * 4, (y * png.width + x0 + width) * 4);
  }
  writePng(file, png);
}

function editManifest(edit: (manifest: OfficeManifest) => void): void {
  const file = path.join(assetsDir, OFFICE_MANIFEST_FILE);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf-8')) as OfficeManifest;
  edit(manifest);
  fs.writeFileSync(file, JSON.stringify(manifest));
}

function issuesFor(asset: string): string[] {
  return validateOfficeManifest(assetsDir)
    .filter((issue) => issue.asset === asset)
    .map((issue) => issue.message);
}

beforeEach(() => {
  assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-assets-'));
  fs.cpSync(BUNDLED_ASSETS, assetsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(assetsDir, { recursive: true, force: true });
});

describe('office manifest validation', () => {
  it('finds the bundled manifest in agreement with every bundled sheet', () => {
    expect(validateOfficeManifest(assetsDir)).toEqual([]);
  });

  it('names a character sheet that lost a frame, with the expected and actual size', () => {
    const png = readPng(SHEET);
    cropPng(SHEET, png.width - CHAR_FRAME_W, png.height);

    expect(issuesFor(SHEET)).toEqual([
      `size is ${png.width - CHAR_FRAME_W}×${png.height}, expected ${png.width}×${png.height}: 18 frames per row, expected 19`,
    ]);
  });

  it('names a character sheet whose last facing row was cut off', () => {
    const png = readPng(SHEET);
    cropPng(SHEET, png.width, png.height - CHAR_FRAME_H);

    expect(issuesFor(SHEET)).toEqual([
      `size is ${png.width}×${png.height - CHAR_FRAME_H}, expected ${png.width}×${png.height}: 2 facing rows, expected 3 (down, up, right)`,
    ]);
  });

  it('names a character sheet whose facing row was erased at full size', () => {
    clearRows(SHEET, 2 * CHAR_FRAME_H, 3 * CHAR_FRAME_H);

    expect(issuesFor(SHEET)).toEqual(["facing 'right' (row 2) is missing: every frame is empty"]);
  });

  it('names a carpet sheet with an erased piece', () => {
    clearRect('carpets/carpet_1.png', 16, 16, 16, 16);

    expect(issuesFor('carpets/carpet_1.png')).toEqual(['carpet piece 5 is empty']);
  });

  it('names a furniture frame whose size disagrees with its variant', () => {
    cropPng('furniture/DESK/DESK_FRONT.png', 40, 38);

    expect(issuesFor('furniture/DESK/DESK_FRONT.png')).toEqual(['size is 40×38, expected 48×38']);
  });

  it('rejects an anchor outside the frame', () => {
    editManifest((manifest) => {
      const desk = manifest.furniture.find((item) => item.id === 'DESK');
      desk!.variants[0].anchor = { x: 16, y: -2 };
    });

    expect(issuesFor('DESK_FRONT')).toEqual(['anchor (16, -2) is outside the 48×38 frame']);
  });

  it('rejects an anchor off the footprint top vertex', () => {
    editManifest((manifest) => {
      manifest.furniture.find((item) => item.id === 'DESK')!.variants[0].anchor = { x: 16, y: 20 };
    });

    expect(issuesFor('DESK_FRONT')).toEqual([
      "anchor is (16, 20), expected (16, 14), the footprint's top vertex",
    ]);
  });

  it('rejects a seat height the seated character frames were not drawn for', () => {
    editManifest((manifest) => {
      manifest.furniture.find((item) => item.id === 'STOOL')!.seatZ = 10;
    });

    expect(issuesFor('STOOL')).toEqual([
      "seatZ is 10, expected 6 (the seated character frames' seatedAnchor sits 6 px above their anchor)",
    ]);
  });

  it('flags a layout piece the manifest does not describe', () => {
    editManifest((manifest) => {
      manifest.furniture = manifest.furniture.filter((item) => item.id !== 'DESK');
    });

    const issues = validateOfficeManifest(assetsDir).map((i) => `${i.asset}: ${i.message}`);
    expect(issues).toContain('furniture/DESK: is on disk but not in the manifest');
    expect(
      issues.some((i) => i.endsWith("places 'DESK_FRONT', which the manifest does not describe")),
    ).toBe(true);
  });

  it('flags a layout that places an animated variant by its key instead of a frame id', () => {
    const file = path.join(assetsDir, LAYOUT);
    const layout = JSON.parse(fs.readFileSync(file, 'utf-8')) as { furniture: object[] };
    layout.furniture.push({ uid: 'pc', type: 'PC_FRONT_ON', col: 0, row: 0 });
    fs.writeFileSync(file, JSON.stringify(layout));

    expect(issuesFor(LAYOUT)).toEqual([
      "places 'PC_FRONT_ON', which the manifest does not describe",
    ]);
  });

  it('rejects a schema version it does not understand', () => {
    editManifest((manifest) => {
      manifest.schemaVersion = 2;
    });

    expect(validateOfficeManifest(assetsDir)).toEqual([
      { asset: OFFICE_MANIFEST_FILE, message: 'schemaVersion is 2, expected 1' },
    ]);
  });

  it('names every missing top-level section instead of throwing', () => {
    editManifest((manifest) => {
      const partial = manifest as Partial<OfficeManifest>;
      partial.characters = undefined;
      partial.projection = undefined;
    });

    expect(validateOfficeManifest(assetsDir)).toEqual([
      { asset: OFFICE_MANIFEST_FILE, message: "missing 'projection'" },
      { asset: OFFICE_MANIFEST_FILE, message: "missing 'characters'" },
    ]);
  });

  it('exits non-zero from the command line, naming the asset and the mismatch', () => {
    const png = readPng(SHEET);
    cropPng(SHEET, png.width - CHAR_FRAME_W, png.height);

    const run = spawnSync(process.execPath, ['--import', 'tsx', VALIDATE_SCRIPT, assetsDir], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 8000,
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`[assets] ${SHEET}: size is`);
    expect(run.stderr).toContain('18 frames per row, expected 19');
  });
});
