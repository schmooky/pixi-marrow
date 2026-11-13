import { Assets, DOMAdapter, Texture } from 'pixi.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeSkeleton } from '../../src/core';
import { type LoadedAtlas, MarrowAsset, MarrowError, MarrowSpine, registerMarrowAssets } from '../../src/index';
import { blankTexture, fixtureFiles, holdTicker, importRig } from './helpers';

const BOY = fixtureFiles('4.2/spineboy-pro.skel');
const BOY_JSON = fixtureFiles('4.2/spineboy-pro.json');
const DRAGON = fixtureFiles('4.3/dragon-ess.skel');

/** The files a server would answer, by URL. */
const files = new Map<string, string | Uint8Array>([
    ['art/boy.skel', BOY.skeleton],
    ['art/boy.json', BOY_JSON.skeleton],
    ['art/boy.atlas', BOY.atlas],
    ['art/boy-3f2a.atlas?v=2', BOY.atlas],
    ['dragon.skel', DRAGON.skeleton],
    ['dragon.atlas', DRAGON.atlas],
]);

/** Pixi makes every URL absolute against the page: here that page is at the root of localhost. */
const ROOT = 'http://localhost/';
const local = (url: string): string => (url.startsWith(ROOT) ? url.slice(ROOT.length) : url);
const adapter = DOMAdapter.get();

const fetched = vi.fn(async (url: string): Promise<Response> => {
    const body = files.get(local(url));

    if (body === undefined) return new Response('', { status: 404 });

    return new Response(typeof body === 'string' ? body : body.slice());
});

/** The loader of Pixi, typed as loosely as the stub below answers. */
const loader: {
    load(assets: unknown, onProgress?: unknown): Promise<unknown>;
    unload(assets: unknown): Promise<void>;
} = Assets.loader;
const realLoad = loader.load.bind(loader);
const realUnload = loader.unload.bind(loader);
/** The page images the parser asked the loader for, with their data. */
let images: { src: string; data: unknown }[];
let unloaded: string[];

async function rejection(promise: Promise<unknown> | (() => unknown)): Promise<MarrowError> {
    const error = await (typeof promise === 'function' ? Promise.resolve().then(promise) : promise).then(
        () => undefined,
        (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(MarrowError);

    return error as MarrowError;
}

beforeAll(async () => {
    DOMAdapter.set({ ...adapter, getBaseUrl: () => ROOT });
    // the format detections of Pixi need a document
    await Assets.init({ skipDetections: true });
    registerMarrowAssets();
    // a second call adds nothing
    registerMarrowAssets();
});
afterAll(() => DOMAdapter.set(adapter));

beforeEach(() => {
    images = [];
    unloaded = [];
    vi.stubGlobal('fetch', fetched);
    // Node has no image decoder: a page image comes back as a blank texture
    vi.spyOn(loader, 'load').mockImplementation(async (assets: unknown, onProgress?: unknown) => {
        const asset = assets as { src?: unknown; data?: unknown };

        if (typeof asset.src === 'string' && /\.(png|webp|avif)(\?|$)/.test(asset.src)) {
            images.push({ src: local(asset.src), data: asset.data });

            return blankTexture();
        }

        return realLoad(assets, onProgress);
    });
    vi.spyOn(loader, 'unload').mockImplementation(async (assets: unknown) => {
        if (typeof assets === 'string' && /\.(png|webp|avif)(\?|$)/.test(assets)) unloaded.push(local(assets));
        else await realUnload(assets);
    });
});

afterEach(async () => {
    await Assets.unload([...files.keys()].filter((url) => Assets.cache.has(url)));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Pixi Assets', () => {
    it('loads a .skel file and its atlas, and makes a display object without a wait', async () => {
        holdTicker();
        await Assets.load(['art/boy.skel', 'art/boy.atlas']);
        const hero = MarrowSpine.from({ skeleton: 'art/boy.skel', atlas: 'art/boy.atlas' });
        const { model } = await importRig('4.2/spineboy-pro.skel');

        expect(hero.info).toEqual(describeSkeleton(model));
        expect(images.map(({ src }) => src)).toEqual(['art/spineboy.png']);
        expect(images[0]?.data).toEqual({ alphaMode: 'premultiply-alpha-on-upload' });
        const walk = hero.play('walk', { loop: true });

        hero.update(0.25);
        expect(walk.time).toBeCloseTo(0.25);
        hero.destroy();
    });

    it('turns a Spine .json file into the same skeleton as its .skel file', async () => {
        await Assets.load(['art/boy.json', 'art/boy.skel']);
        const fromJson = Assets.get('art/boy.json');
        const fromBinary = Assets.get('art/boy.skel');

        const names = (info: ReturnType<typeof describeSkeleton>): unknown => [
            info.version,
            info.bones,
            info.slots,
            info.animations.map((animation) => animation.name),
        ];

        expect(names(describeSkeleton(fromJson))).toEqual(names(describeSkeleton(fromBinary)));
    });

    it('takes aliases, page images in data and their metadata, as the official runtime does', async () => {
        const page = blankTexture();

        holdTicker();
        await Assets.load([
            { alias: 'boy-data', src: 'art/boy.skel' },
            { alias: 'boy-atlas', src: 'art/boy.atlas', data: { images: { 'spineboy.png': page } } },
            { alias: 'dragon-data', src: 'dragon.skel' },
            { alias: 'dragon-atlas', src: 'dragon.atlas', data: { imageMetadata: { autoGenerateMipmaps: true } } },
        ]);
        const boy = Assets.get<LoadedAtlas>('boy-atlas');

        expect(boy.textures).toEqual([page]);
        // the dragon has more than one page: each one is asked with the metadata
        expect(images.length).toBeGreaterThan(1);
        for (const { data } of images)
            expect(data).toMatchObject({ autoGenerateMipmaps: true, alphaMode: expect.any(String) });
        const hero = MarrowSpine.from({ skeleton: 'boy-data', atlas: 'boy-atlas' });

        expect(hero.asset.textures).toEqual([page]);
        hero.destroy();
        await Assets.unload(['boy-data', 'boy-atlas', 'dragon-data', 'dragon-atlas']);
        // a page that was passed in is left alone
        expect(unloaded.filter((url) => url.includes('spineboy'))).toEqual([]);
    });

    it('loads the pages of a renamed atlas from next to it, with its query', async () => {
        await Assets.load({ alias: 'busted', src: 'art/boy-3f2a.atlas?v=2' });

        expect(images.map(({ src }) => src)).toEqual(['art/spineboy.png?v=2']);
        await Assets.unload('busted');
        expect(unloaded).toEqual(['art/spineboy.png?v=2']);
    });

    it('shares one asset per skeleton, atlas and outlines option', async () => {
        await Assets.load(['art/boy.skel', 'art/boy.atlas']);
        const options = { skeleton: 'art/boy.skel', atlas: 'art/boy.atlas' };
        const first = MarrowAsset.get(options);

        expect(MarrowAsset.get(options)).toBe(first);
        expect(MarrowAsset.get({ ...options, outlines: 'off' })).not.toBe(first);
        expect(MarrowAsset.get({ ...options, outlines: 'off' }).outlinesState).toBe('off');
        first.destroy();
        expect(MarrowAsset.get(options)).not.toBe(first);
    });

    it('ends the assets of an atlas when Pixi unloads it, and gives its pages back', async () => {
        const ticker = holdTicker();

        await Assets.load(['art/boy.skel', 'art/boy.atlas']);
        const hero = MarrowSpine.from({ skeleton: 'art/boy.skel', atlas: 'art/boy.atlas' });

        hero.play('walk', { loop: true });
        await Assets.unload('art/boy.atlas');
        expect(hero.asset.destroyed).toBe(true);
        expect(unloaded).toEqual(['art/spineboy.png']);
        expect(() => ticker.update(ticker.lastTime + 16)).not.toThrow();
        expect(hero.autoUpdate).toBe(false);
        hero.destroy();
    });

    it('picks the resolution and the format of an atlas from its name', () => {
        const parsed = Assets.resolver.parsers.map((parser) =>
            parser.test('art/hero@0.5x.webp.atlas') ? parser.parse('art/hero@0.5x.webp.atlas') : undefined,
        );

        expect(parsed).toContainEqual({ resolution: 0.5, format: 'webp', src: 'art/hero@0.5x.webp.atlas' });
        // registered twice, added once
        const names = Assets.loader.parsers.map((parser) => parser.name);

        expect(names.filter((name) => name === 'marrowAtlasLoader')).toHaveLength(1);
        expect(names.filter((name) => name === 'marrowSkeletonLoader')).toHaveLength(1);
    });

    it('says what to do when an alias holds nothing it loaded', async () => {
        await Assets.load('art/boy.skel');
        const missing = await rejection(() =>
            MarrowSpine.from({ skeleton: 'art/nobody.skel', atlas: 'art/boy.atlas' }),
        );

        expect(missing.code).toBe('invalid-data');
        expect(missing.message).toContain('"art/nobody.skel"');
        expect(missing.fix).toContain(
            "registerMarrowAssets() before the load, then load it: await Assets.load('art/nobody.skel')",
        );
        Assets.cache.set('raw-atlas', BOY.atlas);
        const raw = await rejection(() => MarrowSpine.from({ skeleton: 'art/boy.skel', atlas: 'raw-atlas' }));

        expect(raw.message).toContain('atlas');
        Assets.cache.remove('raw-atlas');
        await Assets.load('art/boy.atlas');
        const outlines = await rejection(() =>
            MarrowAsset.get({ skeleton: 'art/boy.skel', atlas: 'art/boy.atlas', outlines: 'file.json' as 'off' }),
        );

        expect(outlines.fix).toContain('MarrowAsset.load');
    });

    it('takes a page as a texture source, and one image alone as the first page', async () => {
        const source = Texture.WHITE.source;

        await Assets.load({ alias: 'one', src: 'art/boy.atlas', data: { images: source } });

        expect(Assets.get<LoadedAtlas>('one').textures[0]?.source).toBe(source);
        expect(images).toEqual([]);
        await Assets.unload('one');
    });
});
