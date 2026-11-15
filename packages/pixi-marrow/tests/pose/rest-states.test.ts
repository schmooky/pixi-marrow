import { describe, expect, it } from 'vitest';
import {
    createPoseEngine,
    importSkeleton,
    isNewer,
    LOCAL_STRIDE,
    type PoseEngine,
    type SkeletonModel,
    touchPose,
} from '../../src/core';
import { listFixtures, readFixture } from '../parity/fixtures';

/*
 * The states in which a skeleton rests, on both engines: ended entries on several tracks, an
 * ended entry below full alpha, and an ended entry on an upper track alone. At rest an update
 * runs no timeline and leaves the version and every stamp alone.
 *
 * That no timeline runs is seen from outside: a number written into the animated pose behind the
 * back of the engine, without a new version, stays. A timeline that ran would write it again.
 * The parity suite has the same states against the official cores: pose-scripts-rest.ts.
 */

const DT = 1 / 60;
const ROTATION = 2;

/** A way to bring an engine to one of the states. Every entry plays once and stays past its end. */
type Play = (engine: PoseEngine, animation: (name: string) => number) => void;

const STATES: readonly (readonly [string, Play])[] = [
    [
        'ended entries on two tracks',
        (engine, animation) => {
            engine.setAnimation(0, animation('walk'), false);
            engine.setAnimation(1, animation('run'), false);
        },
    ],
    [
        'an ended entry at alpha 0.5',
        (engine, animation) => {
            engine.configure(engine.setAnimation(0, animation('walk'), false), { alpha: 0.5 });
        },
    ],
    [
        'an ended entry on track 1 alone',
        (engine, animation) => {
            engine.setAnimation(1, animation('walk'), false);
        },
    ],
    [
        'ended entries on three tracks, two below full alpha',
        (engine, animation) => {
            engine.configure(engine.setAnimation(0, animation('walk'), false), { alpha: 0.75 });
            engine.setAnimation(1, animation('run'), false);
            engine.configure(engine.setAnimation(3, animation('jump'), false), { alpha: 0.25 });
        },
    ],
];

async function load(id: string): Promise<SkeletonModel> {
    const fixture = listFixtures().find((candidate) => candidate.id === id);

    if (fixture === undefined) throw new Error(`no fixture ${id}`);

    return importSkeleton(readFixture(fixture).skeleton);
}

/** The first bone whose rotation the walk has moved away from the setup pose. */
function keyedBone(model: SkeletonModel, engine: PoseEngine): number {
    const { setup, count } = model.bones;

    for (let bone = 0; bone < count; bone++) {
        const at = bone * LOCAL_STRIDE + ROTATION;

        if (engine.state.local[at] !== setup[at]) return bone;
    }
    throw new Error('the animation moved no bone');
}

/** Updates and returns how many updates moved the version or a stamp. */
function moves(engine: PoseEngine, updates: number): number {
    const { state } = engine;
    let moved = 0;

    for (let i = 0; i < updates; i++) {
        const seen = state.version;

        engine.update(DT);
        const stamped =
            state.boneStamps.some((stamp) => isNewer(stamp, seen)) ||
            state.slotStamps.some((stamp) => isNewer(stamp, seen)) ||
            isNewer(state.drawOrderStamp, seen);

        if (state.version !== seen || stamped) moved++;
    }

    return moved;
}

describe.each(['4.2/spineboy-pro.skel', '4.3/spineboy-pro.skel'])('the rest of %s', (id) => {
    it.each(STATES)('holds for %s', async (_name, play) => {
        const model = await load(id);
        const engine = await createPoseEngine(model);
        const { state } = engine;

        play(engine, (name) => model.animations.findIndex((animation) => animation.name === name));
        // past every end, and long enough for an entry below full alpha to arrive at its keys
        for (let i = 0; i < 1200; i++) engine.update(DT);
        engine.takeEvents();
        const bone = keyedBone(model, engine);
        const at = bone * LOCAL_STRIDE + ROTATION;
        const rested = Number(state.local[at]);
        const world = Array.from(state.world);

        expect(moves(engine, 100)).toBe(0);
        expect(Array.from(state.world)).toEqual(world);
        expect(engine.takeEvents()).toEqual([]);

        // no timeline runs: a number written without a new version stays as it is
        state.local[at] = rested + 33;
        expect(moves(engine, 100)).toBe(0);
        expect(state.local[at]).toBe(rested + 33);

        // a new version wakes the engine: the timelines write the bone again and it comes to rest again
        touchPose(state);
        expect(moves(engine, 1)).toBe(1);
        expect(state.local[at]).not.toBe(rested + 33);
        for (let i = 0; i < 600; i++) engine.update(DT);
        expect(state.local[at]).toBe(rested);
        expect(Array.from(state.world)).toEqual(world);
        expect(moves(engine, 50)).toBe(0);
    });

    it('ends when an entry changes, and comes back', async () => {
        const model = await load(id);
        const engine = await createPoseEngine(model);
        const animation = (name: string): number => model.animations.findIndex((candidate) => candidate.name === name);

        engine.setAnimation(0, animation('walk'), false);
        const upper = engine.setAnimation(1, animation('run'), false);

        for (let i = 0; i < 600; i++) engine.update(DT);
        expect(moves(engine, 20)).toBe(0);
        engine.configure(upper, { alpha: 0.5 });
        // the upper entry now mixes with the lower one: the pose moves
        expect(moves(engine, 1)).toBe(1);
        for (let i = 0; i < 600; i++) engine.update(DT);
        expect(moves(engine, 20)).toBe(0);
        // a color the slot has already is no change
        engine.setColor(0, Number(engine.slotPose.colors[0]), Number(engine.slotPose.colors[1]), 0, 1);
        engine.update(DT);
        engine.update(DT);
        const blue = Number(engine.slotPose.colors[2]);

        engine.setColor(0, Number(engine.slotPose.colors[0]), Number(engine.slotPose.colors[1]), blue, 1);
        expect(moves(engine, 20)).toBe(0);
    });
});
