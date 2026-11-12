import { Assets, Texture, TextureSource } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanOutlines } from '../../src/api/outline-scan';
import { importAtlas } from '../../src/core';
import { buildAtlasOutlines, type PagePixels } from '../../src/geometry/outlines';
import { type AtlasOutlines, MarrowAsset, MarrowError, MarrowSpine } from '../../src/index';
import type { PageReader } from '../../src/render/page-alpha';
import { fixtureFiles, importRig } from './helpers';
import { boyAsset, pixelPages } from './pages';

async function rejection(promise: Promise<unknown>): Promise<MarrowError> {
    const error = await promise.then(
        () => undefined,
        (reason: unknown) => reason,
    );

    if (!(error instanceof MarrowError)) throw new Error(`expected a MarrowError, got ${String(error)}`);

    return error;
}

describe('the outlines of an asset', () => {
    it('are read from the page textures after the load, and optimized says when', async () => {
        const { asset, built } = await boyAsset();

        // the load is over and the scan has not run
        expect(asset.outlines).toBeUndefined();
        await asset.optimized;
        expect(asset.outlines).toEqual(built);
        expect(built.regions.filter((region) => region?.polygon).length).toBeGreaterThan(20);
        await expect(asset.optimized).resolves.toBeUndefined();
        asset.destroy();
    });

    it('are none with off, and optimized resolves at once', async () => {
        const { asset } = await boyAsset({ outlines: 'off' });
        let resolved = false;

        void asset.optimized.then(() => {
            resolved = true;
        });
        await Promise.resolve();
        expect(resolved).toBe(true);
        expect(asset.outlines).toBeUndefined();
    });

    it('are the object that was passed, checked against the atlas', async () => {
        const { built } = await boyAsset({ outlines: 'off' });
        const { asset } = await boyAsset({ outlines: built });
        const { model, atlas } = await importRig('4.2/raptor-pro.skel');
        const textures = atlas.pages.map(() => Texture.WHITE);
        const error = await rejection(MarrowAsset.from({ model, atlas, textures, outlines: built }));

        expect(asset.outlines).toEqual(built);
        // a checked copy, so a later change of the object cannot reach the renderer
        expect(asset.outlines).not.toBe(built);
        await expect(asset.optimized).resolves.toBeUndefined();
        expect(error.code).toBe('invalid-data');
        expect(error.message).toContain('The outlines file does not fit the atlas');
    });

    it('stay undefined for pages that cannot be read, and optimized does not reject', async () => {
        const { model, atlas } = await importRig('4.2/spineboy-pro.skel');
        const white = await MarrowAsset.from({ model, atlas, textures: [Texture.WHITE] });
        // the size of the page, and no image behind it
        const blank = new Texture({ source: new TextureSource({ width: 1024, height: 256 }) });
        const empty = await MarrowAsset.from({ model, atlas, textures: [blank] });

        await expect(white.optimized).resolves.toBeUndefined();
        await expect(empty.optimized).resolves.toBeUndefined();
        expect(white.outlines).toBeUndefined();
        expect(empty.outlines).toBeUndefined();
        white.destroy();
        empty.destroy();
    });

    it('are not read once the asset was destroyed', async () => {
        const { asset } = await boyAsset();

        asset.destroy();
        await expect(asset.optimized).resolves.toBeUndefined();
        expect(asset.outlines).toBeUndefined();
    });

    it('are dropped at once and read again when a page texture gets other pixels', async () => {
        const { asset, built, textures } = await boyAsset();
        const [page] = textures;

        if (page === undefined) throw new Error('the atlas has a page');
        await asset.optimized;
        const first = asset.outlines;

        expect(first).toEqual(built);
        // the user painted over the page: a clear image
        if (page.source.resource instanceof Uint8Array) page.source.resource.fill(0);
        page.source.update();
        expect(asset.outlines).toBeUndefined();
        await asset.optimized;
        expect(asset.outlines?.regions.every((region) => region?.polygon?.length === 0)).toBe(true);
        asset.destroy();
        // a destroyed asset does not listen any more
        page.source.update();
        await asset.optimized;
        expect(asset.outlines?.regions.every((region) => region?.polygon?.length === 0)).toBe(true);
    });
});

describe('a display object and the outlines of its asset', () => {
    it('takes them at its next update with one new layout, and the same triangles', async () => {
        const { asset } = await boyAsset();
        const hero = new MarrowSpine(asset, { autoUpdate: false });

        hero.play('run', { loop: true });
        hero.update(0.1);
        const before = { ...hero.stats };

        expect(before.templateBuilds).toBe(1);
        await asset.optimized;
        expect(hero.stats.templateBuilds).toBe(1);
        hero.update(0);
        // spineboy has no region without a pixel and no covered slot: quads as before
        expect(hero.stats).toMatchObject({
            templateBuilds: 2,
            vertices: before.vertices,
            indices: before.indices,
            drawCalls: before.drawCalls,
            tightRanges: 0,
            coveredSlots: 0,
        });
        hero.update(0.1);
        expect(hero.stats.templateBuilds).toBe(2);
        hero.destroy();
        asset.destroy();
    });

    it('lays polygons out with tightMesh on, and nothing new with both cuts off', async () => {
        const { asset } = await boyAsset();

        await asset.optimized;
        const quads = new MarrowSpine(asset, { autoUpdate: false, tightMesh: 'off', occlusion: 'off' });
        const tight = new MarrowSpine(asset, { autoUpdate: false, tightMesh: 'on' });
        const plain = new MarrowSpine(asset, { autoUpdate: false });

        for (const hero of [quads, tight, plain]) hero.update(0);
        expect(tight.stats.tightRanges).toBeGreaterThan(5);
        expect(tight.stats.vertices).not.toBe(quads.stats.vertices);
        expect(plain.stats).toMatchObject({ tightRanges: 0, vertices: quads.stats.vertices, templateBuilds: 1 });
        expect(quads.stats).toMatchObject({ tightRanges: 0, templateBuilds: 1 });
        for (const hero of [quads, tight, plain]) hero.destroy();
        asset.destroy();
    });
});

describe('scanOutlines', () => {
    /** A page texture that stands for an image: an object with a size. */
    const imagePage = (width: number, height: number): Texture =>
        new Texture({ source: new TextureSource({ width, height, resource: { width, height } }) });
    const clearPixels = (width: number, height: number): PagePixels => ({
        width,
        height,
        data: new Uint8Array(width * height * 4),
    });
    const ATLAS = importAtlas(
        ['a.png', 'size: 8, 8', 'pma: true', 'one', 'bounds: 0, 0, 4, 4', '']
            .concat(['b.png', 'size: 8, 8', 'two', 'bounds: 0, 0, 4, 4', ''])
            .concat(['c.png', 'size: 8, 8', 'three', 'bounds: 0, 0, 4, 4', ''])
            .join('\n'),
    );

    /** A scan with a reader that notes what it is asked, and idle time that the test hands out. */
    function fakeScan(textures: Texture[], answer: (page: number) => PagePixels | null = () => clearPixels(8, 8)) {
        const calls: string[] = [];
        const slices: (() => void)[] = [];
        const reader: PageReader = {
            read(source, premultiplied) {
                const page = textures.findIndex((texture) => texture.source === source);

                calls.push(`page ${page}${premultiplied ? ' premultiplied' : ''}`);

                return answer(page);
            },
            release: () => {
                calls.push('release');
            },
        };
        const scan = scanOutlines(ATLAS, textures, { reader, idle: (run) => slices.push(run) });
        const runSlice = (): boolean => {
            const slice = slices.shift();

            slice?.();

            return slice !== undefined;
        };

        return { scan, calls, runSlice, slices };
    }

    it('reads one page per idle slice, tells the reader which pages are premultiplied, and frees it', async () => {
        const textures = [imagePage(8, 8), imagePage(8, 8), imagePage(8, 8)];
        const { scan, calls, runSlice, slices } = fakeScan(textures);

        expect(calls).toEqual([]);
        expect(slices).toHaveLength(1);
        runSlice();
        expect(calls).toEqual(['page 0 premultiplied']);
        runSlice();
        expect(calls).toEqual(['page 0 premultiplied', 'page 1']);
        runSlice();
        expect(calls).toHaveLength(3);
        // the last slice has no page left
        expect(runSlice()).toBe(true);
        expect(runSlice()).toBe(false);
        expect(calls).toEqual(['page 0 premultiplied', 'page 1', 'page 2', 'release']);
        const outlines = await scan.done;

        // a clear page: no region shows a pixel
        expect(outlines?.regions.map((region) => region?.polygon)).toEqual([[], [], []]);
    });

    it('leaves a page alone that cannot be read, that can change or that is sampled another way', async () => {
        const mipmapped = imagePage(8, 8);
        const canvas = new Texture({
            source: new TextureSource({ width: 8, height: 8, resource: { getContext: () => null } }),
        });
        const textures = [mipmapped, canvas, imagePage(8, 8)];

        mipmapped.source.autoGenerateMipmaps = true;
        const { scan, calls, runSlice } = fakeScan(textures);

        while (runSlice());
        expect(calls).toEqual(['page 2', 'release']);
        expect((await scan.done)?.regions.map((region) => region?.polygon ?? null)).toEqual([null, null, []]);
        // pixels of another size than the page, a reader that gives up and one that throws
        const failing = fakeScan([imagePage(8, 8), imagePage(8, 8), imagePage(8, 8)], (page) => {
            if (page === 2) throw new Error('context lost');

            return page === 0 ? clearPixels(4, 4) : null;
        });

        while (failing.runSlice());
        expect(failing.calls).toEqual(['page 0 premultiplied', 'page 1', 'page 2', 'release']);
        // no page was read: there are no outlines
        await expect(failing.scan.done).resolves.toBeUndefined();
    });

    it('stops before its next page', async () => {
        const { scan, calls, runSlice } = fakeScan([imagePage(8, 8), imagePage(8, 8), imagePage(8, 8)]);

        runSlice();
        scan.stop();
        while (runSlice());
        expect(calls).toEqual(['page 0 premultiplied', 'release']);
        await expect(scan.done).resolves.toBeUndefined();
    });
});

describe('MarrowAsset.load with outlines', () => {
    const BOY = fixtureFiles('4.2/spineboy-pro.skel');
    const RAPTOR = fixtureFiles('4.2/raptor-pro.skel');
    const files = new Map<string, string | Uint8Array>([
        ['art/boy.skel', BOY.skeleton],
        ['art/boy.atlas', BOY.atlas],
        ['art/bad.outlines.json', 'not json'],
    ]);
    const fetched = vi.fn(async (url: string): Promise<Response> => {
        const body = files.get(url);

        return body === undefined
            ? new Response('', { status: 404 })
            : new Response(typeof body === 'string' ? body : body.slice());
    });
    const pixiAssets: { load(asset: unknown): Promise<unknown>; unload(url: unknown): Promise<void> } = Assets;
    const loadImage = vi.spyOn(pixiAssets, 'load');
    const unloadImage = vi.spyOn(pixiAssets, 'unload');
    const assets: MarrowAsset[] = [];
    const base = { skeleton: 'art/boy.skel', atlas: 'art/boy.atlas' } as const;
    let outlines: AtlasOutlines;

    async function load(options: Parameters<typeof MarrowAsset.load>[0]): Promise<MarrowAsset> {
        const asset = await MarrowAsset.load(options);

        if (!assets.includes(asset)) assets.push(asset);

        return asset;
    }

    beforeEach(async () => {
        const boy = await pixelPages('4.2/spineboy.atlas');
        const raptor = await pixelPages('4.2/raptor.atlas');

        outlines = buildAtlasOutlines(boy.atlas, boy.pages);
        files.set('art/boy.outlines.json', JSON.stringify(outlines));
        files.set('art/raptor.outlines.json', JSON.stringify(buildAtlasOutlines(raptor.atlas, raptor.pages)));
        files.set('art/raptor.atlas', RAPTOR.atlas);
        vi.stubGlobal('fetch', fetched);
        fetched.mockClear();
        loadImage
            .mockReset()
            .mockImplementation(async () => new Texture({ source: new TextureSource({ width: 2, height: 2 }) }));
        unloadImage.mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => {
        for (const asset of assets.splice(0)) asset.destroy();
        vi.unstubAllGlobals();
    });

    it('fetches the file a URL names during the load and checks it against the atlas', async () => {
        const asset = await load({ ...base, outlines: 'art/boy.outlines.json' });

        expect(fetched.mock.calls.map(([url]) => url).sort()).toEqual([
            'art/boy.atlas',
            'art/boy.outlines.json',
            'art/boy.skel',
        ]);
        // there from the start, with no work left in the background
        expect(asset.outlines).toEqual(outlines);
        await expect(asset.optimized).resolves.toBeUndefined();
    });

    it('throws for a file of another atlas, a file that is not JSON and a file that is missing, before any image loads', async () => {
        const other = await rejection(MarrowAsset.load({ ...base, outlines: 'art/raptor.outlines.json' }));
        const broken = await rejection(MarrowAsset.load({ ...base, outlines: 'art/bad.outlines.json' }));
        const missing = await rejection(MarrowAsset.load({ ...base, outlines: 'art/none.outlines.json' }));
        const object = await rejection(
            MarrowAsset.load({ ...base, outlines: { ...outlines, version: 1, regions: [] } }),
        );

        expect(other.message).toContain('The outlines file does not fit the atlas: the atlas has');
        expect(broken.message).toContain('The outlines file at art/bad.outlines.json is not JSON');
        expect(missing.message).toContain('The outlines file at art/none.outlines.json did not load: status 404.');
        expect(object.message).toContain('The outlines file does not fit the atlas');
        expect(loadImage).not.toHaveBeenCalled();
    });

    it('takes an object, and loads no outlines with off', async () => {
        const given = await load({ ...base, outlines });
        const none = await load({ ...base, outlines: 'off' });

        expect(given.outlines).toEqual(outlines);
        expect(none.outlines).toBeUndefined();
        await expect(none.optimized).resolves.toBeUndefined();
        expect(fetched.mock.calls.map(([url]) => url)).not.toContain('off');
    });

    it('shares one asset between loads with the same outlines option, and no asset between other ones', async () => {
        const auto = await load(base);
        const copy: AtlasOutlines = JSON.parse(JSON.stringify(outlines));
        const loaded = [
            auto,
            await load({ ...base, outlines: 'off' }),
            await load({ ...base, outlines: 'art/boy.outlines.json' }),
            await load({ ...base, outlines }),
            await load({ ...base, outlines: copy }),
        ];

        expect(new Set(loaded).size).toBe(5);
        expect(await load({ ...base, outlines: 'auto' })).toBe(auto);
        expect(await load({ ...base, outlines: 'off' })).toBe(loaded[1]);
        expect(await load({ ...base, outlines: 'art/boy.outlines.json' })).toBe(loaded[2]);
        expect(await load({ ...base, outlines })).toBe(loaded[3]);
        expect(await load({ ...base, outlines: copy })).toBe(loaded[4]);
    });
});
