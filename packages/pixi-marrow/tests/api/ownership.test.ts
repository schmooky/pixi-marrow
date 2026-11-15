import { Assets, Texture } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarrowAsset, MarrowError, MarrowSpine } from '../../src/index';
import { fixtureFiles, holdTicker } from './helpers';
import { type ImageLoader, ROOT, stubFetch, stubImageLoader, useLocalUrls } from './urls';

/*
 * Who holds an asset and its page images. An audit found that one `destroy` call took the
 * textures from every display object and every other screen, and that a display object never
 * let its asset go.
 */

const BOY = fixtureFiles('4.2/spineboy-pro.skel');
const BOY_JSON = fixtureFiles('4.2/spineboy-pro.json');
const files = new Map<string, string | Uint8Array>([
    ['art/boy.skel', BOY.skeleton],
    ['art/boy.json', BOY_JSON.skeleton],
    ['art/boy.atlas', BOY.atlas],
]);
const options = { skeleton: 'art/boy.skel', atlas: 'art/boy.atlas' } as const;
let images: ImageLoader;
let fetched: { readonly urls: string[] };

useLocalUrls();
beforeEach(() => {
    holdTicker();
    images = stubImageLoader();
    fetched = stubFetch(files);
});
afterEach(() => {
    images.restore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the owners of an asset', () => {
    it('ends after the last of two loads let it go, not after the first', async () => {
        const first = await MarrowAsset.load(options);
        const second = await MarrowAsset.load({ ...options });

        expect(second).toBe(first);
        first.destroy();
        expect(first.destroyed).toBe(false);
        expect(images.unloads).toEqual([]);
        // the other screen still makes display objects from it
        const hero = new MarrowSpine(second, { autoUpdate: false });

        hero.destroy();
        expect(second.destroyed).toBe(false);
        second.destroy();
        expect(second.destroyed).toBe(true);
        expect(images.unloads).toEqual(['art/spineboy.png']);
    });

    it('keeps its textures for a display object on the stage, whatever is destroyed first', async () => {
        const asset = await MarrowAsset.load(options);
        const hero = new MarrowSpine(asset, { autoUpdate: false });
        const source = asset.textures[0]?.source;
        const walk = hero.play('walk', { loop: true });

        asset.destroy();
        // calls without an owner do nothing: they cannot take the hold of the display object
        asset.destroy();
        asset.destroy();
        expect(asset.destroyed).toBe(false);
        // the render of Pixi reads the style of the source: it crashed on a source that was destroyed
        expect(source?.destroyed).toBe(false);
        expect(source?.style).not.toBeNull();
        expect(() => hero.update(0.25)).not.toThrow();
        expect(walk.time).toBeCloseTo(0.25);
        expect(images.unloads).toEqual([]);

        hero.destroy();
        expect(asset.destroyed).toBe(true);
        expect(source?.destroyed).toBe(true);
        expect(images.unloads).toEqual(['art/spineboy.png']);
        expect(() => new MarrowSpine(asset)).toThrow('The asset was destroyed.');
    });

    it('lets go of everything when the display object of MarrowSpine.load is destroyed', async () => {
        const hero = await MarrowSpine.load({ ...options, autoUpdate: false });
        const twin = await MarrowSpine.load({ ...options, autoUpdate: false });
        const { asset } = hero;

        expect(twin.asset).toBe(asset);
        expect(fetched.urls).toHaveLength(2);
        hero.destroy();
        expect(asset.destroyed).toBe(false);
        twin.destroy();
        expect(asset.destroyed).toBe(true);
        expect(images.unloads).toEqual(['art/spineboy.png']);

        // nothing stays for the life of the page: the next load starts over
        const next = await MarrowSpine.load({ ...options, autoUpdate: false });

        expect(next.asset).not.toBe(asset);
        expect(fetched.urls).toHaveLength(4);
        next.destroy();
        expect(images.unloads).toEqual(['art/spineboy.png', 'art/spineboy.png']);
    });

    it('stays for a load that holds it while display objects of MarrowSpine.load come and go', async () => {
        const preloaded = await MarrowAsset.load(options);
        const hero = await MarrowSpine.load({ ...options, autoUpdate: false });

        expect(hero.asset).toBe(preloaded);
        hero.destroy();
        expect(preloaded.destroyed).toBe(false);
        expect(images.unloads).toEqual([]);
        preloaded.destroy();
        expect(preloaded.destroyed).toBe(true);
    });

    it('gives a load that waits on an asset which ended in the meantime an asset of its own', async () => {
        const first = await MarrowAsset.load(options);
        // asked while the asset is alive, answered after it ended
        const waiting = MarrowAsset.load(options);

        first.destroy();
        const second = await waiting;

        expect(first.destroyed).toBe(true);
        expect(second).not.toBe(first);
        expect(second.destroyed).toBe(false);
        expect(() => new MarrowSpine(second, { autoUpdate: false }).destroy()).not.toThrow();
        second.destroy();
    });

    it('leaves the textures of MarrowAsset.from alone, and ends with its last holder', async () => {
        const loaded = await MarrowAsset.load(options);
        const mine = new Texture({ source: loaded.textures[0]?.source ?? Texture.WHITE.source });
        const asset = await MarrowAsset.from({ model: loaded.model, atlas: loaded.atlas, textures: [mine] });
        const hero = new MarrowSpine(asset, { autoUpdate: false });

        asset.destroy();
        expect(asset.destroyed).toBe(false);
        hero.destroy();
        expect(asset.destroyed).toBe(true);
        expect(mine.destroyed).toBe(false);
        expect(images.unloads).toEqual([]);
        loaded.destroy();
    });
});

describe('the holders of a page image', () => {
    it('shares one texture between a relative and an absolute URL of one atlas', async () => {
        files.set(`${ROOT}art/boy.atlas`, BOY.atlas);
        const relative = await MarrowAsset.load(options);
        const absolute = await MarrowAsset.load({ skeleton: 'art/boy.json', atlas: `${ROOT}art/boy.atlas` });

        expect(absolute).not.toBe(relative);
        expect(absolute.textures[0]).toBe(relative.textures[0]);
        expect(images.loads.map(({ src }) => src)).toEqual(['art/spineboy.png', `${ROOT}art/spineboy.png`]);

        relative.destroy();
        expect(images.unloads).toEqual([]);
        expect(absolute.textures[0]?.source.destroyed).toBe(false);
        absolute.destroy();
        expect(images.unloads).toEqual(['art/spineboy.png']);
        files.delete(`${ROOT}art/boy.atlas`);
    });

    it('never unloads a page that the game loaded before', async () => {
        // the game preloads the page itself, through the loader that Pixi Assets uses
        const preloaded = await Assets.loader.load<Texture>('art/spineboy.png');
        const asset = await MarrowAsset.load(options);

        expect(asset.textures[0]).toBe(preloaded);
        asset.destroy();
        expect(asset.destroyed).toBe(true);
        expect(images.unloads).toEqual([]);
        expect(preloaded.source.destroyed).toBe(false);

        // and again: the page is still the game's when pixi-marrow asks a second time
        const again = await MarrowAsset.load(options);

        again.destroy();
        expect(images.unloads).toEqual([]);
        expect(images.texture('art/spineboy.png')).toBe(preloaded);
    });

    it('never unloads a page that is in the cache of Pixi Assets, put there before or after the load', async () => {
        const before = new Texture({ source: Texture.WHITE.source });

        Assets.cache.set('art/spineboy.png', before);
        const first = await MarrowAsset.load(options);

        first.destroy();
        expect(images.unloads).toEqual([]);
        Assets.cache.remove('art/spineboy.png');
        images.restore();
        images = stubImageLoader();

        const second = await MarrowAsset.load(options);
        const page = second.textures[0];

        // the game takes the texture that pixi-marrow loaded into its own cache
        Assets.cache.set(`${ROOT}art/spineboy.png`, page);
        second.destroy();
        expect(second.destroyed).toBe(true);
        expect(images.unloads).toEqual([]);
        expect(page?.source.destroyed).toBe(false);
        Assets.cache.remove(`${ROOT}art/spineboy.png`);
    });

    it('gives back the pages that did load when another page fails, and names the URL of that page', async () => {
        const loader: { load(assets: unknown): Promise<unknown> } = Assets.loader;
        const stub = vi.mocked(loader.load).getMockImplementation();

        vi.mocked(loader.load).mockImplementation(async (assets: unknown) => {
            if (Reflect.get(Object(assets), 'src') === 'art/spineboy.png') throw new Error('decode failed');

            return stub?.(assets);
        });
        const error = await MarrowAsset.load(options).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(MarrowError);
        expect(String(error)).toContain(
            'The page image "spineboy.png" at art/spineboy.png did not load: decode failed',
        );
        // the next load is the first holder again
        vi.mocked(loader.load).mockImplementation(async (assets: unknown) => stub?.(assets));
        const asset = await MarrowAsset.load(options);

        asset.destroy();
        expect(images.unloads).toEqual(['art/spineboy.png']);
    });
});
