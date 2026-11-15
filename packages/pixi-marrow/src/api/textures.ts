import type { Texture } from 'pixi.js';
import type { AtlasFilter, AtlasPage } from '../model/atlas';

/** The alpha modes of Pixi a page texture can have. The render path assumes premultiplied texels. */
type PageAlphaMode = 'premultiplied-alpha' | 'premultiply-alpha-on-upload';

/** The filter inside one mip level. The first word of an atlas mip filter names it. */
const texelFilter = (filter: AtlasFilter): 'nearest' | 'linear' =>
    filter === 'nearest' || filter === 'mipMapNearestNearest' || filter === 'mipMapNearestLinear'
        ? 'nearest'
        : 'linear';

/**
 * The alpha mode the texture of an atlas page needs: a premultiplied page is uploaded as it is.
 *
 * @example
 * const texture = await Assets.load({ src: 'hero.png', data: { alphaMode: alphaModeOf(page) } });
 */
export const alphaModeOf = (page: AtlasPage): PageAlphaMode =>
    page.pma ? 'premultiplied-alpha' : 'premultiply-alpha-on-upload';

/**
 * Whether the image behind a texture keeps its pixels: an image, a bitmap or bytes in memory.
 * A canvas and a video change, and outlines of one moment would cut the next one wrong.
 *
 * @example
 * if (isStillImage(texture.source.resource)) console.log('the page can have outlines');
 */
export function isStillImage(resource: unknown): boolean {
    if (typeof resource !== 'object' || resource === null) return false;

    return !('getContext' in resource) && !('videoWidth' in resource) && !('displayWidth' in resource);
}

/**
 * Sets up a texture the way its atlas page asks, as the official Pixi runtime does: alpha mode,
 * min and mag filter, mipmaps and wrap.
 *
 * @example
 * const atlas = importAtlas(text);
 * atlas.pages.forEach((page, i) => configureTexture(textures[i] ?? Texture.WHITE, page));
 */
export function configureTexture(texture: Texture, page: AtlasPage): void {
    const source = texture.source;
    const style = source.style;
    const alphaMode = alphaModeOf(page);

    style.minFilter = texelFilter(page.minFilter);
    style.magFilter = texelFilter(page.magFilter);
    style.addressModeU = page.repeatX ? 'repeat' : 'clamp-to-edge';
    style.addressModeV = page.repeatY ? 'repeat' : 'clamp-to-edge';
    style.update();
    source.autoGenerateMipmaps = page.minFilter !== 'nearest' && page.minFilter !== 'linear';
    source.updateMipmaps();
    if (source.alphaMode !== alphaMode) {
        source.alphaMode = alphaMode;
        // the texels are uploaded again in the new mode
        source.update();
    }
}
