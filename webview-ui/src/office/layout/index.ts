export type { CatalogEntryWithCategory } from './furnitureCatalog.js';
export { getCatalogEntry } from './furnitureCatalog.js';
export {
  createDefaultLayout,
  deserializeLayout,
  getBlockedTiles,
  getSeatTiles,
  layoutToFurnitureInstances,
  layoutToSeats,
  layoutToTileMap,
  serializeLayout,
} from './layoutSerializer.js';
export { findPath, getWalkableTiles, isWalkable } from './tileMap.js';
