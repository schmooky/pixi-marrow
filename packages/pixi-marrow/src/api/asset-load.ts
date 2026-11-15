import { Assets, type Loader, path, Texture } from 'pixi.js';
import { MarrowError } from '../base/errors';
import { closestName } from '../base/names';
import { importAtlas } from '../formats/atlas';
import { importSkeleton } from '../formats/import';
import type { SkeletonSource } from '../formats/sniff';
import type { AtlasModel, AtlasPage } from '../model/atlas';
import type { SkeletonModel } from '../model/model';
import { alphaModeOf } from './textures';

/*
 * The part of a load that reads the files and gets the page images. It loads on demand, next
 * to the files themselves: a game that gets its skeletons from memory does not carry it.
 *
 * Page images come from the loader of Pixi `Assets`, which keeps one texture per absolute URL.
 * This module counts who holds each one, in one map for `MarrowAsset.load` and for the `.atlas`
 * parser of Pixi `Assets`. So two atlases, a relative and an absolute URL, or the two ways to
 * load never unload an image that another still draws with.
 */

/** The page textures of an atlas, with the image URLs that were loaded for them. */
export interface LoadedPages {
    /** One texture per atlas page, in page order. */
    textures: Texture[];
    /** The URLs that were loaded. {@link releasePage} gives each one back. */
    loaded: string[];
}

/** Who holds one image. */
interface Held {
    count: number;
    /** True when the loader had the image before pixi-marrow asked for it. The game owns it then. */
    readonly foreign: boolean;
}

/** The holders of each image by absolute URL, per loader: a loader keeps one texture per URL. */
const holders = new WeakMap<Loader, Map<string, Held>>();
/** The absolute URLs of images that warned about their alpha mode. Each one warns once. */
const alphaWarned = new Set<string>();

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function heldBy(loader: Loader): Map<string, Held> {
    let map = holders.get(loader);

    if (map === undefined) {
        map = new Map();
        holders.set(loader, map);
    }

    return map;
}

/** Whether the game has the image in Pixi `Assets` itself, under the URL as written or made absolute. */
const inCache = (url: string, absolute: string): boolean => Assets.cache.has(url) || Assets.cache.has(absolute);

/**
 * Counts one more holder of an image URL.
 *
 * @example
 * for (const url of pages.loaded) holdPage(url);
 */
export function holdPage(url: string, loader: Loader = Assets.loader): void {
    const absolute = path.toAbsolute(url);
    const map = heldBy(loader);
    const held = map.get(absolute);

    if (held !== undefined) held.count++;
    else {
        // an image the loader has before the first holder was loaded by the game: it is never unloaded here
        const foreign = loader.promiseCache[absolute] !== undefined || inCache(url, absolute);

        map.set(absolute, { count: 1, foreign });
    }
}

/** Counts one holder of an image URL less. Returns the holders entry when none is left. */
function letGo(url: string, loader: Loader): Held | undefined {
    const absolute = path.toAbsolute(url);
    const map = heldBy(loader);
    const held = map.get(absolute);

    if (held === undefined || --held.count > 0) return undefined;
    map.delete(absolute);

    return held;
}

/**
 * Gives back an image URL that {@link loadPages} loaded or {@link holdPage} counted. The image
 * is unloaded when nobody else holds it. An image that the game loaded itself is left alone:
 * one that Pixi `Assets` had before pixi-marrow asked, and one the game put into its cache since.
 *
 * @example
 * for (const url of pages.loaded) releasePage(url);
 */
export function releasePage(url: string, loader: Loader = Assets.loader): void {
    const held = letGo(url, loader);

    if (held === undefined || held.foreign || inCache(url, path.toAbsolute(url))) return;
    loader.unload(url).catch((error: unknown) => {
        console.warn(`pixi-marrow: the page image at ${url} was not unloaded: ${reasonOf(error)}`);
    });
}

/**
 * Warns once per image that came from the cache of the loader in another alpha mode than its
 * atlas page needs. The browser decoded its pixels for that other mode, and a change of the
 * mode afterwards cannot undo that: edges come out too dark or too bright.
 */
function checkAlpha(texture: Texture, page: AtlasPage, url: string): void {
    const wanted = alphaModeOf(page);
    const absolute = path.toAbsolute(url);
    const resource: unknown = texture.source.resource;
    // an image element keeps its bytes: the mode on the texture is all that counts for it
    const element = typeof HTMLImageElement === 'function' && resource instanceof HTMLImageElement;

    if (texture.source.alphaMode === wanted || element || alphaWarned.has(absolute)) return;
    alphaWarned.add(absolute);
    console.warn(
        `pixi-marrow: the page image at ${url} was loaded before with the alpha mode "${texture.source.alphaMode}", ` +
            `but the atlas page "${page.name}" needs "${wanted}". Its pixels were decoded for the other mode, ` +
            'so its edges can look too dark or too bright. ' +
            `Load the image with data: { alphaMode: '${wanted}' }, or let pixi-marrow load it first.`,
    );
}

async function loadPage(
    url: string,
    page: AtlasPage,
    loader: Loader,
    metadata: Readonly<Record<string, unknown>>,
): Promise<Texture> {
    let texture: unknown;

    holdPage(url, loader);
    try {
        texture = await loader.load({ src: url, data: { ...metadata, alphaMode: alphaModeOf(page) } });
    } catch (error) {
        letGo(url, loader);
        throw new MarrowError('not-found', `The page image "${page.name}" at ${url} did not load: ${reasonOf(error)}`, {
            fix: `Put the image at ${url}, or pass it in "textures" under the page name.`,
        });
    }
    if (!(texture instanceof Texture)) {
        releasePage(url, loader);
        throw new MarrowError('invalid-data', `Pixi loaded "${page.name}" from ${url}, but not as a texture.`, {
            fix: 'Use an image format that Pixi loads as a texture, such as PNG or WebP.',
        });
    }
    checkAlpha(texture, page, url);

    return texture;
}

/**
 * The URL of a page image that lies next to its atlas. The query of the atlas URL is kept, as in
 * the official Pixi runtime: `art/hero.atlas?v=3` gives `art/hero.png?v=3`.
 */
function pageUrl(atlasUrl: string, pageName: string): string {
    const hash = atlasUrl.indexOf('#');
    const url = hash === -1 ? atlasUrl : atlasUrl.slice(0, hash);
    const query = url.indexOf('?');
    const file = query === -1 ? url : url.slice(0, query);

    return `${file.slice(0, file.lastIndexOf('/') + 1)}${pageName}${query === -1 ? '' : url.slice(query)}`;
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

/** How {@link loadPages} gets the images. The defaults are those of `MarrowAsset.load`. */
export interface PageLoadOptions {
    /** The loader the images come from. Default: the loader of Pixi `Assets`. */
    loader?: Loader;
    /** Passed to the load of every image as its `data`, next to the alpha mode. */
    metadata?: Readonly<Record<string, unknown>>;
    /** Makes the URL of a given image the URL to load. Default: the URL as it is. */
    resolve?: (url: string) => string;
}

/**
 * Gets one texture per atlas page. A page named in `given` uses that texture, or the image at
 * that URL. Every other page is loaded from next to the atlas. `atlasUrl` is the URL the atlas
 * was fetched from, so that the images get the same base path and query.
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
    options: PageLoadOptions = {},
): Promise<LoadedPages> {
    const { loader = Assets.loader, metadata = {}, resolve = (url: string) => url } = options;

    checkPageNames(atlas, given);
    const urls: (string | undefined)[] = [];
    const results = await Promise.allSettled(
        atlas.pages.map((page) => {
            // own keys only: a page could be named like a member every object has
            const named = Object.hasOwn(given, page.name) ? given[page.name] : undefined;
            const image = typeof named === 'string' ? resolve(named) : (named ?? pageUrl(atlasUrl, page.name));

            urls.push(typeof image === 'string' ? image : undefined);

            return typeof image === 'string' ? loadPage(image, page, loader, metadata) : image;
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
        for (const url of loaded) releasePage(url, loader);
        throw failures[0];
    }

    return { textures, loaded };
}

/** Whether a file starts like a web page: with `<`, after white space and a byte order mark. */
function isPage(file: unknown): boolean {
    if (typeof file === 'string') return /^[\s\uFEFF]*</.test(file);
    if (!(file instanceof Uint8Array)) return false;
    for (const byte of file) {
        if (byte > 0x20 && byte !== 0xef && byte !== 0xbb && byte !== 0xbf) return byte === 0x3c;
    }

    return false;
}

/**
 * The error of a file that was fetched, with its URL in front. A server that does not find a
 * file can answer with its index page and status 200: such a file gets an error that says so.
 * An error that is no `MarrowError` is returned as it is.
 *
 * @example
 * const atlas = await read(() => importAtlas(text), 'atlas', url, text);
 */
export function fileError(error: unknown, what: string, url: string, file: unknown): unknown {
    if (isPage(file)) {
        return new MarrowError(
            'invalid-data',
            `The server returned an HTML page for the ${what} at ${url}, not the file. The URL is probably wrong.`,
            {
                fix: 'Check the URL. A dev server or a host of a single-page app answers a wrong URL with its index page and status 200.',
            },
        );
    }
    if (!(error instanceof MarrowError)) return error;
    // the message of a MarrowError is its code, its text and its fix
    const text = error.message.slice(`[pixi-marrow:${error.code}] `.length, -error.fix.length - 1);

    return new MarrowError(error.code, `The ${what} at ${url} is not valid. ${text}`, {
        fix: error.fix,
        validNames: error.validNames,
        ...(error.closest === undefined ? {} : { closest: error.closest }),
    });
}

/** Where the files of a load came from. A part without a URL was passed in memory. */
export interface FileUrls {
    skeleton: string | undefined;
    atlas: string;
}

/**
 * Imports the skeleton and the atlas of a load. An error names the URL of its file.
 *
 * @example
 * const { model, atlas } = await readFiles(bytes, atlasText, { skeleton: 'hero.skel', atlas: 'hero.atlas' });
 */
export async function readFiles(
    skeleton: SkeletonSource,
    atlasText: string,
    urls: FileUrls,
): Promise<{ model: SkeletonModel; atlas: AtlasModel }> {
    let model: SkeletonModel;
    let atlas: AtlasModel;

    try {
        model = await importSkeleton(skeleton);
    } catch (error) {
        throw urls.skeleton === undefined ? error : fileError(error, 'skeleton', urls.skeleton, skeleton);
    }
    try {
        atlas = importAtlas(atlasText);
    } catch (error) {
        throw fileError(error, 'atlas', urls.atlas, atlasText);
    }

    return { model, atlas };
}
