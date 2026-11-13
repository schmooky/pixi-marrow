import {
    type AssetExtension,
    Assets,
    checkExtension,
    DOMAdapter,
    ExtensionType,
    extensions,
    type Loader,
    LoaderParserPriority,
    type ResolvedAsset,
    Resolver,
    Texture,
    TextureSource,
} from 'pixi.js';
import { MarrowError } from '../base/errors';
import { importAtlas } from '../formats/atlas';
import { importSkeleton } from '../formats/import';
import type { AtlasModel } from '../model/atlas';
import type { SkeletonModel } from '../model/model';
import { loadPoseEngine, type PoseEngineFactory } from '../pose/engine';
import { loadClipCode } from '../render/clip-code';
import { loadMeshCode } from '../render/mesh-code';
import { hasClip, startsWithMeshes } from '../render/mode';
import type { MarrowAsset } from './asset';
import { type CachedAssetParts, setCacheReader } from './cache-hook';
import { renderMode } from './checks';
import { assetsPages, loadPages, type PageSource, releasePage } from './textures';

/*
 * Spine files through Pixi `Assets`, so that a manifest, a bundle and the output of AssetPack
 * load them. `registerMarrowAssets` adds the parsers. Nothing is registered at import, unlike
 * the official Pixi runtime, and a game that never calls it does not carry them.
 *
 * - A `.skel` file, or a `.json` file that is a Spine skeleton, becomes a `SkeletonModel`. The
 *   pose code for its Spine version loads with it, and the clip code when it clips, so that
 *   `MarrowSpine.from` can be synchronous.
 * - An `.atlas` file becomes a `LoadedAtlas`: the atlas and one texture per page. The pages load
 *   with the loader of Pixi from next to the atlas, or come from `data.images`.
 * - The resolver reads the resolution and the format from a name such as `hero@0.5x.webp.atlas`,
 *   so that Pixi picks the variant of an atlas that its preferences ask for.
 *
 * The parsers have names of their own, so they can share a page with those of the official
 * runtime. Both claim the same file extensions, though: register one runtime per game.
 */

/** The name of the parser for `.atlas` files, for the `parser` field of an asset. */
const ATLAS_PARSER = 'marrowAtlasLoader';
/** The name of the parser for `.skel` files and Spine `.json` files. */
const SKELETON_PARSER = 'marrowSkeletonLoader';

/**
 * What Pixi `Assets` holds for an `.atlas` file that pixi-marrow loaded.
 *
 * @example
 * await Assets.load('hero.atlas');
 * const { atlas, textures } = Assets.get<LoadedAtlas>('hero.atlas');
 */
export interface LoadedAtlas {
    /** The atlas as its file describes it. */
    readonly atlas: AtlasModel;
    /** One texture per atlas page, in page order. */
    readonly textures: readonly Texture[];
}

/**
 * What the `data` of an `.atlas` asset can hold. These are the fields of the official runtime.
 *
 * @example
 * await Assets.load({ src: 'hero.atlas', data: { images: { 'hero.png': heroTexture } } });
 */
export interface AtlasAssetData {
    /**
     * Page images by page name: a texture, a texture source, or the URL of the image. One image
     * alone is the first page. A page that is not named loads from next to the atlas.
     */
    images?: Texture | TextureSource | string | Readonly<Record<string, Texture | TextureSource | string>>;
    /** Passed to the load of every page image, as its `data`. */
    imageMetadata?: Readonly<Record<string, unknown>>;
}

/** What a loaded atlas took from the loader, to give it back when Pixi unloads the atlas. */
interface AtlasLoad {
    pages: PageSource;
    loaded: readonly string[];
    /** What was made from the atlas and ends with it. */
    users: Set<{ destroy(): void }>;
}

/** The pose code of each skeleton the parser made. Only those can be used synchronously. */
const engines = new WeakMap<SkeletonModel, PoseEngineFactory>();
const atlasLoads = new WeakMap<LoadedAtlas, AtlasLoad>();
/** One page source per loader of Pixi: the loader caches each image by URL. */
const pageSources = new WeakMap<Loader, PageSource>();

function pagesOf(loader: Loader): PageSource {
    let pages = pageSources.get(loader);

    if (pages === undefined) {
        pages = {
            load: (url, data) => loader.load({ src: url, data }),
            unload: (url) => void loader.unload(url),
            holders: new Map(),
        };
        pageSources.set(loader, pages);
    }

    return pages;
}

/** Whether an object that Pixi read from a `.json` file is a Spine skeleton. */
function isSkeletonJson(asset: unknown): boolean {
    if (typeof asset !== 'object' || asset === null) return false;

    return Object.hasOwn(asset, 'bones') && Object.hasOwn(asset, 'skeleton');
}

const srcOf = (resolved: ResolvedAsset | undefined): string => (typeof resolved?.src === 'string' ? resolved.src : '');

/** Whether the asset names a parser itself, under its name of now or of older Pixi versions. */
function asksFor(resolved: ResolvedAsset | undefined, name: string): boolean {
    return resolved?.parser === name || resolved?.loadParser === name;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
    const response = await DOMAdapter.get().fetch(url);

    if (!response.ok) throw new Error(`[${SKELETON_PARSER}] ${url} did not load: status ${response.status}`);

    return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
    const response = await DOMAdapter.get().fetch(url);

    if (!response.ok) throw new Error(`[${ATLAS_PARSER}] ${url} did not load: status ${response.status}`);

    return response.text();
}

/** The page images of `data.images` by page name, as `loadPages` takes them. */
function givenImages(images: AtlasAssetData['images'], atlas: AtlasModel): Record<string, Texture | string> {
    if (images === undefined) return {};
    const single = typeof images === 'string' || images instanceof Texture || images instanceof TextureSource;
    const named: Readonly<Record<string, Texture | TextureSource | string>> = single
        ? { [atlas.pages[0]?.name ?? '']: images }
        : images;
    const given: Record<string, Texture | string> = {};

    for (const [name, image] of Object.entries(named)) {
        given[name] = image instanceof TextureSource ? new Texture({ source: image }) : image;
    }

    return given;
}

const skeletonAsset = {
    extension: ExtensionType.Asset,
    loader: {
        id: SKELETON_PARSER,
        name: SKELETON_PARSER,
        extension: { type: ExtensionType.LoadParser, priority: LoaderParserPriority.Normal, name: SKELETON_PARSER },
        test: (url: string): boolean => checkExtension(url, '.skel'),
        load: (url: string): Promise<Uint8Array> => fetchBytes(url),
        testParse(asset: unknown, resolved?: ResolvedAsset): Promise<boolean> {
            const src = srcOf(resolved);
            const bytes = asset instanceof Uint8Array;
            const json = isSkeletonJson(asset);

            return Promise.resolve(
                (bytes && checkExtension(src, '.skel')) ||
                    (json && checkExtension(src, '.json')) ||
                    ((bytes || json) && asksFor(resolved, SKELETON_PARSER)),
            );
        },
        async parse(asset: unknown): Promise<SkeletonModel> {
            const model = await importSkeleton(asset as Uint8Array | object);
            const [createEngine] = await Promise.all([
                loadPoseEngine(model),
                hasClip(model) ? loadClipCode() : undefined,
            ]);

            engines.set(model, createEngine);

            return model;
        },
    },
} as AssetExtension<SkeletonModel>;

const atlasAsset = {
    extension: ExtensionType.Asset,
    resolver: {
        test: (value: string): boolean => checkExtension(value, '.atlas'),
        parse(value: string) {
            const parts = value.split('.');

            return {
                resolution: Number.parseFloat(Resolver.RETINA_PREFIX?.exec(value)?.[1] ?? '1'),
                format: parts[parts.length - 2],
                src: value,
            };
        },
    },
    loader: {
        id: ATLAS_PARSER,
        name: ATLAS_PARSER,
        extension: { type: ExtensionType.LoadParser, priority: LoaderParserPriority.Normal, name: ATLAS_PARSER },
        test: (url: string): boolean => checkExtension(url, '.atlas'),
        load: (url: string): Promise<string> => fetchText(url),
        testParse(asset: unknown, resolved?: ResolvedAsset): Promise<boolean> {
            const named = checkExtension(srcOf(resolved), '.atlas') || asksFor(resolved, ATLAS_PARSER);

            return Promise.resolve(named && typeof asset === 'string');
        },
        async parse(text: string, resolved?: ResolvedAsset<AtlasAssetData>, loader?: Loader): Promise<LoadedAtlas> {
            const data = resolved?.data ?? {};
            const atlas = importAtlas(text);
            // Pixi hands its loader to every parse
            const pages = loader === undefined ? assetsPages : pagesOf(loader);
            const given = givenImages(data.images, atlas);
            const { textures, loaded } = await loadPages(atlas, srcOf(resolved), given, pages, data.imageMetadata);
            const result: LoadedAtlas = { atlas, textures };

            atlasLoads.set(result, { pages, loaded, users: new Set() });

            return result;
        },
        unload(result: LoadedAtlas): void {
            const load = atlasLoads.get(result);

            if (load === undefined) return;
            atlasLoads.delete(result);
            for (const user of load.users) user.destroy();
            for (const url of load.loaded) releasePage(url, load.pages);
        },
    },
} as AssetExtension<LoadedAtlas | string, AtlasAssetData>;

let registered = false;

/**
 * Teaches Pixi `Assets` to load Spine files. A `.skel` file or a Spine `.json` file becomes a
 * skeleton, an `.atlas` file becomes the atlas with its page textures. Call it once before the
 * first load of a Spine file through `Assets`, a manifest or a bundle. Later calls do nothing.
 *
 * @example
 * registerMarrowAssets();
 * await Assets.load(['hero.skel', 'hero.atlas']);
 * const hero = MarrowSpine.from({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
 */
export function registerMarrowAssets(): void {
    if (registered) return;
    registered = true;
    extensions.add(skeletonAsset, atlasAsset);
    setCacheReader(sharedFromCache);
}

/** What `MarrowAsset.get` and `MarrowSpine.from` take: the aliases a skeleton and its atlas were loaded under. */
export interface MarrowAssetsOptions {
    /** The alias of a `.skel` file or a Spine `.json` file that Pixi `Assets` loaded. */
    skeleton: string;
    /** The alias of the `.atlas` file that Pixi `Assets` loaded. */
    atlas: string;
    /** `auto` (the default) reads the page images in idle time, `off` uses no outlines. See `MarrowLoadOptions.outlines`. */
    outlines?: 'auto' | 'off';
    /** The render mode the display objects will ask for, see `MarrowLoadOptions.renderMode`. Default `auto`. */
    renderMode?: 'auto' | 'mesh' | 'batched';
}

/** The assets made from what Pixi `Assets` holds: by atlas, by skeleton, by outlines option. */
const fromCache = new WeakMap<LoadedAtlas, WeakMap<SkeletonModel, Partial<Record<'auto' | 'off', MarrowAsset>>>>();

function notLoaded(alias: string, what: string): MarrowError {
    return new MarrowError('invalid-data', `Pixi Assets holds no ${what} that pixi-marrow loaded under "${alias}".`, {
        fix: `Call registerMarrowAssets() before the load, then load it: await Assets.load('${alias}'). Do not register another Spine runtime for the same files.`,
    });
}

/** What Pixi `Assets` holds under an alias, or undefined. `Assets.get` would warn for nothing. */
const cached = (alias: string): unknown => (Assets.cache.has(alias) ? Assets.get(alias) : undefined);

/**
 * The asset of a skeleton and an atlas that Pixi `Assets` loaded under two aliases, for
 * `MarrowAsset.get`. Calls with the same files and outlines share one asset, which ends when Pixi
 * unloads the atlas. `make` is the constructor of `MarrowAsset`, which is private.
 *
 * Throws a `MarrowError` when a file is not loaded, or was loaded without the parsers of this
 * module. The code of the mesh mode starts to load when the instances need it.
 */
function sharedFromCache(
    options: MarrowAssetsOptions,
    make: (parts: CachedAssetParts, createEngine: PoseEngineFactory) => MarrowAsset,
): MarrowAsset {
    const model = cached(options.skeleton);
    const createEngine = typeof model === 'object' && model !== null ? engines.get(model as SkeletonModel) : undefined;

    if (createEngine === undefined) throw notLoaded(options.skeleton, 'skeleton');
    const atlas = cached(options.atlas) as LoadedAtlas | undefined;
    const load = typeof atlas === 'object' && atlas !== null ? atlasLoads.get(atlas) : undefined;

    if (atlas === undefined || load === undefined) throw notLoaded(options.atlas, 'atlas');
    const outlines = options.outlines ?? 'auto';
    const mode = renderMode(options.renderMode ?? 'auto');

    if (outlines !== 'auto' && outlines !== 'off') {
        throw new MarrowError('invalid-data', `outlines is ${String(outlines)}, but must be "auto" or "off".`, {
            fix: 'For an outlines file, use MarrowAsset.load or MarrowAsset.from.',
        });
    }
    const skeleton = model as SkeletonModel;
    let byModel = fromCache.get(atlas);

    if (byModel === undefined) {
        byModel = new WeakMap();
        fromCache.set(atlas, byModel);
    }
    const made = byModel.get(skeleton) ?? {};
    let asset = made[outlines];

    if (asset === undefined || asset.destroyed) {
        const parts = { model: skeleton, atlas: atlas.atlas, textures: atlas.textures };

        asset = make({ ...parts, outlines: outlines === 'off' ? undefined : 'auto' }, createEngine);
        made[outlines] = asset;
        byModel.set(skeleton, made);
        load.users.add(asset);
        if (startsWithMeshes(skeleton, atlas.atlas, mode)) void loadMeshCode();
    } else if (mode === 'mesh') void loadMeshCode();

    return asset;
}
