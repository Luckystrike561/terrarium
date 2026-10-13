/**
 * Office world renderer: PixiJS (WebGL) retained scene graph, isometric.
 *
 * - One `worldLayer` container is positioned/scaled once per frame
 *   (`position = (offsetX, offsetY)` device px, `scale = zoom`). Every
 *   world-space child (tiles, carpets, walls, furniture, characters, pets,
 *   bubbles, badges) is built in LOCAL, unscaled iso pixel coordinates (see
 *   iso.ts: a tile is a 32×16 diamond). The simulation stays on the top-down
 *   grid; positions are projected here.
 * - Each floor of the building is one FloorScene: a child container of
 *   `worldLayer` raised by the floor's elevation, bottom floor first, with the
 *   pillars joining the floors behind them all.
 * - Area labels and floor names stay in DEVICE-PIXEL space as children of the
 *   stage instead: their minimum font size is deliberately constant-in-device-pixels,
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
 * - Each layer (floor/carpet, area overlay/labels, entities, bubbles/badges,
 *   building pillars/floor names) is built by its own scene*.ts module; this
 *   file only owns the containers/pools that must persist across frames and
 *   sequences the builders in draw order.
 */

// Registers Pixi's non-eval fallback for its uniform-buffer sync path before
// any renderer is created, so the app never depends on `new Function`/eval
// being available.
import 'pixi.js/unsafe-eval';

import type { Renderer } from 'pixi.js';
import { Application, Container, Graphics, Sprite, Texture, TextureStyle } from 'pixi.js';

import type { ColorValue } from '../../components/ui/types.js';
import { paintNightSkyline } from '../backdrop.js';
import { gridRect, mapOffset } from '../projection.js';
import type {
  AreaDefinition,
  CarpetTile,
  Character,
  FurnitureInstance,
  OfficeLayout,
  Pet,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import type { AreaLabelEntry } from './sceneAreas.js';
import {
  rebuildAreaLabels,
  rebuildAreaOverlay,
  repositionAreaLabels,
  updateSeatIndicator,
} from './sceneAreas.js';
import type { BubbleLayers, BubblePools } from './sceneBubbles.js';
import { createBubblePools, updateBubblesAndBadges } from './sceneBubbles.js';
import type { FloorNameEntry } from './sceneBuilding.js';
import { drawPillars, updateFloorNames } from './sceneBuilding.js';
import type { EntityPools } from './sceneEntities.js';
import { createEntityPools, updateEntities } from './sceneEntities.js';
import { rebuildCarpet, rebuildFloor } from './sceneFloor.js';

TextureStyle.defaultOptions.scaleMode = 'nearest';

// ── Public types ────────────────────────────────────────────────

export interface SelectionRenderState {
  selectedAgentId: number | null;
  hoveredAgentId: number | null;
  hoveredTile: { col: number; row: number } | null;
  seats: Map<string, Seat>;
  characters: Map<number, Character>;
}

/** One floor of the building, drawn `elevation` iso px above the first. */
export interface FloorRenderState {
  id: string;
  name: string;
  elevation: number;
  /** Thickness of the slab the floor stands on. */
  slabPx: number;
  /** Identity used to detect layout edits cheaply (see module doc). */
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  furniture: FurnitureInstance[];
  characters: Character[];
  selection?: SelectionRenderState;
  tileColors?: Array<ColorValue | null>;
  layoutCols?: number;
  layoutRows?: number;
  carpetTiles?: Array<CarpetTile | null>;
  areas?: AreaDefinition[];
  areaTiles?: Array<string | null>;
  pets?: Pet[];
}

export interface WorldRenderState {
  /** Bottom to top. */
  floors: FloorRenderState[];
  /** The first floor's grid, which `mapOffset` centers. */
  grid: { cols: number; rows: number };
  zoom: number;
  panX: number;
  panY: number;
}

// ── One floor ─────────────────────────────────────────────────────

/** Everything drawn for one floor, in one container raised by the floor's elevation. Area labels live in the
 *  device-pixel label layer instead, offset by the same elevation. */
class FloorScene {
  readonly root = new Container();
  private floorContainer = new Container();
  private carpetContainer = new Container();
  private areaOverlayGfx = new Graphics();
  private seatIndicatorGfx = new Graphics();
  private entityContainer = new Container({ isRenderGroup: true });
  private bubbleLayers: BubbleLayers = {
    bubble: new Container(),
    badge: new Container(),
    petBubble: new Container(),
  };
  private areaLabelContainer = new Container();

  private lastLayout: OfficeLayout | null = null;
  private lastSlabPx = 0;

  private entityPools: EntityPools = createEntityPools();
  private bubblePools: BubblePools = createBubblePools();
  private areaLabelPool = new Map<string, AreaLabelEntry>();

  constructor(worldLayer: Container, labelLayer: Container) {
    this.root.addChild(
      this.floorContainer,
      this.carpetContainer,
      this.areaOverlayGfx,
      this.seatIndicatorGfx,
      this.entityContainer,
      this.bubbleLayers.bubble,
      this.bubbleLayers.badge,
      this.bubbleLayers.petBubble,
    );
    this.entityContainer.sortableChildren = true;
    worldLayer.addChild(this.root);
    labelLayer.addChild(this.areaLabelContainer);
  }

  update(state: FloorRenderState, offsetX: number, offsetY: number, zoom: number): void {
    this.root.position.set(0, -state.elevation);
    const cols = state.layoutCols ?? (state.tileMap.length > 0 ? state.tileMap[0].length : 0);
    const rows = state.layoutRows ?? state.tileMap.length;
    if (state.layout !== this.lastLayout || state.slabPx !== this.lastSlabPx) {
      rebuildFloor(this.floorContainer, state);
      rebuildCarpet(this.carpetContainer, state, cols, rows);
      rebuildAreaLabels(this.areaLabelContainer, this.areaLabelPool, state);
      rebuildAreaOverlay(this.areaOverlayGfx, state, cols, rows);
      this.lastLayout = state.layout;
      this.lastSlabPx = state.slabPx;
    }

    // Area labels anchor to the world, but render in device-pixel space for
    // crisp, zoom-clamped text. Reposition them whenever pan/zoom moves.
    repositionAreaLabels(this.areaLabelPool, offsetX, offsetY - state.elevation * zoom, zoom);

    updateSeatIndicator(this.seatIndicatorGfx, state);
    updateEntities(this.entityPools, this.entityContainer, state);
    updateBubblesAndBadges(this.bubblePools, this.bubbleLayers, state);
  }

  destroy(): void {
    this.root.removeFromParent();
    this.areaLabelContainer.removeFromParent();
    this.root.destroy({ children: true, texture: false });
    this.areaLabelContainer.destroy({ children: true });
  }
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

  /** Pillars first, then one container per floor, bottom to top (zIndex = floor index). */
  private worldLayer = new Container();
  private pillarGfx = new Graphics();
  /** Device-pixel text: every floor's area labels, and the floor names. */
  private labelLayer = new Container();

  private floorScenes = new Map<string, FloorScene>();
  private floorNamePool = new Map<string, FloorNameEntry>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.pillarGfx.roundPixels = true;
    this.pillarGfx.zIndex = -1;
    this.worldLayer.sortableChildren = true;
    this.worldLayer.addChild(this.pillarGfx);
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
    this.app.stage.addChild(this.backdrop, this.worldLayer, this.labelLayer);
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
    const { offsetX, offsetY } = mapOffset(
      canvasWidth,
      canvasHeight,
      gridRect(state.grid),
      state.zoom,
      state.panX,
      state.panY,
    );
    this.worldLayer.position.set(offsetX, offsetY);
    this.worldLayer.scale.set(state.zoom, state.zoom);
    this.updateBackdrop(canvasWidth, canvasHeight, state.zoom);

    const liveFloors = new Set<string>();
    state.floors.forEach((floor, index) => {
      liveFloors.add(floor.id);
      let scene = this.floorScenes.get(floor.id);
      if (!scene) {
        scene = new FloorScene(this.worldLayer, this.labelLayer);
        this.floorScenes.set(floor.id, scene);
      }
      scene.root.zIndex = index;
      scene.update(floor, offsetX, offsetY, state.zoom);
    });
    for (const [id, scene] of this.floorScenes) {
      if (liveFloors.has(id)) continue;
      scene.destroy();
      this.floorScenes.delete(id);
    }
    drawPillars(this.pillarGfx, state.floors);
    updateFloorNames(
      this.labelLayer,
      this.floorNamePool,
      state.floors,
      offsetX,
      offsetY,
      state.zoom,
    );

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
}
