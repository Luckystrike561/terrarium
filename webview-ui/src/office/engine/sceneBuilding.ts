import type { Container, Graphics } from 'pixi.js';
import { Text } from 'pixi.js';

import {
  AREA_LABEL_SHADOW_ALPHA,
  AREA_LABEL_SHADOW_COLOR,
  BUILDING_PILLAR_WIDTH_PX,
  FLOOR_NAME_COLOR,
  FLOOR_NAME_FONT_SIZE_PX,
  FLOOR_NAME_MIN_FONT_SIZE_PX,
  FLOOR_SLAB_LEFT_COLOR,
  FLOOR_SLAB_RIGHT_COLOR,
} from '../../constants.js';
import type { Point } from '../iso.js';
import { tileCorner } from '../iso.js';
import { contentBounds } from '../projection.js';
import type { OfficeLayout } from '../types.js';
import { hexToNumber } from './pixiColor.js';
import type { FloorRenderState } from './sceneRenderer.js';

/** The side corners of the area two floors share, where the pillars between them stand on both floors. */
function sharedSideCorners(
  upper: OfficeLayout,
  lower: OfficeLayout,
): { left: Point; right: Point } {
  const a = contentBounds(upper);
  const b = contentBounds(lower);
  return {
    left: tileCorner(Math.max(a.minCol, b.minCol), Math.min(a.maxRow, b.maxRow)),
    right: tileCorner(Math.min(a.maxCol, b.maxCol), Math.max(a.minRow, b.minRow)),
  };
}

function floorNameText(name: string, fill: string): Text {
  const text = new Text({
    text: name,
    style: {
      fontFamily: 'FS Pixel Sans',
      fontWeight: 'bold',
      fill: hexToNumber(fill),
      align: 'center',
    },
  });
  text.anchor.set(0.5, 0);
  text.roundPixels = true;
  return text;
}

export interface FloorNameEntry {
  shadow: Text;
  main: Text;
}

/** Two pillars under every upper floor, at the side corners it shares with the floor below, down to that floor. */
export function drawPillars(gfx: Graphics, floors: FloorRenderState[]): void {
  gfx.clear();
  const leftColor = hexToNumber(FLOOR_SLAB_LEFT_COLOR);
  const rightColor = hexToNumber(FLOOR_SLAB_RIGHT_COLOR);
  for (let index = 1; index < floors.length; index++) {
    const upper = floors[index];
    const lower = floors[index - 1];
    const { left, right } = sharedSideCorners(upper.layout, lower.layout);
    const leftTop = left.y - upper.elevation + upper.slabPx;
    gfx
      .rect(left.x, leftTop, BUILDING_PILLAR_WIDTH_PX, left.y - lower.elevation - leftTop)
      .fill(leftColor);
    const rightTop = right.y - upper.elevation + upper.slabPx;
    gfx
      .rect(
        right.x - BUILDING_PILLAR_WIDTH_PX,
        rightTop,
        BUILDING_PILLAR_WIDTH_PX,
        right.y - lower.elevation - rightTop,
      )
      .fill(rightColor);
  }
}

/** Each floor's name on the front of its slab, in device pixels like the area labels. A lone office has none. */
export function updateFloorNames(
  labelLayer: Container,
  pool: Map<string, FloorNameEntry>,
  floors: FloorRenderState[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const named = floors.length > 1 ? floors : [];
  const fontSize = Math.max(FLOOR_NAME_FONT_SIZE_PX * zoom, FLOOR_NAME_MIN_FONT_SIZE_PX);
  for (const floor of named) {
    let label = pool.get(floor.id);
    if (!label) {
      label = {
        shadow: floorNameText(floor.name, AREA_LABEL_SHADOW_COLOR),
        main: floorNameText(floor.name, FLOOR_NAME_COLOR),
      };
      label.shadow.alpha = AREA_LABEL_SHADOW_ALPHA;
      labelLayer.addChild(label.shadow, label.main);
      pool.set(floor.id, label);
    }
    if (label.main.text !== floor.name) {
      label.shadow.text = floor.name;
      label.main.text = floor.name;
    }
    label.shadow.style.fontSize = fontSize;
    label.main.style.fontSize = fontSize;
    const bounds = contentBounds(floor.layout);
    const left = tileCorner(bounds.minCol, bounds.maxRow);
    const front = tileCorner(bounds.maxCol, bounds.maxRow);
    const x = offsetX + ((left.x + front.x) / 2) * zoom;
    const y = offsetY + ((left.y + front.y) / 2 - floor.elevation) * zoom;
    label.shadow.position.set(x + 1, y + 1);
    label.main.position.set(x, y);
  }
  for (const [id, label] of pool) {
    if (named.some((floor) => floor.id === id)) continue;
    labelLayer.removeChild(label.shadow, label.main);
    label.shadow.destroy();
    label.main.destroy();
    pool.delete(id);
  }
}
