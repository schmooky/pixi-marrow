import { BufferImageSource, Texture, type TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanOutlines } from '../../src/api/outline-scan';
import { importAtlas } from '../../src/core';
import { buildAtlasOutlines, type PagePixels } from '../../src/geometry/outlines';
import { MarrowAsset } from '../../src/index';
import { fixtureFiles, importRig } from './helpers';
import { pixelPages } from './pages';

/*
 * `outlines: 'auto'` for many assets on one atlas. An audit found one WebGL context and one
 * read of the page per asset, all alive at once: a slot game with 17 symbols on one atlas lost
 * the context of its renderer to them.
 */

/** What the readers that the scans made were asked. The module makes one for all scans. */
const readers = vi.hoisted(() => ({ made: 0, reads: [] as number[], releases: 0, live: 0, mostLive: 0 }));

vi.mock('../../src/render/page-alpha', () => ({
    createPageReader: () => {
        let holds = false;

        readers.made++;

        return {
            read(source: TextureSource): PagePixels | null {
                const resource: unknown = source.resource;

                // a reader holds a WebGL context from its first read to its release
                if (!holds) {
                    holds = true;
                    readers.live++;
                    readers.mostLive = Math.max(readers.mostLive, readers.live);
                }
                readers.reads.push(source.uid);
                if (!(resource instanceof Uint8Array)) return null;

                return { width: source.pixelWidth, height: source.pixelHeight, data: resource };
            },
            release(): void {
                if (holds) readers.live--;
                holds = false;
                readers.releases++;
            },
        };
    },
}));

const ATLAS_TEXT = fixtureFiles('4.2/spineboy-pro.skel').atlas;

afterEach(() => {
    readers.reads.length = 0;
    readers.releases = 0;
    readers.mostLive = 0;
});

describe('scans of one atlas page by many assets', () => {
    it('read the page once through one reader, and free its context when no page waits', async () => {
        const { model } = await importRig('4.2/spineboy-pro.skel');
        const { atlas, pages, textures } = await pixelPages('4.2/spineboy.atlas');
        const built = buildAtlasOutlines(atlas, pages);
        const assets: MarrowAsset[] = [];

        // 17 symbols: each asset parsed the atlas file itself, and all draw from the same page textures
        for (let i = 0; i < 17; i++) {
            assets.push(await MarrowAsset.from({ model, atlas: importAtlas(ATLAS_TEXT), textures, outlines: 'auto' }));
        }
        expect(assets.every((asset) => asset.outlinesState === 'scanning')).toBe(true);
        await Promise.all(assets.map((asset) => asset.optimized));

        expect(readers.made).toBe(1);
        expect(readers.reads).toEqual(textures.map((texture) => texture.source.uid));
        expect(readers.mostLive).toBe(1);
        expect(readers.live).toBe(0);
        expect(readers.releases).toBe(1);
        for (const asset of assets) {
            expect(asset.outlinesState).toBe('scanned');
            expect(asset.outlines).toEqual(built);
        }

        // an asset that comes later takes what was read: the page is not read again
        const late = await MarrowAsset.from({ model, atlas: importAtlas(ATLAS_TEXT), textures, outlines: 'auto' });

        await late.optimized;
        expect(late.outlines).toEqual(built);
        expect(readers.reads).toHaveLength(textures.length);
        for (const asset of [...assets, late]) asset.destroy();
    });

    it('still read the page for the others when one asset ends during the scan', async () => {
        const { model } = await importRig('4.2/spineboy-pro.skel');
        const { atlas, pages, textures } = await pixelPages('4.2/spineboy.atlas');
        const first = await MarrowAsset.from({ model, atlas, textures, outlines: 'auto' });
        const second = await MarrowAsset.from({ model, atlas: importAtlas(ATLAS_TEXT), textures, outlines: 'auto' });

        first.destroy();
        await Promise.all([first.optimized, second.optimized]);

        expect(first.outlines).toBeUndefined();
        expect(second.outlines).toEqual(buildAtlasOutlines(atlas, pages));
        expect(readers.reads).toHaveLength(textures.length);
        second.destroy();
    });

    it('do not read a page that nobody waits for any more, and read it for the next asset', async () => {
        const { model } = await importRig('4.2/spineboy-pro.skel');
        const { atlas, textures } = await pixelPages('4.2/spineboy.atlas');
        const only = await MarrowAsset.from({ model, atlas, textures, outlines: 'auto' });

        only.destroy();
        await only.optimized;
        // the slice of the page runs in idle time, and finds no asset
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(readers.reads).toEqual([]);
        expect(readers.live).toBe(0);

        const next = await MarrowAsset.from({ model, atlas, textures, outlines: 'auto' });

        await next.optimized;
        expect(next.outlinesState).toBe('scanned');
        expect(readers.reads).toHaveLength(textures.length);
        next.destroy();
    });

    it('read a page again after its texture got other pixels', async () => {
        const { model } = await importRig('4.2/spineboy-pro.skel');
        const { atlas, textures } = await pixelPages('4.2/spineboy.atlas');
        const asset = await MarrowAsset.from({ model, atlas, textures, outlines: 'auto' });
        const twin = await MarrowAsset.from({ model, atlas: importAtlas(ATLAS_TEXT), textures, outlines: 'auto' });

        await Promise.all([asset.optimized, twin.optimized]);
        expect(readers.reads).toHaveLength(textures.length);
        textures[0]?.source.update();
        expect(asset.outlines).toBeUndefined();
        expect(twin.outlines).toBeUndefined();
        await Promise.all([asset.optimized, twin.optimized]);

        // once for both assets, not once for each
        expect(readers.reads).toHaveLength(textures.length + 1);
        expect(asset.outlinesState).toBe('scanned');
        expect(twin.outlinesState).toBe('scanned');
        asset.destroy();
        twin.destroy();
    });

    it('does not share between two atlases that cut one image in other ways', async () => {
        const { model } = await importRig('4.2/spineboy-pro.skel');
        const { atlas, textures } = await pixelPages('4.2/spineboy.atlas');
        // the same page with every region moved by a pixel
        const moved = importAtlas(ATLAS_TEXT.replace(/bounds: ?(\d+)/g, (_, x: string) => `bounds: ${Number(x) + 1}`));
        const asset = await MarrowAsset.from({ model, atlas, textures, outlines: 'auto' });
        const other = await MarrowAsset.from({ model, atlas: moved, textures, outlines: 'auto' });

        await Promise.all([asset.optimized, other.optimized]);
        expect(readers.reads).toHaveLength(textures.length * 2);
        expect(other.outlines?.regions[0]?.rect.x).toBe((asset.outlines?.regions[0]?.rect.x ?? 0) + 1);
        asset.destroy();
        other.destroy();
    });
});

describe('the outlines of a scan', () => {
    it.each(['4.2/raptor.atlas', '4.2/spineboy-pma.atlas', '4.2/dragon.atlas', '4.1/coin-pma.atlas'])(
        'are those of buildAtlasOutlines for %s, slice by slice',
        async (id) => {
            const { atlas, pages, textures } = await pixelPages(id);
            const scan = scanOutlines(atlas, textures, { budget: 0 });

            expect(await scan.done).toEqual(buildAtlasOutlines(atlas, pages));
        },
    );
});

describe('the slices of a scan', () => {
    /** A page of 64 by 64 pixels that is opaque, with 16 regions of 16 by 16 pixels. */
    function gridPage(): { atlas: ReturnType<typeof importAtlas>; texture: Texture; regions: number } {
        const lines = ['grid.png', 'size: 64, 64'];

        for (let i = 0; i < 16; i++) lines.push(`cell${i}`, `bounds: ${(i % 4) * 16}, ${(i >> 2) * 16}, 16, 16`);
        const resource = new Uint8Array(64 * 64 * 4).fill(255);
        const source = new BufferImageSource({ resource, width: 64, height: 64, format: 'rgba8unorm' });

        return { atlas: importAtlas(`${lines.join('\n')}\n`), texture: new Texture({ source }), regions: 16 };
    }

    /** Runs a scan with idle time that the test hands out, and counts the regions each slice outlined. */
    async function slicesOf(budget: number, cost: number): Promise<number> {
        const { atlas, texture } = gridPage();
        const waiting: (() => void)[] = [];
        let clock = 0;
        let slices = 0;
        const scan = scanOutlines(atlas, [texture], {
            idle: (run) => waiting.push(run),
            budget,
            // every look at the clock costs `cost` milliseconds
            now: () => {
                clock += cost;

                return clock;
            },
        });
        let ended = false;

        void scan.done.then(() => {
            ended = true;
        });
        while (!ended) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            const slice = waiting.shift();

            if (slice !== undefined) {
                slices++;
                slice();
            }
        }
        expect((await scan.done)?.regions).toHaveLength(16);

        return slices;
    }

    it('give the frame back when the time of a slice is used up, not after a whole page', async () => {
        // the clock moves 1 ms per region: a budget of 4 ms holds 4 regions
        expect(await slicesOf(4, 1)).toBe(4);
        // no budget: every region gets a slice of its own
        expect(await slicesOf(0, 1)).toBe(16);
        // time enough: the page is done in the slice that read it
        expect(await slicesOf(1000, 1)).toBe(1);
    });
});
