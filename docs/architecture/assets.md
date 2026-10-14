# Asset system

Bundled assets live in `webview-ui/public/assets/`. `esbuild.js` copies that directory to `dist/assets/`, and the server loads it from there. PNGs are decoded with pngjs into `SpriteData` (a 2D hex array: alpha ≥ `PNG_ALPHA_THRESHOLD` (2) is visible, `#RRGGBBAA` for semi-transparent pixels). The decoders live in `core/src/assets/` and the server side in `server/src/assetLoader.ts`.

```
webview-ui/public/assets/
  characters/          char_0.png … char_11.png, cto.png
  floors/              floor_0.png … floor_8.png
  furniture/<ITEM>/    manifest.json + PNGs, one folder per item
  carpets/  pets/  walls/
  default-layout-<N>.json
```

## Generated art

The bundled furniture, characters and floors are **generated** to the art direction in [`docs/art-direction.md`](../art-direction.md). Edit the generators, not the PNGs.

- `npx tsx scripts/iso-art/generate.ts` rewrites `assets/furniture/`, `assets/characters/` and `assets/floors/` from code. `scripts/iso-art/furniture/*.ts` model furniture with the `IsoScene` ray tracer in `scripts/iso-art/lib/scene.ts`, which inks the outline, dithers fabric and adds the gloss. `scripts/iso-art/characters.ts` composes each frame from parts: the posed body is drawn from joint positions in `scripts/iso-art/characters/body.ts`, and the head (skull, face, twelve hairstyles, accessories) is hand-placed templates in `scripts/iso-art/characters/head.ts`. `scripts/iso-art/floors.ts` draws the floor materials with their tile grid.
- `npx tsx scripts/iso-art/layout.ts` rebuilds the bundled default office (an open work area, the CTO's office, a meeting room, and a lounge with a break corner and the coffee machine, each with its own floor, behind glass partitions) as `default-layout-<REVISION>.json`. Bump `REVISION` on every change.
- `npx tsx scripts/iso-art/preview.ts <module>` renders review sheets to `/tmp/iso-preview` without touching assets.

## Default layout

`loadDefaultLayout()` (`server/src/assetLoader.ts`) scans `assets/` for `default-layout-<N>.json` and serves the one with the highest `N`, stamping `layoutRevision` from `N` when the file has none. It falls back to an unversioned `default-layout.json` only when no versioned file exists. The server serves the bundled default only when `~/.terrarium/layout.json` does not exist, so a saved layout is never replaced by a newer default.

## Furniture

**Per-furniture manifests.** Each item lives in its own folder under `assets/furniture/` with a `manifest.json` that declares its sprites, rotation groups, state groups (on/off) and animation frames. The server builds its catalog from these manifests when it loads assets.

**Catalog.** `furniture-catalog.json` is not a source file. The webview build generates it from the manifests (`buildFurnitureCatalog` in `core/src/assets/build.ts`, called from `webview-ui/vite.config.ts`), and the Vite dev server serves the same thing at `/assets/furniture-catalog.json`. Entries carry `id, name, label, category, footprint, isDesk, canPlaceOnWalls, groupId?, orientation?, state?, canPlaceOnSurfaces?, backgroundTiles?`. Categories: desks, chairs, storage, electronics, decor, wall, misc. The naming convention is `{BASE}[_{ORIENTATION}][_{STATE}]`, for example `MONITOR_FRONT_OFF`.

**Iso sprite anchor contract.** An item with footprint fw×fh is `(fw+fh)*16` px wide, and its floor diamond touches the image's left, right and bottom edges (`footprintSpriteOrigin`). Sprites of any other width are treated as flat art and stand centered on the footprint. Orientation is the facing direction on the grid (front = +row, screen lower-left, right = +col, back, left), and rotated footprints are transposed. Desk tops are at z=12 (`DESK_SURFACE_Z`), chair seats at z=6, back walls are 56 px tall, and surface items are drawn starting at desk height.

**Rotation groups.** `buildDynamicCatalog()` builds a `rotationGroups` Map from assets sharing a `groupId`. Any 2+ orientations are supported (for example front and back only). `getOrientationInGroup()` tells the renderer when a `left` member should be drawn mirrored.

**State groups.** Items with `state: "on"` / `"off"` sharing the same `groupId` and `orientation` form on/off pairs (`stateGroups`, `getOnStateType()`), mirrored across orientations.

**Placement flags.**

- `backgroundTiles?: number`: characters can walk through the top N footprint rows. The iso set uses 0 everywhere.
- `canPlaceOnSurfaces?: boolean`: monitors, mugs and the like sit on `isDesk` furniture tiles and sort on the attached layer, after the desk.
- `canPlaceOnWalls?: boolean`: paintings, clocks, shelves and whiteboards are wall-mounted. `front` mounts on a wall running along cols (its visible face is the +row face), `right` on a wall running along rows (+col face). They sort on the attached layer, after their wall tile.

## Colorize

`webview-ui/src/office/colorize.ts` has two modes, selected by the `ColorValue.colorize?` flag:

- **Colorize** (Photoshop-style): grayscale → luminance → contrast → brightness → fixed HSL. Always used for floor tiles.
- **Adjust** (default for furniture and character hue shifts): shifts the original pixel's HSL. `adjustSprite()` is exported for character hue shifts.

The cache is keyed by an arbitrary string that includes the colorize flag.

## Floors, walls and carpets

- **Floors**: `assets/floors/floor_0.png` to `floor_8.png`, 16×16 each, one material per index (slabs, tiles, planks, bricks, checkerboards), each carrying the key light as a bright seam and a darker inset edge. Cached by (pattern, h, s, b, c), and projected onto 32×16 diamonds (`projectToDiamond`).
- **Walls**: the iso walls are procedural boxes, see [renderer.md](renderer.md#layout). The server still loads and sends `walls.png` sets (`wallTilesLoaded`), which the webview no longer uses.
- **Carpets**: `webview-ui/src/office/sprites/carpetTiles.ts` caches carpet sprites with dual-colour colorization for marching-squares autotiling.

## Character sprites

12 pre-coloured agent sheets (`assets/characters/char_0.png` to `char_11.png`, `CHAR_COUNT`), one per palette, plus the CTO's `cto.png` (`CTO_CHARACTER_FILE`). Each is 608×168: 19 frames × 32 px wide, 3 direction rows × 56 px tall (`CHAR_FRAME_W`, `CHAR_FRAME_H`). Row 0 is DOWN (3/4 front, facing screen lower-left), row 1 is UP (3/4 back), row 2 is RIGHT (row 0 mirrored per frame). LEFT is the mirrored UP at runtime.

The frame order is `CHARACTER_FRAMES` in `core/src/assets/constants.ts`: walk1–3, type1–2, read1–2, idle1–2, rest1–2, raiseHand1–2, raiseHandSeated1–2, holdForm1–2, holdFormSeated1–2. `decodeCharacterPng` rejects a sheet of any other size. When `hueShift !== 0`, `hueShiftSheet()` applies `adjustSprite()` to every frame before the pose sets are built and cached.

## Load order

On `webviewReady` the server sends, in order:

`characterSpritesLoaded` → `petSpritesLoaded` → `floorTilesLoaded` → `wallTilesLoaded` → `carpetTilesLoaded` → `furnitureAssetsLoaded` → `layoutLoaded`

Each asset message is skipped when its part of the cache is missing. Agent state follows `layoutLoaded`.

## Editor tools

`scripts/` keeps three standalone HTML tools, opened directly in a browser:

- `asset-manager.html`: furniture editor for positions and metadata, with Save and Save As via the File System Access API.
- `wall-tile-editor.html`: wall sprite editor.
- `jsonl-viewer.html`: transcript inspector.
