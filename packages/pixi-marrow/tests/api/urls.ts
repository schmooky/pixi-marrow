import { Assets, DOMAdapter, path, Texture, TextureSource } from 'pixi.js';
import { afterAll, beforeAll, vi } from 'vitest';

/** The page every relative URL is made absolute against in the tests of a file that calls {@link useLocalUrls}. */
export const ROOT = 'http://localhost/';

/** A URL as a test wrote it: without the root that Pixi puts in front. */
export const local = (url: string): string => (url.startsWith(ROOT) ? url.slice(ROOT.length) : url);

/**
 * Gives Pixi a base URL for the tests of one file. Node has no document, and the loader of Pixi
 * makes every URL absolute against the page.
 */
export function useLocalUrls(): void {
    const adapter = DOMAdapter.get();

    beforeAll(() => DOMAdapter.set({ ...adapter, getBaseUrl: () => ROOT }));
    afterAll(() => DOMAdapter.set(adapter));
}

/** What a stubbed image loader was asked, and the textures it holds. */
export interface ImageLoader {
    /** The images that were asked for, as the caller wrote them, with their data. */
    readonly loads: { src: string; data: Record<string, unknown> }[];
    /** The URLs that were unloaded, without the root. */
    readonly unloads: string[];
    /** The texture the loader holds for a URL, or undefined. */
    texture(url: string): Texture | undefined;
    /** Puts the real loader back. */
    restore(): void;
}

const IMAGE = /\.(png|webp|avif)(\?|#|$)/;

/**
 * Makes the loader of Pixi `Assets` answer image URLs without a decoder, the way the real one
 * does: one texture per absolute URL, kept in `promiseCache`, in the alpha mode of the data, and
 * destroyed by `unload`. Other URLs go to the real loader.
 */
export function stubImageLoader(): ImageLoader {
    const loader: {
        load(assets: unknown, onProgress?: unknown): Promise<unknown>;
        unload(assets: unknown): Promise<void>;
        promiseCache: Record<string, unknown>;
    } = Assets.loader;
    const realLoad = loader.load.bind(loader);
    const realUnload = loader.unload.bind(loader);
    const textures = new Map<string, Texture>();
    const loads: ImageLoader['loads'] = [];
    const unloads: string[] = [];
    const loadSpy = vi.spyOn(loader, 'load').mockImplementation(async (assets: unknown, onProgress?: unknown) => {
        const asset = typeof assets === 'string' ? { src: assets } : Object(assets);
        const src: unknown = Reflect.get(asset, 'src');

        if (typeof src !== 'string' || !IMAGE.test(src)) return realLoad(assets, onProgress);
        const absolute = path.toAbsolute(src);
        const data: Record<string, unknown> = { ...Object(Reflect.get(asset, 'data')) };
        let texture = textures.get(absolute);

        loads.push({ src, data });
        if (texture === undefined) {
            const alphaMode = data.alphaMode === 'premultiplied-alpha' ? data.alphaMode : 'premultiply-alpha-on-upload';

            texture = new Texture({ source: new TextureSource({ width: 2, height: 2, alphaMode }) });
            textures.set(absolute, texture);
            loader.promiseCache[absolute] = { promise: Promise.resolve(texture), parser: null };
        }

        return texture;
    });
    const unloadSpy = vi.spyOn(loader, 'unload').mockImplementation(async (assets: unknown) => {
        if (typeof assets !== 'string' || !IMAGE.test(assets)) return realUnload(assets);
        const absolute = path.toAbsolute(assets);

        unloads.push(local(absolute));
        textures.get(absolute)?.destroy(true);
        textures.delete(absolute);
        delete loader.promiseCache[absolute];
    });

    return {
        loads,
        unloads,
        texture: (url) => textures.get(path.toAbsolute(url)),
        restore() {
            for (const absolute of textures.keys()) delete loader.promiseCache[absolute];
            textures.clear();
            loadSpy.mockRestore();
            unloadSpy.mockRestore();
        },
    };
}

/** Makes `fetch` answer from a map of files by URL, with or without the root. Other URLs get status 404. */
export function stubFetch(files: ReadonlyMap<string, string | Uint8Array>): { readonly urls: string[] } {
    const urls: string[] = [];

    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
        const body = files.get(url) ?? files.get(local(url));

        urls.push(url);
        if (body === undefined) return new Response('', { status: 404 });

        return new Response(typeof body === 'string' ? body : body.slice());
    });

    return { urls };
}
