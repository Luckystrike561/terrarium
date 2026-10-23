# Asset system

Bundled assets live in `webview-ui/public/assets/`. `esbuild.js` copies that directory to `dist/assets/`, and the server loads it from there. PNGs are decoded with pngjs into `SpriteData` (a 2D hex array: alpha ≥ `PNG_ALPHA_THRESHOLD` (2) is visible, `#RRGGBBAA` for semi-transparent pixels). The decoders live in `core/src/assets/` and the server side in `server/src/assetLoader.ts`.

```
webview-ui/public/assets/
  office-manifest.json  the office manifest, generated
  characters/          char_0.png … char_11.png, cto.png
  floors/              floor_0.png … floor_8.png
  furniture/<ITEM>/    manifest.json + PNGs, one folder per item
  carpets/  pets/  walls/
  default-layout-<N>.json
```

## Generated art

The bundled furniture, characters and floors are **generated** to the art direction in [`docs/art-direction.md`](../art-direction.md). Edit the generators, not the PNGs.

- `npx tsx scripts/iso-art/generate.ts` (`npm run assets:generate`) rewrites `assets/furniture/`, `assets/characters/`, `assets/floors/` and `assets/office-manifest.json` from code, then validates the result and exits non-zero on any mismatch. `scripts/iso-art/furniture/*.ts` model furniture with the `IsoScene` ray tracer in `scripts/iso-art/lib/scene.ts`. `scripts/iso-art/characters.ts` composes hand-placed pixel templates from `scripts/iso-art/characters/`. `scripts/iso-art/floors.ts` draws the lit floor materials.
- `npx tsx scripts/iso-art/layout.ts` rebuilds the bundled default office (open-plan work space, glass-walled CTO office and meeting room, break room with kitchen, coffee machine and lounge) as `default-layout-<REVISION>.json`. Bump `REVISION` on every change.
- `npx tsx scripts/iso-art/preview.ts <module>` renders review sheets to `/tmp/iso-preview` without touching assets.

## Office manifest

`assets/office-manifest.json` is one versioned, machine-readable document that describes every furniture item, character sheet, pet sheet, tile texture and animation the office uses. It is the only geometry source a client needs: footprints, anchors, heights and frame timings are read from it, never from a renderer constant or a filename. The types and field semantics live in `core/src/assets/officeManifest.ts`.

The art pipeline writes it (`scripts/iso-art/manifest.ts`, called by `generate.ts`) from the furniture specs, the shared constants in `core/src/assets/constants.ts` and the sheets on disk. The webview reads the same constants, so changing a constant moves the manifest and today's renderer together.

| Section         | What it carries                                                                                                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | `OFFICE_MANIFEST_SCHEMA_VERSION` (1). A client rejects a version it does not know. Bump it on any change an older client would misread                                                                                                                                                                                 |
| `projection`    | `tileSize` world px per tile, the `isoTileWidth` × `isoTileHeight` diamond                                                                                                                                                                                                                                             |
| `tiles`         | Floor tile value → `floors/floor_N.png` and its texture size, the wall tile value with the solid and glass wall heights, the void tile value, and the carpet marching-squares sheets (piece size, grid, corner bits)                                                                                                   |
| `furniture[]`   | Per item: `placement` (floor, surface, wall), `footprint` (width × depth in tiles), `heightZ`, `seatZ` when sittable, `occlusionSplitZ` when a backrest occludes by depth. Per variant: orientation, state, footprint, frame size, `anchor`, frames with their catalog ids and files, `frameDurationSec` when animated |
| `characters`    | Frame size, feet `anchor`, `seatedAnchor`, frame names, facings (sheet row, mirrored), animations (sheet columns, frame duration, seated) and the sheets                                                                                                                                                               |
| `pets`          | Sheet size, each animation's step sequence and frame duration, the strip of frames per facing with its anchor, and the sheets                                                                                                                                                                                          |

A furniture variant's `anchor` is the sprite pixel on the top vertex of the item's first tile at floor level, so a sprite is drawn at `tileCorner(col, row) - anchor`. Surface and wall items carry their lift in the art and anchor on the floor too. A character's `anchor` sits on the floor point under its feet, and a seated animation's `seatedAnchor` sits on the seat point: the seat tile's centre at the chair's `seatZ`.

**Validation.** `npm run assets:validate` (`scripts/validate-assets.ts`, over `validateOfficeManifest` in `core/src/assets/officeManifestValidation.ts`) checks the manifest against every sheet and prints one line per mismatch, naming the asset with the expected and actual value, then exits non-zero. It checks the schema version and that every top-level section is present, every sheet's size against its declared frame grid (a lost frame or facing row), every facing row, furniture frame and carpet piece but the empty junction for content (an erased facing or piece), every anchor inside its frame and on the footprint's top vertex, furniture widths against their footprints, seat heights against the seated character frames, and that every sheet on disk and every piece, floor and carpet the default layout uses is described. `npm run build` and `npm run package` run it, and so does the `Assets` workflow on every push and pull request, together with `server/__tests__/officeManifest.test.ts`, which corrupts copies of the bundled sheets and expects each mismatch to be caught. The same workflow reruns `npm run assets:generate` and fails if anything under `webview-ui/public/assets` changes, so a manifest left stale by a constant edit fails in CI even when the pre-push hook was skipped.

**Where each renderer constant lives in the manifest.**

| Renderer fact                                                                | Manifest field                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `TILE_SIZE`, `ISO_TILE_W`, `ISO_TILE_H`                                      | `projection`                                                   |
| `footprintSpriteOrigin` and its anchor contract                              | `furniture[].variants[].anchor`, `footprint`, `frameSize`      |
| `WALL_HEIGHT_PX`, `WALL_GLASS_HEIGHT_PX`, `TileType.WALL` / `VOID`           | `tiles.wall`, `tiles.voidTile`                                 |
| Floor value `N` → `floor_{N-1}.png`, `projectToDiamond`                      | `tiles.floor`                                                  |
| Carpet `carpetJunctionCase` bits, piece grid                                 | `tiles.carpet`                                                 |
| `category === 'chairs'` sittable test, chair seat height                     | `furniture[].seatZ`                                            |
| Chair backrest drawn over its sitter                                         | `furniture[].occlusionSplitZ` with the variant's `orientation` |
| `FURNITURE_FRAME_DURATION_SEC`, animation groups                             | `furniture[].variants[].frames`, `frameDurationSec`            |
| `CHAR_FRAME_W`, `CHAR_FRAME_H`, `CHARACTER_FRAMES`, rows and the LEFT mirror | `characters.frameSize`, `frameNames`, `facings`                |
| `CHARACTER_ANIMATIONS` (walk cycle, pose loops, durations)                   | `characters.animations`                                        |
| Bottom-centre feet anchor, seated frames drawn at chair height               | `characters.anchor`, `characters.seatedAnchor`                 |
| Pet sheet layout, `PET_ANIMATIONS`                                           | `pets`                                                         |

## Default layout

`loadDefaultLayout()` (`server/src/assetLoader.ts`) scans `assets/` for `default-layout-<N>.json` and serves the one with the highest `N`, stamping `layoutRevision` from `N` when the file has none. It falls back to an unversioned `default-layout.json` only when no versioned file exists. The server serves the bundled default only when `~/.terrarium/layout.json` does not exist, so a saved layout is never replaced by a newer default.

## Furniture

**Per-furniture manifests.** Each item lives in its own folder under `assets/furniture/` with a `manifest.json` that declares its sprites, rotation groups, state groups (on/off) and animation frames. The server builds its catalog from these manifests when it loads assets.

**Catalog.** `furniture-catalog.json` is not a source file. The webview build generates it from the manifests (`buildFurnitureCatalog` in `core/src/assets/build.ts`, called from `webview-ui/vite.config.ts`), and the Vite dev server serves the same thing at `/assets/furniture-catalog.json`. Entries carry `id, name, label, category, footprint, isDesk, canPlaceOnWalls, groupId?, orientation?, state?, canPlaceOnSurfaces?, backgroundTiles?`. Categories: desks, chairs, storage, electronics, decor, wall, misc. The naming convention is `{BASE}[_{ORIENTATION}][_{STATE}]`, for example `MONITOR_FRONT_OFF`.

**Iso sprite anchor contract.** An item with footprint fw×fh is `(fw+fh)*16` px wide, and its floor diamond touches the image's left, right and bottom edges (`footprintSpriteOrigin`). Sprites of any other width are treated as flat art and stand centered on the footprint. Orientation is the facing direction on the grid (front = +row, screen lower-left, right = +col, back, left), and rotated footprints are transposed. Desk tops are at z=12 (`DESK_SURFACE_Z`), chair seats at z=6, walls are 40 px tall, and surface items are drawn starting at desk height.

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

12 pre-coloured agent sheets (`assets/characters/char_0.png` to `char_11.png`, `CHAR_COUNT`), one per palette, plus the CTO's `cto.png` (`CTO_CHARACTER_FILE`). Each is 456×120: 19 frames × 24 px wide, 3 direction rows × 40 px tall (`CHAR_FRAME_W`, `CHAR_FRAME_H`). Row 0 is DOWN (3/4 front, facing screen lower-left), row 1 is UP (3/4 back), row 2 is RIGHT (row 0 mirrored per frame). LEFT is the mirrored UP at runtime.

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
