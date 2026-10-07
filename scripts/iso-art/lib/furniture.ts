/**
 * Furniture spec → asset folder (PNGs + manifest.json in the format
 * core/src/assets/manifestUtils.ts flattens).
 */

import * as fs from 'fs';
import * as path from 'path';

import type { PixelImage } from './image.js';

export type Orientation = 'front' | 'right' | 'back' | 'left';
export type FurnitureCategory =
  'desks' | 'chairs' | 'storage' | 'electronics' | 'decor' | 'wall' | 'misc';

/** One drawable variant. Orientation semantics (grid directions):
 *  front = faces +row (screen lower-left), right = faces +col (lower-right),
 *  back = faces -row (upper-right), left = faces -col (upper-left).
 *  Chairs: the sitter faces the same way as the chair. */
export interface FurnitureVariant {
  orientation?: Orientation;
  state?: 'on' | 'off';
  footprintW: number;
  footprintH: number;
  /** One image, or several for an animation (state 'on' only). */
  images: PixelImage[];
}

export interface FurnitureSpec {
  id: string;
  name: string;
  category: FurnitureCategory;
  canPlaceOnWalls?: boolean;
  canPlaceOnSurfaces?: boolean;
  variants: FurnitureVariant[];
}

interface ManifestAssetJson {
  type: 'asset';
  id: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  orientation?: string;
  state?: string;
  frame?: number;
}

type ManifestNodeJson = ManifestAssetJson | Record<string, unknown>;

function assetNode(
  spec: FurnitureSpec,
  variant: FurnitureVariant,
  image: PixelImage,
  files: Map<string, PixelImage>,
  frame?: number,
): ManifestAssetJson {
  const parts = [spec.id, variant.orientation?.toUpperCase(), variant.state?.toUpperCase()];
  if (frame !== undefined) parts.push(String(frame + 1));
  const id = parts.filter(Boolean).join('_');
  files.set(`${id}.png`, image);
  return {
    type: 'asset',
    id,
    file: `${id}.png`,
    width: image.width,
    height: image.height,
    footprintW: variant.footprintW,
    footprintH: variant.footprintH,
    ...(frame !== undefined ? { frame } : {}),
  };
}

function variantNode(
  spec: FurnitureSpec,
  variant: FurnitureVariant,
  files: Map<string, PixelImage>,
): ManifestNodeJson {
  if (variant.images.length === 1) {
    return {
      ...assetNode(spec, variant, variant.images[0], files),
      ...(variant.state ? { state: variant.state } : {}),
    };
  }
  return {
    type: 'group',
    groupType: 'animation',
    ...(variant.state ? { state: variant.state } : {}),
    members: variant.images.map((im, i) => assetNode(spec, variant, im, files, i)),
  };
}

export function writeFurniture(spec: FurnitureSpec, furnitureDir: string): void {
  const dir = path.join(furnitureDir, spec.id);
  fs.mkdirSync(dir, { recursive: true });
  const files = new Map<string, PixelImage>();
  const common = {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    canPlaceOnWalls: spec.canPlaceOnWalls ?? false,
    canPlaceOnSurfaces: spec.canPlaceOnSurfaces ?? false,
    backgroundTiles: 0,
  };

  let manifest: Record<string, unknown>;
  const orientations = [
    ...new Set(spec.variants.map((v) => v.orientation).filter(Boolean)),
  ] as Orientation[];
  if (spec.variants.length === 1 && orientations.length === 0 && !spec.variants[0].state) {
    const node = assetNode(spec, spec.variants[0], spec.variants[0].images[0], files);
    manifest = { ...common, ...node, id: spec.id };
  } else if (orientations.length > 0) {
    const members = orientations.map((orientation) => {
      const own = spec.variants.filter((v) => v.orientation === orientation);
      if (own.length === 1 && !own[0].state) {
        return { ...variantNode(spec, own[0], files), orientation };
      }
      return {
        type: 'group',
        groupType: 'state',
        orientation,
        members: own.map((v) => variantNode(spec, v, files)),
      };
    });
    manifest = {
      ...common,
      type: 'group',
      groupType: 'rotation',
      rotationScheme: orientations.length === 2 ? '2-way' : '4-way',
      members,
    };
  } else {
    manifest = {
      ...common,
      type: 'group',
      groupType: 'state',
      members: spec.variants.map((v) => variantNode(spec, v, files)),
    };
  }

  for (const [file, image] of files) image.writePng(path.join(dir, file));
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
