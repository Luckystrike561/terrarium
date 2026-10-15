# Office renderer and UI

The webview (`webview-ui/`) is React 19 for the HUD and DOM overlays, and PixiJS (WebGL) for the office itself. Paths below are relative to `webview-ui/src/` unless stated otherwise.

## Rendering

Game state lives in the imperative `Building` class (`office/engine/building.ts`), a stack of `OfficeState` floors (`office/engine/officeState.ts`), not in React state. It is rendered as **2:1 isometric pixel art** through a PixiJS retained scene graph (`office/engine/sceneRenderer.ts`), not Canvas 2D.

- **Projection.** The simulation (pathfinding, seats, layout) stays on the top-down tile grid. Only drawing and hit-testing go through `office/iso.ts`: `isoX = x - y`, `isoY = (x + y)/2 - z`, and a tile is a 32×16 diamond.
- **Pixels.** Zoom is device pixels per sprite pixel, with `antialias: false`, `roundPixels: true` and nearest-neighbor texture sampling. There is no `ctx.scale(dpr)`: the Application's `resolution` stays 1 and the canvas backing store is sized in device pixels directly.
- **World layer.** World-space sprites (tiles, furniture, characters, pets, the pet bubble) live in one `worldLayer` container, positioned and scaled once per frame (`position = (offsetX, offsetY)`, `scale = zoom`) and built in local, unscaled iso pixel coordinates. Each floor is one child container of it, raised by the floor's elevation. Area labels and floor names render in device-pixel space directly, since their minimum font size is deliberately constant in device pixels.
- **Textures.** `office/sprites/textureCache.ts` turns `SpriteData` into one `PIXI.Texture` per sprite, regardless of zoom.
- **CSP.** `pixi.js/unsafe-eval` is imported before any renderer is created, so a CSP without `unsafe-eval` never blocks Pixi's uniform-buffer sync path.
- **Game loop.** `office/engine/gameLoop.ts` is a rAF loop with a delta-time cap of 0.1 s, decoupled from the render target.

### Backdrop

The stage's first child, behind `worldLayer`, is a screen-space sprite of the office's daylight sky and city, a banded sky with pixel clouds over a daytime city (`office/backdrop.ts`, colours `BACKDROP_*` in `constants.ts`), covering the whole canvas. The fit bands, VOID tiles and any pan show sky instead of the container's `#1e1e2e`.

One backdrop pixel is `round(zoom)` device pixels (integral, so nearest sampling stays even), and it is repainted only when the canvas size or that pixel size changes, never per frame. It is anchored bottom-left, so a resize extends it. It takes no part in hit-testing (all hit-tests are DOM handlers in `OfficeCanvas`), so clicking it is clicking empty space. A future day/night cycle can `tint` it.

### Fitted view and camera

**The office fits the viewport exactly. There is no user zoom.** `OfficeCanvas` derives the zoom every frame as `fitZoom` (`office/projection.ts`): the zoom at which `Building.viewRect()` touches the canvas on its tighter axis, centered. For a lone floor that is the iso bounding box of the non-VOID tiles (`boundsRect(contentBounds)`, raised by the back-wall height), exactly as before floors existed. For a building it spans every floor and its slab. It is deliberately **not an integer**, so sprite pixels can be uneven. It reports up through `onZoomChange` for the DOM overlays.

Only a canvas too small for `ZOOM_MIN` (1x) scrolls (wheel, trackpad, Shift+wheel for horizontal, middle-mouse drag), and every pan goes through `clampPan` so it never scrolls past the office edge. Ctrl+wheel is swallowed.

**Camera follow.** `cameraFollowId` (separate from `selectedAgentId`, both on the `Building`) smoothly centers the camera on the followed agent on its own floor, clamped like any pan. It is set on agent click and cleared on deselection or manual scroll.

### Floors

The office is a building with one floor per machine (see [CLAUDE.md](../../CLAUDE.md#office-ui) for where machines come from). `Building.floors` runs bottom to top. The first is always this machine's and holds the greeter. Each floor is a whole `OfficeState` (seats, lounge, CTO office, CTO queue, pets), so everything below stays per floor and an agent only ever finds a seat or a queue spot on its own.

- **Stacking.** Floor N is drawn and hit-tested `elevation` iso px higher (`worldToIso(x, y, elevation)`). `Building.restack` puts each floor's slab `BUILDING_FLOOR_GAP_PX` above the top of the back walls of the floor below, so no two floors overlap on screen: no floor hides a character of another, and the draw order between floors is just floor order.
- **Building look.** With more than one floor every floor stands on a `BUILDING_SLAB_PX` slab (a lone office stands on the `FLOOR_SLAB_PX` slab, the office's thick floor edge, outlined in ink), two pillars join each floor to the floor below at the side corners of the area both floors cover (their layouts can differ: `layout.json` furnishes only the first), and the floor's name (`floorsLoaded`) is written on the front of its slab.
- **Input.** `Building.getCharacterAt` tries the top floor first, shifting the point by each floor's elevation. Seat reassignment and right-click walking resolve the tile on the selected agent's floor only (`Building.tileAt`), so a seat on another floor is never offered. `ToolOverlay` raises each label by its floor's elevation.
- **Sub-agents** spawn on their parent's floor. Their ids come from one counter shared by every floor, so an id names one character in the whole building.

### Draw order

`office/engine/isoSort.ts`: every wall tile, furniture piece, character and pet carries a footprint box. Two boxes whose screen columns overlap are ordered by a separating axis (the one entirely at lower col or lower row is behind), so a long desk and a character at its front corner sort correctly where any single depth key fails. Overlapping footprints fall back to `SortLayer`: floor furniture, then actors, then attached items (surface items, wall items). A chair whose sitter faces away (`back` or `left`) uses the attached layer so its backrest covers the sitter. Other chairs draw under them.

Character and pet hit-testing (`getCharacterAt`, `getPetAt`) works in iso screen space, because tall sprites cover tiles behind their footprint. A character's hit box runs from its feet to its crown: `CHARACTER_HIT_HEIGHT` standing, `CHARACTER_SEATED_HIT_HEIGHT` seated, since a seated frame draws the head lower. The front-most character whose box holds the point wins. Floors never overlap, so a draw order across floors needs no sort box.

## UI styling

App window look: 1 or 2 px ink borders, small rounded corners, hard offset shadows (`2px 2px 0px #111111`, no blur). CSS variables live in `index.css` `:root` (`--color-hud-bg`, `--color-hud-titlebar`, `--color-ink`, the `--color-status-*` state colours, ...). The pixel font is FS Pixel Sans (`webview-ui/public/fonts/FSPixelSansUnicode-Regular.ttf`), loaded via `@font-face` in `index.css` and applied globally.

The HUD is the office's own app chrome. `components/BottomToolbar.tsx` is a window strip, and `components/ConnectionsMenu.tsx` sits in a window (`components/ui/Clipboard.tsx`).

- Modals and notices (`components/ui/Modal.tsx`, `ChangelogModal.tsx`, `MigrationNotice.tsx`) are `.hud-window` windows: a white body under a blue `.hud-titlebar` with the title and a close button.
- Tooltips, toasts and in-world labels (`Tooltip.tsx`, `VersionIndicator.tsx`, `ConnectionIndicator.tsx`, `ToolOverlay.tsx`'s activity label, the greeter's `IntroBubble.tsx`) are white ink-bordered `.hud-tag` name tags.
- The pet bubble (`office/sprites/bubble-pet.json`) shares the ink outline (`#111111`) with the rest of the office art.

Custom ESLint rules (`eslint-rules/terrarium-rules.mjs`) enforce `no-inline-colors` (hex, rgb, rgba, hsl and hsla literals only in `constants.ts`), `pixel-shadow` (`var(--pixel-shadow)` or `2px 2px 0px`) and `pixel-font` (must reference FS Pixel Sans). All are `error` level.

## Characters

`office/engine/characters.ts` runs the character FSM:

- **active**: pathfind to the seat, then type or read by tool type.
- **idle**: wander randomly with BFS, and return to the seat after `wanderLimit` moves.

Movement stays on the top-down grid. In iso, grid DOWN and RIGHT face the viewer (screen lower-left and lower-right) and UP and LEFT face away. Sheets carry DOWN (3/4 front), UP (3/4 back) and RIGHT (mirrored DOWN). LEFT is the mirrored UP at runtime.

**Poses** (`getCharacterPose`, drawn per [`docs/art-direction.md`](../art-direction.md)):

- Only a working agent types (writing tools) or reads (reading tools).
- A seated agent without work rests (lounge sofa, a rest at its desk, the CTO's couch), and a standing idle agent breathes.
- An agent in the CTO queue shows why it waits from `ctoQueueSlot.reason`: a raised hand for input, a held-up form for approval, seated on a visitor chair or standing at the door.
- Every pose but walking is a frame loop stepped by `advancePoseFrame` at its own `*_FRAME_DURATION_SEC` (2 frames, `POSE_FRAME_COUNTS`), except typing and reading, which hold their first frame (`STILL_POSES`) until they are redrawn.
- Seated frames share one hip height, and every seat sinks its sitter by its own amount (`SEAT_SINK_PX`, by furniture group) and pulls it toward the middle of a sofa or bench (`SEAT_PULL_TO_CENTER`), through `OfficeState.sittingOffset`. Sprite, hit box and label all follow it.
- Characters are drawn `CHARACTER_SCALE` (1.25) times their art's native size, so a standing character stands as tall against the desks, chairs and walls as the procedural set's did. Hit boxes and label offsets are measured on the native art and scaled by it.

Chair tiles are blocked for all characters except their own assigned seat (per-character pathfinding via `withOwnSeatUnblocked`).

### Palettes

`pickDiversePalette()` counts the palettes of current non-sub-agent characters and picks randomly from the least-used ones. The first `CHAR_COUNT` (12) agents each get a distinct worker. Beyond that, workers repeat with a random hue shift (45 to 315°) via `adjustSprite()`. A character stores `palette` (0 to `CHAR_COUNT - 1`) and `hueShift` (degrees). The sprite cache is keyed by `"palette:hueShift"`.

### Spawn and despawn effect

A Matrix-style digital rain animation (0.3 s, `office/engine/matrixEffect.ts`). 16 vertical columns sweep top to bottom with staggered timing. Spawn: green rain reveals the character's pixels. Despawn: the pixels are consumed by green rain trails. The `matrixEffect` field on `Character` is `'spawn'`, `'despawn'` or `null`, and the normal FSM is paused during the effect. Restored agents (`existingAgents`) use `skipSpawnEffect: true` and appear instantly.

### Sound

An ascending two-note chime (E5 → E6, Web Audio API, `notificationSound.ts`) plays when an agent finishes a turn and goes idle (`agentStatus: 'waiting'`). `unlockAudio()` on canvas mousedown resumes the context, since browsers start it suspended. It is always on.

Sub-agent characters are covered in [claude-teams.md](claude-teams.md#sub-agents-in-the-office).

## CTO office and the CTO queue

The room holding the first `EXEC_CHAIR` is the CTO's office (`office/engine/ctoOffice.ts`, `computeOfficeTiles`: reachable from that chair without crossing a doorway).

A fixed **CTO** character lives there. It is not an agent: `OfficeState.cto`, `CTO_ID`, drawn from its own sheet `cto.png` via `getCtoSprites`, so no agent ever looks like it. It runs a loop (`updateCto`): typing at the executive desk for `CTO_DESK_SEC` (monitor on), then walking to the office couch (its first lounge seat) for `CTO_COUCH_SEC` to rest, and back. Like the greeter it lives outside `characters`, so it gets no hit-test and no persistence. Every seat in the office is claimed for it and its tiles leave the wander set, so agents are never given a desk, a rest seat or a wander target in there.

**An agent that needs the human joins the CTO queue** until that clears:

- a permission request (herdr's `blocked`, Claude's `PermissionRequest`) until `clearPermissionBubble` (next tool start or turn end).
- waiting for input (`turnEnd` with `awaitingInput`) until it goes active again.

Queue order is arrival order (`OfficeState.ctoQueue`). The first agents take the office's other seats, the **visitor chairs** in front of the CTO's desk. The rest stand outside the door (the 1 to 2 tile wall gap nearest the CTO chair, `computeDoorQueue`, nearest first, up to `CTO_QUEUE_MAX_SLOTS`), facing it. While anyone waits at the door, the queue **rotates** every `CTO_VISIT_SEC`: the head goes to the back, so the longest-seated visitor gives its chair to the next agent at the door.

The FSM override is `ctoQueueSlot` (`seated` for visitor chairs, `reason` for the waiting pose) in `characters.ts`. Losing it drops the agent into IDLE, which walks an active agent back to its desk.

## Seats and the lounge

Seats are derived from chair furniture. `layoutToSeats()` creates a seat at every footprint tile of every chair. Multi-tile chairs produce multiple seats keyed `uid`, `uid:1`, `uid:2`. Facing direction priority: the chair's `orientation` from the catalog (front→DOWN, back→UP, left→LEFT, right→RIGHT), then the adjacent desk direction, then forward (DOWN). Click a character to select it (white outline), then click an available seat to reassign it.

A seat facing no electronics (sofas and benches around the coffee table) is a **rest seat** (`restSeatUids`). Idle characters claim a free rest seat (`restSeatId`, transient, never persisted) and sit there instead of at their desk. When the lounge is full they fall back to wandering. Desk seats (`seatId`) go to whoever is working: an active character whose `seatId` is a rest seat takes a free work seat, or swaps with an idle character holding one (`claimWorkSeatForActiveAgent`). Rest seats are handed out as desks only when every work seat is taken.

**Turn end.** `setAgentActive(false)` does not send a character to the lounge right away: it sets a negative `seatTimer` sentinel (`-SEAT_LINGER_SEC`, 90s) that counts up toward 0 while the character stays seated at its own desk showing the rest pose. Work resuming inside that window resumes typing in place, no walk. Only once the linger reaches 0 does it claim a rest seat and head to the lounge, same as an ordinary idle rest.

## Layout

There is no in-app layout editor. The office is authored in code (`scripts/iso-art/layout.ts`, see [assets.md](assets.md)) and loaded read-only. On `webviewReady` the server sends `~/.terrarium/layout.json` when it exists, otherwise the bundled default, for the first floor. Every other floor uses the bundled default, sent alongside as `floorLayout` when `layout.json` replaced it. Fields no tool can author now (`areas`, `areaTiles`, `pets`) still load and render, as do `carpetTiles`. Folder→Area mappings live in `config.json` `standalone.areaMappings`.

**Layout model**: `{ version: 1, cols, rows, tiles: TileType[], furniture: PlacedFurniture[], tileColors?: ColorValue[], carpetTiles?, areas?, areaTiles?, pets?, layoutRevision? }`. Grid dimensions are dynamic. `TileType.VOID` tiles are transparent and non-walkable. `office/layout/layoutSerializer.ts` converts between the layout and the runtime tile map, furniture and seats. `office/layout/tileMap.ts` holds walkability and BFS pathfinding.

**Floor**: 9 full-color PixelLab materials (`assets/floors/floor_N.png`, `FLOOR_TILE_SIZE` 32×32, see [assets.md](assets.md#floors-walls-and-carpets)), tinted per tile with Adjust-mode HSL shifts from `tileColors` (neutral leaves the material untouched), projected to a 64×32 diamond and drawn at half size (`ART_SCALE`) so the world footprint stays a 32×16 tile.

**Walls** (`office/isoWalls.ts`): a wall tile whose -row or -col neighbour is VOID or off-grid is a back wall, a thin wallpapered `WALL_HEIGHT_PX` (56 world units) box standing on the tile's inner edge, so wall items hang on the tile boundary and the corner tile is the post where two back walls meet. It has flat faces in the tile's wall colour, a lighter cap with an ink line under it and a skirting board. The floor is drawn under every wall tile, borrowing the nearest open tile's material. Every other wall renders as a **glass partition**: a thin ink-framed pane `WALL_GLASS_HEIGHT_PX` tall along the wall's run (cols, rows, or both at a junction), so interior rooms stay visible. Wall-mounted items belong on back walls. `traceSprite` samples both at `ART_SCALE` art pixels per world unit, so a 1-world-unit ink line traces as a single art pixel, and the sprite is drawn at half size.

**Auto-state**: `officeState.rebuildFurnitureInstances()` swaps electronics to their ON sprites when an active agent faces a desk with that item nearby (3 tiles deep in the facing direction, 1 tile to each side). It works at render time without modifying the layout.
