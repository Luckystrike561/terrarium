/**
 * Office world renderer: PixiJS (WebGL) retained scene graph, isometric.
 *
 * - One `worldLayer` container is positioned/scaled once per frame
 *   (`position = (offsetX, offsetY)` device px, `scale = zoom`). Every
 *   world-space child (tiles, carpets, walls, furniture, characters, pets,
 *   bubbles, badges) is built in LOCAL, unscaled iso pixel coordinates (see
 *   iso.ts: a tile is a 32×16 diamond). The simulation stays on the top-down
 *   grid; positions are projected here.
 * - Area labels stay in DEVICE-PIXEL space as direct children of the stage
 *   instead: their minimum font size is deliberately constant-in-device-pixels,
 *   not proportional to zoom, so they can't live inside the scaled worldLayer.
 * - The night-skyline backdrop is the stage's first child, also in device
 *   pixels, so it covers the whole canvas (fit bands, VOID tiles, any pan).
 * - Walls/furniture/characters/pets are retained Sprite pools keyed by a
 *   stable id (furniture uid, `row:col` for wall tiles, character id, pet id)
 *   and diffed every frame, then ordered with isoDrawOrder: a single depth
 *   key cannot order iso boxes of different sizes. This runs every frame
 *   because `OfficeState.furniture` gets a fresh array identity whenever
 *   auto-on electronics toggle, so the array reference alone isn't a valid
 *   "did anything change" signal. That's unlike the tile grid, whose
 *   `OfficeLayout` reference is only replaced when a new layout is loaded,
 *   so floor / carpet / area-overlay / area-label containers rebuild only then.
 */

// Registers Pixi's non-eval fallback for its uniform-buffer sync path before
// any renderer is created, so the app never depends on `new Function`/eval
// being available.
import 'pixi.js/unsafe-eval';

import type { Renderer } from 'pixi.js';
import { Application, Container, Graphics, Sprite, Text, Texture, TextureStyle } from 'pixi.js';

import type { ColorValue } from '../../components/ui/types.js';
import {
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
  CARPET_DEFAULT_ACCENT_COLOR,
  CARPET_DEFAULT_COLOR,
  CHARACTER_SITTING_OFFSET_PX,
  FLOOR_SLAB_LEFT_COLOR,
  FLOOR_SLAB_PX,
  FLOOR_SLAB_RIGHT_COLOR,
  HOVERED_OUTLINE_ALPHA,
  SEAT_AVAILABLE_COLOR,
  SEAT_BUSY_COLOR,
  SEAT_OWN_COLOR,
  SELECTED_OUTLINE_ALPHA,
  STATUS_BADGE_HORIZONTAL_OFFSET_PX,
  STATUS_BADGE_VERTICAL_OFFSET_PX,
} from '../../constants.js';
import { paintNightSkyline } from '../backdrop.js';
import { getColorizedFloorSprite, WALL_COLOR } from '../floorTiles.js';
import type { Point } from '../iso.js';
import { ISO_TILE_H, ISO_TILE_W, projectToDiamond, tileCorner, worldToIso } from '../iso.js';
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
  getCtoSprites,
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

// ── Public types ────────────────────────────────────────────────

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
  tileColors?: Array<ColorValue | null>;
  layoutCols?: number;
  layoutRows?: number;
  carpetTiles?: Array<CarpetTile | null>;
  areas?: AreaDefinition[];
  areaTiles?: Array<string | null>;
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

  /** Screen-space, behind `worldLayer`: covers the whole canvas whatever the
   *  pan, and is repainted only when the canvas size or pixel size changes. */
  private backdrop = new Sprite();
  private backdropKey = '';

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

  private lastLayout: OfficeLayout | null = null;

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
    this.app.stage.addChild(this.backdrop, this.worldLayer, this.areaLabelContainer);
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
    // Shared sprite textures outlive the app (texture: false), but the
    // backdrop's texture is owned here alone.
    if (this.backdrop.texture !== Texture.EMPTY) this.backdrop.texture.destroy(true);
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
    this.updateBackdrop(canvasWidth, canvasHeight, state.zoom);

    if (state.layout !== this.lastLayout) {
      this.rebuildFloor(state);
      this.rebuildCarpet(state, cols, rows);
      this.rebuildAreaLabels(state);
      this.rebuildAreaOverlay(state, cols, rows);
      this.lastLayout = state.layout;
    }

    // Area labels anchor to the world, but render in device-pixel space for
    // crisp, zoom-clamped text. Reposition them whenever pan/zoom moves.
    this.repositionAreaLabels(offsetX, offsetY, state.zoom);

    this.updateSeatIndicator(state);
    this.updateEntities(state);
    this.updateBubblesAndBadges(state);

    this.app.renderer.render(this.app.stage);
    return { offsetX, offsetY };
  }

  // ── Backdrop (resize-gated) ────────────────────────────────────

  private updateBackdrop(canvasWidth: number, canvasHeight: number, zoom: number): void {
    // One backdrop pixel per office sprite pixel, kept integral so nearest
    // sampling never produces uneven pixel columns.
    const pixelSize = Math.max(1, Math.round(zoom));
    const key = `${canvasWidth}x${canvasHeight}@${pixelSize}`;
    if (key === this.backdropKey) return;
    this.backdropKey = key;

    const image = paintNightSkyline(
      Math.ceil(canvasWidth / pixelSize),
      Math.ceil(canvasHeight / pixelSize),
    );
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas
      .getContext('2d')!
      .putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);

    const previous = this.backdrop.texture;
    this.backdrop.texture = Texture.from(canvas);
    if (previous !== Texture.EMPTY) previous.destroy(true);
    this.backdrop.scale.set(pixelSize);
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
        this.areaOverlayGfx
          .poly(polyCoords(footprintDiamond(c, r)))
          .fill({ color: hexToNumber(hex), alpha: AREA_OVERLAY_ALPHA });
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
      const sprites = ch.isCto ? getCtoSprites() : getCharacterSprites(ch.palette, ch.hueShift);
      const spriteData = getCharacterSprite(ch, sprites);
      const texture = getTexture(spriteData);
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
      const anchor = worldToIso(ch.x, ch.y);
      const localX = Math.round(anchor.x - texture.width / 2);
      const localY = Math.round(anchor.y + sittingOffset - texture.height);
      const box = actorBox(ch.x, ch.y);

      if (ch.matrixEffect) {
        liveMatrix.add(ch.id);
        const gfx = getOrCreateGraphics(this.matrixPool, ch.id, this.entityContainer);
        gfx.clear();
        gfx.alpha = 1;
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
      body.alpha = 1;
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
}
