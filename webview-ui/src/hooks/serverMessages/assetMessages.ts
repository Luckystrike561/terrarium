import type { ServerMessage } from '../../../../core/src/messages.js';
import { setFloorSprites } from '../../office/floorTiles.js';
import { buildDynamicCatalog } from '../../office/layout/furnitureCatalog.js';
import { setCarpetSprites } from '../../office/sprites/carpetTiles.js';
import { setPetTemplates } from '../../office/sprites/petSpriteData.js';
import { setCharacterTemplates } from '../../office/sprites/spriteData.js';
import { destroyAllTextures } from '../../office/sprites/textureCache.js';
import { setProviderCapabilities } from '../../office/toolUtils.js';
import type { MessageContext } from './messageContext.js';

/** Asset-loading family: provider capability taxonomies and every sprite/furniture/area
 *  bundle the server streams down. Returns true if `msg.type` matched one of its
 *  variants. */
export function handleAssetMessage(msg: ServerMessage, ctx: MessageContext): boolean {
  if (msg.type === 'providerCapabilities') {
    setProviderCapabilities(msg.providers);
    return true;
  } else if (msg.type === 'characterSpritesLoaded') {
    const characters = msg.characters;
    console.log(`[Webview] Received ${characters.length} pre-colored character sprites`);
    destroyAllTextures();
    setCharacterTemplates(characters, msg.cto);
    return true;
  } else if (msg.type === 'petSpritesLoaded') {
    const pets = msg.pets;
    if (!Array.isArray(pets)) {
      return true;
    }
    const petNames = Array.isArray(msg.petNames) ? msg.petNames : undefined;
    console.log(`[Webview] Received ${pets.length} pet sprites`);
    destroyAllTextures();
    setPetTemplates(pets, petNames);
    return true;
  } else if (msg.type === 'floorTilesLoaded') {
    const sprites = msg.sprites;
    console.log(`[Webview] Received ${sprites.length} floor tile patterns`);
    destroyAllTextures();
    setFloorSprites(sprites);
    return true;
  } else if (msg.type === 'carpetTilesLoaded') {
    const sets = msg.sets;
    console.log(`[Webview] Received ${sets.length} carpet variant(s)`);
    destroyAllTextures();
    setCarpetSprites(sets);
    return true;
  } else if (msg.type === 'areaMappingsLoaded') {
    const mappings = msg.mappings ?? {};
    ctx.building.setAreaMappings(mappings);
    return true;
  } else if (msg.type === 'furnitureAssetsLoaded') {
    try {
      const catalog = msg.catalog;
      const sprites = msg.sprites;
      console.log(`📦 Webview: Loaded ${catalog.length} furniture assets`);
      // Build dynamic catalog immediately so getCatalogEntry() works when layoutLoaded arrives next
      buildDynamicCatalog({ catalog, sprites });
      destroyAllTextures();
    } catch (err) {
      console.error(`❌ Webview: Error processing furnitureAssetsLoaded:`, err);
    }
    return true;
  }
  return false;
}
