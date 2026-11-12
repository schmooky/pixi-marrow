import type { TextureSource } from 'pixi.js';
import type { AtlasPage } from '../model/atlas';

/*
 * Whether the texture of an atlas page is sampled the way outlines assume. The cuts of overdraw
 * rest on the pixels of the page, see `cuts.ts`. A view asks before it lays its vertex ranges
 * out with cuts, and the scan of the page images asks before it reads a page.
 */

/** The pixels around a visible pixel that bilinear filtering can mix into a sample. */
export const FILTER_MARGIN = 0.5;

/**
 * Why the texture of an atlas page keeps the quads of its regions. `size`: it has another pixel
 * size than the atlas states. `mipmaps` and `anisotropy`: it is filtered across pixels that are
 * further apart. `repeat`: it repeats where the atlas page does not. `premultiplied`: it holds a
 * premultiplied image for a page the atlas calls straight.
 */
export type PageBlock = 'size' | 'mipmaps' | 'anisotropy' | 'repeat' | 'premultiplied';

/**
 * Why the texture of an atlas page is not sampled the way outlines assume, or null when it is:
 * bilinear or nearest, from the pixels the outlines were built from. A page with a block keeps
 * its quads, and none of its regions hides a slot.
 *
 * The texture must have the pixel size the atlas states: on a scaled texture the margin of an
 * outline is less than a texel. It must have no mipmaps and no anisotropic filtering, which
 * both mix pixels that are further apart. It must not repeat where the atlas page does not, and
 * it must not hold a premultiplied image for a page the atlas calls straight.
 *
 * @example
 * const blocks = atlas.pages.map((page, i) => pageBlock(textures[i]?.source ?? Texture.WHITE.source, page));
 */
export function pageBlock(source: TextureSource, page: AtlasPage): PageBlock | null {
    const { style } = source;

    if (source.pixelWidth !== page.width || source.pixelHeight !== page.height) return 'size';
    if (source.autoGenerateMipmaps || source.mipLevelCount !== 1) return 'mipmaps';
    if (style.maxAnisotropy !== 1) return 'anisotropy';
    if ((!page.repeatX && style.addressModeU === 'repeat') || (!page.repeatY && style.addressModeV === 'repeat')) {
        return 'repeat';
    }

    return !page.pma && source.alphaMode === 'premultiplied-alpha' ? 'premultiplied' : null;
}

/**
 * Whether the texture of an atlas page is sampled the way outlines assume. See {@link pageBlock}.
 *
 * @example
 * const allowed = atlas.pages.map((page, i) => pageAllowsCuts(textures[i]?.source ?? Texture.WHITE.source, page));
 */
export function pageAllowsCuts(source: TextureSource, page: AtlasPage): boolean {
    return pageBlock(source, page) === null;
}
