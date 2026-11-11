import { DOMAdapter, type Texture } from 'pixi.js';
import { MarrowError } from '../base/errors';
import { importAtlas } from '../formats/atlas';
import { importSkeleton } from '../formats/import';
import type { AtlasModel } from '../model/atlas';
import { describeSkeleton, type SkeletonInfo } from '../model/info';
import type { SkeletonModel } from '../model/model';
import { loadPoseEngine, type PoseEngineFactory, type PoseEngineOptions } from '../pose/engine';
import { configureTexture, loadPages, releasePage } from './textures';

/** What `MarrowAsset.load` and `MarrowSpine.load` take. */
export interface MarrowLoadOptions {
    /**
     * The skeleton: a URL, the bytes of a `.skel` file, or parsed JSON. A URL that ends in
     * `.json` is fetched as text, any other URL as bytes.
     */
    skeleton: string | Uint8Array | ArrayBuffer | object;
    /** The URL of the `.atlas` file. */
    atlas: string;
    /**
     * Page images by page name: a texture, or the URL of the image. A page that is not named is
     * loaded from next to the atlas. A name that is no page of the atlas throws.
     */
    textures?: Readonly<Record<string, Texture | string>>;
    /**
     * What to do with a skeleton that has constraints, which are not solved yet. `error` (the
     * default) throws. `ignore` plays the skeleton without them.
     */
    constraints?: 'error' | 'ignore';
}

/** What `MarrowAsset.from` takes: a skeleton and an atlas that are in memory. */
export interface MarrowAssetData {
    model: SkeletonModel;
    atlas: AtlasModel;
    /** One texture per atlas page, in page order. */
    textures: readonly Texture[];
    /** What to do with a skeleton that has constraints. `error` (the default) throws. */
    constraints?: 'error' | 'ignore';
}

/** The assets loaded from URLs, by what was asked for. Loads of the same things share one asset. */
const shared = new Map<string, Promise<MarrowAsset>>();

const engineOptions = (constraints: 'error' | 'ignore' | undefined): PoseEngineOptions =>
    constraints === undefined ? {} : { constraints };

/** What identifies a load, or undefined when the skeleton is not a URL. */
function loadKey(options: MarrowLoadOptions): string | undefined {
    if (typeof options.skeleton !== 'string') return undefined;
    const textures = Object.entries(options.textures ?? {})
        .map(([name, texture]) => [name, typeof texture === 'string' ? texture : `texture ${texture.uid}`])
        .sort(([a = ''], [b = '']) => a.localeCompare(b));

    return JSON.stringify([options.skeleton, options.atlas, options.constraints ?? 'error', textures]);
}

async function fetchFile(url: string, what: string): Promise<Response> {
    let response: Response;

    try {
        response = await DOMAdapter.get().fetch(url);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        throw new MarrowError('invalid-data', `The ${what} at ${url} did not load: ${reason}`, {
            fix: 'Check the URL and that the server allows the request.',
        });
    }
    if (!response.ok) {
        throw new MarrowError('invalid-data', `The ${what} at ${url} did not load: status ${response.status}.`, {
            fix: 'Check the URL.',
        });
    }

    return response;
}

/** The skeleton as the importer takes it. A URL is fetched: `.json` as text, anything else as bytes. */
async function readSkeleton(
    skeleton: MarrowLoadOptions['skeleton'],
): Promise<string | Uint8Array | ArrayBuffer | object> {
    if (typeof skeleton !== 'string') return skeleton;
    const response = await fetchFile(skeleton, 'skeleton');

    return /\.json(?:[?#]|$)/i.test(skeleton) ? response.text() : new Uint8Array(await response.arrayBuffer());
}

/**
 * What all instances of one skeleton share: the model, the atlas, one texture per atlas page and
 * the code that poses the skeleton. Create display objects from it with `new MarrowSpine(asset)`.
 *
 * @example
 * const asset = await MarrowAsset.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
 * const first = new MarrowSpine(asset);
 * const second = new MarrowSpine(asset);
 * console.log(asset.info.animations.map((animation) => animation.name));
 */
export class MarrowAsset {
    /** The skeleton as its file describes it. */
    readonly model: SkeletonModel;
    /** The atlas as its file describes it. */
    readonly atlas: AtlasModel;
    /** One texture per atlas page, in page order. */
    readonly textures: readonly Texture[];
    /** Creates the pose engine of one more instance. Synchronous. */
    readonly createEngine: PoseEngineFactory;
    /** The image URLs this asset loaded, which it unloads when it is destroyed. */
    private readonly loaded: readonly string[];
    /** What the asset is shared under, or undefined. */
    private readonly key: string | undefined;
    private description: SkeletonInfo | undefined;
    private gone = false;

    private constructor(data: MarrowAssetData, createEngine: PoseEngineFactory, loaded: string[], key?: string) {
        const { model, atlas, textures } = data;

        if (textures.length !== atlas.pages.length) {
            throw new MarrowError(
                'invalid-data',
                `The atlas has ${atlas.pages.length} pages, but ${textures.length} textures were passed.`,
                {
                    fix: `Pass one texture per page, in this order: ${atlas.pages.map((page) => page.name).join(', ')}.`,
                },
            );
        }
        atlas.pages.forEach((page, i) => {
            const texture = textures[i];

            if (texture !== undefined) configureTexture(texture, page);
        });
        this.model = model;
        this.atlas = atlas;
        this.textures = [...textures];
        this.createEngine = createEngine;
        this.loaded = loaded;
        this.key = key;
    }

    /** The names, counts and features of the skeleton, as plain data. */
    get info(): SkeletonInfo {
        this.description ??= describeSkeleton(this.model);

        return this.description;
    }

    /** True once {@link destroy} was called. */
    get destroyed(): boolean {
        return this.gone;
    }

    /**
     * Loads a skeleton, its atlas and the page images. The images are loaded with Pixi `Assets`
     * from next to the atlas, unless `textures` names them. Each page texture is set up from its
     * atlas page: alpha mode, filters, mipmaps and wrap.
     *
     * Loads of the same skeleton URL, atlas URL and options share one asset. Throws a
     * `MarrowError` when a file does not load or is not valid. A skeleton with constraints throws
     * too, unless `constraints` is `ignore`.
     *
     * @example
     * const asset = await MarrowAsset.load({ skeleton: 'hero.json', atlas: 'hero.atlas' });
     * const fromBytes = await MarrowAsset.load({ skeleton: bytes, atlas: 'hero.atlas', constraints: 'ignore' });
     */
    static load(options: MarrowLoadOptions): Promise<MarrowAsset> {
        const key = loadKey(options);
        const cached = key === undefined ? undefined : shared.get(key);

        if (cached !== undefined) return cached;
        const loading = MarrowAsset.fetch(options, key);

        if (key !== undefined) {
            shared.set(key, loading);
            // a load that failed can be tried again
            loading.catch(() => shared.delete(key));
        }

        return loading;
    }

    /**
     * Creates an asset from a skeleton and an atlas that are in memory, with one texture per
     * atlas page in page order. Each texture is set up from its atlas page. It is asynchronous
     * because the pose code for the skeleton's Spine version loads on demand.
     *
     * @example
     * const model = await importSkeleton(bytes);
     * const atlas = importAtlas(atlasText);
     * const asset = await MarrowAsset.from({ model, atlas, textures: [pageTexture] });
     */
    static async from(data: MarrowAssetData): Promise<MarrowAsset> {
        return new MarrowAsset(data, await loadPoseEngine(data.model, engineOptions(data.constraints)), []);
    }

    private static async fetch(options: MarrowLoadOptions, key: string | undefined): Promise<MarrowAsset> {
        const [source, atlasFile] = await Promise.all([
            readSkeleton(options.skeleton),
            fetchFile(options.atlas, 'atlas'),
        ]);
        const model = await importSkeleton(source);
        const atlas = importAtlas(await atlasFile.text());
        // before the images, so that a skeleton that cannot play costs no image loads
        const createEngine = await loadPoseEngine(model, engineOptions(options.constraints));
        const { textures, loaded } = await loadPages(atlas, options.atlas, options.textures);

        return new MarrowAsset({ model, atlas, textures }, createEngine, loaded, key);
    }

    /**
     * Unloads the page images this asset loaded and stops sharing the asset. Textures that were
     * passed in are left alone. Destroy the display objects made from the asset first.
     */
    destroy(): void {
        if (this.gone) return;
        this.gone = true;
        if (this.key !== undefined) shared.delete(this.key);
        for (const url of this.loaded) releasePage(url);
    }
}
