import { Assets, Texture } from 'pixi.js';
import { MarrowError } from '../base/errors';
import { closestName } from '../base/names';
import type { AtlasFilter, AtlasModel, AtlasPage } from '../model/atlas';

/** The alpha modes of Pixi a page texture can have. The render path assumes premultiplied texels. */
type PageAlphaMode = 'premultiplied-alpha' | 'premultiply-alpha-on-upload';

/** The page textures of an atlas, with the image URLs that were loaded for them. */
export interface LoadedPages {
    /** One texture per atlas page, in page order. */
    textures: Texture[];
    /** The URLs the page source loaded. {@link releasePage} gives each one back. */
    loaded: string[];
}

/**
 * What loads page images: Pixi `Assets` for `MarrowAsset.load`, or the loader of Pixi that
 * loads an `.atlas` asset. Each counts how many atlases hold each image URL, and unloads the
 * image when the last one lets go.
 */
export interface PageSource {
    load(url: string, data: Readonly<Record<string, unknown>>): Promise<unknown>;
    unload(url: string): void;
    readonly holders: Map<string, number>;
}

/** Page images through Pixi `Assets`. */
export const assetsPages: PageSource = {
    load: (url, data) => Assets.load({ src: url, data }),
    unload: (url) => void Assets.unload(url),
    holders: new Map(),
};

/** The filter inside one mip level. The first word of an atlas mip filter names it. */
const texelFilter = (filter: AtlasFilter): 'nearest' | 'linear' =>
    filter === 'nearest' || filter === 'mipMapNearestNearest' || filter === 'mipMapNearestLinear'
        ? 'nearest'
        : 'linear';

const alphaModeOf = (page: AtlasPage): PageAlphaMode =>
    page.pma ? 'premultiplied-alpha' : 'premultiply-alpha-on-upload';

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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

/**
 * The URL of a page image that lies next to its atlas. The query of the atlas URL is kept, as in
 * the official Pixi runtime: `art/hero.atlas?v=3` gives `art/hero.png?v=3`.
 */
function pageUrl(atlasUrl: string, pageName: string): string {
    const hash = atlasUrl.indexOf('#');
    const url = hash === -1 ? atlasUrl : atlasUrl.slice(0, hash);
    const query = url.indexOf('?');
    const path = query === -1 ? url : url.slice(0, query);

    return `${path.slice(0, path.lastIndexOf('/') + 1)}${pageName}${query === -1 ? '' : url.slice(query)}`;
}

/** Counts one holder of an image URL less. Returns true when none is left. */
function letGo(url: string, source: PageSource): boolean {
    const count = (source.holders.get(url) ?? 0) - 1;

    if (count > 0) {
        source.holders.set(url, count);

        return false;
    }
    source.holders.delete(url);

    return true;
}

/**
 * Gives back an image URL that {@link loadPages} loaded. The image is unloaded when no other
 * atlas holds it.
 *
 * @example
 * for (const url of pages.loaded) releasePage(url);
 */
export function releasePage(url: string, source: PageSource = assetsPages): void {
    if (letGo(url, source)) source.unload(url);
}

async function loadPage(
    url: string,
    page: AtlasPage,
    source: PageSource,
    metadata: Readonly<Record<string, unknown>>,
): Promise<Texture> {
    let texture: unknown;

    source.holders.set(url, (source.holders.get(url) ?? 0) + 1);
    try {
        texture = await source.load(url, { ...metadata, alphaMode: alphaModeOf(page) });
    } catch (error) {
        letGo(url, source);
        throw new MarrowError('invalid-data', `The page image "${page.name}" did not load: ${reasonOf(error)}`, {
            fix: `Put the image at ${url}, or pass it in "textures" under the page name.`,
        });
    }
    if (!(texture instanceof Texture)) {
        releasePage(url, source);
        throw new MarrowError('invalid-data', `Pixi loaded "${page.name}" from ${url}, but not as a texture.`, {
            fix: 'Use an image format that Pixi loads as a texture, such as PNG or WebP.',
        });
    }

    return texture;
}

/** Throws for a name in `given` that is no page of the atlas: a texture that would never be used. */
function checkPageNames(atlas: AtlasModel, given: Readonly<Record<string, Texture | string>>): void {
    const validNames = atlas.pages.map((page) => page.name);

    for (const name of Object.keys(given)) {
        if (validNames.includes(name)) continue;
        // an atlas has a page, so there is a closest name
        const closest = closestName(name, validNames) ?? '';

        throw new MarrowError('unknown-name', `The atlas has no page "${name}". The closest name is "${closest}".`, {
            fix: `Name the textures after the atlas pages: ${validNames.join(', ')}.`,
            validNames,
            closest,
        });
    }
}

/**
 * Gets one texture per atlas page. A page named in `given` uses that texture, or the image at
 * that URL. Every other page is loaded from next to the atlas, through Pixi `Assets` unless
 * `source` says otherwise. `metadata` goes to the load of every image, next to its alpha mode.
 *
 * Throws for a name in `given` that is no page of the atlas. When one image fails, the images
 * that did load are given back and the first error is thrown.
 *
 * @example
 * const pages = await loadPages(atlas, 'art/hero.atlas', { 'hero.png': heroTexture });
 * console.log(pages.textures.length, pages.loaded);
 */
export async function loadPages(
    atlas: AtlasModel,
    atlasUrl: string,
    given: Readonly<Record<string, Texture | string>> = {},
    source: PageSource = assetsPages,
    metadata: Readonly<Record<string, unknown>> = {},
): Promise<LoadedPages> {
    checkPageNames(atlas, given);
    const urls: (string | undefined)[] = [];
    const results = await Promise.allSettled(
        atlas.pages.map((page) => {
            // own keys only: a page could be named like a member every object has
            const image =
                (Object.hasOwn(given, page.name) ? given[page.name] : undefined) ?? pageUrl(atlasUrl, page.name);

            urls.push(typeof image === 'string' ? image : undefined);

            return typeof image === 'string' ? loadPage(image, page, source, metadata) : image;
        }),
    );
    const loaded: string[] = [];
    const textures: Texture[] = [];
    const failures: unknown[] = [];

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const url = urls[i];

        if (result === undefined) continue;
        if (result.status === 'rejected') failures.push(result.reason);
        else {
            textures.push(result.value);
            if (url !== undefined) loaded.push(url);
        }
    }
    if (failures.length > 0) {
        for (const url of loaded) releasePage(url, source);
        throw failures[0];
    }

    return { textures, loaded };
}
