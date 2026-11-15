import { Assets } from 'pixi.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAtlasOutlines } from '../../src/geometry/outlines';
import { type AtlasOutlines, MarrowAsset, MarrowError, MarrowSpine, registerMarrowAssets } from '../../src/index';
import { fixtureFiles, holdTicker } from './helpers';
import { pixelPages } from './pages';
import { type ImageLoader, ROOT, stubFetch, stubImageLoader, useLocalUrls } from './urls';

/*
 * Pixi `Assets` next to `MarrowAsset.load`: one page image for both, an outlines file for an
 * asset of `MarrowAsset.get`, and files that are told by their content.
 */

const BOY = fixtureFiles('4.2/spineboy-pro.skel');
const BOY_JSON = fixtureFiles('4.2/spineboy-pro.json');
const HTML = '<!doctype html>\n<html><body>My game</body></html>';
const files = new Map<string, string | Uint8Array>([
    ['art/boy.skel', BOY.skeleton],
    ['art/boy.json', BOY_JSON.skeleton],
    ['art/boy.atlas', BOY.atlas],
    ['art/boy-3f2a91', BOY_JSON.skeleton],
    ['art/json-inside.skel', BOY_JSON.skeleton],
    ['art/typo.skel', HTML],
    ['art/typo.atlas', HTML],
]);
const aliases = { skeleton: 'art/boy.skel', atlas: 'art/boy.atlas' } as const;
let images: ImageLoader;
let outlines: AtlasOutlines;
let raptorOutlines: AtlasOutlines;

useLocalUrls();
beforeAll(async () => {
    const boy = await pixelPages('4.2/spineboy.atlas');
    const raptor = await pixelPages('4.2/raptor.atlas');

    outlines = buildAtlasOutlines(boy.atlas, boy.pages);
    raptorOutlines = buildAtlasOutlines(raptor.atlas, raptor.pages);
    files.set('art/boy.outlines.json', JSON.stringify(outlines));
    // the format detections of Pixi need a document
    await Assets.init({ skipDetections: true });
    registerMarrowAssets();
});
beforeEach(() => {
    holdTicker();
    images = stubImageLoader();
    stubFetch(files);
});
afterEach(async () => {
    await Assets.unload([...files.keys()].filter((url) => Assets.cache.has(url)));
    images.restore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** The error a promise rejects with, as text. Pixi wraps the error of a parser into one of its own. */
const failure = (promise: Promise<unknown>): Promise<string> =>
    promise.then(
        () => 'no error',
        (reason: unknown) => String(reason),
    );

describe('a page image of Pixi Assets and of MarrowAsset.load', () => {
    it('is one texture, which stays while either one holds it', async () => {
        await Assets.load(['art/boy.skel', 'art/boy.atlas']);
        const fromAssets = MarrowAsset.get(aliases);
        const direct = await MarrowAsset.load(aliases);

        expect(direct).not.toBe(fromAssets);
        expect(direct.textures[0]).toBe(fromAssets.textures[0]);
        // both asked the loader, which holds one texture per absolute URL
        expect(images.loads.map(({ src }) => src)).toEqual(['art/spineboy.png', 'art/spineboy.png']);

        await Assets.unload('art/boy.atlas');
        expect(fromAssets.destroyed).toBe(true);
        expect(images.unloads).toEqual([]);
        expect(direct.textures[0]?.source.destroyed).toBe(false);
        direct.destroy();
        expect(images.unloads).toEqual(['art/spineboy.png']);
    });

    it('stays for the atlas in Assets when the asset of MarrowAsset.load ends first', async () => {
        const direct = await MarrowAsset.load(aliases);

        await Assets.load(['art/boy.skel', 'art/boy.atlas']);
        const hero = MarrowSpine.from({ ...aliases, autoUpdate: false });

        direct.destroy();
        expect(direct.destroyed).toBe(true);
        expect(images.unloads).toEqual([]);
        expect(() => hero.update(0.1)).not.toThrow();

        // the display object keeps the page past the unload of the atlas
        await Assets.unload('art/boy.atlas');
        expect(images.unloads).toEqual([]);
        hero.destroy();
        expect(images.unloads).toEqual(['art/spineboy.png']);
    });

    it('lets Assets own an asset again that a destroy call of the game let go', async () => {
        await Assets.load(['art/boy.skel', 'art/boy.atlas']);
        const asset = MarrowAsset.get(aliases);
        const hero = new MarrowSpine(asset, { autoUpdate: false });

        asset.destroy();
        expect(asset.destroyed).toBe(false);
        expect(MarrowAsset.get(aliases)).toBe(asset);
        hero.destroy();
        // Assets holds it once more, so it did not end with the display object
        expect(asset.destroyed).toBe(false);
        asset.destroy();
        expect(asset.destroyed).toBe(true);
        expect(MarrowAsset.get(aliases)).not.toBe(asset);
    });
});

describe('outlines for an asset of MarrowAsset.get', () => {
    beforeEach(() => Assets.load(['art/boy.skel', 'art/boy.atlas']));

    it('come from a file that Assets loaded, by its alias or its URL', async () => {
        await Assets.load({ alias: 'boy-outlines', src: 'art/boy.outlines.json' });
        const asset = MarrowAsset.get({ ...aliases, outlines: 'boy-outlines' });

        // the check and the code that cuts load on demand: the outlines come a moment later
        expect(asset.outlinesState).toBe('given');
        expect(asset.outlines).toBeUndefined();
        await asset.optimized;
        expect(asset.outlines).toEqual(outlines);
        expect(asset.outlinesState).toBe('given');
        // no page image was read
        expect(MarrowAsset.get({ ...aliases, outlines: 'boy-outlines' })).toBe(asset);
        expect(MarrowAsset.get({ ...aliases, outlines: 'art/boy.outlines.json' })).toBe(asset);
        expect(MarrowAsset.get(aliases)).not.toBe(asset);
        await Assets.unload('boy-outlines');
    });

    it('come from an object, for MarrowSpine.from too', async () => {
        const hero = MarrowSpine.from({ ...aliases, outlines, autoUpdate: false, occlusion: 'auto' });

        expect(hero.asset.outlinesState).toBe('given');
        await hero.asset.optimized;
        expect(hero.asset.outlines).toEqual(outlines);
        expect(MarrowAsset.get({ ...aliases, outlines })).toBe(hero.asset);
        expect(() => hero.update(0.1)).not.toThrow();
        hero.destroy();
    });

    it('throw at once for the file of another atlas and for a file that is not loaded', () => {
        const other = (): unknown => MarrowAsset.get({ ...aliases, outlines: raptorOutlines });
        const missing = (): unknown => MarrowAsset.get({ ...aliases, outlines: 'art/none.outlines.json' });

        expect(other).toThrow(MarrowError);
        expect(other).toThrow(/The outlines do not fit the atlas: the atlas has \d+ regions/);
        expect(other).toThrow('pixi-marrow outlines <atlas>');
        expect(missing).toThrow('Pixi Assets holds no outlines file under "art/none.outlines.json".');
        expect(missing).toThrow("await Assets.load('art/none.outlines.json')");
        // nothing was held for the assets that were not made
        expect(MarrowAsset.get(aliases).destroyed).toBe(false);
    });

    it('reject optimized for outlines with damaged content, and the asset keeps its quads', async () => {
        const damaged: object = { ...outlines, version: 2 };
        // what a JSON file that was edited by hand can hold
        const asset = MarrowAsset.get({ ...aliases, outlines: damaged as AtlasOutlines });
        const error = await asset.optimized.then(
            () => undefined,
            (reason: unknown) => reason,
        );

        expect(error).toBeInstanceOf(MarrowError);
        expect(String(error)).toContain('format version 2');
        expect(asset.outlines).toBeUndefined();
    });
});

describe('the parsers of Pixi Assets', () => {
    it('take a JSON skeleton from a URL without a telling name, when the asset names the parser', async () => {
        await Assets.load({ alias: 'hashed', src: 'art/boy-3f2a91', parser: 'marrowSkeletonLoader' });
        await Assets.load(['art/json-inside.skel', 'art/boy.atlas']);
        const hashed = MarrowAsset.get({ skeleton: 'hashed', atlas: 'art/boy.atlas' });
        const inside = MarrowAsset.get({ skeleton: 'art/json-inside.skel', atlas: 'art/boy.atlas' });

        expect(hashed.model.version).toBe('4.2');
        expect(hashed.info.animations.map((animation) => animation.name)).toContain('walk');
        expect(inside.info.counts).toEqual(hashed.info.counts);
        await Assets.unload('hashed');
        expect(hashed.destroyed).toBe(true);
    });

    it('say that the server returned an HTML page, with the URL', async () => {
        const skeleton = await failure(Assets.load('art/typo.skel'));
        const atlas = await failure(Assets.load('art/typo.atlas'));

        expect(skeleton).toContain('The server returned an HTML page for the skeleton at art/typo.skel, not the file.');
        expect(atlas).toContain('The server returned an HTML page for the atlas at art/typo.atlas, not the file.');
        expect(skeleton).toContain('[pixi-marrow:invalid-data]');
    });

    it('name the URL of a file that does not load', async () => {
        const skeleton = await failure(Assets.load('art/none.skel'));
        const atlas = await failure(Assets.load('art/none.atlas'));

        expect(skeleton).toContain(
            `[pixi-marrow:invalid-data] The skeleton at ${ROOT}art/none.skel did not load: status 404.`,
        );
        expect(atlas).toContain(`The atlas at ${ROOT}art/none.atlas did not load: status 404.`);
    });
});
