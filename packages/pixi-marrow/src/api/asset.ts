import { DOMAdapter, type Texture, type TextureSource } from 'pixi.js';
import { MarrowError } from '../base/errors';
import { importAtlas } from '../formats/atlas';
import { importSkeleton } from '../formats/import';
import type { AtlasModel } from '../model/atlas';
import { describeSkeleton, type SkeletonInfo } from '../model/info';
import type { SkeletonModel } from '../model/model';
import type { AtlasOutlines } from '../model/outlines';
import { loadPoseEngine, type PoseEngineFactory } from '../pose/engine';
import { loadClipCode } from '../render/clip-code';
import { loadCutCode } from '../render/cut-code';
import { loadMeshCode } from '../render/mesh-code';
import { hasClip, type RenderMode, startsWithMeshes } from '../render/mode';
import { renderMode } from './checks';
import { configureTexture, isStillImage, loadPages, releasePage } from './textures';

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
     * Where the outlines of the atlas regions come from. With them a slot behind an opaque one
     * is skipped and a region without a visible pixel is not drawn. The picture stays the same.
     * `tightMesh: 'on'` of a display object also needs them.
     *
     * - `auto` (the default) reads the page images in idle time after the load. See `MarrowAsset.optimized`.
     * - `off` loads none: every region stays a quad and every slot is drawn.
     * - A string is the URL of the file that `pixi-marrow outlines` wrote. It is fetched during the load.
     * - An object is the parsed content of such a file.
     *
     * A file or an object that does not fit the atlas throws.
     */
    outlines?: 'auto' | 'off' | string | AtlasOutlines;
    /**
     * The render mode the display objects of the asset will ask for, so that the load brings
     * the code they draw with. The code of the mesh mode is not in the root import. The load
     * waits for it with `mesh`, and with `auto` (the default) for a skeleton that `auto` draws
     * with meshes. A display object that asks for the mesh mode later loads the code itself and
     * draws in a batch until it is there.
     */
    renderMode?: 'auto' | 'mesh' | 'batched';
}

/** What `MarrowAsset.from` takes: a skeleton and an atlas that are in memory. */
export interface MarrowAssetData {
    model: SkeletonModel;
    atlas: AtlasModel;
    /** One texture per atlas page, in page order. */
    textures: readonly Texture[];
    /**
     * Where the outlines of the atlas regions come from: `auto` (the default) reads the page
     * textures in idle time, `off` uses none, an object is checked against the atlas and used.
     */
    outlines?: 'auto' | 'off' | AtlasOutlines;
    /** The render mode the display objects will ask for, see `MarrowLoadOptions.renderMode`. Default `auto`. */
    renderMode?: 'auto' | 'mesh' | 'batched';
}

/**
 * Where the outlines of an asset stand.
 *
 * - `given`: the load got them, as a file or as an object.
 * - `scanned`: they were read from the page images after the load.
 * - `scanning`: the page images are being read at the moment, and there are none yet.
 * - `unread`: the scan ended and could read no page image. Every region keeps its quad.
 * - `off`: the asset was loaded with `outlines: 'off'`.
 */
export type OutlinesState = 'given' | 'scanned' | 'scanning' | 'unread' | 'off';

/** What an asset is made of: the files, and the outlines or the word that says how to get them. */
interface AssetParts {
    model: SkeletonModel;
    atlas: AtlasModel;
    textures: readonly Texture[];
    outlines: AtlasOutlines | 'auto' | undefined;
}

/** The assets loaded from URLs, by what was asked for. Loads of the same things share one asset. */
const shared = new Map<string, Promise<MarrowAsset>>();

/** Numbers for the outline objects that loads were asked with, so that a load can be told from another. */
const outlineIds = new WeakMap<object, number>();
let nextOutlineId = 1;

/** How the outlines option reads in the key of a load. Two objects are two keys. */
function outlinesKey(outlines: MarrowLoadOptions['outlines']): string {
    if (outlines === undefined || typeof outlines === 'string') return outlines ?? 'auto';
    let id = outlineIds.get(outlines);

    if (id === undefined) {
        id = nextOutlineId++;
        outlineIds.set(outlines, id);
    }

    return `object ${id}`;
}

/** What identifies a load, or undefined when the skeleton is not a URL. */
function loadKey(options: MarrowLoadOptions): string | undefined {
    if (typeof options.skeleton !== 'string') return undefined;
    const textures = Object.entries(options.textures ?? {})
        .map(([name, texture]) => [name, typeof texture === 'string' ? texture : `texture ${texture.uid}`])
        .sort(([a = ''], [b = '']) => a.localeCompare(b));

    return JSON.stringify([options.skeleton, options.atlas, textures, outlinesKey(options.outlines)]);
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

/** The parsed outlines file of a load, or what the option says when it names no file. */
async function readOutlines(outlines: MarrowLoadOptions['outlines']): Promise<unknown> {
    if (typeof outlines !== 'string' || outlines === 'auto' || outlines === 'off') return outlines ?? 'auto';
    const response = await fetchFile(outlines, 'outlines file');

    try {
        return await response.json();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        throw new MarrowError('invalid-data', `The outlines file at ${outlines} is not JSON: ${reason}`, {
            fix: 'Write the file again for this atlas: pixi-marrow outlines <atlas>.',
        });
    }
}

/**
 * What an asset starts with: the outlines of an object, checked against the atlas, or the word
 * for none or later. The code that checks them and the code that cuts with them load on
 * demand, so a load without outlines does not pay for either.
 */
async function checkOutlines(outlines: unknown, atlas: AtlasModel): Promise<AtlasOutlines | 'auto' | undefined> {
    if (outlines === 'off') return undefined;
    if (outlines === undefined || outlines === 'auto') return 'auto';
    const [{ readAtlasOutlines }] = await Promise.all([import('../geometry/outlines'), loadCutCode()]);

    return readAtlasOutlines(outlines, atlas);
}

/**
 * The code that poses a skeleton, and with it the code its instances draw with that is not in
 * the root import. The code that clips loads for a skeleton with a clipping attachment. The
 * code of the mesh mode loads when the instances start in that mode: `mode` names it, or it is
 * `auto` and the skeleton is one that `auto` draws with meshes.
 *
 * A load of the mesh mode that fails does not fail the asset: its instances draw in a batch.
 */
async function loadCode(model: SkeletonModel, atlas: AtlasModel, mode: RenderMode): Promise<PoseEngineFactory> {
    const [createEngine] = await Promise.all([
        loadPoseEngine(model),
        hasClip(model) ? loadClipCode() : undefined,
        startsWithMeshes(model, atlas, mode) ? loadMeshCode() : undefined,
    ]);

    return createEngine;
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
    /** The image URLs this asset loaded, which it unloads when it is destroyed. */
    private readonly loaded: readonly string[];
    /** What the asset is shared under, or undefined. */
    private readonly key: string | undefined;
    private description: SkeletonInfo | undefined;
    private gone = false;
    private found: AtlasOutlines | undefined;
    /** The scan that reads the pages at the moment. */
    private scan: StartedScan | undefined;
    /** Resolves when the scan has ended. */
    private work: Promise<void> = Promise.resolve();
    /** True when the outlines come from the pixels of the textures, and follow them. */
    private readonly scans: boolean;

    private constructor(parts: AssetParts, createEngine: PoseEngineFactory, loaded: string[], key?: string) {
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
        this.loaded = loaded;
        this.key = key;
        this.scans = outlines === 'auto';
        if (outlines === 'auto') {
            for (const texture of this.textures) texture.source.on('update', this.onPageUpdate, this);
            this.startScan();
        } else this.found = outlines;
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
     * The outlines of the atlas regions, or undefined when there are none. With `outlines: 'auto'`
     * they are undefined until the page images were read, and again while they are read once
     * more after a page texture got other pixels.
     */
    get outlines(): AtlasOutlines | undefined {
        return this.found;
    }

    /** Where the {@link outlines} come from, and whether they are still being read. */
    get outlinesState(): OutlinesState {
        if (!this.scans) return this.found === undefined ? 'off' : 'given';
        if (this.scan !== undefined) return 'scanning';

        return this.found === undefined ? 'unread' : 'scanned';
    }

    /**
     * Resolves when the work in the background has ended: with `outlines: 'auto'` the scan of the
     * page images, which sets {@link outlines}. Resolves at once when there is no such work. It
     * never rejects: a page that cannot be read keeps its quads.
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
     * Loads of the same skeleton URL, atlas URL and options share one asset. Throws a
     * `MarrowError` when a file does not load or is not valid. Every constraint of the skeleton
     * is solved: IK, transform, path, physics and sliders.
     *
     * The outlines of the atlas regions are read from the page images after the load, in idle
     * time, unless `outlines` names a file, gives them or is `off`.
     *
     * @example
     * const asset = await MarrowAsset.load({ skeleton: 'hero.json', atlas: 'hero.atlas' });
     * const fromBytes = await MarrowAsset.load({ skeleton: bytes, atlas: 'hero.atlas' });
     */
    static load(options: MarrowLoadOptions): Promise<MarrowAsset> {
        const key = loadKey(options);
        const cached = key === undefined ? undefined : shared.get(key);

        // an asset that is shared was loaded for another mode, perhaps: the code of this one loads next to it
        if (cached !== undefined) return options.renderMode === 'mesh' ? loadMeshCode().then(() => cached) : cached;
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
        const { model, atlas, textures } = data;
        const outlines = await checkOutlines(data.outlines, atlas);

        const createEngine = await loadCode(model, atlas, renderMode(data.renderMode ?? 'auto'));

        return new MarrowAsset({ model, atlas, textures, outlines }, createEngine, []);
    }

    private static async fetch(options: MarrowLoadOptions, key: string | undefined): Promise<MarrowAsset> {
        const [source, atlasFile, outlinesFile] = await Promise.all([
            readSkeleton(options.skeleton),
            fetchFile(options.atlas, 'atlas'),
            readOutlines(options.outlines),
        ]);
        const model = await importSkeleton(source);
        const atlas = importAtlas(await atlasFile.text());
        // before the images, so that outlines of another atlas cost no image loads
        const outlines = await checkOutlines(outlinesFile, atlas);
        const createEngine = await loadCode(model, atlas, renderMode(options.renderMode ?? 'auto'));
        const { textures, loaded } = await loadPages(atlas, options.atlas, options.textures);

        return new MarrowAsset({ model, atlas, textures, outlines }, createEngine, loaded, key);
    }

    /**
     * Unloads the page images this asset loaded and stops sharing the asset. Textures that were
     * passed in are left alone. A scan of the page images ends before its next page. Destroy the
     * display objects made from the asset first. One that is left no longer updates.
     */
    destroy(): void {
        if (this.gone) return;
        this.gone = true;
        this.scan?.stop();
        this.scan = undefined;
        if (this.scans) {
            for (const texture of this.textures) texture.source.off('update', this.onPageUpdate, this);
        }
        if (this.key !== undefined) shared.delete(this.key);
        for (const url of this.loaded) releasePage(url);
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
            .catch(() => undefined)
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
