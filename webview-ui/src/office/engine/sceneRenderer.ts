/**
 * Office world renderer: PixiJS (WebGL) retained scene graph.
 *
 * Replaces the old per-frame Canvas 2D redraw (engine/renderer.ts). Design:
 *
 * - One `worldLayer` container is positioned/scaled once per frame
 *   (`position = (offsetX, offsetY)` device px, `scale = zoom`). Every
 *   world-space child (tiles, carpets, walls, furniture, characters, pets,
 *   bubbles, badges) is built in LOCAL, unscaled sprite-pixel coordinates,
 *   the same units as `Character.x`/`FurnitureInstance.x`/tile col*TILE_SIZE.
 *   `roundPixels: true` on every child snaps the final device-pixel position
 *   at render time, so this reproduces the old `Math.round(offsetX + x*zoom)`
 *   arithmetic without paying for it on every sprite every frame.
 * - Area labels and all editor-mode chrome (grid, ghost border, selection
 *   highlight, delete/rotate buttons) stay in DEVICE-PIXEL space as direct
 *   children of the stage instead: their stroke widths and the area label's
 *   minimum font size are deliberately constant-in-device-pixels, not
 *   proportional to zoom, so they can't live inside the scaled worldLayer.
 * - Furniture/walls/characters/pets/bubbles/badges are retained Sprite pools
 *   keyed by a stable id (furniture uid, `row:col` for wall tiles, character
 *   id, pet id) and diffed every frame: existing pool entries are repositioned
 *   in place, entries no longer present are pruned. This runs every frame
 *   because `OfficeState.furniture` gets a fresh array identity whenever
 *   auto-on electronics toggle, so the array reference alone isn't a valid
 *   "did anything change" signal. That's unlike the tile grid, whose
 *   `OfficeLayout` reference is only replaced on an actual edit
 *   (editorActions.ts always spreads into a new layout object before
 *   `rebuildFromLayout`), so floor / carpet / area-overlay / area-label
 *   containers rebuild only then.
 */

// VS Code webviews run under a strict CSP that forbids `new Function`/eval.
// This registers Pixi's non-eval fallback for its uniform-buffer sync path
// before any renderer is created.
import 'pixi.js/unsafe-eval';

import type { Renderer } from 'pixi.js';
import { Application, Container, Graphics, Sprite, Text, TextureStyle } from 'pixi.js';

import type { ColorValue } from '../../components/ui/types.js';
import {
  AREA_ACTIVE_ALPHA_MULTIPLIER,
  AREA_LABEL_ALPHA,
  AREA_LABEL_FALLBACK_COLOR,
  AREA_LABEL_FONT_SIZE_PX,
  AREA_LABEL_MIN_FONT_SIZE_PX,
  AREA_LABEL_SHADOW_ALPHA,
  AREA_LABEL_SHADOW_COLOR,
  AREA_OVERLAY_ALPHA,
  BUBBLE_FADE_DURATION_SEC,
  BUBBLE_SITTING_OFFSET_PX,
  BUBBLE_VERTICAL_OFFSET_PX,
  BUTTON_ICON_COLOR,
  BUTTON_ICON_SIZE_FACTOR,
  BUTTON_LINE_WIDTH_MIN,
  BUTTON_LINE_WIDTH_ZOOM_FACTOR,
  BUTTON_MIN_RADIUS,
  BUTTON_RADIUS_ZOOM_FACTOR,
  CARPET_DEFAULT_ACCENT_COLOR,
  CARPET_DEFAULT_COLOR,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  DELETE_BUTTON_BG,
  GHOST_BORDER_HOVER_FILL,
  GHOST_BORDER_HOVER_STROKE,
  GHOST_BORDER_STROKE,
  GHOST_INVALID_TINT,
  GHOST_PREVIEW_SPRITE_ALPHA,
  GHOST_PREVIEW_TINT_ALPHA,
  GHOST_VALID_TINT,
  GRID_LINE_COLOR,
  HEADLESS_CHARACTER_ALPHA,
  HOVERED_OUTLINE_ALPHA,
  OUTLINE_Z_SORT_OFFSET,
  ROTATE_BUTTON_BG,
  SEAT_AVAILABLE_COLOR,
  SEAT_BUSY_COLOR,
  SEAT_OWN_COLOR,
  SELECTED_OUTLINE_ALPHA,
  SELECTION_DASH_PATTERN,
  SELECTION_HIGHLIGHT_COLOR,
  STATUS_BADGE_HORIZONTAL_OFFSET_PX,
  STATUS_BADGE_VERTICAL_OFFSET_PX,
  VOID_TILE_DASH_PATTERN,
  VOID_TILE_OUTLINE_COLOR,
} from '../../constants.js';
import { getColorizedFloorSprite, hasFloorSprites, WALL_COLOR } from '../floorTiles.js';
import { mapOffset } from '../projection.js';
import {
  getCarpetJunctionSprite,
  getCarpetPaletteKey,
  hasCarpetSprites,
} from '../sprites/carpetTiles.js';
import { getPetSprites } from '../sprites/petSpriteData.js';
import {
  BUBBLE_HEART_SPRITE,
  BUBBLE_PERMISSION_SPRITE,
  BUBBLE_WAITING_SPRITE,
  getCharacterSprites,
  STATUS_DONE_SPRITE,
  STATUS_IDLE_SPRITE,
  STATUS_PERMISSION_SPRITE,
  STATUS_WAITING_INPUT_SPRITE,
  STATUS_WORKING_SPRITE,
} from '../sprites/spriteData.js';
import { getOutlineSprite, getTexture } from '../sprites/textureCache.js';
import type {
  AreaDefinition,
  CarpetTile,
  Character,
  FurnitureInstance,
  OfficeLayout,
  Pet,
  Seat,
  SpriteData,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, TILE_SIZE, TileType } from '../types.js';
import { getWallInstances, hasWallSprites, wallColorToHex } from '../wallTiles.js';
import { getCharacterSprite } from './characters.js';
import { drawMatrixEffect } from './matrixEffect.js';
import { getPetSpriteData } from './petEntity.js';
import { hexToNumber, hexToPixiColor, rgbaToPixiColor } from './pixiColor.js';

TextureStyle.defaultOptions.scaleMode = 'nearest';

// ── Settings ────────────────────────────────────────────────────

/**
 * "Display headless as ghosts": whether headless agents render translucent.
 * Module state rather than a render param: the rAF loop reads it every frame.
 */
let ghostHeadlessAgents = false;

export function setGhostHeadlessAgents(enabled: boolean): void {
  ghostHeadlessAgents = enabled;
}

export function isGhostHeadlessAgentsEnabled(): boolean {
  return ghostHeadlessAgents;
}

// ── Public types ────────────────────────────────────────────────

export interface ButtonBounds {
  /** Center X in device pixels */
  cx: number;
  /** Center Y in device pixels */
  cy: number;
  /** Radius in device pixels */
  radius: number;
}

export type DeleteButtonBounds = ButtonBounds;
export type RotateButtonBounds = ButtonBounds;

export interface EditorRenderState {
  showGrid: boolean;
  ghostSprite: SpriteData | null;
  ghostMirrored: boolean;
  ghostCol: number;
  ghostRow: number;
  ghostValid: boolean;
  selectedCol: number;
  selectedRow: number;
  selectedW: number;
  selectedH: number;
  hasSelection: boolean;
  isRotatable: boolean;
  /** Updated each frame by the delete-button draw step */
  deleteButtonBounds: DeleteButtonBounds | null;
  /** Updated each frame by the rotate-button draw step */
  rotateButtonBounds: RotateButtonBounds | null;
  /** Whether to show ghost border (expansion tiles outside grid) */
  showGhostBorder: boolean;
  /** Hovered ghost border tile col (-1 to cols) */
  ghostBorderHoverCol: number;
  /** Hovered ghost border tile row (-1 to rows) */
  ghostBorderHoverRow: number;
}

export interface SelectionRenderState {
  selectedAgentId: number | null;
  hoveredAgentId: number | null;
  hoveredTile: { col: number; row: number } | null;
  seats: Map<string, Seat>;
  characters: Map<number, Character>;
}

export interface WorldRenderState {
  /** Identity used to detect layout edits cheaply (see module doc). */
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  furniture: FurnitureInstance[];
  characters: Character[];
  zoom: number;
  panX: number;
  panY: number;
  selection?: SelectionRenderState;
  editor?: EditorRenderState;
  tileColors?: Array<ColorValue | null>;
  layoutCols?: number;
  layoutRows?: number;
  carpetTiles?: Array<CarpetTile | null>;
  areas?: AreaDefinition[];
  areaTiles?: Array<string | null>;
  showAreas?: boolean;
  activeAreaLabel?: string | null;
  pets?: Pet[];
}

// ── Pool helpers ────────────────────────────────────────────────

function getOrCreateSprite<K>(pool: Map<K, Sprite>, key: K, container: Container): Sprite {
  let sprite = pool.get(key);
  if (!sprite) {
    sprite = new Sprite();
    sprite.roundPixels = true;
    container.addChild(sprite);
    pool.set(key, sprite);
  }
  return sprite;
}

function getOrCreateGraphics<K>(pool: Map<K, Graphics>, key: K, container: Container): Graphics {
  let gfx = pool.get(key);
  if (!gfx) {
    gfx = new Graphics();
    gfx.roundPixels = true;
    container.addChild(gfx);
    pool.set(key, gfx);
  }
  return gfx;
}

function pruneStale<K, V extends Container>(
  pool: Map<K, V>,
  container: Container,
  liveKeys: Set<K>,
): void {
  for (const [key, child] of pool) {
    if (liveKeys.has(key)) continue;
    container.removeChild(child);
    pool.delete(key);
  }
}

// ── Dashed-line drawing (Graphics has no native setLineDash) ────

function dashLine(
  gfx: Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dash: number,
  gap: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  let pos = 0;
  let drawing = true;
  while (pos < len) {
    const step = Math.min(drawing ? dash : gap, len - pos);
    if (drawing) {
      gfx.moveTo(x0 + ux * pos, y0 + uy * pos);
      gfx.lineTo(x0 + ux * (pos + step), y0 + uy * (pos + step));
    }
    pos += step;
    drawing = !drawing;
  }
}

function dashRect(
  gfx: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  dash: readonly [number, number],
): void {
  const [len, gap] = dash;
  dashLine(gfx, x, y, x + w, y, len, gap);
  dashLine(gfx, x + w, y, x + w, y + h, len, gap);
  dashLine(gfx, x + w, y + h, x, y + h, len, gap);
  dashLine(gfx, x, y + h, x, y, len, gap);
}

// ── Status badge sprite selection ──────────────────────────────

function statusBadgeSprite(ch: Character): SpriteData {
  if (ch.bubbleType === 'permission') return STATUS_PERMISSION_SPRITE;
  if (ch.isActive) return STATUS_WORKING_SPRITE;
  if (ch.bubbleType === 'waiting') {
    return ch.waitingAwaitingInput ? STATUS_WAITING_INPUT_SPRITE : STATUS_DONE_SPRITE;
  }
  return STATUS_IDLE_SPRITE;
}

// ── Renderer ──────────────────────────────────────────────────────

export class OfficeSceneRenderer {
  private canvas: HTMLCanvasElement;
  private app = new Application();
  private ready = false;

  private worldLayer = new Container();
  private floorContainer = new Container();
  private carpetContainer = new Container();
  private areaOverlayGfx = new Graphics();
  private seatIndicatorGfx = new Graphics();
  private entityContainer = new Container({ isRenderGroup: true });
  private bubbleContainer = new Container();
  private badgeContainer = new Container();
  private petBubbleContainer = new Container();
  private areaLabelContainer = new Container();
  private editorContainer = new Container();

  private lastLayout: OfficeLayout | null = null;
  private lastAreaOverlayKey = '';

  private furniturePool = new Map<string, Sprite>();
  private wallPool = new Map<string, Sprite>();
  private characterPool = new Map<number, Sprite>();
  private outlinePool = new Map<number, Sprite>();
  private matrixPool = new Map<number, Graphics>();
  private petPool = new Map<string, Sprite>();
  private bubblePool = new Map<number, Sprite>();
  private badgePool = new Map<number, Sprite>();
  private petBubblePool = new Map<string, Sprite>();
  private areaLabelPool = new Map<
    string,
    { shadow: Text; main: Text; localCx: number; localCy: number }
  >();

  private ghostSpritePixi = new Sprite();
  private ghostTintGfx = new Graphics();
  private gridGfx = new Graphics();
  private ghostBorderGfx = new Graphics();
  private selectionGfx = new Graphics();
  private deleteButtonGfx = new Graphics();
  private rotateButtonGfx = new Graphics();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.worldLayer.addChild(
      this.floorContainer,
      this.carpetContainer,
      this.areaOverlayGfx,
      this.seatIndicatorGfx,
      this.entityContainer,
      this.bubbleContainer,
      this.badgeContainer,
      this.petBubbleContainer,
    );
    this.entityContainer.sortableChildren = true;
    this.editorContainer.addChild(
      this.gridGfx,
      this.ghostBorderGfx,
      this.ghostSpritePixi,
      this.ghostTintGfx,
      this.selectionGfx,
      this.deleteButtonGfx,
      this.rotateButtonGfx,
    );
    this.ghostSpritePixi.roundPixels = true;
  }

  async init(): Promise<void> {
    await this.app.init({
      canvas: this.canvas,
      preference: 'webgl',
      antialias: false,
      roundPixels: true,
      autoDensity: false,
      resolution: 1,
      autoStart: false,
      sharedTicker: false,
      backgroundAlpha: 0,
      width: Math.max(1, this.canvas.width),
      height: Math.max(1, this.canvas.height),
    });
    this.app.stage.addChild(this.worldLayer, this.areaLabelContainer, this.editorContainer);
    this.ready = true;
  }

  get renderer(): Renderer {
    return this.app.renderer;
  }

  resize(width: number, height: number): void {
    if (!this.ready) return;
    this.app.renderer.resize(Math.max(1, width), Math.max(1, height));
  }

  destroy(): void {
    this.app.destroy({ removeView: false }, { children: true, texture: false });
  }

  renderFrame(state: WorldRenderState): { offsetX: number; offsetY: number } {
    if (!this.ready) return { offsetX: 0, offsetY: 0 };

    const canvasWidth = this.app.renderer.width;
    const canvasHeight = this.app.renderer.height;
    const cols = state.layoutCols ?? (state.tileMap.length > 0 ? state.tileMap[0].length : 0);
    const rows = state.layoutRows ?? state.tileMap.length;

    const { offsetX, offsetY } = mapOffset(
      canvasWidth,
      canvasHeight,
      cols,
      rows,
      state.zoom,
      state.panX,
      state.panY,
    );
    this.worldLayer.position.set(offsetX, offsetY);
    this.worldLayer.scale.set(state.zoom, state.zoom);

    if (state.layout !== this.lastLayout) {
      this.rebuildFloor(state, cols);
      this.rebuildCarpet(state, cols, rows);
      this.rebuildAreaLabels(state);
      this.lastAreaOverlayKey = '';
      this.lastLayout = state.layout;
    }

    const areaOverlayKey = `${state.showAreas ? 1 : 0}:${state.activeAreaLabel ?? ''}`;
    if (areaOverlayKey !== this.lastAreaOverlayKey) {
      this.rebuildAreaOverlay(state, cols, rows);
      this.lastAreaOverlayKey = areaOverlayKey;
    }
    this.areaLabelContainer.visible = !!state.showAreas;
    // Area labels anchor to the world, but render in device-pixel space for
    // crisp, zoom-clamped text. Reposition them whenever pan/zoom moves.
    this.repositionAreaLabels(offsetX, offsetY, state.zoom);

    this.updateSeatIndicator(state);
    this.updateEntities(state);
    this.updateBubblesAndBadges(state);
    this.updateEditorOverlay(state, offsetX, offsetY);

    this.app.renderer.render(this.app.stage);
    return { offsetX, offsetY };
  }

  // ── Floor + wall base color (layout-gated) ─────────────────────

  private rebuildFloor(state: WorldRenderState, cols: number): void {
    this.floorContainer.removeChildren();
    const tmRows = state.tileMap.length;
    const tmCols = tmRows > 0 ? state.tileMap[0].length : 0;
    const layoutCols = state.layoutCols ?? cols;
    const useSpriteFloors = hasFloorSprites();

    for (let r = 0; r < tmRows; r++) {
      for (let c = 0; c < tmCols; c++) {
        const tile = state.tileMap[r][c];
        if (tile === TileType.VOID) continue;

        if (tile === TileType.WALL || !useSpriteFloors) {
          const gfx = new Graphics();
          gfx.roundPixels = true;
          if (tile === TileType.WALL) {
            const colorIdx = r * layoutCols + c;
            const wallColor = state.tileColors?.[colorIdx];
            const fill = hexToNumber(wallColor ? wallColorToHex(wallColor) : WALL_COLOR);
            gfx.rect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE).fill(fill);
          }
          this.floorContainer.addChild(gfx);
          continue;
        }

        const colorIdx = r * layoutCols + c;
        const color = state.tileColors?.[colorIdx] ?? { h: 0, s: 0, b: 0, c: 0 };
        const spriteData = getColorizedFloorSprite(tile, color);
        const sprite = new Sprite(getTexture(spriteData));
        sprite.roundPixels = true;
        sprite.position.set(c * TILE_SIZE, r * TILE_SIZE);
        this.floorContainer.addChild(sprite);
      }
    }
  }

  private rebuildCarpet(state: WorldRenderState, cols: number, rows: number): void {
    this.carpetContainer.removeChildren();
    if (!hasCarpetSprites()) return;
    const carpetTiles = state.carpetTiles;
    if (!carpetTiles || carpetTiles.length === 0) return;

    for (let jy = 0; jy <= rows; jy++) {
      for (let jx = 0; jx <= cols; jx++) {
        const localGroups = new Map<
          string,
          {
            variant: number;
            color: ColorValue;
            accentColor: ColorValue;
            paletteKey: string;
            order: number;
          }
        >();

        const adjacent = [
          { col: jx - 1, row: jy - 1 },
          { col: jx, row: jy - 1 },
          { col: jx, row: jy },
          { col: jx - 1, row: jy },
        ];

        for (const pos of adjacent) {
          if (pos.col < 0 || pos.row < 0 || pos.col >= cols || pos.row >= rows) continue;
          const tile = carpetTiles[pos.row * cols + pos.col];
          if (!tile) continue;
          const color = tile.color ?? CARPET_DEFAULT_COLOR;
          const accentColor = tile.accentColor ?? CARPET_DEFAULT_ACCENT_COLOR;
          const paletteKey = getCarpetPaletteKey(color, accentColor);
          const key = `${tile.variant}:${paletteKey}`;
          const order = tile.order ?? 0;
          const existing = localGroups.get(key);
          if (!existing || order > existing.order) {
            localGroups.set(key, { variant: tile.variant, color, accentColor, paletteKey, order });
          }
        }

        if (localGroups.size === 0) continue;

        const ordered = [...localGroups.values()].sort((a, b) => a.order - b.order);
        for (const { variant, color, accentColor, paletteKey } of ordered) {
          const spriteData = getCarpetJunctionSprite(
            jx,
            jy,
            variant,
            carpetTiles,
            cols,
            rows,
            color,
            accentColor,
            paletteKey,
          );
          if (!spriteData) continue;
          const sprite = new Sprite(getTexture(spriteData));
          sprite.roundPixels = true;
          const halfW = spriteData[0].length / 2;
          const halfH = spriteData.length / 2;
          sprite.position.set(jx * TILE_SIZE - halfW, jy * TILE_SIZE - halfH);
          this.carpetContainer.addChild(sprite);
        }
      }
    }
  }

  private rebuildAreaOverlay(state: WorldRenderState, cols: number, rows: number): void {
    this.areaOverlayGfx.clear();
    if (!state.showAreas) return;
    const areaTiles = state.areaTiles;
    const areas = state.areas;
    if (!areaTiles || areaTiles.length === 0 || !areas || areas.length === 0) return;

    const colorMap = new Map<string, string>();
    for (const a of areas) colorMap.set(a.label, a.color);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const label = areaTiles[r * cols + c];
        if (!label) continue;
        const hex = colorMap.get(label);
        if (!hex) continue;
        const alpha =
          state.activeAreaLabel === label
            ? AREA_OVERLAY_ALPHA * AREA_ACTIVE_ALPHA_MULTIPLIER
            : AREA_OVERLAY_ALPHA;
        this.areaOverlayGfx
          .rect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE)
          .fill({ color: hexToNumber(hex), alpha });
      }
    }
  }

  private rebuildAreaLabels(state: WorldRenderState): void {
    for (const { shadow, main } of this.areaLabelPool.values()) {
      this.areaLabelContainer.removeChild(shadow);
      this.areaLabelContainer.removeChild(main);
    }
    this.areaLabelPool.clear();

    const areaTiles = state.areaTiles;
    const areas = state.areas;
    if (!areaTiles || areaTiles.length === 0 || !areas || areas.length === 0) return;
    const cols = state.layoutCols ?? 0;
    const rows = state.layoutRows ?? 0;

    const colorMap = new Map<string, string>();
    for (const a of areas) colorMap.set(a.label, a.color);

    const centroids = new Map<string, { sumX: number; sumY: number; count: number }>();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const label = areaTiles[r * cols + c];
        if (!label) continue;
        const acc = centroids.get(label);
        if (acc) {
          acc.sumX += c;
          acc.sumY += r;
          acc.count += 1;
        } else {
          centroids.set(label, { sumX: c, sumY: r, count: 1 });
        }
      }
    }

    for (const [label, acc] of centroids) {
      const localCx = (acc.sumX / acc.count + 0.5) * TILE_SIZE;
      const localCy = (acc.sumY / acc.count + 0.5) * TILE_SIZE;
      const shadow = new Text({
        text: label,
        style: {
          fontFamily: 'FS Pixel Sans',
          fontWeight: 'bold',
          fill: hexToNumber(AREA_LABEL_SHADOW_COLOR),
          align: 'center',
        },
      });
      shadow.anchor.set(0.5, 0.5);
      shadow.alpha = AREA_LABEL_SHADOW_ALPHA;
      shadow.roundPixels = true;

      const main = new Text({
        text: label,
        style: {
          fontFamily: 'FS Pixel Sans',
          fontWeight: 'bold',
          fill: hexToNumber(colorMap.get(label) ?? AREA_LABEL_FALLBACK_COLOR),
          align: 'center',
        },
      });
      main.anchor.set(0.5, 0.5);
      main.alpha = AREA_LABEL_ALPHA;
      main.roundPixels = true;

      this.areaLabelContainer.addChild(shadow, main);
      this.areaLabelPool.set(label, { shadow, main, localCx, localCy });
    }
  }

  private repositionAreaLabels(offsetX: number, offsetY: number, zoom: number): void {
    const fontSize = Math.max(AREA_LABEL_FONT_SIZE_PX * zoom, AREA_LABEL_MIN_FONT_SIZE_PX);
    for (const { shadow, main, localCx, localCy } of this.areaLabelPool.values()) {
      shadow.style.fontSize = fontSize;
      main.style.fontSize = fontSize;
      const cx = offsetX + localCx * zoom;
      const cy = offsetY + localCy * zoom;
      shadow.position.set(cx + 1, cy + 1);
      main.position.set(cx, cy);
    }
  }

  // ── Seat indicator (per-frame, cheap) ───────────────────────────

  private updateSeatIndicator(state: WorldRenderState): void {
    this.seatIndicatorGfx.clear();
    const selection = state.selection;
    if (!selection || selection.selectedAgentId === null || !selection.hoveredTile) return;
    const selectedChar = selection.characters.get(selection.selectedAgentId);
    if (!selectedChar) return;

    for (const [uid, seat] of selection.seats) {
      if (seat.seatCol !== selection.hoveredTile.col || seat.seatRow !== selection.hoveredTile.row)
        continue;

      const x = seat.seatCol * TILE_SIZE;
      const y = seat.seatRow * TILE_SIZE;
      const fill =
        selectedChar.seatId === uid
          ? rgbaToPixiColor(SEAT_OWN_COLOR)
          : !seat.assigned
            ? rgbaToPixiColor(SEAT_AVAILABLE_COLOR)
            : rgbaToPixiColor(SEAT_BUSY_COLOR);
      this.seatIndicatorGfx.rect(x, y, TILE_SIZE, TILE_SIZE).fill(fill);
      break;
    }
  }

  // ── Entities: walls, furniture, characters, pets (per-frame) ───

  private updateEntities(state: WorldRenderState): void {
    const liveFurniture = new Set<string>();
    const liveWalls = new Set<string>();
    const liveBodies = new Set<number>();
    const liveOutlines = new Set<number>();
    const liveMatrix = new Set<number>();
    const livePets = new Set<string>();

    if (hasWallSprites()) {
      const wallInstances = getWallInstances(state.tileMap, state.tileColors, state.layoutCols);
      for (const inst of wallInstances) {
        const row = Math.round(inst.zY / TILE_SIZE) - 1;
        const col = Math.round(inst.x / TILE_SIZE);
        const key = `${row}:${col}`;
        liveWalls.add(key);
        const sprite = getOrCreateSprite(this.wallPool, key, this.entityContainer);
        sprite.texture = getTexture(inst.sprite);
        sprite.position.set(inst.x, inst.y);
        sprite.scale.set(1, 1);
        sprite.zIndex = inst.zY;
        sprite.visible = true;
      }
    }

    for (const f of state.furniture) {
      if (!f.uid) continue;
      liveFurniture.add(f.uid);
      const sprite = getOrCreateSprite(this.furniturePool, f.uid, this.entityContainer);
      const texture = getTexture(f.sprite);
      sprite.texture = texture;
      sprite.zIndex = f.zY;
      sprite.visible = true;
      if (f.mirrored) {
        sprite.scale.set(-1, 1);
        sprite.position.set(f.x + texture.width, f.y);
      } else {
        sprite.scale.set(1, 1);
        sprite.position.set(f.x, f.y);
      }
    }

    for (const ch of state.characters) {
      const sprites = getCharacterSprites(ch.palette, ch.hueShift);
      const spriteData = getCharacterSprite(ch, sprites);
      const texture = getTexture(spriteData);
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
      const localX = ch.x - texture.width / 2;
      const localY = ch.y + sittingOffset - texture.height;
      const charZY = ch.y + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET;
      const alpha = ch.isHeadless && ghostHeadlessAgents ? HEADLESS_CHARACTER_ALPHA : 1;

      if (ch.matrixEffect) {
        liveMatrix.add(ch.id);
        const gfx = getOrCreateGraphics(this.matrixPool, ch.id, this.entityContainer);
        gfx.clear();
        gfx.zIndex = charZY;
        gfx.alpha = alpha;
        gfx.visible = true;
        drawMatrixEffect(gfx, ch, spriteData, localX, localY, 1);
        continue;
      }

      liveBodies.add(ch.id);
      const body = getOrCreateSprite(this.characterPool, ch.id, this.entityContainer);
      body.texture = texture;
      body.position.set(localX, localY);
      body.scale.set(1, 1);
      body.zIndex = charZY;
      body.alpha = alpha;
      body.visible = true;

      const isSelected = state.selection?.selectedAgentId === ch.id;
      const isHovered = state.selection?.hoveredAgentId === ch.id;
      if (isSelected || isHovered) {
        liveOutlines.add(ch.id);
        const outlineData = getOutlineSprite(spriteData);
        const outline = getOrCreateSprite(this.outlinePool, ch.id, this.entityContainer);
        outline.texture = getTexture(outlineData);
        outline.position.set(localX - 1, localY - 1);
        outline.scale.set(1, 1);
        outline.zIndex = charZY - OUTLINE_Z_SORT_OFFSET;
        outline.alpha = isSelected ? SELECTED_OUTLINE_ALPHA : HOVERED_OUTLINE_ALPHA;
        outline.visible = true;
      }
    }

    for (const pet of state.pets ?? []) {
      const petSprites = getPetSprites(pet.petType);
      const spriteData = getPetSpriteData(pet, petSprites);
      if (!spriteData) continue;
      const texture = getTexture(spriteData);
      livePets.add(pet.id);
      const sprite = getOrCreateSprite(this.petPool, pet.id, this.entityContainer);
      sprite.texture = texture;
      sprite.position.set(pet.x - texture.width / 2, pet.y - texture.height);
      sprite.scale.set(1, 1);
      sprite.zIndex = pet.y + TILE_SIZE / 2;
      sprite.visible = true;
    }

    pruneStale(this.furniturePool, this.entityContainer, liveFurniture);
    pruneStale(this.wallPool, this.entityContainer, liveWalls);
    pruneStale(this.characterPool, this.entityContainer, liveBodies);
    pruneStale(this.outlinePool, this.entityContainer, liveOutlines);
    pruneStale(this.matrixPool, this.entityContainer, liveMatrix);
    pruneStale(this.petPool, this.entityContainer, livePets);
  }

  // ── Bubbles + status badges (per-frame) ─────────────────────────

  private updateBubblesAndBadges(state: WorldRenderState): void {
    const liveBubbles = new Set<number>();
    const liveBadges = new Set<number>();
    const livePetBubbles = new Set<string>();

    for (const ch of state.characters) {
      if (ch.bubbleType && !(ch.bubbleType === 'waiting' && ch.waitingAwaitingInput)) {
        liveBubbles.add(ch.id);
        const spriteData =
          ch.bubbleType === 'permission' ? BUBBLE_PERMISSION_SPRITE : BUBBLE_WAITING_SPRITE;
        let alpha = 1.0;
        if (ch.bubbleType === 'waiting' && ch.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
          alpha = ch.bubbleTimer / BUBBLE_FADE_DURATION_SEC;
        }
        const texture = getTexture(spriteData);
        const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
        const sprite = getOrCreateSprite(this.bubblePool, ch.id, this.bubbleContainer);
        sprite.texture = texture;
        sprite.position.set(
          ch.x - texture.width / 2,
          ch.y + sittingOff - BUBBLE_VERTICAL_OFFSET_PX - texture.height - 1,
        );
        sprite.alpha = alpha;
        sprite.visible = true;
      }

      if (!ch.isSubagent && !ch.isGreeter) {
        liveBadges.add(ch.id);
        const texture = getTexture(statusBadgeSprite(ch));
        const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
        const sprite = getOrCreateSprite(this.badgePool, ch.id, this.badgeContainer);
        sprite.texture = texture;
        sprite.position.set(
          ch.x + STATUS_BADGE_HORIZONTAL_OFFSET_PX - texture.width / 2,
          ch.y + sittingOff - STATUS_BADGE_VERTICAL_OFFSET_PX - texture.height / 2,
        );
        sprite.visible = true;
      }
    }

    for (const pet of state.pets ?? []) {
      if (!pet.bubbleType) continue;
      livePetBubbles.add(pet.id);
      let alpha = 1.0;
      if (pet.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
        alpha = Math.max(0, pet.bubbleTimer / BUBBLE_FADE_DURATION_SEC);
      }
      const texture = getTexture(BUBBLE_HEART_SPRITE);
      const sprite = getOrCreateSprite(this.petBubblePool, pet.id, this.petBubbleContainer);
      sprite.texture = texture;
      sprite.position.set(pet.x - texture.width / 2, pet.y - TILE_SIZE - texture.height - 1);
      sprite.alpha = alpha;
      sprite.visible = true;
    }

    pruneStale(this.bubblePool, this.bubbleContainer, liveBubbles);
    pruneStale(this.badgePool, this.badgeContainer, liveBadges);
    pruneStale(this.petBubblePool, this.petBubbleContainer, livePetBubbles);
  }

  // ── Editor overlays (device-pixel space, redrawn every frame) ──

  private updateEditorOverlay(state: WorldRenderState, offsetX: number, offsetY: number): void {
    this.gridGfx.clear();
    this.ghostBorderGfx.clear();
    this.ghostTintGfx.clear();
    this.selectionGfx.clear();
    this.deleteButtonGfx.clear();
    this.rotateButtonGfx.clear();
    this.ghostSpritePixi.visible = false;

    const editor = state.editor;
    if (!editor) return;

    const cols = state.layoutCols ?? 0;
    const rows = state.layoutRows ?? 0;
    const zoom = state.zoom;
    const s = TILE_SIZE * zoom;

    if (editor.showGrid) {
      const { color: lineColor, alpha: lineAlpha } = rgbaToPixiColor(GRID_LINE_COLOR);
      for (let c = 0; c <= cols; c++) {
        const x = offsetX + c * s + 0.5;
        this.gridGfx.moveTo(x, offsetY).lineTo(x, offsetY + rows * s);
      }
      for (let r = 0; r <= rows; r++) {
        const y = offsetY + r * s + 0.5;
        this.gridGfx.moveTo(offsetX, y).lineTo(offsetX + cols * s, y);
      }
      this.gridGfx.stroke({ width: 1, color: lineColor, alpha: lineAlpha });

      const { color: voidColor, alpha: voidAlpha } = rgbaToPixiColor(VOID_TILE_OUTLINE_COLOR);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (state.tileMap[r]?.[c] === TileType.VOID) {
            dashRect(
              this.gridGfx,
              offsetX + c * s + 0.5,
              offsetY + r * s + 0.5,
              s - 1,
              s - 1,
              VOID_TILE_DASH_PATTERN,
            );
          }
        }
      }
      this.gridGfx.stroke({ width: 1, color: voidColor, alpha: voidAlpha });
    }

    if (editor.showGhostBorder) {
      const ghostTiles: Array<{ c: number; r: number }> = [];
      for (let c = -1; c <= cols; c++) {
        ghostTiles.push({ c, r: -1 });
        ghostTiles.push({ c, r: rows });
      }
      for (let r = 0; r < rows; r++) {
        ghostTiles.push({ c: -1, r });
        ghostTiles.push({ c: cols, r });
      }

      const hoverFill = rgbaToPixiColor(GHOST_BORDER_HOVER_FILL);
      const hoverStroke = rgbaToPixiColor(GHOST_BORDER_HOVER_STROKE);
      const normalStroke = rgbaToPixiColor(GHOST_BORDER_STROKE);

      for (const { c, r } of ghostTiles) {
        const x = offsetX + c * s;
        const y = offsetY + r * s;
        const isHovered = c === editor.ghostBorderHoverCol && r === editor.ghostBorderHoverRow;
        if (isHovered) {
          this.ghostBorderGfx.rect(x, y, s, s).fill(hoverFill);
        }
        dashRect(this.ghostBorderGfx, x + 0.5, y + 0.5, s - 1, s - 1, VOID_TILE_DASH_PATTERN);
        this.ghostBorderGfx.stroke({
          width: 1,
          color: isHovered ? hoverStroke.color : normalStroke.color,
          alpha: isHovered ? hoverStroke.alpha : normalStroke.alpha,
        });
      }
    }

    if (editor.ghostSprite && editor.ghostCol >= 0) {
      const texture = getTexture(editor.ghostSprite);
      const x = offsetX + editor.ghostCol * s;
      const y = offsetY + editor.ghostRow * s;
      this.ghostSpritePixi.texture = texture;
      this.ghostSpritePixi.alpha = GHOST_PREVIEW_SPRITE_ALPHA;
      this.ghostSpritePixi.visible = true;
      if (editor.ghostMirrored) {
        this.ghostSpritePixi.scale.set(-zoom, zoom);
        this.ghostSpritePixi.position.set(x + texture.width * zoom, y);
      } else {
        this.ghostSpritePixi.scale.set(zoom, zoom);
        this.ghostSpritePixi.position.set(x, y);
      }
      const tintColor = hexToNumber(editor.ghostValid ? GHOST_VALID_TINT : GHOST_INVALID_TINT);
      this.ghostTintGfx
        .rect(x, y, texture.width * zoom, texture.height * zoom)
        .fill({ color: tintColor, alpha: GHOST_PREVIEW_TINT_ALPHA });
    }

    if (editor.hasSelection) {
      const x = offsetX + editor.selectedCol * s;
      const y = offsetY + editor.selectedRow * s;
      const w = editor.selectedW * s;
      const h = editor.selectedH * s;
      dashRect(this.selectionGfx, x + 1, y + 1, w - 2, h - 2, SELECTION_DASH_PATTERN);
      this.selectionGfx.stroke({ width: 2, color: hexToNumber(SELECTION_HIGHLIGHT_COLOR) });

      editor.deleteButtonBounds = this.drawRoundButton(
        this.deleteButtonGfx,
        offsetX + (editor.selectedCol + editor.selectedW) * s + 1,
        offsetY + editor.selectedRow * s - 1,
        zoom,
        hexToPixiColor(DELETE_BUTTON_BG),
        'x',
      );

      if (editor.isRotatable) {
        editor.rotateButtonBounds = this.drawRoundButton(
          this.rotateButtonGfx,
          offsetX + editor.selectedCol * s - 1,
          offsetY + editor.selectedRow * s - 1,
          zoom,
          hexToPixiColor(ROTATE_BUTTON_BG),
          'rotate',
        );
      } else {
        editor.rotateButtonBounds = null;
      }
    } else {
      editor.deleteButtonBounds = null;
      editor.rotateButtonBounds = null;
    }
  }

  private drawRoundButton(
    gfx: Graphics,
    cx: number,
    cy: number,
    zoom: number,
    bg: { color: number; alpha: number },
    icon: 'x' | 'rotate',
  ): ButtonBounds {
    const radius = Math.max(BUTTON_MIN_RADIUS, zoom * BUTTON_RADIUS_ZOOM_FACTOR);
    const lineWidth = Math.max(BUTTON_LINE_WIDTH_MIN, zoom * BUTTON_LINE_WIDTH_ZOOM_FACTOR);
    const iconColor = hexToNumber(BUTTON_ICON_COLOR);

    gfx.circle(cx, cy, radius).fill(bg);

    if (icon === 'x') {
      const xSize = radius * BUTTON_ICON_SIZE_FACTOR;
      gfx.moveTo(cx - xSize, cy - xSize).lineTo(cx + xSize, cy + xSize);
      gfx.moveTo(cx + xSize, cy - xSize).lineTo(cx - xSize, cy + xSize);
      gfx.stroke({ width: lineWidth, color: iconColor, cap: 'round' });
    } else {
      const arcR = radius * BUTTON_ICON_SIZE_FACTOR;
      gfx.arc(cx, cy, arcR, -Math.PI * 0.8, Math.PI * 0.7);
      gfx.stroke({ width: lineWidth, color: iconColor, cap: 'round' });
      const endAngle = Math.PI * 0.7;
      const endX = cx + arcR * Math.cos(endAngle);
      const endY = cy + arcR * Math.sin(endAngle);
      const arrowSize = radius * 0.35;
      gfx.moveTo(endX + arrowSize * 0.6, endY - arrowSize * 0.3);
      gfx.lineTo(endX, endY);
      gfx.lineTo(endX + arrowSize * 0.7, endY + arrowSize * 0.5);
      gfx.stroke({ width: lineWidth, color: iconColor, cap: 'round' });
    }

    return { cx, cy, radius };
  }
}
