import type { Texture, TextureSource } from 'pixi.js';
import { MarrowError } from '../base/errors';
import type { AtlasModel } from '../model/atlas';
import { describeSkeleton, type SkeletonInfo } from '../model/info';
import type { SkeletonModel } from '../model/model';
import type { AtlasOutlines } from '../model/outlines';
import type { PoseEngineFactory } from '../pose/engine';
import { loadCutCode } from '../render/cut-code';
import { loadMeshCode } from '../render/mesh-code';
import { type AssetParts, checkOutlines, fetchAsset, loadCode, loadKey } from './asset-fetch';
import { type AssetHolds, trackAsset } from './asset-holds';
import type { MarrowAssetData, MarrowLoadOptions, OutlinesState } from './asset-options';
import type { MarrowAssetsOptions } from './assets';
import { cacheReader } from './cache-hook';
import { renderMode } from './checks';
import { configureTexture, isStillImage } from './textures';

export type { MarrowAssetData, MarrowLoadOptions, OutlinesState } from './asset-options';

/** The assets loaded from URLs, by what was asked for. Loads of the same things share one asset. */
const shared = new Map<string, Promise<MarrowAsset>>();

let scanWarned = false;

/** Warns once that a scan of the page images did not run, with the cause. The assets keep their quads. */
function warnScan(error: unknown): undefined {
    if (scanWarned) return;
    scanWarned = true;
    console.warn(
        `pixi-marrow: outlines: 'auto' read no page image, so every region keeps its quad: ${error instanceof Error ? error.message : String(error)}`,
    );
}

/** A scan of the page images that was started. The code that scans loads on demand. */
interface StartedScan {
    /** Ends the scan before its next page, or before it begins. */
    stop(): void;
}

/**
 * What all instances of one skeleton share: the model, the atlas, one texture per atlas page,
 * the outlines of the atlas regions and the code that poses the skeleton. Create display
 * objects from it with `new MarrowSpine(asset)`.
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
    /** Gives back what the asset took to exist: the page images it loaded. */
    private readonly release: () => void;
    /** What the asset is shared under, or undefined. */
    private readonly key: string | undefined;
    /** Who holds the asset: the loads that returned it and the display objects that are alive. */
    private readonly held: AssetHolds;
    private description: SkeletonInfo | undefined;
    private gone = false;
    private found: AtlasOutlines | undefined;
    /** The scan that reads the pages at the moment. */
    private scan: StartedScan | undefined;
    /** Resolves when the scan has ended. */
    private work: Promise<void> = Promise.resolve();
    /** True when the outlines come from the pixels of the textures, and follow them. */
    private readonly scans: boolean;
    /** True when the load got the outlines, as a file or as an object. */
    private readonly given: boolean;

    private constructor(parts: AssetParts, createEngine: PoseEngineFactory, release: () => void, key?: string) {
        const { model, atlas, textures, outlines } = parts;

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
        this.release = release;
        this.key = key;
        this.held = trackAsset(this, () => this.free());
        this.scans = outlines === 'auto';
        this.given = outlines !== 'auto' && outlines !== undefined;
        if (outlines === 'auto') {
            for (const texture of this.textures) texture.source.on('update', this.onPageUpdate, this);
            this.startScan();
        } else if (outlines instanceof Promise) {
            this.work = outlines.then((checked) => {
                if (!this.gone) this.found = checked;
            });
        } else this.found = outlines;
    }

    /** The names, counts and features of the skeleton, as plain data. */
    get info(): SkeletonInfo {
        this.description ??= describeSkeleton(this.model);

        return this.description;
    }

    /**
     * True once the asset ended: every load that returned it called {@link destroy}, and no
     * display object made from it is alive. Its textures are unloaded then.
     */
    get destroyed(): boolean {
        return this.gone;
    }

    /**
     * The outlines of the atlas regions, or undefined when there are none. With `outlines: 'auto'`
     * they are undefined until the page images were read, and again while they are read once
     * more after a page texture got other pixels.
     */
    get outlines(): AtlasOutlines | undefined {
        return this.found;
    }

    /** Where the {@link outlines} come from, and whether they are still being read. */
    get outlinesState(): OutlinesState {
        if (!this.scans) return this.given ? 'given' : 'off';
        if (this.scan !== undefined) return 'scanning';

        return this.found === undefined ? 'unread' : 'scanned';
    }

    /**
     * Resolves when the work in the background has ended: with `outlines: 'auto'` the scan of the
     * page images, which sets {@link outlines}. Resolves at once when there is no such work. A
     * page that cannot be read keeps its quads, and the promise still resolves.
     *
     * An asset of `MarrowAsset.get` checks given outlines in the background. The promise rejects
     * with a `MarrowError` when their content is damaged. Outlines of another atlas throw at once.
     *
     * Display objects take the outlines at their next update.
     *
     * @example
     * const asset = await MarrowAsset.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
     * await asset.optimized;
     * console.log(asset.outlines?.regions.length);
     */
    get optimized(): Promise<void> {
        return this.work;
    }

    /**
     * Loads a skeleton, its atlas and the page images. The images are loaded with Pixi `Assets`
     * from next to the atlas, unless `textures` names them. Each page texture is set up from its
     * atlas page: alpha mode, filters, mipmaps and wrap.
     *
     * Loads of the same skeleton URL, atlas URL and options share one asset, and each load that
     * returns it is one owner. Call {@link destroy} once per load: the asset ends after the last
     * one. Throws a `MarrowError` that names the URL when a file does not load or is not valid.
     * Every constraint of the skeleton is solved: IK, transform, path, physics and sliders.
     *
     * The skeleton, the atlas, the outlines file and the page images all go through the resolver
     * of Pixi `Assets`, so `basePath` and `defaultSearchParams` of `Assets.init` apply to each.
     * Two assets that name one image, by any URL that leads to it, share its texture.
     *
     * The asset has no outlines of the atlas regions unless `outlines` names a file, gives them
     * or is `auto`, which reads them from the page images in idle time after the load.
     *
     * @example
     * const asset = await MarrowAsset.load({ skeleton: 'hero.json', atlas: 'hero.atlas' });
     * const fromBytes = await MarrowAsset.load({ skeleton: bytes, atlas: 'hero.atlas' });
     */
    static load(options: MarrowLoadOptions): Promise<MarrowAsset> {
        const key = loadKey(options);
        const cached = key === undefined ? undefined : shared.get(key);

        if (cached !== undefined) {
            return cached.then((asset) => {
                // the asset ended between its load and this call
                if (asset.gone) return MarrowAsset.load(options);
                asset.held.owners++;

                // it was loaded for another mode, perhaps: the code of this one loads next to it
                return options.renderMode === 'mesh' ? loadMeshCode().then(() => asset) : asset;
            });
        }
        const loading = fetchAsset(options).then(
            ({ parts, createEngine, release }) => new MarrowAsset(parts, createEngine, release, key),
        );

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
     * because the pose code for the skeleton's Spine version loads on demand. The caller is the
     * one owner of the asset, and the textures stay the caller's: {@link destroy} leaves them alone.
     *
     * @example
     * const model = await importSkeleton(bytes);
     * const atlas = importAtlas(atlasText);
     * const asset = await MarrowAsset.from({ model, atlas, textures: [pageTexture] });
     */
    static async from(data: MarrowAssetData): Promise<MarrowAsset> {
        const { model, atlas, textures } = data;
        const outlines = await checkOutlines(data.outlines, atlas);

        const createEngine = await loadCode(model, atlas, renderMode(data.renderMode ?? 'auto'));

        return new MarrowAsset({ model, atlas, textures, outlines }, createEngine, () => undefined);
    }

    /**
     * Gets the asset of a skeleton and an atlas that Pixi `Assets` loaded, by their aliases.
     * Synchronous: the pose code loaded with the skeleton. Calls with the same aliases and
     * outlines share one asset. Pixi `Assets` is its owner: unload the atlas or the skeleton to
     * let it go. The asset ends then, or when its last display object is destroyed after that.
     *
     * `outlines` takes `auto`, the object of an outlines file, or the alias or URL that
     * `Assets` loaded such a file under. The outlines show a moment later, see {@link optimized}.
     *
     * The code of the mesh mode starts to load here when the instances need it. They draw in a
     * batch until it is there. Throws a `MarrowError` for an alias that holds nothing pixi-marrow
     * loaded.
     *
     * @example
     * await Assets.load(['hero.skel', 'hero.atlas']);
     * const asset = MarrowAsset.get({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
     */
    static get(options: MarrowAssetsOptions): MarrowAsset {
        const read = cacheReader();

        if (read === undefined) {
            throw new MarrowError('invalid-data', 'Pixi Assets has no parsers of pixi-marrow yet.', {
                fix: 'Call registerMarrowAssets() before the first load of a Spine file through Assets.',
            });
        }

        // the reader counts the asset as one more holder of the pages of the atlas
        return read(options, (parts, createEngine, release) => new MarrowAsset(parts, createEngine, release));
    }

    /**
     * Lets one owner of the asset go: call it once for each `MarrowAsset.load` or
     * `MarrowAsset.from` that returned the asset. The asset ends when no owner is left and no
     * display object made from it is alive. So a display object on the stage never loses its
     * textures, and a screen that lets go does not break another screen that shares the asset.
     *
     * When the asset ends, it unloads the page images it loaded, unless another asset or the game
     * holds them. An image that the game loaded through Pixi `Assets` itself is never unloaded,
     * and textures that were passed in are left alone. A scan of the page images stops.
     *
     * More calls than owners do nothing. An asset of `MarrowAsset.get` has Pixi `Assets` as its
     * owner: a call lets that owner go early, and the next `MarrowAsset.get` makes a new asset.
     *
     * @example
     * const asset = await MarrowAsset.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
     * const hero = new MarrowSpine(asset);
     * asset.destroy(); // the hero still draws
     * hero.destroy(); // now the textures are unloaded
     */
    destroy(): void {
        const { held } = this;

        if (held.owners > 0 && --held.owners === 0 && held.users === 0) this.free();
    }

    /** Ends the asset: stops its scan, stops sharing it and gives its page images back. */
    private free(): void {
        if (this.gone) return;
        this.gone = true;
        this.scan?.stop();
        this.scan = undefined;
        if (this.scans) {
            for (const texture of this.textures) texture.source.off('update', this.onPageUpdate, this);
        }
        if (this.key !== undefined) shared.delete(this.key);
        this.release();
    }

    /** Reads the page images in idle time and keeps the outlines they give. */
    private startScan(): void {
        let stopped = false;
        let running: StartedScan | undefined;
        const scan: StartedScan = {
            stop() {
                stopped = true;
                running?.stop();
            },
        };

        this.scan = scan;
        this.work = import('./outline-scan')
            .then(({ scanOutlines }) => {
                if (stopped) return undefined;
                const started = scanOutlines(this.atlas, this.textures);

                running = started;

                return started.done;
            })
            // code that did not load gives no outlines, and every region keeps its quad
            .catch(warnScan)
            // the code that cuts loads once there are outlines to cut with, and before a view gets them
            .then((outlines) => (outlines === undefined ? undefined : loadCutCode().then(() => outlines)))
            .then((outlines) => {
                // a scan that was stopped or replaced gives nothing
                if (this.scan !== scan) return;
                this.scan = undefined;
                this.found = outlines;
            });
    }

    /**
     * A page texture got other pixels, so outlines of the pixels before could cut visible ones.
     * They are dropped at once and read again. A canvas or a video has no outlines to drop.
     */
    private onPageUpdate(source: TextureSource): void {
        if (this.gone || !isStillImage(source.resource)) return;
        this.found = undefined;
        this.scan?.stop();
        this.startScan();
    }
}
