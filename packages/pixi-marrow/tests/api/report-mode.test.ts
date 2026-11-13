import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type MarrowAsset, MarrowError, MarrowSpine, type PerfEntry, type PerfFeature } from '../../src/index';
import { touchPose } from '../../src/pose/state';
import { loadMeshCode } from '../../src/render/mesh-code';
import { AUTO_BATCH_VERTICES } from '../../src/render/mode';
import { createStage } from '../render/batch-stage';
import type { CoverSlot } from '../render/cover-rig';
import { coverAsset } from './cover-asset';
import { FRAME, fixtureAsset } from './helpers';

/** Slots that lie apart, so that none covers another. */
const apart = (slots: readonly CoverSlot[]): CoverSlot[] =>
    slots.map((slot, index) => ({ ...slot, at: [index * 400, 0] }));

describe('the render mode of a display object', () => {
    const made: MarrowSpine[] = [];

    function create(asset: MarrowAsset, options: ConstructorParameters<typeof MarrowSpine>[1] = {}): MarrowSpine {
        const spine = new MarrowSpine(asset, { ...options, autoUpdate: false });

        made.push(spine);

        return spine;
    }

    async function row(spine: MarrowSpine, feature: PerfFeature): Promise<PerfEntry> {
        const found = (await spine.perf.report()).find((entry) => entry.feature === feature);

        if (found === undefined) throw new Error(`the report has no row ${feature}`);

        return found;
    }

    // the code of the mesh mode is there, as after an asset that asked for it. `mesh-code.test.ts` is about the time before
    beforeAll(async () => {
        await loadMeshCode();
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    it('is the option of the display object, auto unless it says otherwise', async () => {
        const asset = await fixtureAsset('4.2/speedy-ess.skel');
        const auto = create(asset);
        const mesh = create(asset, { renderMode: 'mesh' });
        const batched = create(asset, { renderMode: 'batched' });

        expect([auto.renderMode, mesh.renderMode, batched.renderMode]).toEqual(['auto', 'mesh', 'batched']);
        expect([auto.stats.renderMode, mesh.stats.renderMode, batched.stats.renderMode]).toEqual([
            AUTO_BATCH_VERTICES >= 44 ? 'batched' : 'mesh',
            'mesh',
            'batched',
        ]);
        // the display object holds what its mode draws with: one object, or one mesh
        expect(batched.children[0]?.children.map((child) => child.label)).toEqual(['marrow-batch']);
        expect(mesh.children[0]?.children.map((child) => child.label)).toEqual(['marrow-range']);
    });

    it('changes with the property, from the next update on', async () => {
        const spine = create(await fixtureAsset('4.2/speedy-ess.skel'), { renderMode: 'mesh' });

        spine.renderMode = 'batched';
        expect(spine.renderMode).toBe('batched');
        expect(spine.stats.renderMode).toBe('mesh');
        spine.update(FRAME);
        expect(spine.stats.renderMode).toBe('batched');
        expect(await row(spine, 'renderMode')).toMatchObject({ value: 'batched' });
        spine.renderMode = 'auto';
        expect(spine.renderMode).toBe('auto');
    });

    it('refuses a value that is no mode, as an option and as a property, and lists the modes', async () => {
        const asset = await fixtureAsset('4.2/speedy-ess.skel');
        const spine = create(asset);
        const wrong = [
            (): unknown => new MarrowSpine(asset, { autoUpdate: false, renderMode: 'batch' as never }),
            (): unknown => Reflect.set(spine, 'renderMode', 'meshes'),
        ];

        for (const run of wrong) {
            let error: unknown;

            try {
                run();
            } catch (caught) {
                error = caught;
            }
            expect(error).toBeInstanceOf(MarrowError);
            expect(error).toMatchObject({ code: 'invalid-data', validNames: ['auto', 'mesh', 'batched'] });
        }
        expect(spine.renderMode).toBe('auto');
    });

    it('is the first row of the report, with the reason for the mode', async () => {
        const small = await fixtureAsset('4.2/speedy-ess.skel');
        const large = await fixtureAsset('4.2/raptor-pro.skel');
        const clipped = await coverAsset([
            { name: 'cut', shows: 'big', as: 'clip' },
            { name: 'small', shows: 'small' },
        ]);
        const shares = 'It shares draw calls with the skeletons next to it, and the CPU places its vertices';
        const owns = 'It has draw calls of its own, and the GPU places its vertices';
        const cases: [MarrowSpine, string, string][] = [
            [create(small, { renderMode: 'batched' }), 'batched', `the option renderMode is "batched". ${shares}`],
            [create(small, { renderMode: 'mesh' }), 'mesh', `the option renderMode is "mesh". ${owns}`],
            [
                create(small, { renderMode: 'mesh', skinning: 'gpu' }),
                'mesh',
                'the option renderMode is "mesh". It has draw calls of its own, and its vertex shader places the vertices from the bones, except where they deform',
            ],
            // a clip changes nothing: an asset with a clipping attachment loads the code that clips in a batch
            [create(clipped, { renderMode: 'batched' }), 'batched', `the option renderMode is "batched". ${shares}`],
        ];
        const auto = create(small);
        const autoLarge = create(large);
        const autoClipped = create(clipped);

        autoClipped.update(FRAME);
        expect(await row(autoClipped, 'renderMode')).toEqual({
            feature: 'renderMode',
            value: 'batched',
            reason: `the option renderMode is "auto": the skeleton has 4 vertices in a batch, which is at most ${AUTO_BATCH_VERTICES}. ${shares}`,
        });
        expect(autoClipped.stats).toMatchObject({ clips: 1, maskDraws: 0, drawCalls: 1 });
        expect(await row(autoClipped, 'clipping')).toEqual({
            feature: 'clipping',
            value: '1 clip, cut on the CPU',
            reason: 'the clipping attachment of slot "cut" cuts visible slots: their triangles are cut as the official runtime cuts them and stay in the batch, which keeps room for 0 vertices and 0 indices of cut triangles',
        });

        for (const [spine, value, reason] of cases) {
            spine.update(FRAME);
            expect((await spine.perf.report())[0]).toEqual({ feature: 'renderMode', value, reason });
            expect(spine.stats.renderMode).toBe(value);
        }
        // auto says which side of its limit the skeleton is on
        for (const [spine, vertices] of [
            [auto, 44],
            [autoLarge, 667],
        ] as const) {
            const batched = vertices <= AUTO_BATCH_VERTICES;
            const side = batched ? 'at most' : 'more than';

            expect(await row(spine, 'renderMode')).toEqual({
                feature: 'renderMode',
                value: batched ? 'batched' : 'mesh',
                reason: `the option renderMode is "auto": the skeleton has ${vertices} vertices in a batch, which is ${side} ${AUTO_BATCH_VERTICES}. ${batched ? shares : owns}`,
            });
        }
    });

    it('counts the batches a skeleton draws in, and how many skeletons share the first one', async () => {
        const stage = createStage();
        const asset = await fixtureAsset('4.2/speedy-ess.skel');
        const spines = [0, 1, 2].map(() => create(asset, { renderMode: 'batched' }));
        const [spine] = spines;

        if (spine === undefined) throw new Error('no spine');
        expect(await row(spine, 'drawCalls')).toEqual({
            feature: 'drawCalls',
            value: '1 shared',
            reason: 'Pixi has not built the instructions of the render group with the skeleton yet',
        });
        for (const item of spines) stage.root.addChild(item);
        stage.render();
        expect(stage.counts.draws).toHaveLength(1);
        expect(await row(spine, 'drawCalls')).toEqual({
            feature: 'drawCalls',
            value: '1 shared',
            reason: '1 batch of the render group, shared with 2 other skeletons: the visible slots share one blend state and one group of pages',
        });
        // 44 vertices with 28 bytes each, and 66 indices with one triangle without area
        expect(await row(spine, 'vertices')).toEqual({
            feature: 'vertices',
            value: '108 vertices, 66 indices',
            reason: '44 of the vertices are visible. The batch holds the largest attachment of every slot, 1370 bytes for this skeleton',
        });
        expect((await spine.perf.memory()).gpuBuffers).toBe(44 * 28 + 69 * 2);
    });

    it('counts a batch per run for a skeleton that multiplies or screens', async () => {
        const stage = createStage();
        const asset = await coverAsset(
            apart([
                { name: 'body', shows: 'small' },
                { name: 'glow', shows: 'small', blend: 'screen' },
                { name: 'spark', shows: 'small', blend: 'additive' },
            ]),
        );
        const spines = [0, 1].map(() => create(asset, { renderMode: 'batched' }));
        const [spine] = spines;

        if (spine === undefined) throw new Error('no spine');
        for (const item of spines) {
            item.update(FRAME);
            stage.root.addChild(item);
        }
        stage.render();
        // body, glow, spark: additive draws with normal. The second skeleton starts in the batch of the first spark
        expect(stage.counts.draws.map((draw) => draw.blendMode)).toEqual([
            'normal',
            'screen',
            'normal',
            'screen',
            'normal',
        ]);
        expect(spine.stats.drawCalls).toBe(3);
        expect(await row(spine, 'drawCalls')).toEqual({
            feature: 'drawCalls',
            value: '3 shared',
            reason: '3 batches of the render group: a batch ends where the blend state or the group of 16 pages changes. The first one is shared with 0 other skeletons',
        });
        expect(await row(spine, 'blend')).toMatchObject({ value: '2 extra ranges', reason: 'slot "glow" uses screen' });
    });

    it('says that a batch samples 16 pages, and that a renderer with a lower limit gets meshes', async () => {
        const many = create(await fixtureAsset('4.2/chibi-stickers.skel'), { renderMode: 'batched' });
        const stage = createStage({ maxTextures: 2 });
        const dragon = create(await fixtureAsset('4.2/dragon-ess.skel'), { renderMode: 'batched' });
        const pages = many.asset.atlas.pages.length;

        many.update(FRAME);
        expect(pages).toBeGreaterThan(8);
        expect(await row(many, 'renderMode')).toMatchObject({ value: 'batched' });
        expect(await row(many, 'pages')).toEqual({
            feature: 'pages',
            value: 'no extra range',
            reason: `the atlas has ${pages} pages and a batch samples up to 16`,
        });
        stage.root.addChild(dragon);
        stage.render();
        expect(await row(dragon, 'renderMode')).toEqual({
            feature: 'renderMode',
            value: 'mesh',
            reason: 'the option renderMode is "batched", and a batch of the renderer samples fewer textures than the skeleton has atlas pages. It has draw calls of its own, and the GPU places its vertices',
        });
        expect((await row(dragon, 'pages')).reason).toBe(
            `the atlas has ${dragon.asset.atlas.pages.length} pages and a draw range samples up to 8`,
        );
    });

    it('is in no batch while it shows nothing', async () => {
        const stage = createStage();
        const spine = create(await coverAsset([{ name: 'clear', shows: 'small', color: 'ffffff00' }]), {
            renderMode: 'batched',
        });

        stage.root.addChild(spine);
        spine.update(FRAME);
        stage.render();
        expect(stage.counts.draws).toEqual([]);
        expect(spine.stats).toMatchObject({ renderMode: 'batched', drawCalls: 0, indices: 0 });
        expect(await row(spine, 'drawCalls')).toMatchObject({ value: '0', reason: 'no slot is visible' });
        expect((await row(spine, 'slots')).value).toBe('0 of 1 visible');
        // the slot fades in: the skeleton joins the batch with the next build
        spine.engine.state.colors[3] = 1;
        touchPose(spine.engine.state);
        spine.update(FRAME);
        stage.render();
        expect(stage.counts.draws).toHaveLength(1);
        expect(spine.stats.drawCalls).toBe(1);
    });
});
