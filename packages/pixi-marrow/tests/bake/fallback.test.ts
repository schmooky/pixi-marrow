import { describe, expect, it } from 'vitest';
import { playBaked } from '../../src/bake/playback';
import { nextVersion, type PoseEngine, type SkeletonModel } from '../../src/core';
import { BAKE_RIGS, bakeable, DT, displayEngine, eventData, hostOf, modelOf, poseDifference } from './kit';

/*
 * What does not play baked poses as the engine does: a mix, a second track, a write to a bone, a
 * rig with physics or a slider, a skin change, a cleared track, another alpha, another place of
 * the skeleton and another physics mode. Two engines take the same calls, one of them with baked
 * playback. Its updates that are not eligible must be posed by the engine, and both must show
 * the same pose and fire the same events. The pose of 4.1 and 4.2 depends on the pose before
 * in its last bits, so poses are equal within a millionth after a stretch of baked updates.
 */

interface Pair {
    live: PoseEngine;
    baked: PoseEngine;
    tally: ReturnType<typeof playBaked>;
    /** Updates so far, and the baked ones among them. */
    updates: number;
}

async function pairOf(model: SkeletonModel): Promise<Pair> {
    const host = await hostOf(model);
    const baked = displayEngine(host);

    return { live: displayEngine(host), baked, tally: playBaked(host, baked, null), updates: 0 };
}

/** The same call on both engines. */
function both(pair: Pair, call: (engine: PoseEngine) => void): void {
    call(pair.live);
    call(pair.baked);
}

/** True when the entry that plays alone is applied at a time a clip has a frame for, as the baker reaches it. */
function atSample(engine: PoseEngine): boolean {
    const entry = engine.solo();

    if (entry === null || entry.reverse || entry.animationStart !== 0) return false;
    const duration = engine.state.model.animations[entry.animation]?.duration ?? 0;
    const time = entry.loop ? entry.trackTime % duration : Math.min(entry.trackTime, duration);

    if (time >= duration) return true;
    for (let sum = 0; sum <= time; sum += DT) if (sum === time) return true;

    return false;
}

/**
 * `times` updates on both. The events must be equal after each. The poses must be equal after
 * each update the engine posed, and after each baked one at a sample time: between samples a
 * baked pose shows the frame before. Returns how many updates played baked.
 */
function updates(pair: Pair, times: number, what: string, exact = false): number {
    const start = pair.tally.baked;

    for (let i = 0; i < times; i++) {
        const before = pair.tally.baked;

        both(pair, (engine) => engine.update(DT));
        expect(pair.baked.takeEvents().map(eventData), what).toEqual(pair.live.takeEvents().map(eventData));
        if (pair.tally.baked > before && !atSample(pair.live)) continue;
        const difference = poseDifference(pair.live.state, pair.baked.state, exact);

        if (difference !== null) expect.fail(`${what}, update ${i + 1}: ${difference} (${pair.tally.last})`);
    }

    return pair.tally.baked - start;
}

/** Writes one local value of a bone as a bone handle does: the value, then the version. */
function writeBone(engine: PoseEngine, bone: number, field: number, value: number): void {
    engine.state.local[bone * 7 + field] = value;
    engine.state.version = nextVersion(engine.state.version);
}

const named = (model: SkeletonModel, name: string): number => model.animations.findIndex((each) => each.name === name);

describe.each(['4.1/spineboy-pro.skel', '4.2/spineboy-pro.skel', '4.3/spineboy-pro.skel'])('%s', (id) => {
    it('poses a mix with the engine, and plays baked once the next animation plays alone', async () => {
        const model = await modelOf(id);
        const pair = await pairOf(model);

        both(pair, (engine) => engine.setAnimation(0, named(model, 'walk'), true));
        expect(updates(pair, 30, 'walk')).toBe(29);
        both(pair, (engine) => {
            engine.setMix(named(model, 'walk'), named(model, 'run'), 0.25);
            engine.setAnimation(0, named(model, 'run'), true);
        });
        // 15 updates of the mix and the one that ends it
        expect(updates(pair, 16, 'walk to run')).toBe(0);
        expect(updates(pair, 30, 'run')).toBe(29);
    });

    it('poses a second track with the engine', async () => {
        const model = await modelOf(id);
        const pair = await pairOf(model);

        both(pair, (engine) => engine.setAnimation(0, named(model, 'run'), true));
        updates(pair, 10, 'run');
        both(pair, (engine) => engine.setAnimation(1, named(model, 'aim'), true));
        expect(updates(pair, 20, 'run and aim')).toBe(0);
        both(pair, (engine) => engine.setEmptyAnimation(1, 0.1));
        expect(updates(pair, 6, 'aim mixed out')).toBe(0);
        // the empty entry leaves the track at its end: run plays alone again
        expect(updates(pair, 20, 'run')).toBeGreaterThan(15);
    });

    it('poses the update after a write to a bone, and stays posed while a value the animation leaves alone is not the setup one', async () => {
        const model = await modelOf(id);
        const pair = await pairOf(model);
        const walk = named(model, 'walk');
        const keyed = model.animations[walk]?.timelines.find(({ kind }) => kind === 'rotate')?.target ?? -1;
        const root = model.bones.names.indexOf('root');

        both(pair, (engine) => engine.setAnimation(0, walk, true));
        updates(pair, 10, 'walk');
        // a value the animation keys: the next update writes it again, then baking goes on
        both(pair, (engine) => writeBone(engine, keyed, 2, 33));
        expect(updates(pair, 1, 'after a write that walk keys')).toBe(0);
        expect(updates(pair, 10, 'walk')).toBe(10);
        // a value it leaves alone stays in the pose: no frame of the clip has it
        both(pair, (engine) => writeBone(engine, root, 2, 20));
        expect(updates(pair, 20, 'with root turned')).toBe(0);
        expect(pair.tally.last).toContain('differs from the setup pose');
        both(pair, (engine) => writeBone(engine, root, 2, Number(model.bones.setup[root * 7 + 2])));
        expect(updates(pair, 1, 'root back')).toBe(0);
        expect(updates(pair, 10, 'walk')).toBe(10);
    });

    it('poses a skin change, another place and another physics mode, then plays the clip of the skin', async () => {
        const model = await modelOf(id);
        const pair = await pairOf(model);

        both(pair, (engine) => engine.setAnimation(0, named(model, 'idle'), true));
        updates(pair, 10, 'idle');
        both(pair, (engine) => engine.setSkin(0));
        expect(updates(pair, 1, 'after a skin change')).toBe(0);
        expect(updates(pair, 10, 'idle with a skin')).toBe(10);
        both(pair, (engine) => {
            engine.state.x = 12;
        });
        expect(updates(pair, 10, 'placed elsewhere')).toBe(0);
        both(pair, (engine) => {
            engine.state.x = 0;
        });
        updates(pair, 2, 'back in place');
        both(pair, (engine) => {
            engine.physics = 'pose';
        });
        expect(updates(pair, 1, 'another physics mode')).toBe(0);
        expect(updates(pair, 5, 'idle')).toBe(5);
    });

    it('keeps the pose of the current time when a track is cleared or its alpha changes', async () => {
        const model = await modelOf(id);
        const pair = await pairOf(model);
        const walk = named(model, 'walk');

        both(pair, (engine) => engine.setAnimation(0, walk, true));
        updates(pair, 25, 'walk');
        both(pair, (engine) => engine.clearTrack(0));
        updates(pair, 3, 'cleared');
        both(pair, (engine) => engine.setAnimation(0, named(model, 'run'), true));
        // run over the pose walk left: values run leaves alone are not the setup ones
        expect(updates(pair, 20, 'run over walk')).toBe(0);
        both(pair, (engine) => engine.setupPose());
        updates(pair, 20, 'run from the setup pose');
        both(pair, (engine) => engine.configure(engine.setAnimation(0, walk, true), {}));
        updates(pair, 20, 'walk');
        both(pair, (engine) => {
            const entry = engine.solo();

            if (entry !== null) engine.configure(entry, { alpha: 0.4 });
        });
        expect(updates(pair, 10, 'walk at alpha 0.4')).toBe(0);
        both(pair, (engine) => engine.setupPose());
        both(pair, (engine) => engine.clearTracks());
        updates(pair, 2, 'setup pose, then cleared');
    });
});

describe('rigs with physics or a slider', () => {
    const rigs = BAKE_RIGS.filter(({ version }) => version !== '4.1');

    it('play without baking, to the bit', { timeout: 60_000 }, async () => {
        let posed = 0;

        for (const fixture of rigs) {
            const model = await modelOf(fixture.id);

            if (bakeable(model)) continue;
            const pair = await pairOf(model);

            for (let animation = 0; animation < Math.min(3, model.animations.length); animation++) {
                both(pair, (engine) => engine.setAnimation(0, animation, true));
                expect(updates(pair, 20, `${fixture.id} ${model.animations[animation]?.name}`, true)).toBe(0);
            }
            expect(pair.tally.last).toMatch(/physics constraint|slider/);
            posed++;
        }
        expect(posed).toBeGreaterThan(4);
    });
});
