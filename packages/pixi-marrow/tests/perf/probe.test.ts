import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type MarrowAsset, MarrowError, MarrowSpine } from '../../src/index';
import { createProbe, type PerfProbe } from '../../src/perf';
import { touchPose } from '../../src/pose/state';
import { coverAsset } from '../api/cover-asset';
import { FRAME, fixtureAsset, poseOf } from '../api/helpers';
import type { CoverSlot } from '../render/cover-rig';

/** Two small slots that lie apart, so that neither covers the other. */
const APART: readonly CoverSlot[] = [
    { name: 'left', shows: 'small', at: [0, 0] },
    { name: 'right', shows: 'small', at: [400, 0] },
];

/** Makes `performance.now` answer with the given times, one per call. */
function clock(times: readonly number[]): { calls: () => number } {
    let at = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => times[at++] ?? Number.NaN);

    return { calls: () => now.mock.calls.length };
}

function thrownBy(run: () => unknown): MarrowError {
    try {
        run();
    } catch (error) {
        if (error instanceof MarrowError) return error;
        throw error;
    }
    throw new Error('nothing was thrown');
}

/** The uploads the view of a display object has made so far, as the probe counts them. */
function uploads(spine: MarrowSpine): number {
    const { positionUploads, colorUploads, uvUploads, maskUploads, maskRebuilds } = spine.stats;

    return positionUploads + colorUploads + uvUploads + maskUploads + maskRebuilds;
}

describe('a perf probe', () => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];

    function create(from: MarrowAsset = asset): MarrowSpine {
        const spine = new MarrowSpine(from, { autoUpdate: false });

        made.push(spine);

        return spine;
    }

    beforeAll(async () => {
        asset = await coverAsset(APART);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.restoreAllMocks();
    });

    it('is attached to the display object it was created for, and to no other', () => {
        const spine = create();
        const other = create();
        const probe = createProbe(spine);

        expect(spine.updateProbe).toBe(probe);
        expect(other.updateProbe).toBeNull();
        expect(probe.attached).toBe(true);
        expect(probe.read()).toEqual({
            updates: 0,
            update: { total: 0, mean: 0, worst: 0 },
            pose: { total: 0, mean: 0, worst: 0 },
            geometry: { total: 0, mean: 0, worst: 0 },
            events: { total: 0, mean: 0, worst: 0 },
            counters: {
                drawCalls: 0,
                vertices: 0,
                uploads: 0,
                rangesRebuilt: 0,
                clips: 0,
                coveredSlots: 0,
                skippedUpdates: 0,
                placedSlots: 0,
            },
        });
    });

    it('sorts the time of every update into pose, geometry and events', () => {
        const spine = create();
        const probe = createProbe(spine);
        // per update: the start, after the engine, after the events were matched, after the view, the end
        const time = clock([0, 3, 4, 9, 11, 20, 21, 21.5, 23.5, 24]);

        spine.update(FRAME);
        spine.update(FRAME);

        expect(time.calls()).toBe(10);
        expect(probe.read()).toMatchObject({
            updates: 2,
            pose: { total: 4, mean: 2, worst: 3 },
            geometry: { total: 7, mean: 3.5, worst: 5 },
            // matching the events and emitting them: 1 and 2, then 0.5 and 0.5
            events: { total: 4, mean: 2, worst: 3 },
            update: { total: 15, mean: 7.5, worst: 11 },
        });
    });

    it('measures the engine, the view and the listeners where they run', () => {
        const spine = create();
        const probe = createProbe(spine);
        const order: string[] = [];
        const update = spine.engine.update.bind(spine.engine);
        let now = 0;

        vi.spyOn(performance, 'now').mockImplementation(() => now);
        // each part moves the clock by its own amount
        vi.spyOn(spine.engine, 'update').mockImplementation((seconds) => {
            update(seconds);
            now += 5;
        });
        vi.spyOn(spine.engine, 'takeEvents').mockImplementation(() => {
            now += 1;

            return [];
        });
        vi.spyOn(Reflect.get(spine, 'skeletonView'), 'update').mockImplementation(() => {
            now += 7;
        });
        vi.spyOn(probe, 'record').mockImplementation((...times) => order.push(times.join(' ')));

        spine.update(FRAME);

        expect(order).toEqual(['5 7 1']);
    });

    it('records after the listeners of the update have run', async () => {
        const spine = create(await fixtureAsset('4.2/spineboy-pro.skel'));
        const probe = createProbe(spine);
        const order: string[] = [];
        const record = probe.record.bind(probe);

        spine.on('start', () => order.push('listener'));
        vi.spyOn(probe, 'record').mockImplementation((pose, geometry, events) => {
            order.push('record');
            record(pose, geometry, events);
        });
        spine.play('walk');
        spine.update(FRAME);

        expect(order).toEqual(['listener', 'record']);
        expect(probe.read().updates).toBe(1);
        expect(probe.read().update.total).toBeGreaterThan(0);
    });

    it('adds up what the view did in every update', () => {
        const spine = create();
        const probe = createProbe(spine);
        const before = { ...spine.stats };

        // a pose that is marked as changed: the view places the two quads again, as it does while it plays
        for (let i = 0; i < 3; i++) {
            touchPose(spine.engine.state);
            spine.update(FRAME);
        }
        expect(spine.stats.positionUploads - before.positionUploads).toBe(3);
        // one range of two quads: the positions upload in every update, nothing else changes
        expect(probe.read().counters).toEqual({
            drawCalls: 3,
            vertices: 24,
            uploads: 3,
            rangesRebuilt: 0,
            clips: 0,
            coveredSlots: 0,
            skippedUpdates: 0,
            placedSlots: 6,
        });
    });

    it('counts the updates in which the view found nothing to do', () => {
        const spine = create();
        const probe = createProbe(spine);
        const before = { ...spine.stats };

        // Nothing plays. An engine that knows so leaves the pose alone, and the view skips. One
        // that marks every pose as changed makes the view place the two quads again
        for (let i = 0; i < 3; i++) spine.update(FRAME);
        const worked = spine.stats.positionUploads - before.positionUploads;
        const skipped = spine.stats.skips - before.skips;
        const { counters } = probe.read();

        expect(worked + skipped).toBeLessThanOrEqual(3);
        expect(counters).toMatchObject({ uploads: worked, skippedUpdates: skipped, placedSlots: worked * 2 });
        expect(counters.vertices).toBe(worked * 8);
    });

    it('counts like the counters of the view while a fixture with a clip plays', async () => {
        const spine = create(await fixtureAsset('4.2/spineboy-pro.skel'));

        spine.play('portal');
        spine.update(FRAME);
        const probe = createProbe(spine);
        const before = { uploads: uploads(spine), rebuilds: spine.stats.indexRebuilds };
        const sums = { drawCalls: 0, vertices: 0, clips: 0, coveredSlots: 0, skippedUpdates: 0, placedSlots: 0 };

        for (let i = 0; i < 60; i++) {
            const { skips, positionUploads } = spine.stats;

            spine.update(FRAME);
            sums.drawCalls += spine.stats.drawCalls;
            if (spine.stats.positionUploads !== positionUploads) sums.vertices += spine.stats.vertices;
            sums.clips += spine.stats.clips;
            sums.coveredSlots += spine.stats.coveredSlots;
            if (spine.stats.skips !== skips) sums.skippedUpdates++;
            else sums.placedSlots += spine.stats.placedSlots;
        }
        const { counters, updates } = probe.read();

        expect(updates).toBe(60);
        expect(counters).toEqual({
            ...sums,
            uploads: uploads(spine) - before.uploads,
            rangesRebuilt: spine.stats.indexRebuilds - before.rebuilds,
        });
        expect(counters.clips).toBeGreaterThan(0);
        expect(counters.rangesRebuilt).toBeGreaterThan(0);
        expect(counters.uploads).toBeGreaterThan(60);
    });

    it('counts no vertices for an update that uploads no positions', async () => {
        const spine = create(await coverAsset([{ name: 'clear', shows: 'small', color: 'ffffff00' }]));
        const probe = createProbe(spine);

        spine.update(FRAME);

        expect(probe.read()).toMatchObject({ updates: 1, counters: { vertices: 0, uploads: 0, drawCalls: 0 } });
    });

    it('forgets what it measured with reset, and measures on', () => {
        const spine = create();
        const probe = createProbe(spine);

        clock([0, 1, 2, 3, 4, 10, 12, 14, 16, 18]);
        spine.update(FRAME);
        probe.reset();

        expect(probe.read()).toMatchObject({ updates: 0, update: { total: 0, mean: 0, worst: 0 } });
        expect(probe.read().counters.uploads).toBe(0);
        touchPose(spine.engine.state);
        spine.update(FRAME);

        expect(probe.read()).toMatchObject({
            updates: 1,
            pose: { total: 2, worst: 2 },
            geometry: { total: 2 },
            events: { total: 4 },
            counters: { uploads: 1, drawCalls: 1 },
        });
        expect(probe.attached).toBe(true);
    });

    it('detaches with stop and keeps what it measured', () => {
        const spine = create();
        const probe = createProbe(spine);

        spine.update(FRAME);
        const reading = probe.read();

        probe.stop();
        probe.stop();
        spine.update(FRAME);
        probe.record(1, 2, 3);
        probe.reset();

        expect(spine.updateProbe).toBeNull();
        expect(probe.attached).toBe(false);
        expect(reading.updates).toBe(1);
        expect(probe.read()).toMatchObject({ updates: 0, counters: { uploads: 0 } });
    });

    it('leaves another probe alone that took its place', () => {
        const spine = create();
        const probe = createProbe(spine);
        const mine = { record: vi.fn() };

        spine.updateProbe = mine;
        probe.stop();
        spine.update(FRAME);

        expect(spine.updateProbe).toBe(mine);
        expect(mine.record).toHaveBeenCalledOnce();
        expect(probe.read().updates).toBe(0);
    });

    it('can follow a probe that was stopped', () => {
        const spine = create();
        const first: PerfProbe = createProbe(spine);

        first.stop();
        const second = createProbe(spine);

        spine.update(FRAME);

        expect(first.read().updates).toBe(0);
        expect(second.read().updates).toBe(1);
    });

    it('throws for a display object that has a probe, and for one that was destroyed', () => {
        const spine = create();
        const gone = create();

        createProbe(spine);
        gone.destroy();
        const twice = thrownBy(() => createProbe(spine));
        const late = thrownBy(() => createProbe(gone));

        expect(twice.code).toBe('invalid-data');
        expect(twice.message).toContain('The display object has a probe that measures its updates.');
        expect(twice.fix).toBe('Call stop() on that probe first, or read that one.');
        expect(late.code).toBe('invalid-data');
        expect(late.message).toContain('The display object was destroyed and updates no more.');
        expect(gone.updateProbe).toBeNull();
    });

    it('changes nothing in what the display object does', async () => {
        const boy = await fixtureAsset('4.3/spineboy-pro.skel');
        const plain = create(boy);
        const probed = create(boy);
        const heard = { plain: [] as string[], probed: [] as string[] };

        createProbe(probed);
        for (const [spine, list] of [
            [plain, heard.plain],
            [probed, heard.probed],
        ] as const) {
            for (const type of ['start', 'interrupt', 'end', 'complete', 'event'] as const) {
                spine.on(type, () => list.push(type));
            }
            spine.play('walk', { loop: true });
            spine.resetPhysics();
            spine.queue('run', { mix: 0.2, delay: 0.3 });
            for (let i = 0; i < 60; i++) spine.update(FRAME);
        }

        expect(poseOf(probed.engine)).toEqual(poseOf(plain.engine));
        expect(heard.probed).toEqual(heard.plain);
        expect(heard.plain.length).toBeGreaterThan(3);
        expect(probed.stats).toEqual(plain.stats);
        expect(probed.physics).toBe('update');
    });
});
