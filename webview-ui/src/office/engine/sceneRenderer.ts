/**
 * Office world renderer: PixiJS (WebGL) retained scene graph, isometric.
 *
 * - One `worldLayer` container is positioned/scaled once per frame
 *   (`position = (offsetX, offsetY)` device px, `scale = zoom`). Every
 *   world-space child (tiles, carpets, walls, furniture, characters, pets,
 *   bubbles, badges) is built in LOCAL, unscaled iso pixel coordinates (see
 *   iso.ts: a tile is a 32×16 diamond). The simulation stays on the top-down
 *   grid; positions are projected here.
 * - Area labels and all editor-mode chrome (grid, ghost border, selection
 *   highlight, delete/rotate buttons) stay in DEVICE-PIXEL space as direct
 *   children of the stage instead: their stroke widths and the area label's
 *   minimum font size are deliberately constant-in-device-pixels, not
 *   proportional to zoom, so they can't live inside the scaled worldLayer.
 * - Walls/furniture/characters/pets are retained Sprite pools keyed by a
 *   stable id (furniture uid, `row:col` for wall tiles, character id, pet id)
 *   and diffed every frame, then ordered with isoDrawOrder: a single depth
 *   key cannot order iso boxes of different sizes. This runs every frame
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
  DELETE_BUTTON_BG,
  FLOOR_SLAB_LEFT_COLOR,
  FLOOR_SLAB_PX,
  FLOOR_SLAB_RIGHT_COLOR,
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
import { getColorizedFloorSprite, WALL_COLOR } from '../floorTiles.js';
import type { Point } from '../iso.js';
import {
  footprintSpriteOrigin,
  ISO_TILE_H,
  ISO_TILE_W,
  projectToDiamond,
  tileCorner,
  worldToIso,
} from '../iso.js';
import { getWallSprite } from '../isoWalls.js';
import { gridRect, mapOffset } from '../projection.js';
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
import { wallColorToHex } from '../wallTiles.js';
import { getCharacterSprite } from './characters.js';
import type { SortBox } from './isoSort.js';
import { isoDrawOrder, SortLayer } from './isoSort.js';
import { drawMatrixEffect } from './matrixEffect.js';
import { getPetSpriteData } from './petEntity.js';
import { hexToNumber, rgbaToPixiColor } from './pixiColor.js';

TextureStyle.defaultOptions.scaleMode = 'nearest';

/** Half-extent (tiles) of a character's or pet's sort box around its feet. */
const ACTOR_SORT_HALF = 0.01;
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
  ghostFootprintW: number;
  ghostFootprintH: number;
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

function dashPoly(gfx: Graphics, points: readonly Point[], dash: readonly [number, number]): void {
  const [len, gap] = dash;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    dashLine(gfx, a.x, a.y, b.x, b.y, len, gap);
  }
}

/** Iso corners of a tile rectangle, clockwise from the top vertex. */
function footprintDiamond(col: number, row: number, w = 1, h = 1): Point[] {
  return [
    tileCorner(col, row),
    tileCorner(col + w, row),
    tileCorner(col + w, row + h),
    tileCorner(col, row + h),
  ];
}

function polyCoords(points: readonly Point[]): number[] {
  return points.flatMap((p) => [p.x, p.y]);
}

function actorBox(x: number, y: number): SortBox {
  const col = x / TILE_SIZE;
  const row = y / TILE_SIZE;
  return {
    minCol: col - ACTOR_SORT_HALF,
    minRow: row - ACTOR_SORT_HALF,
    maxCol: col + ACTOR_SORT_HALF,
    maxRow: row + ACTOR_SORT_HALF,
    layer: SortLayer.ACTOR,
  };
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
      gridRect({ cols, rows }),
      state.zoom,
      state.panX,
      state.panY,
    );
    this.worldLayer.position.set(offsetX, offsetY);
    this.worldLayer.scale.set(state.zoom, state.zoom);

    if (state.layout !== this.lastLayout) {
      this.rebuildFloor(state);
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

  private rebuildFloor(state: WorldRenderState): void {
    this.floorContainer.removeChildren();
    const tileMap = state.tileMap;
    const rows = tileMap.length;
    const cols = rows > 0 ? tileMap[0].length : 0;
    const layoutCols = state.layoutCols ?? cols;
    const isOpen = (c: number, r: number) =>
      r < 0 || c < 0 || r >= rows || c >= cols || tileMap[r][c] === TileType.VOID;

    // Slab edges where the office floor ends, so the room reads as a block.
    const slab = new Graphics();
    slab.roundPixels = true;
    const leftSlab = hexToNumber(FLOOR_SLAB_LEFT_COLOR);
    const rightSlab = hexToNumber(FLOOR_SLAB_RIGHT_COLOR);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (tileMap[r][c] === TileType.VOID) continue;
        const left = tileCorner(c, r + 1);
        const bottom = tileCorner(c + 1, r + 1);
        const right = tileCorner(c + 1, r);
        if (isOpen(c, r + 1)) {
          slab
            .poly([
              left.x,
              left.y,
              bottom.x,
              bottom.y,
              bottom.x,
              bottom.y + FLOOR_SLAB_PX,
              left.x,
              left.y + FLOOR_SLAB_PX,
            ])
            .fill(leftSlab);
        }
        if (isOpen(c + 1, r)) {
          slab
            .poly([
              bottom.x,
              bottom.y,
              right.x,
              right.y,
              right.x,
              right.y + FLOOR_SLAB_PX,
              bottom.x,
              bottom.y + FLOOR_SLAB_PX,
            ])
            .fill(rightSlab);
        }
      }
    }
    this.floorContainer.addChild(slab);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = tileMap[r][c];
        // Walls are boxes drawn with the entities.
        if (tile === TileType.VOID || tile === TileType.WALL) continue;
        const color = state.tileColors?.[r * layoutCols + c] ?? { h: 0, s: 0, b: 0, c: 0 };
        const sprite = new Sprite(
          getTexture(projectToDiamond(getColorizedFloorSprite(tile, color))),
        );
        sprite.roundPixels = true;
        const top = tileCorner(c, r);
        sprite.position.set(top.x - ISO_TILE_W / 2, top.y);
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
          const sprite = new Sprite(getTexture(projectToDiamond(spriteData)));
          sprite.roundPixels = true;
          const center = tileCorner(jx, jy);
          sprite.position.set(center.x - ISO_TILE_W / 2, center.y - ISO_TILE_H / 2);
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
          .poly(polyCoords(footprintDiamond(c, r)))
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
      const center = worldToIso(
        (acc.sumX / acc.count + 0.5) * TILE_SIZE,
        (acc.sumY / acc.count + 0.5) * TILE_SIZE,
      );
      const localCx = center.x;
      const localCy = center.y;
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

      const fill =
        selectedChar.seatId === uid
          ? rgbaToPixiColor(SEAT_OWN_COLOR)
          : !seat.assigned
            ? rgbaToPixiColor(SEAT_AVAILABLE_COLOR)
            : rgbaToPixiColor(SEAT_BUSY_COLOR);
      this.seatIndicatorGfx
        .poly(polyCoords(footprintDiamond(seat.seatCol, seat.seatRow)))
        .fill(fill);
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
    const drawables: Array<{ box: SortBox; nodes: Container[] }> = [];

    const tileMap = state.tileMap;
    const layoutCols = state.layoutCols ?? tileMap[0]?.length ?? 0;
    for (let r = 0; r < tileMap.length; r++) {
      for (let c = 0; c < tileMap[r].length; c++) {
        if (tileMap[r][c] !== TileType.WALL) continue;
        const key = `${r}:${c}`;
        liveWalls.add(key);
        const color = state.tileColors?.[r * layoutCols + c];
        const { sprite: wallSprite, height } = getWallSprite(
          tileMap,
          c,
          r,
          color ? wallColorToHex(color) : WALL_COLOR,
        );
        const sprite = getOrCreateSprite(this.wallPool, key, this.entityContainer);
        sprite.texture = getTexture(wallSprite);
        const top = tileCorner(c, r);
        sprite.position.set(top.x - ISO_TILE_W / 2, top.y - height);
        sprite.scale.set(1, 1);
        sprite.visible = true;
        drawables.push({
          box: { minCol: c, minRow: r, maxCol: c + 1, maxRow: r + 1, layer: SortLayer.FLOOR },
          nodes: [sprite],
        });
      }
    }

    for (const f of state.furniture) {
      liveFurniture.add(f.uid);
      const sprite = getOrCreateSprite(this.furniturePool, f.uid, this.entityContainer);
      const texture = getTexture(f.sprite);
      sprite.texture = texture;
      sprite.visible = true;
      if (f.mirrored) {
        sprite.scale.set(-1, 1);
        sprite.position.set(f.x + texture.width, f.y);
      } else {
        sprite.scale.set(1, 1);
        sprite.position.set(f.x, f.y);
      }
      drawables.push({ box: f.sort, nodes: [sprite] });
    }

    for (const ch of state.characters) {
      const sprites = getCharacterSprites(ch.palette, ch.hueShift);
      const spriteData = getCharacterSprite(ch, sprites);
      const texture = getTexture(spriteData);
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
      const anchor = worldToIso(ch.x, ch.y);
      const localX = Math.round(anchor.x - texture.width / 2);
      const localY = Math.round(anchor.y + sittingOffset - texture.height);
      const alpha = ch.isHeadless && ghostHeadlessAgents ? HEADLESS_CHARACTER_ALPHA : 1;
      const box = actorBox(ch.x, ch.y);

      if (ch.matrixEffect) {
        liveMatrix.add(ch.id);
        const gfx = getOrCreateGraphics(this.matrixPool, ch.id, this.entityContainer);
        gfx.clear();
        gfx.alpha = alpha;
        gfx.visible = true;
        drawMatrixEffect(gfx, ch, spriteData, localX, localY, 1);
        drawables.push({ box, nodes: [gfx] });
        continue;
      }

      liveBodies.add(ch.id);
      const body = getOrCreateSprite(this.characterPool, ch.id, this.entityContainer);
      body.texture = texture;
      body.position.set(localX, localY);
      body.scale.set(1, 1);
      body.alpha = alpha;
      body.visible = true;
      const nodes: Container[] = [body];

      const isSelected = state.selection?.selectedAgentId === ch.id;
      const isHovered = state.selection?.hoveredAgentId === ch.id;
      if (isSelected || isHovered) {
        liveOutlines.add(ch.id);
        const outlineData = getOutlineSprite(spriteData);
        const outline = getOrCreateSprite(this.outlinePool, ch.id, this.entityContainer);
        outline.texture = getTexture(outlineData);
        outline.position.set(localX - 1, localY - 1);
        outline.scale.set(1, 1);
        outline.alpha = isSelected ? SELECTED_OUTLINE_ALPHA : HOVERED_OUTLINE_ALPHA;
        outline.visible = true;
        nodes.unshift(outline);
      }
      drawables.push({ box, nodes });
    }

    for (const pet of state.pets ?? []) {
      const petSprites = getPetSprites(pet.petType);
      const spriteData = getPetSpriteData(pet, petSprites);
      if (!spriteData) continue;
      const texture = getTexture(spriteData);
      livePets.add(pet.id);
      const anchor = worldToIso(pet.x, pet.y);
      const sprite = getOrCreateSprite(this.petPool, pet.id, this.entityContainer);
      sprite.texture = texture;
      sprite.position.set(
        Math.round(anchor.x - texture.width / 2),
        Math.round(anchor.y - texture.height),
      );
      sprite.scale.set(1, 1);
      sprite.visible = true;
      drawables.push({ box: actorBox(pet.x, pet.y), nodes: [sprite] });
    }

    let z = 0;
    for (const i of isoDrawOrder(drawables.map((d) => d.box))) {
      for (const node of drawables[i].nodes) node.zIndex = z++;
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
        const anchor = worldToIso(ch.x, ch.y);
        const sprite = getOrCreateSprite(this.bubblePool, ch.id, this.bubbleContainer);
        sprite.texture = texture;
        sprite.position.set(
          Math.round(anchor.x - texture.width / 2),
          Math.round(anchor.y + sittingOff - BUBBLE_VERTICAL_OFFSET_PX - texture.height - 1),
        );
        sprite.alpha = alpha;
        sprite.visible = true;
      }

      if (!ch.isSubagent && !ch.isGreeter && !ch.isCto) {
        liveBadges.add(ch.id);
        const texture = getTexture(statusBadgeSprite(ch));
        const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
        const anchor = worldToIso(ch.x, ch.y);
        const sprite = getOrCreateSprite(this.badgePool, ch.id, this.badgeContainer);
        sprite.texture = texture;
        sprite.position.set(
          Math.round(anchor.x + STATUS_BADGE_HORIZONTAL_OFFSET_PX - texture.width / 2),
          Math.round(anchor.y + sittingOff - STATUS_BADGE_VERTICAL_OFFSET_PX - texture.height / 2),
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
      const anchor = worldToIso(pet.x, pet.y);
      sprite.position.set(
        Math.round(anchor.x - texture.width / 2),
        Math.round(anchor.y - TILE_SIZE - texture.height - 1),
      );
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
    const toDevice = (p: Point): Point => ({ x: offsetX + p.x * zoom, y: offsetY + p.y * zoom });
    const diamond = (c: number, r: number, w = 1, h = 1) =>
      footprintDiamond(c, r, w, h).map(toDevice);

    if (editor.showGrid) {
      const { color: lineColor, alpha: lineAlpha } = rgbaToPixiColor(GRID_LINE_COLOR);
      for (let c = 0; c <= cols; c++) {
        const a = toDevice(tileCorner(c, 0));
        const b = toDevice(tileCorner(c, rows));
        this.gridGfx.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      for (let r = 0; r <= rows; r++) {
        const a = toDevice(tileCorner(0, r));
        const b = toDevice(tileCorner(cols, r));
        this.gridGfx.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      this.gridGfx.stroke({ width: 1, color: lineColor, alpha: lineAlpha });

      const { color: voidColor, alpha: voidAlpha } = rgbaToPixiColor(VOID_TILE_OUTLINE_COLOR);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (state.tileMap[r]?.[c] === TileType.VOID) {
            dashPoly(this.gridGfx, diamond(c, r), VOID_TILE_DASH_PATTERN);
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
        const points = diamond(c, r);
        const isHovered = c === editor.ghostBorderHoverCol && r === editor.ghostBorderHoverRow;
        if (isHovered) {
          this.ghostBorderGfx.poly(polyCoords(points)).fill(hoverFill);
        }
        dashPoly(this.ghostBorderGfx, points, VOID_TILE_DASH_PATTERN);
        this.ghostBorderGfx.stroke({
          width: 1,
          color: isHovered ? hoverStroke.color : normalStroke.color,
          alpha: isHovered ? hoverStroke.alpha : normalStroke.alpha,
        });
      }
    }

    if (editor.ghostSprite && editor.ghostCol >= 0) {
      const texture = getTexture(editor.ghostSprite);
      const origin = toDevice(
        footprintSpriteOrigin(
          editor.ghostCol,
          editor.ghostRow,
          editor.ghostFootprintW,
          editor.ghostFootprintH,
          texture.width,
          texture.height,
        ),
      );
      this.ghostSpritePixi.texture = texture;
      this.ghostSpritePixi.alpha = GHOST_PREVIEW_SPRITE_ALPHA;
      this.ghostSpritePixi.visible = true;
      if (editor.ghostMirrored) {
        this.ghostSpritePixi.scale.set(-zoom, zoom);
        this.ghostSpritePixi.position.set(origin.x + texture.width * zoom, origin.y);
      } else {
        this.ghostSpritePixi.scale.set(zoom, zoom);
        this.ghostSpritePixi.position.set(origin.x, origin.y);
      }
      const tintColor = hexToNumber(editor.ghostValid ? GHOST_VALID_TINT : GHOST_INVALID_TINT);
      this.ghostTintGfx
        .poly(
          polyCoords(
            diamond(
              editor.ghostCol,
              editor.ghostRow,
              editor.ghostFootprintW,
              editor.ghostFootprintH,
            ),
          ),
        )
        .fill({ color: tintColor, alpha: GHOST_PREVIEW_TINT_ALPHA });
    }

    if (editor.hasSelection) {
      const { selectedCol: col, selectedRow: row, selectedW: w, selectedH: h } = editor;
      dashPoly(this.selectionGfx, diamond(col, row, w, h), SELECTION_DASH_PATTERN);
      this.selectionGfx.stroke({ width: 2, color: hexToNumber(SELECTION_HIGHLIGHT_COLOR) });

      const rightVertex = toDevice(tileCorner(col + w, row));
      editor.deleteButtonBounds = this.drawRoundButton(
        this.deleteButtonGfx,
        rightVertex.x,
        rightVertex.y,
        zoom,
        rgbaToPixiColor(DELETE_BUTTON_BG),
        'x',
      );

      if (editor.isRotatable) {
        const leftVertex = toDevice(tileCorner(col, row + h));
        editor.rotateButtonBounds = this.drawRoundButton(
          this.rotateButtonGfx,
          leftVertex.x,
          leftVertex.y,
          zoom,
          rgbaToPixiColor(ROTATE_BUTTON_BG),
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
      const startAngle = -Math.PI * 0.8;
      gfx.moveTo(cx + arcR * Math.cos(startAngle), cy + arcR * Math.sin(startAngle));
      gfx.arc(cx, cy, arcR, startAngle, Math.PI * 0.7);
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
