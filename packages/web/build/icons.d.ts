import type { Plugin } from "vite";
/**
 * Painter's algorithm over the layers. Pixels whose neighbours share their
 * topmost layer take one sample; only edge pixels are supersampled, which
 * keeps the build fast on a Raspberry Pi.
 */
export declare function renderIcon(size: number, maskable: boolean): Uint8Array;
/** Serves the icons in dev and emits them into `dist/icons` on build. */
export declare function terrariumIcons(): Plugin;
