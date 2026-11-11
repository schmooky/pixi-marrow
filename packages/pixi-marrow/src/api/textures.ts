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
    /** The URLs loaded through Pixi `Assets`. {@link releasePage} gives each one back. */
    loaded: string[];
}

/** How many loaded assets hold each image URL. The image is unloaded when the last one lets go. */
const holders = new Map<string, number>();

/** The filter inside one mip level. The first word of an atlas mip filter names it. */
const texelFilter = (filter: AtlasFilter): 'nearest' | 'linear' =>
    filter === 'nearest' || filter === 'mipMapNearestNearest' || filter === 'mipMapNearestLinear'
        ? 'nearest'
        : 'linear';

const alphaModeOf = (page: AtlasPage): PageAlphaMode =>
    page.pma ? 'premultiplied-alpha' : 'premultiply-alpha-on-upload';

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
function letGo(url: string): boolean {
    const count = (holders.get(url) ?? 0) - 1;

    if (count > 0) {
        holders.set(url, count);

        return false;
    }
    holders.delete(url);

    return true;
}

/**
 * Gives back an image URL that {@link loadPages} loaded. The image is unloaded from Pixi
 * `Assets` when no other loaded asset holds it.
 *
 * @example
 * for (const url of pages.loaded) releasePage(url);
 */
export function releasePage(url: string): void {
    if (letGo(url)) void Assets.unload(url);
}

async function loadPage(url: string, page: AtlasPage): Promise<Texture> {
    let texture: unknown;

    holders.set(url, (holders.get(url) ?? 0) + 1);
    try {
        texture = await Assets.load({ src: url, data: { alphaMode: alphaModeOf(page) } });
    } catch (error) {
        letGo(url);
        throw new MarrowError('invalid-data', `The page image "${page.name}" did not load: ${reasonOf(error)}`, {
            fix: `Put the image at ${url}, or pass it in "textures" under the page name.`,
        });
    }
    if (!(texture instanceof Texture)) {
        releasePage(url);
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
 * that URL. Every other page is loaded from next to the atlas, through Pixi `Assets`.
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
): Promise<LoadedPages> {
    checkPageNames(atlas, given);
    const urls: (string | undefined)[] = [];
    const results = await Promise.allSettled(
        atlas.pages.map((page) => {
            // own keys only: a page could be named like a member every object has
            const source =
                (Object.hasOwn(given, page.name) ? given[page.name] : undefined) ?? pageUrl(atlasUrl, page.name);

            urls.push(typeof source === 'string' ? source : undefined);

            return typeof source === 'string' ? loadPage(source, page) : source;
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
        for (const url of loaded) releasePage(url);
        throw failures[0];
    }

    return { textures, loaded };
}
