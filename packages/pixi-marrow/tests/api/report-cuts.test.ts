import { Container, Texture } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { type MarrowAsset, MarrowSpine, type PerfEntry, type PerfFeature } from '../../src/index';
import type { SkeletonView } from '../../src/render/skeleton-view';
import type { CoverSlot } from '../render/cover-rig';
import { outlineOf, PENTAGON, pageTextures, setPolygon } from '../render/cuts';
import { coverAsset, drawWith, fakeRenderer } from './cover-asset';
import { FRAME, fixtureAsset } from './helpers';
import { boyAsset } from './pages';

/** A small slot behind a big one: the small one is covered. */
const BEHIND: readonly CoverSlot[] = [
    { name: 'small', shows: 'small' },
    { name: 'big', shows: 'big' },
];

/** Three regions that lie apart: one gets a polygon, one shows no pixel, one keeps its quad. */
const SHAPES: readonly CoverSlot[] = [
    { name: 'shape', shows: 'small', at: [300, 0] },
    { name: 'clear', shows: 'mid', at: [0, 300] },
    { name: 'quad', shows: 'big', at: [600, 0] },
];

const STAYS = 'Both cuts stay off for this instance';

describe('the rows of the perf report about the cuts of overdraw', () => {
    const made: MarrowSpine[] = [];
    const assets: MarrowAsset[] = [];

    /** A display object in the mesh mode, whose rows these tests read, unless asked otherwise. */
    function create(asset: MarrowAsset, options: ConstructorParameters<typeof MarrowSpine>[1] = {}): MarrowSpine {
        const spine = new MarrowSpine(asset, { renderMode: 'mesh', ...options, autoUpdate: false });

        made.push(spine);
        assets.push(asset);

        return spine;
    }

    async function row(spine: MarrowSpine, feature: PerfFeature): Promise<PerfEntry> {
        const found = (await spine.perf.report()).find((entry) => entry.feature === feature);

        if (found === undefined) throw new Error(`the report has no row ${feature}`);

        return found;
    }

    /** The values and reasons of the three rows. */
    const cuts = async (spine: MarrowSpine): Promise<Record<string, string>[]> => {
        const rows = await spine.perf.report();

        return rows
            .filter(({ feature }) => ['tightMesh', 'occlusion', 'outlines'].includes(feature))
            .map(({ value, reason }) => ({ value, reason }));
    };

    /** An asset whose small region has a polygon and whose middle region shows no pixel. */
    const shapesAsset = (): Promise<MarrowAsset> =>
        coverAsset(SHAPES, {
            fill: (outlines) => {
                setPolygon(outlines, 'small', PENTAGON);
                setPolygon(outlines, 'mid', []);
                // a region without a visible pixel has no opaque part
                outlineOf(outlines, 'mid').opaque = null;
            },
        });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        for (const asset of assets.splice(0)) asset.destroy();
    });

    describe('without outlines', () => {
        it('are off for an asset that was loaded with outlines off', async () => {
            const spine = create(await coverAsset(BEHIND, { outlines: 'off' }), { tightMesh: 'on' });
            const reason = 'the asset was loaded with outlines "off"';

            spine.update(FRAME);

            expect(spine.asset.outlinesState).toBe('off');
            expect(await cuts(spine)).toEqual([
                { value: 'off', reason },
                { value: 'off', reason },
                { value: 'off', reason },
            ]);
        });

        it('are off while the page images are read, then follow the scan', async () => {
            const { asset } = await boyAsset();
            const spine = create(asset);
            const regions = asset.atlas.regionNames.length;

            expect(asset.outlinesState).toBe('scanning');
            expect(await cuts(spine)).toEqual([
                { value: 'off', reason: 'the page images are still being read for outlines' },
                { value: 'off', reason: 'the page images are still being read for outlines' },
                { value: 'scanning', reason: 'the page images are being read in idle time' },
            ]);
            await asset.optimized;

            // the scan has ended and the view has not been updated since
            expect(asset.outlinesState).toBe('scanned');
            expect(await row(spine, 'tightMesh')).toMatchObject({
                value: 'off',
                reason: 'the view takes the outlines of the asset with its next update',
            });
            expect(await row(spine, 'outlines')).toMatchObject({
                value: 'scanned',
                reason: `read from the page images after the load: ${regions} of ${regions} regions have an outline`,
            });
            spine.update(FRAME);

            expect(await row(spine, 'tightMesh')).toMatchObject({
                value: 'auto',
                reason: 'the option tightMesh is "auto": regions keep their quads',
            });
            expect((await row(spine, 'occlusion')).value).toMatch(/^\d+ covered slots?$/);
        });

        it('say that a scan could read no page, and why', async () => {
            const asset = await fixtureAsset('4.2/spineboy-pro.skel');
            const spine = create(asset);

            await asset.optimized;
            spine.update(FRAME);

            expect(asset.outlinesState).toBe('unread');
            expect(await cuts(spine)).toEqual([
                { value: 'off', reason: 'the scan could read no page image' },
                { value: 'off', reason: 'the scan could read no page image' },
                {
                    value: 'unread',
                    reason: 'the scan could read no page image, so every region keeps its quad. page "spineboy.png" keeps its quads: its texture has another pixel size than the atlas states',
                },
            ]);
        });
    });

    describe('tightMesh', () => {
        it('is off with the option off, and occlusion with its own', async () => {
            const spine = create(await shapesAsset(), { tightMesh: 'off', occlusion: 'off' });

            spine.update(FRAME);

            expect(await cuts(spine)).toEqual([
                { value: 'off', reason: 'the option tightMesh is "off": every region is a quad' },
                { value: 'off', reason: 'the option occlusion is "off": every slot is drawn' },
                {
                    value: 'given',
                    reason: 'the load got them, as a file or as an object: 5 of 5 regions have an outline',
                },
            ]);
        });

        it('keeps quads by default and leaves out a region without a visible pixel', async () => {
            const spine = create(await shapesAsset());

            spine.update(FRAME);

            expect(await row(spine, 'tightMesh')).toEqual({
                feature: 'tightMesh',
                value: 'auto',
                reason: 'the option tightMesh is "auto": regions keep their quads. 1 visible region without a visible pixel has no vertex',
            });
        });

        it('counts the polygons when it is on', async () => {
            const spine = create(await shapesAsset(), { tightMesh: 'on' });

            spine.update(FRAME);

            expect(spine.stats.tightRanges).toBe(2);
            expect(await row(spine, 'tightMesh')).toEqual({
                feature: 'tightMesh',
                value: 'on',
                reason: '1 of 3 visible regions are polygons. 1 visible region without a visible pixel has no vertex',
            });
        });

        it('names a page whose texture keeps the quads, once the view has seen it', async () => {
            const textures: Texture[] = [];
            const asset = await coverAsset(SHAPES, {
                fill: (outlines) => setPolygon(outlines, 'small', PENTAGON),
                textures: (atlas) => {
                    textures.push(...pageTextures(atlas));

                    return textures;
                },
            });
            const spine = create(asset, { tightMesh: 'on' });
            const [page] = textures;

            if (page === undefined) throw new Error('the atlas has a page');
            spine.update(FRAME);
            expect((await row(spine, 'tightMesh')).reason).toBe('1 of 3 visible regions are polygons');
            page.source.autoGenerateMipmaps = true;
            // a view looks at its page textures in one update of 64
            for (let i = 0; i < 64; i++) spine.update(FRAME);

            expect(await row(spine, 'tightMesh')).toMatchObject({
                value: 'on',
                reason: '0 of 3 visible regions are polygons. page "cover.png" keeps its quads: its texture has mipmaps',
            });
            expect(await row(spine, 'occlusion')).toMatchObject({
                value: '0 covered slots',
                reason: 'no attachment of the layout has an opaque rectangle. page "cover.png" keeps its quads: its texture has mipmaps',
            });
        });

        it('is off for outlines whose margins are too small for bilinear filtering', async () => {
            const asset = await coverAsset(SHAPES, {
                fill: (outlines) => {
                    setPolygon(outlines, 'small', PENTAGON);
                    outlines.margin = 0.25;
                    outlines.opaqueMargin = 0.25;
                },
            });
            const spine = create(asset, { tightMesh: 'on' });

            spine.update(FRAME);

            expect((await cuts(spine)).slice(0, 2)).toEqual([
                {
                    value: 'off',
                    reason: 'the margin of the outlines is below the 0.5 pixels that bilinear filtering needs',
                },
                {
                    value: 'off',
                    reason: 'the margin of the opaque rectangles is below the 0.5 pixels that bilinear filtering needs',
                },
            ]);
        });

        it.each([
            [fakeRenderer(true, false), `the renderer rounds positions to pixels (roundPixels). ${STAYS}`],
            [fakeRenderer(false, true), `the skeleton was drawn to a multisampled target. ${STAYS}`],
        ])('is off for good after a draw that moves edges inside a pixel, and says which', async (renderer, reason) => {
            const spine = create(await shapesAsset(), { tightMesh: 'on' });

            spine.update(FRAME);
            drawWith(spine, fakeRenderer(false, false));
            expect((await row(spine, 'tightMesh')).value).toBe('on');
            drawWith(spine, renderer);
            spine.update(FRAME);

            expect((await cuts(spine)).slice(0, 2)).toEqual([
                { value: 'off', reason },
                { value: 'off', reason },
            ]);
            expect(spine.stats.tightRanges).toBe(0);
        });
    });

    describe('occlusion', () => {
        it('names the slots that an opaque slot covers', async () => {
            const spine = create(await coverAsset(BEHIND));

            for (let i = 0; i < 70 && spine.stats.coveredSlots === 0; i++) spine.update(FRAME);

            expect(spine.stats.coveredSlots).toBe(1);
            expect(await row(spine, 'occlusion')).toEqual({
                feature: 'occlusion',
                value: '1 covered slot',
                reason: 'slot "small" lies behind the opaque part of a later slot and adds no index. The layout has 2 opaque rectangles',
            });
        });

        it('names two covered slots', async () => {
            const spine = create(await coverAsset([{ name: 'tiny', shows: 'small', at: [20, 20] }, ...BEHIND]));

            for (let i = 0; i < 70 && spine.stats.coveredSlots < 2; i++) spine.update(FRAME);

            expect(await row(spine, 'occlusion')).toMatchObject({
                value: '2 covered slots',
                reason: 'slots "tiny", "small" lie behind the opaque part of a later slot and add no index. The layout has 3 opaque rectangles',
            });
        });

        it('finds nothing when no slot lies behind another', async () => {
            const spine = create(await shapesAsset());

            for (let i = 0; i < 10; i++) spine.update(FRAME);

            expect(await row(spine, 'occlusion')).toMatchObject({
                value: '0 covered slots',
                reason: 'the test found no visible slot behind the opaque part of a later slot. The layout has 2 opaque rectangles',
            });
        });

        it('has nothing to test with when no region has an opaque rectangle', async () => {
            const asset = await coverAsset(BEHIND, {
                fill: (outlines) => {
                    for (const region of outlines.regions) if (region !== null) region.opaque = null;
                },
            });
            const spine = create(asset);

            spine.update(FRAME);

            expect(await row(spine, 'occlusion')).toMatchObject({
                value: '0 covered slots',
                reason: 'no attachment of the layout has an opaque rectangle',
            });
        });

        it('covers nothing while an ancestor fades the skeleton', async () => {
            const spine = create(await coverAsset(BEHIND));
            const stage = new Container();

            stage.addChild(spine);
            stage.alpha = 0.5;
            for (let i = 0; i < 10; i++) spine.update(FRAME);

            expect(await row(spine, 'occlusion')).toMatchObject({
                value: '0 covered slots',
                reason: 'an ancestor has an alpha below 1 or a blend mode of its own, so an opaque slot shows what is behind it',
            });
            stage.removeChild(spine);
        });

        it('is off after a draw that moves edges and does not say what the draw did', async () => {
            const spine = create(await coverAsset(BEHIND));

            // a caller of the view that only says that edges move
            const view: SkeletonView = Reflect.get(spine, 'skeletonView');

            spine.update(FRAME);
            view.beforeDraw(true);

            expect(await row(spine, 'occlusion')).toMatchObject({
                value: 'off',
                reason: `a draw moved edges inside a pixel. ${STAYS}`,
            });
        });
    });

    it('state where the outlines of an asset stand, for every state', async () => {
        const given = await coverAsset(BEHIND);
        const off = await coverAsset(BEHIND, { outlines: 'off' });
        const unread = await fixtureAsset('4.1/coin-pro.skel');
        const { asset: scanned } = await boyAsset();

        assets.push(given, off, scanned);
        expect(scanned.outlinesState).toBe('scanning');
        await Promise.all([scanned.optimized, unread.optimized]);

        expect([given, off, unread, scanned].map((asset) => asset.outlinesState)).toEqual([
            'given',
            'off',
            'unread',
            'scanned',
        ]);
        expect(Texture.WHITE.source.pixelWidth).toBe(1);
    });
});
