/**
 * Decodes the base64 PNG character sheets carried by `characterSpritesLoaded`
 * into the frame arrays `setCharacterTemplates` expects. Browser-only (canvas,
 * createImageBitmap): kept out of spriteData.ts so the Node-run webview test
 * suite, which imports spriteData.ts without a DOM lib, never pulls this in.
 */

import { characterPixelsToFrames } from '../../../../core/src/assets/characterPixels.ts';
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHARACTER_DIRECTIONS,
  CHARACTER_FRAMES,
} from '../../../../core/src/assets/constants.ts';
import type { CharacterDirectionSprites } from '../../../../core/src/assets/types.ts';
import { setCharacterTemplates } from './spriteData.ts';

async function decodeCharacterSheetPng(base64Png: string): Promise<CharacterDirectionSprites> {
  const binary = atob(base64Png);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to create 2d canvas context for character sheet decode');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const expectedWidth = CHAR_FRAME_W * CHARACTER_FRAMES.length;
  const expectedHeight = CHAR_FRAME_H * CHARACTER_DIRECTIONS.length;
  if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
    throw new Error(
      `character sheet is ${canvas.width.toString()}×${canvas.height.toString()}, expected ${expectedWidth.toString()}×${expectedHeight.toString()}`,
    );
  }

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return characterPixelsToFrames(data, canvas.width);
}

/** Decode the base64 PNG sheets from a `characterSpritesLoaded` message and
 *  install them as the active agent/CTO templates. `getCharacterSprites()` /
 *  `getCtoSprites()` keep returning the placeholder sheet until this resolves. */
export async function setCharacterTemplatesFromPng(
  characters: readonly { png: string }[],
  cto: { png: string },
): Promise<void> {
  const [decodedCharacters, decodedCto] = await Promise.all([
    Promise.all(characters.map((set) => decodeCharacterSheetPng(set.png))),
    decodeCharacterSheetPng(cto.png),
  ]);
  setCharacterTemplates(decodedCharacters, decodedCto);
}
