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
import type { AtlasOutlines } from '../model/outlines';
import { loadPoseEngine, type PoseEngineFactory } from '../pose/engine';
import { loadClipCode } from '../render/clip-code';
import { loadCutCode } from '../render/cut-code';
import { loadMeshCode } from '../render/mesh-code';
import { hasClip, startsWithMeshes } from '../render/mode';
import type { MarrowAsset } from './asset';
import { ownAsset } from './asset-holds';
import { fileError, holdPage, loadPages, releasePage } from './asset-load';
import { type CachedAssetParts, setCacheReader } from './cache-hook';
import { renderMode } from './checks';

/*
 * Spine files through Pixi `Assets`, so that a manifest, a bundle and the output of AssetPack
 * load them. `registerMarrowAssets` adds the parsers. Nothing is registered at import, unlike
 * the official Pixi runtime, and a game that never calls it does not carry them.
 *
 * - A `.skel` file, or a JSON file that is a Spine skeleton, becomes a `SkeletonModel`. The
 *   content says what a file is, not its name: an asset that names the skeleton parser can have
 *   any URL. The pose code for its Spine version loads with it, and the clip code when it clips,
 *   so that `MarrowSpine.from` can be synchronous.
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
    /** The loader of Pixi that loaded the pages. */
    loader: Loader;
    loaded: readonly string[];
    /** The assets made from the atlas that are alive. An asset that ends leaves the set. */
    users: Set<MarrowAsset>;
}

/** The pose code of each skeleton the parser made. Only those can be used synchronously. */
const engines = new WeakMap<SkeletonModel, PoseEngineFactory>();
const atlasLoads = new WeakMap<LoadedAtlas, AtlasLoad>();
/** The assets made from each skeleton that are alive. Pixi lets them go when it unloads the skeleton. */
const skeletonUsers = new WeakMap<SkeletonModel, Set<MarrowAsset>>();

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

/** Fetches a file for a parser. An error is a `MarrowError` that names the URL. */
async function fetchFile(url: string, what: string): Promise<Response> {
    const failed = (reason: string): MarrowError =>
        new MarrowError('invalid-data', `The ${what} at ${url} did not load: ${reason}`, {
            fix: 'Check the URL and that the server allows the request.',
        });
    const response = await DOMAdapter.get()
        .fetch(url)
        .catch((error: unknown) => {
            throw failed(error instanceof Error ? error.message : String(error));
        });

    if (!response.ok) throw failed(`status ${response.status}.`);

    return response;
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
        load: async (url: string): Promise<Uint8Array> =>
            new Uint8Array(await (await fetchFile(url, 'skeleton')).arrayBuffer()),
        testParse(asset: unknown, resolved?: ResolvedAsset): Promise<boolean> {
            const bytes = asset instanceof Uint8Array;

            // parsed JSON is a skeleton by its content, whatever its URL. Bytes need the name or the parser
            return Promise.resolve(
                isSkeletonJson(asset) ||
                    (bytes && (checkExtension(srcOf(resolved), '.skel') || asksFor(resolved, SKELETON_PARSER))),
            );
        },
        async parse(asset: unknown, resolved?: ResolvedAsset): Promise<SkeletonModel> {
            // bytes hold a binary skeleton or JSON text: their content says which
            const model = await importSkeleton(asset as Uint8Array | object).catch((error: unknown) => {
                throw fileError(error, 'skeleton', srcOf(resolved), asset);
            });
            const [createEngine] = await Promise.all([
                loadPoseEngine(model),
                hasClip(model) ? loadClipCode() : undefined,
            ]);

            engines.set(model, createEngine);

            return model;
        },
        unload(model: SkeletonModel): void {
            // Pixi `Assets` owned the assets made from the skeleton: each ends with its last display object
            for (const user of [...(skeletonUsers.get(model) ?? [])]) user.destroy();
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
        load: async (url: string): Promise<string> => (await fetchFile(url, 'atlas')).text(),
        testParse(asset: unknown, resolved?: ResolvedAsset): Promise<boolean> {
            const named = checkExtension(srcOf(resolved), '.atlas') || asksFor(resolved, ATLAS_PARSER);

            return Promise.resolve(named && typeof asset === 'string');
        },
        async parse(text: string, resolved?: ResolvedAsset<AtlasAssetData>, loader?: Loader): Promise<LoadedAtlas> {
            const data = resolved?.data ?? {};
            const src = srcOf(resolved);
            let atlas: AtlasModel;

            try {
                atlas = importAtlas(text);
            } catch (error) {
                throw fileError(error, 'atlas', src, text);
            }
            // Pixi hands its loader to every parse
            const from = loader ?? Assets.loader;
            const given = givenImages(data.images, atlas);
            const metadata = data.imageMetadata ?? {};
            const { textures, loaded } = await loadPages(atlas, src, given, { loader: from, metadata });
            const result: LoadedAtlas = { atlas, textures };

            atlasLoads.set(result, { loader: from, loaded, users: new Set() });

            return result;
        },
        unload(result: LoadedAtlas): void {
            const load = atlasLoads.get(result);

            if (load === undefined) return;
            atlasLoads.delete(result);
            // each asset holds the pages too: one with a display object on the stage keeps them
            for (const user of [...load.users]) user.destroy();
            for (const url of load.loaded) releasePage(url, load.loader);
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
    /**
     * Where the outlines of the atlas regions come from. See `MarrowLoadOptions.outlines`.
     *
     * - `off` (the default) uses none.
     * - A string is the alias or the URL that Pixi `Assets` loaded the file of `pixi-marrow outlines`
     *   under, as JSON. Load it before the call. This is the way for a game on AssetPack.
     * - An object is the parsed content of such a file.
     * - `auto` reads the page images in idle time, which takes 32 MB for a moment for a page of
     *   2048 by 2048.
     *
     * A file or an object that does not fit the atlas throws.
     */
    outlines?: 'auto' | 'off' | string | AtlasOutlines;
    /** The render mode the display objects will ask for, see `MarrowLoadOptions.renderMode`. Default `auto`. */
    renderMode?: 'auto' | 'mesh' | 'batched';
}

/**
 * The assets made from what Pixi `Assets` holds: by atlas, by skeleton, then by outlines. The last
 * key is `auto`, `off` or the object of an outlines file.
 */
const fromCache = new WeakMap<LoadedAtlas, WeakMap<SkeletonModel, Map<unknown, MarrowAsset>>>();

function notLoaded(alias: string, what: string): MarrowError {
    return new MarrowError('invalid-data', `Pixi Assets holds no ${what} that pixi-marrow loaded under "${alias}".`, {
        fix: `Call registerMarrowAssets() before the load, then load it: await Assets.load('${alias}'). Do not register another Spine runtime for the same files.`,
    });
}

/** What Pixi `Assets` holds under an alias, or undefined. `Assets.get` would warn for nothing. */
const cached = (alias: string): unknown => (Assets.cache.has(alias) ? Assets.get(alias) : undefined);

/** The skeleton and the atlas that Pixi `Assets` holds under two aliases, with what their parsers kept for them. */
function loadedFiles(options: MarrowAssetsOptions): {
    skeleton: SkeletonModel;
    createEngine: PoseEngineFactory;
    atlas: LoadedAtlas;
    load: AtlasLoad;
} {
    const model = cached(options.skeleton);
    const createEngine = typeof model === 'object' && model !== null ? engines.get(model as SkeletonModel) : undefined;

    if (createEngine === undefined) throw notLoaded(options.skeleton, 'skeleton');
    const atlas = cached(options.atlas) as LoadedAtlas | undefined;
    const load = typeof atlas === 'object' && atlas !== null ? atlasLoads.get(atlas) : undefined;

    if (atlas === undefined || load === undefined) throw notLoaded(options.atlas, 'atlas');

    return { skeleton: model as SkeletonModel, createEngine, atlas, load };
}

/**
 * What the outlines option stands for: `auto`, `off` or the object of an outlines file. A string
 * that is no word names such a file in Pixi `Assets`, by its alias or its URL.
 */
function outlinesSource(option: NonNullable<MarrowAssetsOptions['outlines']>): object | 'auto' | 'off' {
    if (option === 'auto' || option === 'off' || typeof option !== 'string') return option;
    const file = cached(option);

    if (typeof file !== 'object' || file === null) {
        throw new MarrowError('invalid-data', `Pixi Assets holds no outlines file under "${option}".`, {
            fix: `Load the file that pixi-marrow outlines wrote before the call: await Assets.load('${option}'). Or pass 'auto', 'off' or the parsed file.`,
        });
    }

    return file;
}

/**
 * The asset of a skeleton and an atlas that Pixi `Assets` loaded under two aliases, for
 * `MarrowAsset.get`. Calls with the same files and outlines share one asset. Pixi `Assets` owns
 * it: it ends when Pixi unloads the atlas or the skeleton and no display object draws with it.
 * `make` is the constructor of `MarrowAsset`, which is private.
 *
 * Throws a `MarrowError` when a file is not loaded, or was loaded without the parsers of this
 * module. The code of the mesh mode starts to load when the instances need it.
 */
function sharedFromCache(
    options: MarrowAssetsOptions,
    make: (parts: CachedAssetParts, createEngine: PoseEngineFactory, release: () => void) => MarrowAsset,
): MarrowAsset {
    const { skeleton, createEngine, atlas, load } = loadedFiles(options);
    const mode = renderMode(options.renderMode ?? 'auto');
    const source = outlinesSource(options.outlines ?? 'off');
    const made = mapOf(
        mapOf(fromCache, atlas, () => new WeakMap()),
        skeleton,
        () => new Map<unknown, MarrowAsset>(),
    );
    const known = made.get(source);

    if (known !== undefined && !known.destroyed) {
        // a destroy call of the game took the place of Assets as the owner: Assets owns it again
        ownAsset(known);
        if (mode === 'mesh') void loadMeshCode();

        return known;
    }
    // throws for outlines of another atlas, before anything is held
    const outlines = source === 'off' ? undefined : source === 'auto' ? 'auto' : laterOutlines(source, atlas.atlas);
    const { loader, loaded, users } = load;
    const byModel = mapOf(skeletonUsers, skeleton, () => new Set<MarrowAsset>());
    let asset: MarrowAsset | undefined;
    const release = (): void => {
        if (asset !== undefined) {
            users.delete(asset);
            byModel.delete(asset);
        }
        for (const url of loaded) releasePage(url, loader);
    };

    // the asset holds the pages of the atlas as the atlas does: they stay while it draws with them
    for (const url of loaded) holdPage(url, loader);
    try {
        asset = make(
            { model: skeleton, atlas: atlas.atlas, textures: atlas.textures, outlines },
            createEngine,
            release,
        );
    } catch (error) {
        release();
        throw error;
    }
    made.set(source, asset);
    users.add(asset);
    byModel.add(asset);
    if (startsWithMeshes(skeleton, atlas.atlas, mode)) void loadMeshCode();

    return asset;
}

/**
 * The outlines of an object for an asset of `MarrowAsset.get`, which cannot wait. A file of
 * another atlas throws at once: the names of its regions are compared here. The whole check and
 * the code that cuts with outlines load on demand, so the outlines come a moment later.
 */
function laterOutlines(source: object, atlas: AtlasModel): Promise<AtlasOutlines> {
    const regions: unknown = Reflect.get(source, 'regions');
    const names = Array.isArray(regions)
        ? regions.map((region: unknown) =>
              typeof region === 'object' && region !== null ? Reflect.get(region, 'name') : null,
          )
        : [];
    const fits =
        names.length === atlas.regionNames.length &&
        names.every((name, i) => name === null || name === atlas.regionNames[i]);

    if (!fits) {
        throw new MarrowError(
            'invalid-data',
            `The outlines do not fit the atlas: the atlas has ${atlas.regionNames.length} regions, and the outlines are of ${names.length} regions or of other names.`,
            { fix: 'Write the file again for this atlas: pixi-marrow outlines <atlas>.' },
        );
    }

    return Promise.all([import('../geometry/outlines'), loadCutCode()]).then(([{ readAtlasOutlines }]) =>
        readAtlasOutlines(source, atlas),
    );
}

/** The value of a key in a map, made on first use. */
function mapOf<K extends object, V>(map: WeakMap<K, V>, key: K, create: () => V): V {
    let value = map.get(key);

    if (value === undefined) {
        value = create();
        map.set(key, value);
    }

    return value;
}
