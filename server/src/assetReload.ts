import type { LoadedAssets, LoadedCharacterSprites, LoadedPetSprites } from './assetLoader.js';
import {
  loadCarpetTiles,
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadPetSprites,
  loadWallTiles,
} from './assetLoader.js';
import type { AssetCache } from './clientMessageHandler.js';
import { setPaletteCount } from './paletteAssigner.js';

/**
 * Shared asset-loading helpers used by the standalone server to build the
 * in-memory asset cache from the bundled assets.
 */
export async function loadAllFurniture(assetsRoot: string): Promise<LoadedAssets | null> {
  return loadFurnitureAssets(assetsRoot);
}

export async function loadAllCharacters(
  assetsRoot: string,
): Promise<LoadedCharacterSprites | null> {
  const chars = await loadCharacterSprites(assetsRoot);
  if (chars) setPaletteCount(chars.characters.length);
  return chars;
}

export async function loadAllPets(assetsRoot: string): Promise<LoadedPetSprites | null> {
  return loadPetSprites(assetsRoot);
}

/**
 * Build the full in-memory asset cache for the standalone server. Reproduces
 * the wrap/unwrap shape `AssetCache` expects: characters/pets/furniture are
 * wrapper objects, while floor/wall/carpet are the unwrapped sprite arrays.
 */
export async function buildAssetCache(distRoot: string): Promise<AssetCache> {
  return {
    characters: await loadAllCharacters(distRoot),
    pets: await loadAllPets(distRoot),
    floorTiles: await loadFloorTiles(distRoot).then((t) => t?.sprites ?? null),
    wallTiles: await loadWallTiles(distRoot).then((t) => t?.sets ?? null),
    carpetTiles: await loadCarpetTiles(distRoot).then((t) => t?.sets ?? null),
    furniture: await loadAllFurniture(distRoot),
    defaultLayout: loadDefaultLayout(distRoot),
  };
}
