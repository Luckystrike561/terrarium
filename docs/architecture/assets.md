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

Furniture, characters and floors are all **AI-generated with [PixelLab](https://pixellab.ai)**; only the default layout is authored directly. Edit the generators, not the PNGs.

- `npx tsx scripts/iso-art/layout.ts` rebuilds the bundled default office as `default-layout-<REVISION>.json`. Bump `REVISION` on every change. It composes the layout from `core/src/officeModules.ts` (see [renderer.md](renderer.md#layout-modules)) rather than authoring tiles directly: the bundled default is one team module plus the CTO module.

## Default layout

`loadDefaultLayout()` (`server/src/assetLoader.ts`) scans `assets/` for `default-layout-<N>.json` and serves the one with the highest `N`, stamping `layoutRevision` from `N` when the file has none. It falls back to an unversioned `default-layout.json` only when no versioned file exists. The server serves the bundled default only when `~/.terrarium/layout.json` does not exist, so a saved layout is never replaced by a newer default.

## Furniture

**Per-furniture manifests.** Each item lives in its own folder under `assets/furniture/` with a `manifest.json` that declares its sprites, rotation groups, state groups (on/off) and animation frames. The server builds its catalog from these manifests when it loads assets.

**Generated with PixelLab, not drawn by code.** Each of the 42 furniture ids is a [PixelLab](https://pixellab.ai) map-object render: `scripts/pixellab/furniture.ts` generates a `front` view per item, downloading every raw frame to `scripts/pixellab/furniture-frames/<ITEM>/` (gitignored), then crops it to its opaque content and upscales by the largest integer factor that still fits the item's required width (never a smooth scale) before packing it into the asset folder. A text-only render faces either diagonal at random, and two separate renders never share a design, so seats, desks and long tables are `turnaround` items: their front render seeds one PixelLab 8-direction object, whose `south-west` view becomes `front` (facing screen lower-left) and `north-east` view becomes `back`. `right` reuses `front` mirrored and `left` reuses `back` mirrored, with no extra PixelLab call. Electronics' on/off and animation frames are chained from the idle render via `init_image` so a lit screen stays visually close to its dark one. The computer, the coffee machine and the wall TV are `stillOn`: every on frame shows the first, since cycling separate renders made them jump. The renderer anchors every item at the floor, so an item made for a desk or the kitchen counter carries that surface's height as transparent rows under it (`surfaceLift`), and a hung wall item carries the rows that put its centre at eye level on the wall (`hang`). `scripts/pixellab/furniture.json` records every prompt, seed and PixelLab object id, so a rerun is auditable and resumable (an existing raw frame is never re-requested), and writes its own review contact sheets to `/tmp/furniture-review/`. A rerun is not guaranteed byte-identical (the AI model is not deterministic) but keeps the same prompt and framing. Every manifest keeps its id, footprint and orientation/state groups regardless, since those come straight from the existing manifest being replaced, not from the generator's own judgment.

**Proportions.** PixelLab renders each item at its own scale, so items whose render is out of proportion with the room carry a `resize` fraction, applied with PixelLab's pixel-art resize. Each fraction brings the item's content size to twice (`ART_SCALE`) the content size of the procedural item it replaced, which had the room's proportions right: chairs, computers, the coffee machine and the executive desk shrink, the sofa, bin and pot grow. Characters are drawn at `CHARACTER_SCALE` to the same reference (see [renderer.md](renderer.md#characters)).

**Kitchen units.** The counter, the sink and the cooker fill their whole tile, so a row of them joins into one continuous worktop. The default canvas (the sprite's width, its height plus 110) makes a low unit come back tall and a narrow canvas leaves no room for detail, so these three render on a 128 px square `canvas` and are resized to the 64 px tile. The sink and the cooker are rendered from the counter's raw front through `init_image` (`initFrom`), so all three share one body, height and palette. The upper cupboard is rendered from the counter the same way and lifted (`surfaceLift`) so it tops out level with the wall, standing in the run above the cooker and the sink instead of hanging flat as wall art. The fridge is rendered on a tall canvas at a person's height. PixelLab's resize can turn an item to face the other diagonal whichever way its input faced, so `mirrorResizedFront` turns a resized front back.

**Catalog.** `furniture-catalog.json` is not a source file. The webview build generates it from the manifests (`buildFurnitureCatalog` in `core/src/assets/build.ts`, called from `webview-ui/vite.config.ts`), and the Vite dev server serves the same thing at `/assets/furniture-catalog.json`. Entries carry `id, name, label, category, footprint, isDesk, canPlaceOnWalls, groupId?, orientation?, state?, canPlaceOnSurfaces?, backgroundTiles?`. Categories: desks, chairs, storage, electronics, decor, wall, misc. The naming convention is `{BASE}[_{ORIENTATION}][_{STATE}]`, for example `MONITOR_FRONT_OFF`.

**Iso sprite anchor contract.** An item with footprint fw×fh is `(fw+fh)*16*ART_SCALE` art px wide, and its floor diamond touches the image's left, right and bottom edges (`footprintSpriteOrigin`, which divides the sprite's art-pixel dimensions by `ART_SCALE` to place it in world units). Sprites of any other width are treated as flat art and stand centered on the footprint. Orientation is the facing direction on the grid (front = +row, screen lower-left, right = +col, back, left), and rotated footprints are transposed. Desk tops are at z=12 (`DESK_SURFACE_Z`), chair seats at z=6, back walls are 56 world units tall, and surface items are drawn starting at desk height.

**Rotation groups.** `buildDynamicCatalog()` builds a `rotationGroups` Map from assets sharing a `groupId`. Any 2+ orientations are supported (for example front and back only). `getOrientationInGroup()` tells the renderer when a `left` member should be drawn mirrored.

**State groups.** Items with `state: "on"` / `"off"` sharing the same `groupId` and `orientation` form on/off pairs (`stateGroups`, `getOnStateType()`), mirrored across orientations.

**Placement flags.**

- `backgroundTiles?: number`: characters can walk through the top N footprint rows. The iso set uses 0 everywhere.
- `canPlaceOnSurfaces?: boolean`: monitors, mugs and the like sit on `isDesk` furniture tiles and sort on the attached layer, after the desk.
- `canPlaceOnWalls?: boolean`: paintings, clocks, shelves and whiteboards are wall-mounted. `front` mounts on a wall running along cols (its visible face is the +row face), `right` on a wall running along rows (+col face). A wall item's art is drawn flat and is wider than one tile's face, so it sorts as a zero-depth box on the wall face stretched over the wall tiles it spills onto (`wallFaceBox` in `layoutSerializer.ts`): after every wall tile it covers, before anything standing in front of the wall.

## Colorize

`webview-ui/src/office/colorize.ts` has two modes, selected by the `ColorValue.colorize?` flag:

- **Colorize** (Photoshop-style): grayscale → luminance → contrast → brightness → fixed HSL. Opt-in (carpets' flat fill).
- **Adjust** (default for furniture, floor tiles and character hue shifts): shifts the original pixel's HSL. `adjustSprite()` is exported for character hue shifts.

The cache is keyed by an arbitrary string that includes the colorize flag.

## Floors, walls and carpets

- **Floors**: `assets/floors/floor_0.png` to `floor_8.png`, 32×32 each (`FLOOR_TILE_SIZE`), one full-color PixelLab material per index (slab, tiles, planks, bricks, checkerboards: see [art-direction.md](../art-direction.md)). A neutral `tileColors` entry shows the material untouched; any other value tints it with Adjust mode. Cached by (pattern, h, s, b, c), and projected onto 64×32 diamonds (`projectToDiamond`), drawn at half size so the world footprint stays a 32×16 tile.
- **Walls**: the iso walls are procedural boxes, see [renderer.md](renderer.md#layout). The server still loads and sends `walls.png` sets (`wallTilesLoaded`), which the webview no longer uses.
- **Carpets**: `webview-ui/src/office/sprites/carpetTiles.ts` caches carpet sprites with dual-colour colorization for marching-squares autotiling.

## Character sprites

12 pre-coloured agent sheets (`assets/characters/char_0.png` to `char_11.png`, `CHAR_COUNT`), one per palette, plus the CTO's `cto.png` (`CTO_CHARACTER_FILE`). Each is 2208×288: 23 frames × 96 px wide, 3 direction rows × 96 px tall (`CHAR_FRAME_W`, `CHAR_FRAME_H`), 2 art px per world unit (`ART_SCALE`). Row 0 is DOWN (3/4 front, facing screen lower-left), row 1 is UP (3/4 back), row 2 is RIGHT (row 0 mirrored per frame). LEFT is the mirrored UP at runtime.

Like the floors and furniture, the characters are AI-generated with [PixelLab](https://pixellab.ai). `scripts/pixellab/cast.json` records the 13 character descriptions (12 workers + the CTO), their seeds and the PixelLab character/animation ids the run produced, so a regeneration is auditable and resumable. `scripts/pixellab/generate.ts` creates each standing character, a seated state for it, and nine animations (walk, idle, wave and holdForm standing; type, read, rest, waveSeated and holdFormSeated seated) in both `south-west` (DOWN) and `north-east` (UP) directions, downloading every raw frame to `scripts/pixellab/frames/<character>/` (gitignored). `scripts/pixellab/pack.ts` then picks one frame per `CHARACTER_FRAMES` slot …

The frame order is `CHARACTER_FRAMES` in `core/src/assets/constants.ts`: walk1–3, type1–4, read1–4, idle1–2, rest1–2, raiseHand1–2, raiseHandSeated1–2, holdForm1–2, holdFormSeated1–2. `decodeCharacterPng` rejects a sheet of any other size. When `hueShift !== 0` (repeated palettes beyond the 12 bundled sheets), `hueShiftSheet()` applies `adjustSprite()` to every frame before the pose sets are built and cached.

`characterSpritesLoaded` carries each sheet as the raw PNG file, base64-encoded (`CharacterSpriteSet { png: string }`), not per-pixel hex arrays: at this sheet size, hex-string JSON ran to 29.5 MB and stalled page load. The server only decodes a sheet to validate its dimensions (`decodeCharacterPng`'s size check) before sending the base64 bytes. The webview decodes each sheet itself with `createImageBitmap` and canvas `getImageData`, then `characterPixelsToFrames()` (`core/src/assets/characterPixels.ts`) slices the RGBA pixels into the same frame arrays `decodeCharacterPng` would have produced, so rendering is byte-identical either way. `setCharacterTemplates()` (`webview-ui/src/office/sprites/spriteData.ts`) stays synchronous; the async decode (`webview-ui/src/office/sprites/decodeCharacterSheet.ts`) calls it once every sheet resolves, and `getCharacterSprites()` / `getCtoSprites()` render the transparent placeholder sheet for any character created before then.

## Load order

On `webviewReady` the server sends, in order:

`characterSpritesLoaded` → `petSpritesLoaded` → `floorTilesLoaded` → `wallTilesLoaded` → `carpetTilesLoaded` → `furnitureAssetsLoaded` → `layoutLoaded`

Each asset message is skipped when its part of the cache is missing. Agent state follows `layoutLoaded`.

## Editor tools

`scripts/` keeps three standalone HTML tools, opened directly in a browser:

- `asset-manager.html`: furniture editor for positions and metadata, with Save and Save As via the File System Access API.
- `wall-tile-editor.html`: wall sprite editor.
- `jsonl-viewer.html`: transcript inspector.
