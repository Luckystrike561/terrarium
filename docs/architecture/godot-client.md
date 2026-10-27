# Godot client

The Godot client is the office renderer that replaces the Pixi one at cutover. Until then it is a second, independent web build served next to the current client: the current client keeps `/`, the Godot export lives under `/godot/`. Today it draws the first floor's office, still: floor, carpets, walls and furniture, with the current client's camera rules. Characters, animations and live data come in later issues.

## Layout

```
godot/                       Godot 4 project (open this directory in the editor)
  project.godot              Rendering settings (below)
  export_presets.cfg         The one "Web" preset: single-threaded, no GDExtension, no PWA
  icon.png, icon.png.import  The tab icon (a copy of the repo's icon.png) and its import settings, uid included
  scenes/office.tscn         Main scene: Office (root) → OfficeMap, Camera, Feed, Assets
  scripts/office.gd          Loads manifest, layout and sheets, builds the map, marks the first frame, publishes the view
  scripts/office_feed.gd     The layout, from the /ws handshake (webviewReady → layoutLoaded)
  scripts/office_assets.gd   The office manifest and sprite sheets, from /assets/
  scripts/server_origin.gd   The server's origin: the page's in the export, npm run dev's in the editor
  scripts/office_manifest.gd The office manifest: projection, tile textures, furniture frames and anchors
  scripts/office_layout.gd   The layout, with the current client's legacy migrations
  scripts/tile_grid.gd       Tile values on the grid: walls, void, back walls, content bounds
  scripts/office_map.gd      Builds the map: slab, floor and carpet TileMapLayers, walls and furniture in draw order
  scripts/office_camera.gd   Fit, wheel zoom, drag pan, pan clamp
  scripts/colorize.gd, wall_sprites.gd, carpet_sprites.gd, iso_sort.gd, iso_projection.gd
                             Ports of the current client's colouring, wall tracer, carpet autotiling, draw order and projection
  web-export.sha256          SHA-256 of every file Godot exports (not the .br/.gz siblings), committed
scripts/godot/
  pin.mjs                    The pinned Godot release and the hashes of what is downloaded
  export.mjs                 npm run godot:export
  check.mjs                  npm run godot:check
  officeReference.ts         The current client's office rasterised in Node, the reference godot:check compares against
  everyFurnitureLayout.mjs   The check's layout with every furniture frame of the manifest
  zip.mjs                    Reads single ZIP members, from a buffer or by HTTP range
```

Scenes carry their `uid` and every node its `unique_id`, and every script has its `.gd.uid`. Godot invents random ones for anything missing on each import, and they end up in `index.pck`, so a file without them makes the export differ from run to run. The editor writes them on save. A scene written by hand needs them added before it is committed.

## Rendering settings

| Setting                       | Value                                           | Why                                                                                    |
| ----------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Internal resolution           | 640 × 360                                       | Fixed. The office is laid out in these pixels                                          |
| Stretch                       | `viewport`, aspect `keep`, scale mode `integer` | The 640 × 360 frame is scaled by whole numbers only, letterboxed                       |
| Canvas texture filter         | Nearest                                         | No smoothing between texels                                                            |
| MSAA 2D / 3D, screen-space AA | Off                                             | Antialiasing blurs pixel edges                                                         |
| Texture import mipmaps        | Off                                             | Mipmaps blur sprites drawn below 1:1                                                   |
| 2D snap                       | Transforms and vertices to pixel                | No half-pixel shimmer                                                                  |
| Renderer                      | `gl_compatibility` everywhere                   | The only renderer the web export runs. Forward+ would fall back with a console warning |

The camera angle is the office manifest's projection: a tile is a 32 × 16 diamond, the same 2:1 dimetric view the Pixi renderer draws.

## The office

Nothing about the office is authored twice. The client reads what the server already serves the current client:

- **Layout.** It opens `/ws`, sends `webviewReady` and takes the first floor's layout from the `layoutLoaded` reply, then closes the socket. That is `~/.terrarium/layout.json` when it exists, otherwise the bundled default, in the same JSON, migrated the way the current client migrates it (`OfficeLayout`). The handshake also carries every sprite as hex strings in messages of several MB, so the peer's inbound buffer is sized for them. Other floors, characters and live state are not read yet.
- **Geometry and art.** `assets/office-manifest.json` (schema version 1, anything else is refused) and the PNG sheets it names, fetched from `/assets/`. Only the sheets the layout uses are fetched. Pixels under the server decoder's alpha threshold (2) are cleared, as the server clears them.

`OfficeMap` builds the static office once, in iso pixels with the top vertex of tile (0, 0) at its origin, in the current client's order: the floor slab, the floor (one `TileMapLayer` on an isometric `TileSet` whose atlas holds each colourised floor diamond once), the carpets (one `TileMapLayer` per stacking order at a corner, marching-squares pieces in their two colours), then walls and furniture as `Sprite2D`s in the iso draw order of their footprint boxes. A furniture frame stands at `tileCorner(col, row) - anchor`, its anchor and footprint read from the manifest. Walls are traced per pixel as the current client traces them, and the colours they and the slab use mirror the webview's constants. Furniture types the manifest lacks are skipped with a warning, as the current client skips types its catalog lacks. Animated furniture shows the frame the layout places.

### Camera

`OfficeCamera` moves and scales the map the way the current client moves its world layer, inside the 640 × 360 frame: the grid centred, then panned, both rounded to whole pixels.

- **Fit.** On load, the largest whole zoom at which the office (its non-void tiles, raised by a back wall's height) fits the frame, clamped to `ZOOM_MIN` (1) and `ZOOM_MAX` (4), centred. The current client fits at a fractional zoom instead. Here the frame is scaled by whole numbers to the window, so every zoom step stays whole on screen.
- **Zoom.** One wheel notch is one zoom step, from `ZOOM_MIN` (1) to `ZOOM_MAX` (4), keeping the office point under the cursor in place. The current client has no user zoom.
- **Pan.** Dragging with the left or middle button pans, and every pan goes through the current client's `clampPan` rule: an axis larger than the frame scrolls but never past the office edge, a smaller one stays centred.

The sky backdrop the current client draws behind the office is not ported: the clear colour shows where it would, including through the glass partitions.

Nor is the building's slab. Once a connection to another host adds a floor, the current client draws every floor, the first included, on a `BUILDING_SLAB_PX` (12) slab, while `OfficeMap` always draws a lone office's `FLOOR_SLAB_PX` (5). `godot:check` runs with no connection, so it never compares that case.

## Building the export

```bash
npm run godot:export
```

From a clean checkout this is the only step. It:

1. Downloads the pinned Godot editor (`scripts/godot/pin.mjs`, Linux x86_64 and arm64) and checks its SHA-512 against the value copied from the release's `SHA512-SUMS.txt`.
2. Reads `templates/web_nothreads_release.zip` out of the 1.3 GB export templates archive by HTTP range, without downloading the rest, and checks its pinned SHA-256.
3. Keeps both under `.cache/godot/<version>/`, with a `_sc_` marker so Godot runs self-contained and never touches `~/.local/share/godot`.
4. Copies `godot/` without `.godot/` to a temporary directory, imports it and exports the `Web` preset into `dist/godot/`.
5. Writes a Brotli (quality 11) and a gzip (level 9) sibling for every `.html`, `.js`, `.wasm` and `.pck`.
6. Rewrites `godot/web-export.sha256` from the files step 4 exported, siblings excluded.

The export is deterministic on the pinned Linux x86_64 and arm64 editors: from the same commit, Godot exports byte-identical files. `godot/web-export.sha256` records only those, not the `.br` and `.gz` siblings, because their bytes depend on the zlib and Brotli Node was built with. A Node linked against the system zlib, the devbox one included, writes different `.gz` siblings. The `Godot` workflow runs the same command and fails when `godot/web-export.sha256` changes, so a commit that changes the export must commit the new checksums too. Bumping Godot means changing `VERSION` and every hash in `pin.mjs`.

The export is not part of `npm run build`, the npm package or the Docker image yet.

## Serving

`createHttpServer` serves `dist/godot/` under `/godot/` when that directory exists at startup (`GODOT_ROUTE_PREFIX`, `GODOT_EXPORT_DIR` in `server/src/constants.ts`). It checks once, so a first export needs a server restart, while a re-export over an existing `dist/godot/` is served at once because every file is read per request. `@fastify/static` with `preCompressed` picks the `.br` or `.gz` sibling by `Accept-Encoding` and keeps the original's `Content-Type` (`application/wasm` for the wasm, which streaming compilation requires). A missing file is a 404, not the current client's `index.html`, and `/godot` redirects to `/godot/` because the export loads its files by relative URL. The build is single-threaded, so it needs no cross-origin isolation headers. Every other route is unchanged.

## Budget

|                                                | Budget      | Measured (Godot 4.7.2)                                        |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------- |
| Compressed payload                             | under 25 MB | 7.3 MB (`index.wasm` 7.1 MB Brotli, from 39.5 MB, and sheets) |
| Office on screen on a 100 Mbit/s LAN, 2 ms RTT | under 4 s   | 2.3 s                                                         |
| Console errors and warnings                    | none        | none                                                          |

`npm run godot:check` enforces it, after `npm run build` and `npm run godot:export`. It starts the real server with a throwaway `HOME`, opens `/godot/` in Chromium throttled to that LAN, and fails on any console error or warning, on an uncompressed `.html`, `.js`, `.wasm` or `.pck` response, on a wasm not sent as `application/wasm`, or past either budget. The first frame is the `terrarium:first-frame` performance mark `office.gd` sets after the first frame with the office in it is drawn, measured from navigation start. Chromium renders WebGL through SwiftShader for the check on every machine, as a CI runner without a GPU does anyway, because headless Chromium on a GPU reads each WebGL frame back and the driver logs "GPU stall due to ReadPixels" warnings that a headed browser never shows. For the same reason the client never reads a texture back: its `TileSetAtlasSource`s have texture padding off, since padding reads the atlas back from the GPU.

The check also holds the drawn office to the current client's, pixel for pixel. `scripts/godot/officeReference.ts` rasterises the office from the server's own asset cache through the webview's own layout migration, colouring, wall tracer, carpet autotiling, tile and furniture placement and draw order, and only reimplements the compositing WebGL does. For each view the check reads the zoom and the office origin `office.gd` publishes as `window.__terrariumGodot`, requires every Godot pixel to be one uniform 2 × 2 block of the 1280 × 720 canvas (no filtering, no half-pixel offset) and to match the reference within 2 per channel, and saves both frames to `test-results/godot-check/<view>/` when they differ, which the workflow uploads as the `godot-check-frames` artifact when it fails. It does so:

- with the bundled default layout: at the fitted view (the zoom and origin the current client's `fitZoom`, floored, and `centeredPan` give), at each wheel step in to `ZOOM_MAX` and back out to `ZOOM_MIN` with the cursor off the frame centre (one notch, one step, the office point under the cursor kept in place, then the origin the current client's `clampPan` gives), dragged past each corner at every zoom (the origin the current client's `clampPan` gives), and after a 7 px drag from the last corner, which is 3.5 Godot pixels (the origin `clampPan` gives that drag).
- with `everyFurnitureLayout.mjs` as `~/.terrarium/layout.json`: every furniture frame of the manifest, both furniture colour modes, every floor texture, wall colours with and without a tile colour, default-coloured and stacked carpets, at the fitted view and dragged to each corner, which together show the whole office.

The LAN is emulated: the check loads `/godot/` from `127.0.0.1` and throttles it, and browsers treat loopback as a secure context. A browser on another machine that reaches the server over plain HTTP (`--host 0.0.0.0`, as the Docker image runs) does not run the export yet. The web shell stops at its feature check with `Secure Context - Check web server configuration (use HTTPS)`, and past that check the engine's audio driver needs `AudioWorklet`, which browsers expose only in a secure context. The Godot client has to run for a plain-HTTP LAN browser before cutover.
