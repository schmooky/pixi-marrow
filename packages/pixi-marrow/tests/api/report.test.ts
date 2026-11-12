import { afterEach, describe, expect, it } from 'vitest';
import { buildReport } from '../../src/api/report';
import { type MarrowAsset, MarrowSpine, type PerfEntry, type PerfFeature } from '../../src/index';
import { inspectView } from '../../src/render/inspect';
import type { SkeletonView } from '../../src/render/skeleton-view';
import type { CoverSlot } from '../render/cover-rig';
import { coverAsset, filesAsset } from './cover-asset';
import { FRAME, fixtureAsset } from './helpers';

/** The features of a report, in the order of its rows. */
const FEATURES: readonly PerfFeature[] = [
    'renderMode',
    'drawCalls',
    'blend',
    'pages',
    'clipping',
    'tightMesh',
    'occlusion',
    'outlines',
    'darkTint',
    'physics',
    'constraints',
    'bones',
    'slots',
    'vertices',
    'uploads',
    'layout',
];

/** Slots that lie apart, so that none covers another. */
const apart = (slots: readonly CoverSlot[]): CoverSlot[] =>
    slots.map((slot, index) => ({ ...slot, at: [index * 400, 0] }));

/** A skeleton with a slot on the first and one on the ninth page of its atlas. */
const NINE_PAGES = {
    skeleton: JSON.stringify({
        skeleton: { spine: '4.2.0' },
        bones: [{ name: 'root' }],
        slots: [
            { name: 'first', bone: 'root', attachment: 'r0' },
            { name: 'ninth', bone: 'root', attachment: 'r8' },
        ],
        skins: [
            {
                name: 'default',
                attachments: {
                    first: { r0: { width: 8, height: 8 } },
                    ninth: { r8: { width: 8, height: 8 } },
                },
            },
        ],
        animations: {},
    }),
    atlas: Array.from({ length: 9 }, (_, page) => `p${page}.png\nsize: 8, 8\nr${page}\nbounds: 0, 0, 8, 8\n`).join(
        '\n',
    ),
};

describe('the perf report of a display object', () => {
    const made: MarrowSpine[] = [];

    /** A display object in the mesh mode, whose rows these tests read, unless asked otherwise. */
    function create(asset: MarrowAsset, options: ConstructorParameters<typeof MarrowSpine>[1] = {}): MarrowSpine {
        const spine = new MarrowSpine(asset, { renderMode: 'mesh', ...options, autoUpdate: false });

        made.push(spine);

        return spine;
    }

    async function fixture(id: string): Promise<MarrowSpine> {
        return create(await fixtureAsset(id));
    }

    async function row(spine: MarrowSpine, feature: PerfFeature): Promise<PerfEntry> {
        const found = (await spine.perf.report()).find((entry) => entry.feature === feature);

        if (found === undefined) throw new Error(`the report has no row ${feature}`);

        return found;
    }

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    it.each(['4.1/spineboy-pro.skel', '4.2/sack-pro.skel', '4.3/owl-pro.skel'])(
        'has one row per feature for %s, in a fixed order, as plain data',
        async (id) => {
            const spine = await fixture(id);
            const report = await spine.perf.report();

            expect(report.map((entry) => entry.feature)).toEqual(FEATURES);
            expect(JSON.parse(JSON.stringify(report))).toEqual(report);
            for (const entry of report) {
                expect(Object.keys(entry)).toEqual(['feature', 'value', 'reason']);
                expect(entry.value).not.toBe('');
                expect(entry.reason).not.toBe('');
            }
        },
    );

    it('comes from one object that is made when it is first asked for, as a promise of new rows', async () => {
        const spine = await fixture('4.2/coin-pro.skel');
        const { perf } = spine;
        const pending = perf.report();
        const [first, second] = await Promise.all([pending, perf.report()]);

        expect(spine.perf).toBe(perf);
        expect(pending).toBeInstanceOf(Promise);
        expect(second).not.toBe(first);
        expect(second).toEqual(first);
    });

    it('reads the instance when the promise resolves, not when it was asked', async () => {
        const spine = await fixture('4.2/sack-pro.skel');
        const pending = spine.perf.report();

        spine.physics = 'none';
        const rows = await pending;

        expect(rows.find((entry) => entry.feature === 'physics')?.value).toMatch(/mode none$/);
    });

    it('still answers for an instance that was destroyed while the code loaded', async () => {
        const spine = await fixture('4.2/coin-pro.skel');
        const pending = Promise.all([spine.perf.report(), spine.perf.memory()]);

        spine.destroy();
        const [rows, memory] = await pending;

        expect(rows.find((entry) => entry.feature === 'drawCalls')).toMatchObject({
            value: '0',
            reason: 'no slot is visible',
        });
        expect(memory.gpuBuffers).toBe(0);
    });

    describe('draw calls', () => {
        it('are one range for a skeleton with normal and additive slots on one page', async () => {
            const spine = await fixture('4.2/spineboy-pro.skel');

            expect(spine.stats.drawCalls).toBe(1);
            expect(await row(spine, 'drawCalls')).toEqual({
                feature: 'drawCalls',
                value: '1',
                reason: '1 draw range: the visible slots share one blend state and one group of pages',
            });
            expect(await row(spine, 'blend')).toMatchObject({
                value: 'no extra range',
                reason: 'no visible slot blends with multiply or screen',
            });
            expect(await row(spine, 'pages')).toMatchObject({
                value: 'no extra range',
                reason: 'the atlas has 1 page and a draw range samples up to 8',
            });
        });

        it('are none for a skeleton that shows nothing', async () => {
            const spine = create(await coverAsset([{ name: 'clear', shows: 'small', color: 'ffffff00' }]));

            spine.update(FRAME);

            expect(await row(spine, 'drawCalls')).toMatchObject({ value: '0', reason: 'no slot is visible' });
            expect((await row(spine, 'slots')).value).toBe('0 of 1 visible');
            expect(await row(spine, 'uploads')).toMatchObject({ value: 'none', reason: 'no update has drawn a slot' });
        });

        it('name the slots that force a range with multiply or screen', async () => {
            const spine = create(
                await coverAsset(
                    apart([
                        { name: 'body', shows: 'small' },
                        { name: 'glow', shows: 'small', blend: 'screen' },
                        { name: 'arm', shows: 'small' },
                        { name: 'shade', shows: 'small', blend: 'multiply' },
                        { name: 'spark', shows: 'small', blend: 'additive' },
                        { name: 'fx', shows: 'small', blend: 'screen' },
                    ]),
                ),
            );

            spine.update(FRAME);

            // body, glow, arm, shade, spark, fx: additive draws with normal, the others do not
            expect(spine.stats.drawCalls).toBe(6);
            expect(await row(spine, 'drawCalls')).toMatchObject({
                value: '6',
                reason: '6 draw ranges: a range ends where the blend state, the group of 8 pages or the clip changes',
            });
            expect(await row(spine, 'blend')).toMatchObject({
                value: '5 extra ranges',
                reason: 'slot "shade" uses multiply, slots "glow", "fx" use screen',
            });
        });

        it('name a slot that needs a blend state of its own and splits nothing', async () => {
            const lone = create(await coverAsset([{ name: 'glow', shows: 'small', blend: 'screen' }]));
            const pair = create(
                await coverAsset(
                    apart([
                        { name: 'body', shows: 'small' },
                        { name: 'glow', shows: 'small', blend: 'screen' },
                    ]),
                ),
            );

            lone.update(FRAME);
            pair.update(FRAME);

            expect(await row(lone, 'blend')).toMatchObject({
                value: 'no extra range',
                reason: 'slot "glow" uses screen',
            });
            expect(await row(pair, 'blend')).toMatchObject({
                value: '1 extra range',
                reason: 'slot "glow" uses screen',
            });
        });

        it('count the multiply slots of a fixture and name six of them', async () => {
            const spine = await fixture('4.2/celestial-circus-pro.skel');
            const { model } = spine.asset;
            const multiply = model.slots.names.filter((_, slot) => model.slots.blendModes[slot] === 2);
            const blend = await row(spine, 'blend');

            expect(multiply.length).toBeGreaterThan(6);
            expect((await row(spine, 'drawCalls')).value).toBe(String(spine.stats.drawCalls));
            expect(blend.value).toBe(`${spine.stats.drawCalls - 1} extra ranges`);
            expect(blend.reason).toMatch(/^slots "face\/nose", .* and \d+ more use multiply$/);
        });

        it('split where the visible slots use a second group of 8 pages', async () => {
            const spine = create(await filesAsset(NINE_PAGES));

            spine.update(FRAME);

            expect(spine.stats.drawCalls).toBe(2);
            expect(await row(spine, 'pages')).toMatchObject({
                value: '1 extra range',
                reason: 'the atlas has 9 pages and a draw range samples up to 8, and the visible slots use 2 groups of 8',
            });
            expect((await row(spine, 'blend')).value).toBe('no extra range');
        });
    });

    describe('clipping', () => {
        it('is off for a skeleton without a clipping attachment', async () => {
            const spine = await fixture('4.2/sack-pro.skel');

            expect(await row(spine, 'clipping')).toMatchObject({
                value: 'off',
                reason: 'the skeleton has no clipping attachment',
            });
        });

        it('follows the clipping attachment an animation shows', async () => {
            const spine = await fixture('4.2/spineboy-pro.skel');

            expect(await row(spine, 'clipping')).toMatchObject({
                value: 'off',
                reason: 'no clipping attachment is applied at the moment',
            });
            spine.play('portal');
            for (let i = 0; i < 40; i++) spine.update(FRAME);

            expect(spine.stats.clips).toBe(1);
            expect(await row(spine, 'clipping')).toMatchObject({
                value: '1 clip, 2 mask draws',
                reason: 'the clipping attachment of slot "clipping" cuts visible slots: a mask is drawn twice and its slots get draw ranges of their own',
            });
            expect((await row(spine, 'drawCalls')).reason).toMatch(/^2 draw ranges and 2 mask draws: /);
        });

        it('draws no mask for a clip that has no visible slot to cut', async () => {
            const spine = create(
                await coverAsset([
                    { name: 'before', shows: 'small' },
                    { name: 'cut', shows: 'big', as: 'clip' },
                ]),
            );

            spine.update(FRAME);

            expect(await row(spine, 'clipping')).toMatchObject({
                value: '1 clip, 0 mask draws',
                reason: 'no visible slot is cut, so no mask is drawn',
            });
        });
    });

    describe('the pose', () => {
        it('states the physics constraints and the mode they run in', async () => {
            const spine = await fixture('4.2/sack-pro.skel');
            const count = spine.asset.model.constraints.filter((constraint) => constraint.type === 'physics').length;

            expect(await row(spine, 'physics')).toMatchObject({
                value: `${count} constraints, mode update`,
                reason: 'every update advances the physics by the time that passed',
            });
            spine.physics = 'none';
            expect(await row(spine, 'physics')).toMatchObject({
                value: `${count} constraints, mode none`,
                reason: 'mode none leaves the physics out: the bones keep the pose of the animations',
            });
            spine.physics = 'pose';
            expect((await row(spine, 'physics')).reason).toBe(
                'mode pose moves the bones to where the physics is and does not advance it',
            );
            spine.physics = 'reset';
            expect((await row(spine, 'physics')).reason).toBe(
                'mode reset starts the physics from the pose of the animations in every update',
            );
        });

        it('states a reset of the physics that waits for its update', async () => {
            const spine = await fixture('4.3/owl-pro.skel');

            spine.resetPhysics();
            expect((await row(spine, 'physics')).reason).toBe(
                'the next update resets the physics, then mode update returns',
            );
            spine.update(FRAME);
            expect((await row(spine, 'physics')).reason).toBe(
                'every update advances the physics by the time that passed',
            );
        });

        it('has no physics for a skeleton without physics constraints', async () => {
            const spine = await fixture('4.1/owl-pro.skel');

            expect(await row(spine, 'physics')).toMatchObject({
                value: 'off',
                reason: 'the skeleton has no physics constraint',
            });
        });

        it.each([
            ['4.2/spineboy-pro.skel', '7 ik, 8 transform'],
            ['4.2/sack-pro.skel', '4 transform, 20 physics'],
            ['4.2/mix-and-match-pro.skel', '2 ik, 17 transform, 4 path'],
            ['4.3/diamond-pro.skel', '1 slider'],
        ])('counts the constraints of %s by kind: %s', async (id, value) => {
            const spine = await fixture(id);

            expect(await row(spine, 'constraints')).toMatchObject({
                value,
                reason: 'every update solves the active ones in the order of the skeleton. A constraint is active with its bones, and with its skin when it needs one',
            });
        });

        it('has no constraints row to count for a skeleton without constraints', async () => {
            const spine = await fixture('4.2/coin-pro.skel');

            expect(await row(spine, 'constraints')).toMatchObject({
                value: 'none',
                reason: 'the skeleton has no constraint',
            });
        });

        it('counts the bones that are posed, which follows the skin', async () => {
            const spine = await fixture('4.2/mix-and-match-pro.skel');
            const total = spine.asset.model.bones.count;
            const posed = (): number => spine.engine.state.active.reduce((sum, active) => sum + active, 0);
            const before = posed();

            expect(before).toBeLessThan(total);
            expect(await row(spine, 'bones')).toMatchObject({
                value: `${before} of ${total} posed`,
                reason: `${total - before} bones need a skin that is not active`,
            });
            spine.skin = 'full-skins/girl';
            spine.update(FRAME);

            expect(posed()).toBeGreaterThan(before);
            expect((await row(spine, 'bones')).value).toBe(`${posed()} of ${total} posed`);
            expect((await row(spine, 'layout')).value).toBe('2 layouts');
        });

        it('counts every bone and slot of a skeleton that shows all of them', async () => {
            const spine = await fixture('4.2/sack-pro.skel');

            expect(await row(spine, 'bones')).toMatchObject({
                value: '31 of 31 posed',
                reason: 'every bone is posed in every update',
            });
            expect(await row(spine, 'slots')).toMatchObject({
                value: '3 of 3 visible',
                reason: 'every slot shows a region or a mesh',
            });
        });
    });

    describe('the buffers', () => {
        it('state the vertices, the indices and how many of the vertices are visible', async () => {
            const spine = await fixture('4.2/spineboy-pro.skel');
            const { vertices, indices } = spine.stats;
            const entry = await row(spine, 'vertices');

            expect(vertices).toBeGreaterThan(0);
            expect(entry.value).toBe(`${vertices} vertices, ${indices} indices`);
            expect(entry.reason).toMatch(/^\d+ of the vertices are visible\. .* with 16-bit indices$/);
            expect(Number(entry.reason.split(' ')[0])).toBeLessThan(vertices);
            expect((await row(spine, 'slots')).reason).toBe(
                'the others show no region or mesh, are transparent or sit on a bone that is not posed',
            );
        });

        it('state 32-bit indices for a layout with more than 65535 vertices', async () => {
            const spine = await fixture('4.2/coin-pro.skel');
            const view: SkeletonView = Reflect.get(spine, 'skeletonView');
            const { asset, engine } = spine;
            const rows = buildReport({
                model: asset.model,
                atlas: asset.atlas,
                info: asset.info,
                outlines: asset.outlines,
                outlinesState: asset.outlinesState,
                state: engine.state,
                // no fixture is that large
                stats: { ...spine.stats, vertices: 65536 },
                view: inspectView(view),
                physics: 'update',
                resetPending: false,
            });

            expect(rows.find((entry) => entry.feature === 'vertices')).toMatchObject({
                value: `65536 vertices, ${spine.stats.indices} indices`,
                reason: expect.stringMatching(/with 32-bit indices$/),
            });
        });

        it('state the uploads per update that drew, with the totals behind them', async () => {
            const spine = create(await coverAsset(apart([{ name: 'a', shows: 'small' }])));

            for (let i = 0; i < 3; i++) spine.update(FRAME);

            // the update of the constructor and three more. The color is written once
            expect(await row(spine, 'uploads')).toMatchObject({
                value: '1 position, 0.25 color, 0 uv per update',
                reason: '4 position, 1 color and 0 uv uploads in 4 updates that drew, 1 rewrite of the index buffers',
            });
            expect(await row(spine, 'layout')).toMatchObject({ value: '1 layout' });
        });

        it('count the uploads of clip masks and of a sequence', async () => {
            const coin = await fixture('4.2/coin-pro.skel');
            const diamond = await fixture('4.3/diamond-pro.skel');

            coin.update(FRAME);
            diamond.play('idle-rotating', { loop: true });
            for (let i = 0; i < 30; i++) diamond.update(FRAME);

            expect((await row(coin, 'uploads')).reason).toMatch(/, 2 mask uploads$/);
            expect(await row(coin, 'darkTint')).toMatchObject({
                value: 'on',
                reason: 'a slot has a dark color: every vertex carries 4 more bytes',
            });
            expect(diamond.stats.uvUploads).toBeGreaterThan(0);
            expect((await row(diamond, 'uploads')).value).toMatch(/^1 position, [\d.]+ color, 0\.\d+ uv per update$/);
            expect(await row(diamond, 'darkTint')).toMatchObject({ value: 'off', reason: 'no slot has a dark color' });
        });
    });
});
