# Godot client

The Godot client is the office renderer that replaces the Pixi one at cutover. Until then it is a second, independent web build served next to the current client: the current client keeps `/`, the Godot export lives under `/godot/`. Today it draws an empty isometric grid and nothing else. The map, furniture, characters and live data come in later issues.

## Layout

```
godot/                       Godot 4 project (open this directory in the editor)
  project.godot              Rendering settings (below)
  export_presets.cfg         The one "Web" preset: single-threaded, no GDExtension, no PWA
  icon.png, icon.png.import  The tab icon (a copy of the repo's icon.png) and its import settings, uid included
  scenes/office.tscn         Main scene: Office (root) → IsoGrid, Camera
  scripts/office.gd          Centres the camera on the grid, marks the first frame
  scripts/iso_grid.gd        Draws the 20 × 20 placeholder grid
  web-export.sha256          SHA-256 of every file Godot exports (not the .br/.gz siblings), committed
scripts/godot/
  pin.mjs                    The pinned Godot release and the hashes of what is downloaded
  export.mjs                 npm run godot:export
  check.mjs                  npm run godot:check
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

|                                           | Budget      | Measured (Godot 4.7.2)                            |
| ----------------------------------------- | ----------- | ------------------------------------------------- |
| Compressed payload                        | under 25 MB | 7.2 MB (`index.wasm` 7.1 MB Brotli, from 39.5 MB) |
| First frame on a 100 Mbit/s LAN, 2 ms RTT | under 4 s   | 2.9 s                                             |
| Console errors and warnings               | none        | none                                              |

`npm run godot:check` enforces it, after `npm run build` and `npm run godot:export`. It starts the real server with a throwaway `HOME`, opens `/godot/` in Chromium throttled to that LAN, and fails on any console error or warning, on an uncompressed `.html`, `.js`, `.wasm` or `.pck` response, on a wasm not sent as `application/wasm`, when the grid's line colour is missing from the canvas, or past either budget. The first frame is the `terrarium:first-frame` performance mark `office.gd` sets after the first frame is drawn, measured from navigation start. Chromium renders WebGL through SwiftShader for the check on every machine, as a CI runner without a GPU does anyway, because headless Chromium on a GPU reads each WebGL frame back and the driver logs "GPU stall due to ReadPixels" warnings that a headed browser never shows.

The LAN is emulated: the check loads `/godot/` from `127.0.0.1` and throttles it, and browsers treat loopback as a secure context. A browser on another machine that reaches the server over plain HTTP (`--host 0.0.0.0`, as the Docker image runs) does not run the export yet. The web shell stops at its feature check with `Secure Context - Check web server configuration (use HTTPS)`, and past that check the engine's audio driver needs `AudioWorklet`, which browsers expose only in a secure context. The Godot client has to run for a plain-HTTP LAN browser before cutover.
