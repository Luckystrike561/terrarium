/**
 * Builders for seeded `~/.pixel-agents/{layout,config}.json`, passed to the
 * standalone fixture via `test.use({ seedLayout, seedConfig })`. The fixture
 * writes them under the isolated HOME before the server starts (see
 * e2e/helpers/standalone.ts), so the server reads them on startup.
 *
 * A seeded layout carries a layoutRevision so the webview treats it as a
 * current layout: without one, migrateLayout remaps tile value 8 (legacy VOID)
 * to VOID, which would erase a FLOOR_8 seed. The server serves `layout.json`
 * verbatim whenever the file exists and never resets it by revision.
 */

/** Any non-zero revision; marks a seeded layout as current, not legacy. */
export const SEED_LAYOUT_REVISION = 9999;

/** Default floor TileType used to fill a seeded grid (FLOOR_1 = 1). */
const FLOOR_1 = 1;

/** The only hex literal an Areas spec needs; centralized here so the
 *  `pixel-agents/no-inline-colors` rule has one declaration to allow. */
// eslint-disable-next-line pixel-agents/no-inline-colors
export const SEED_AREA_COLOR = '#ff6b6b';

export interface SeedAreaTile {
  col: number;
  row: number;
  label: string;
}

export interface SeedCarpetTile {
  col: number;
  row: number;
  variant: number;
}

export interface SeedLayoutOptions {
  cols?: number;
  rows?: number;
  /** TileType value to fill every tile with (default FLOOR_1). */
  floorTile?: number;
  areas?: Array<{ label: string; color: string }>;
  /** Sparse area-tile labels; expanded to a full parallel array. */
  areaTiles?: SeedAreaTile[];
  /** Sparse carpet tiles; expanded to a full parallel array (default colors). */
  carpetTiles?: SeedCarpetTile[];
  /** Chair coordinates; each becomes a WOODEN_CHAIR_FRONT furniture item, so
   *  `layoutToSeats` derives a real seat there
   *  (webview-ui/src/office/layout/layoutSerializer.ts). */
  chairs?: Array<{ col: number; row: number }>;
  /** Extra furniture by catalog type, placed after the chairs. A seat counts as
   *  a work seat only when electronics (`PC_FRONT_OFF`) sit on a tile it faces,
   *  otherwise it is a rest seat. */
  furniture?: Array<{ type: string; col: number; row: number }>;
  /** Placed pets, round-tripped through `layout.pets` verbatim. */
  pets?: Array<{ id: string; petType: number }>;
}

/**
 * Build a minimal valid OfficeLayout (version 1, all-floor, no furniture by
 * default) with optional carpet/area/chair/furniture/pet data, suitable for
 * `test.use({ seedLayout })`.
 */
export function buildSeedLayout(opts: SeedLayoutOptions = {}): Record<string, unknown> {
  const cols = opts.cols ?? 12;
  const rows = opts.rows ?? 12;
  const count = cols * rows;
  const tiles = new Array<number>(count).fill(opts.floorTile ?? FLOOR_1);

  const layout: Record<string, unknown> = {
    version: 1,
    cols,
    rows,
    tiles,
    furniture: [
      ...(opts.chairs ?? []).map((seat, i) => ({
        uid: `seed-chair-${i.toString()}`,
        type: 'WOODEN_CHAIR_FRONT',
        col: seat.col,
        row: seat.row,
      })),
      ...(opts.furniture ?? []).map((item, i) => ({
        uid: `seed-furniture-${i.toString()}`,
        ...item,
      })),
    ],
    layoutRevision: SEED_LAYOUT_REVISION,
  };

  if (opts.areas) {
    layout.areas = opts.areas;
  }
  if (opts.areaTiles) {
    const areaTiles = new Array<string | null>(count).fill(null);
    for (const t of opts.areaTiles) {
      areaTiles[t.row * cols + t.col] = t.label;
    }
    layout.areaTiles = areaTiles;
  }
  if (opts.carpetTiles) {
    const carpetTiles = new Array<{ variant: number } | null>(count).fill(null);
    for (const t of opts.carpetTiles) {
      carpetTiles[t.row * cols + t.col] = { variant: t.variant };
    }
    layout.carpetTiles = carpetTiles;
  }
  if (opts.pets) {
    layout.pets = opts.pets;
  }

  return layout;
}

/**
 * Mirrors server/src/configPersistence.ts DEFAULT_ADAPTER_SETTINGS, except
 * alwaysShowLabels — the e2e baseline turns labels on so overlay text is
 * assertable without hover (same default the fixture-level seed applies when a
 * test passes no seedConfig; see e2e/helpers/standalone.ts).
 */
const DEFAULT_ADAPTER_SETTINGS = {
  soundEnabled: true,
  lastSeenVersion: '',
  alwaysShowLabels: true,
  watchAllSessions: false,
  hooksInfoShown: false,
  showAreas: false,
  areaMappings: {} as Record<string, string[]>,
};

export interface SeedConfigOptions {
  /** Folder name → Area labels. */
  areaMappings?: Record<string, string[]>;
  /** Persisted Show Areas state. */
  showAreas?: boolean;
  /** Adopt external sessions outside the scanned workspace project dir —
   *  needed to pick up an external session rooted in a subfolder. */
  watchAllSessions?: boolean;
}

/**
 * Build a full PixelAgentsConfig for `test.use({ seedConfig })`, setting the
 * standalone namespace's areaMappings / showAreas / watchAllSessions.
 */
export function buildSeedConfig(opts: SeedConfigOptions = {}): Record<string, unknown> {
  return {
    standalone: {
      ...DEFAULT_ADAPTER_SETTINGS,
      showAreas: opts.showAreas ?? false,
      areaMappings: opts.areaMappings ?? {},
      watchAllSessions: opts.watchAllSessions ?? false,
    },
    externalAssetDirectories: [],
    // Same baseline as the fixture-level seed: skip the first-run consent prompt
    // so hook installation proceeds at startup (see e2e/helpers/standalone.ts).
    hooksConsent: { claude: 'granted' },
  };
}
