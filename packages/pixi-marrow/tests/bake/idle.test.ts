import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addBakedClips, bakeAnimation, encodeBakedClips } from '../../src/bake';
import { type BakeHost, playBaked } from '../../src/bake/playback';
import { bakesOf } from '../../src/bake/store';
import { importSkeleton, loadPoseEngine, type PoseEngineFactory, type SkeletonModel } from '../../src/core';
import { combineSkins, KEPT_SKINS } from '../../src/pose/shared/combine-skins';
import { createAttachmentLookup } from '../../src/pose/shared/lookup';
import { fixtureFiles } from '../api/helpers';
import { DT, displayEngine } from './kit';

/*
 * Bakes outside the frame. The update that first plays an animation without a clip starts its
 * bake and plays live. The bake runs in idle time, one step or more per slice, and its clip is
 * the one a bake at once makes. The tests stand in for `requestIdleCallback` and run its slices.
 */

/** The slices that wait for idle time. */
const slices: IdleRequestCallback[] = [];

beforeEach(() => {
    vi.stubGlobal('requestIdleCallback', (slice: IdleRequestCallback) => slices.push(slice));
});

afterEach(() => {
    slices.length = 0;
    vi.unstubAllGlobals();
});

/** Runs the slices that wait, and those they ask for, with an idle deadline. Returns how many ran. */
function runSlices(deadline: IdleDeadline): number {
    let ran = 0;

    for (let slice = slices.shift(); slice !== undefined; slice = slices.shift()) {
        slice(deadline);
        ran++;
    }

    return ran;
}

const noTimeLeft: IdleDeadline = { didTimeout: false, timeRemaining: () => 0 };

/** A model of its own, so that no clip of it was baked before. */
const freshModel = (id: string): Promise<SkeletonModel> => importSkeleton(fixtureFiles(id).skeleton);

/** An asset as a display object hands it over: its bakes run in idle time. The factory counts the engines it made. */
async function idleHost(model: SkeletonModel, made: { engines: number }): Promise<BakeHost> {
    const factory = await loadPoseEngine(model);
    const createEngine: PoseEngineFactory = () => {
        made.engines++;

        return factory();
    };

    return { model, createEngine };
}

describe('a bake in idle time', () => {
    it('starts in the update that first plays an animation, and runs outside that update', async () => {
        const model = await freshModel('4.2/spineboy-pro.skel');
        const made = { engines: 0 };
        const host = await idleHost(model, made);
        const engine = displayEngine(host);
        const tally = playBaked(host, engine, null);
        const walk = model.animations.findIndex(({ name }) => name === 'walk');

        engine.setAnimation(0, walk, true);
        engine.update(DT);
        // the update made no engine to bake with: the bake waits for idle time
        expect(made.engines).toBe(1);
        expect(bakesOf(model).baking).toBe(true);
        expect(slices).toHaveLength(1);
        expect(tally.last).toBe('"walk" posed: its clip is being baked in idle time');
        engine.update(DT);
        expect(tally.baked).toBe(0);
        // one step per slice without time left: the start, every frame and the clip
        const clipFrames = Math.ceil((model.animations[walk]?.duration ?? 0) * 60) + 1;

        expect(runSlices(noTimeLeft)).toBe(clipFrames + 2);
        expect(made.engines).toBe(2);
        expect(bakesOf(model).baking).toBe(false);
        // the next update finds the clip, and the one after plays it
        engine.update(DT);
        engine.update(DT);
        expect(tally.baked).toBe(1);
        const clip = bakesOf(model).find(engine.state.skin, walk, null)?.clip;

        expect(clip).toBeDefined();
        expect(encodeBakedClips(clip === undefined ? [] : [clip])).toEqual(
            encodeBakedClips([await bakeAnimation(model, 'walk')]),
        );
    });

    it('runs as many steps as a slice has time for, and a slice of its own when the wait ran out', async () => {
        const model = await freshModel('4.2/spineboy-pro.skel');
        const host = await idleHost(model, { engines: 0 });
        const engine = displayEngine(host);
        const idle = model.animations.findIndex(({ name }) => name === 'idle');
        const run = model.animations.findIndex(({ name }) => name === 'run');

        playBaked(host, engine, null);
        engine.setAnimation(0, idle, true);
        engine.update(DT);
        expect(runSlices({ didTimeout: false, timeRemaining: () => 50 })).toBe(1);
        expect(bakesOf(model).find(engine.state.skin, idle, null)).not.toBeNull();
        engine.setAnimation(0, run, true);
        engine.update(DT);
        engine.update(DT);
        expect(bakesOf(model).baking).toBe(true);
        // a game that is never idle: the slice after the wait works for a few milliseconds
        const ran = runSlices({ didTimeout: true, timeRemaining: () => 0 });
        const runFrames = Math.ceil((model.animations[run]?.duration ?? 0) * 60) + 1;

        expect(ran).toBeGreaterThan(0);
        expect(ran).toBeLessThanOrEqual(runFrames + 2);
        expect(bakesOf(model).find(engine.state.skin, run, null)).not.toBeNull();
    });

    it('runs on a timer where there is no requestIdleCallback', async () => {
        vi.unstubAllGlobals();
        const model = await freshModel('4.2/spineboy-pro.skel');
        const host = await idleHost(model, { engines: 0 });
        const engine = displayEngine(host);

        playBaked(host, engine, null);
        engine.setAnimation(0, 0, true);
        engine.update(DT);
        expect(bakesOf(model).baking).toBe(true);
        while (bakesOf(model).baking) await new Promise((resolve) => setTimeout(resolve, 0));
        expect(bakesOf(model).find(engine.state.skin, 0, null)).not.toBeNull();
    });

    it('keeps no answer that clips handed over meanwhile made of no use', async () => {
        const model = await freshModel('4.2/spineboy-pro.skel');
        const host = await idleHost(model, { engines: 0 });
        const engine = displayEngine(host);
        const walk = model.animations.findIndex(({ name }) => name === 'walk');

        playBaked(host, engine, null);
        engine.setAnimation(0, walk, true);
        engine.update(DT);
        addBakedClips(host, [await bakeAnimation(model, 'walk', { fps: 30 })]);
        expect(bakesOf(model).baking).toBe(false);
        runSlices(noTimeLeft);
        expect(bakesOf(model).find(engine.state.skin, walk, null)?.fps).toBe(30);
    });

    it('keeps no answer for a combined skin that was freed meanwhile', async () => {
        const model = await freshModel('4.3/mix-and-match-pro.skel');
        const host = await idleHost(model, { engines: 0 });
        const engine = displayEngine(host);
        const lookup = createAttachmentLookup(model);

        playBaked(host, engine, null);
        engine.setSkins([1, 2]);
        const index = engine.state.skin;

        engine.setAnimation(0, 0, true);
        engine.update(DT);
        expect(bakesOf(model).baking).toBe(true);
        // the skin goes, and another list takes its index
        engine.setSkin(-1);
        for (let other = 3; other < KEPT_SKINS + 5; other++) combineSkins(lookup, model, [1, other]);
        expect(lookup.parts(index)).not.toEqual([1, 2]);
        expect(bakesOf(model).baking).toBe(false);
        runSlices(noTimeLeft);
        expect(bakesOf(model).find(index, 0, null)).toBeNull();
    });

    it('says why when the bake fails', async () => {
        const model = await freshModel('4.2/spineboy-pro.skel');
        const factory = await loadPoseEngine(model);
        let engines = 0;
        const host: BakeHost = {
            model,
            createEngine: () => {
                engines++;
                if (engines > 1) throw new Error('no engine to bake with');

                return factory();
            },
        };
        const engine = displayEngine(host);
        const tally = playBaked(host, engine, null);

        engine.setAnimation(0, 0, true);
        engine.update(DT);
        runSlices(noTimeLeft);
        engine.update(DT);
        expect(tally.last).toMatch(/posed: no engine to bake with$/);
        expect(bakesOf(model).find(engine.state.skin, 0, null)).toBeNull();
    });
});
