import { Skeleton } from 'spine-core-4.3';
import { describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, MarrowError, poseStateBytes, type SkeletonModel } from '../../src/core';
import { createPose, poseBytes } from '../../src/pose/v43/pose';
import { prepareRig } from '../../src/pose/v43/rig';
import { PHYSICS_STATE, PLACED_SIZE } from '../../src/pose/v43/solver-types';
import {
    createPair,
    differences,
    NO_REGIONS,
    type Pair,
    physicsBoth,
    playBoth,
    skinBoth,
    updateBoth,
} from './v43-pair';

/*
 * Physics constraints of the 4.3 engine, where the parity scripts do not reach: the pose between
 * updates, reset keys where an animation loops, keys for every physics constraint at once on
 * tracks that mix and add, the y axis that points down, the physics calls of the engine, what the
 * engine refuses, and what a skeleton without physics does not pay.
 */

type Json = Record<string, unknown>;

const wave = (a: number, b: number): Json[] => [{ value: a }, { time: 0.5, value: b }, { time: 1, value: a }];
const late = (time: number, value: number): Json[] => [{ time, value }];

/*
 * Five physics constraints: one that does everything, one that only turns and steps slower than
 * the updates come, one that stretches with the volume kept, one that shears and stretches
 * evenly, and one that needs a skin on a bone that needs it too. Each has some global flags.
 */
const RIG: Json = {
    skeleton: { spine: '4.3.39-beta' },
    bones: [
        { name: 'root', rotation: 5 },
        { name: 'a', parent: 'root', x: 10, length: 30, rotation: 20 },
        { name: 'b', parent: 'a', x: 30, length: 20, rotation: -10, scaleX: 1.1 },
        { name: 'c', parent: 'b', x: 20, length: 10, shearY: 6 },
        { name: 'd', parent: 'root', x: -20, y: 8, length: 15, rotation: 70 },
        { name: 'gated', parent: 'root', x: 5, y: 9, length: 12, skin: true },
    ],
    slots: [],
    constraints: [
        {
            type: 'physics',
            name: 'pa',
            bone: 'a',
            x: 1,
            y: 1,
            rotate: 1,
            scaleX: 1,
            shearX: 0.5,
            strength: 80,
            wind: 3,
            gravity: 5,
            limit: 400,
            inertiaGlobal: true,
            massGlobal: true,
            windGlobal: true,
            mixGlobal: true,
        },
        {
            type: 'physics',
            name: 'pb',
            bone: 'b',
            rotate: 1,
            fps: 20,
            gravity: -8,
            strengthGlobal: true,
            dampingGlobal: true,
            gravityGlobal: true,
            massGlobal: true,
        },
        { type: 'physics', name: 'pc', bone: 'c', x: 0.5, scaleX: 1, scaleY: 'volume', mix: 0.8, mass: 2 },
        { type: 'physics', name: 'pd', bone: 'd', y: 1, shearX: 1, scaleX: 1, scaleY: 'uniform', wind: -6 },
        { type: 'physics', name: 'pg', bone: 'gated', x: 1, rotate: 1, skin: true, mixGlobal: true, windGlobal: true },
    ],
    skins: [{ name: 'default' }, { name: 'on', bones: ['gated'], physics: ['pg'] }],
    animations: {
        move: {
            bones: {
                root: {
                    translate: [{ x: 0 }, { time: 0.3, x: 40, y: 25 }, { time: 0.7, x: -30, y: -10 }, { time: 1 }],
                    rotate: wave(0, 80),
                },
                d: { scale: [{ x: 1 }, { time: 0.6, x: 1.6, y: 0.7 }, { time: 1 }] },
            },
        },
        keyed: {
            physics: {
                pa: {
                    inertia: wave(0.2, 1),
                    strength: wave(20, 140),
                    damping: wave(0.6, 0.95),
                    mass: wave(0.5, 3),
                    wind: wave(-10, 10),
                    gravity: wave(8, -8),
                    mix: wave(1, 0.3),
                },
                '': { inertia: wave(0.9, 0.1), mass: wave(4, 0.7), wind: wave(5, -5), mix: wave(0.4, 1) },
                pb: { reset: [{ time: 0.45 }] },
            },
        },
        // keys that start late: before the first key a timeline mixes toward the setup pose
        late: {
            physics: {
                pa: { mass: late(0.5, 2), wind: late(0.5, 9), strength: late(0.6, 30) },
                '': { gravity: late(0.6, -4), mass: late(0.4, 3), damping: late(0.7, 0.5), strength: late(0.3, 60) },
                pg: { mix: late(0.2, 0.5) },
            },
            bones: { c: { rotate: wave(0, 30) } },
        },
        // reset keys near the end of the animation: a loop passes them between two updates
        resets: {
            physics: {
                '': { reset: [{ time: 0.1 }, { time: 0.97 }] },
                pc: { reset: [{ time: 0.2 }, { time: 0.93 }] },
                pg: { reset: [{ time: 0.5 }] },
            },
            bones: { b: { rotate: wave(0, -40) } },
        },
    },
};
const TEXT = JSON.stringify(RIG);
const [MOVE, KEYED, LATE, RESETS] = [0, 1, 2, 3];
const pairOf = (): Promise<Pair> => createPair({ skeleton: TEXT, atlas: NO_REGIONS });

/** `times` updates on both sides. Returns where the poses differ after each. */
function run(pair: Pair, dt: number, times: number, where: string): string[] {
    const problems: string[] = [];

    for (let i = 0; i < times && problems.length === 0; i++) {
        if (!updateBoth(pair, dt)) throw new Error(`The official core threw ${where}`);
        problems.push(...differences(pair, `${where}, update ${i}`));
    }

    return problems;
}

describe('the physics constraints of the 4.3 pose engine', () => {
    it('run in every mode like the official core, with moves and turns of the skeleton and other forces', async () => {
        const pair = await pairOf();
        const { engine, skeleton } = pair;
        const problems = differences(pair, 'new');

        playBoth(pair, 0, MOVE, true);
        problems.push(...run(pair, 1 / 60, 20, 'at first'));
        for (const mode of ['none', 'pose', 'update', 'reset', 'pose', 'reset', 'update'] as const) {
            physicsBoth(pair, mode);
            expect(engine.physics).toBe(mode);
            engine.physicsTranslate(12, -7);
            skeleton.physicsTranslate(12, -7);
            problems.push(...differences(pair, `after a move in mode ${mode}`));
            problems.push(...run(pair, 0.021, 9, `in mode ${mode}`));
            engine.physicsRotate(3, 4, 50);
            skeleton.physicsRotate(3, 4, 50);
            Object.assign(engine.state, { windX: 0.4, windY: -0.9, gravityX: 0.3, gravityY: -1 });
            Object.assign(skeleton, { windX: 0.4, windY: -0.9, gravityX: 0.3, gravityY: -1 });
            problems.push(...run(pair, 0.07, 6, `after a turn in mode ${mode}`));
        }
        expect(problems.slice(0, 4)).toEqual([]);
    });

    it('reset where an animation passes a reset key, also where it loops past the key', async () => {
        const pair = await pairOf();
        const problems: string[] = [];

        skinBoth(pair, 1);
        playBoth(pair, 0, MOVE, true);
        playBoth(pair, 1, RESETS, true);
        // steps that jump from before the last keys to after the start
        problems.push(...run(pair, 0.11, 40, 'looped'));
        const { mine, theirs } = playBoth(pair, 1, RESETS, false);

        pair.engine.configure(mine, { reverse: true });
        theirs.reverse = true;
        problems.push(...run(pair, 0.09, 15, 'in reverse'));
        // the constraint that needs the skin is left alone without it: no reset and no key reaches it
        skinBoth(pair, -1);
        playBoth(pair, 1, RESETS, true);
        playBoth(pair, 2, LATE, true);
        problems.push(...run(pair, 0.13, 20, 'without the skin'));
        for (const track of [1, 2]) {
            pair.engine.clearTrack(track);
            pair.state.clearTrack(track);
        }
        skinBoth(pair, 1);
        problems.push(...run(pair, 0.05, 12, 'with the skin again'));
        expect(problems.slice(0, 4)).toEqual([]);
    });

    it('take keys for one constraint and for all at once, on tracks that mix, hold and add', async () => {
        const pair = await pairOf();
        const problems: string[] = [];
        const both = (track: number, animation: number, fields: Json): void => {
            const { mine, theirs } = playBoth(pair, track, animation, true);

            pair.engine.configure(mine, fields);
            Object.assign(theirs, fields);
        };

        pair.engine.defaultMix = 0.3;
        pair.state.data.defaultMix = 0.3;
        playBoth(pair, 0, MOVE, true);
        both(1, KEYED, { alpha: 0.6 });
        problems.push(...run(pair, 0.033, 25, 'keyed'));
        both(2, LATE, { alpha: 0.7, additive: true });
        problems.push(...run(pair, 0.033, 25, 'added'));
        skinBoth(pair, 1);
        both(1, LATE, {});
        both(2, KEYED, { additive: true });
        problems.push(...run(pair, 0.05, 30, 'mixed'));
        pair.engine.setupPoseBones();
        pair.skeleton.setupPoseBones();
        problems.push(...differences(pair, 'after the setup pose'));
        both(0, KEYED, {});
        both(0, LATE, {});
        problems.push(...run(pair, 0.05, 30, 'first'));
        expect(problems.slice(0, 4)).toEqual([]);
    });

    it('pull the other way with the y axis down', async () => {
        const frames = async (yDown: boolean): Promise<{ problems: string[]; world: number[] }> => {
            Skeleton.yDown = yDown;
            try {
                const pair = await pairOf();

                // the official skeleton negates its y scale when the y axis points down
                Object.assign(pair.engine.state, { yDown, scaleY: yDown ? -1 : 1 });
                playBoth(pair, 0, MOVE, true);

                return { problems: run(pair, 0.03, 40, `y down ${yDown}`), world: Array.from(pair.engine.state.world) };
            } finally {
                Skeleton.yDown = false;
            }
        };
        const down = await frames(true);
        const up = await frames(false);
        // the mirrored skeleton alone is not it: the gravity that turns a bone has its own sign
        const mirrored = await pairOf();

        Object.assign(mirrored.engine.state, { scaleY: -1 });
        Object.assign(mirrored.skeleton, { scaleY: -1 });
        playBoth(mirrored, 0, MOVE, true);
        expect(run(mirrored, 0.03, 40, 'mirrored')).toEqual([]);
        expect([down.problems, up.problems]).toEqual([[], []]);
        expect(down.world).not.toEqual(Array.from(mirrored.engine.state.world));
    });

    it('refuses a physics mode it does not know and a physics timeline for another constraint', async () => {
        const engine = await createPoseEngine(await importSkeleton(TEXT));
        const damaged = await importSkeleton(TEXT);

        expect(() => Object.assign(engine, { physics: 'later' })).toThrow(MarrowError);
        expect(() => Object.assign(engine, { physics: 'later' })).toThrow('"later" is no physics mode.');
        expect(engine.physics).toBe('update');
        // the keys of the first physics constraint now point at an IK constraint
        damaged.constraints.unshift({ type: 'ik', name: 'aim', skinRequired: false, ...IK });
        await expect(createPoseEngine(damaged)).rejects.toThrow(
            'Animation "keyed" has a physicsConstraintInertia timeline for constraint 0, which is no physics constraint.',
        );
    });
});

/** An IK constraint that takes the place of a physics constraint in a damaged model. */
const IK = {
    bones: Int16Array.of(1),
    target: 4,
    mix: 1,
    softness: 0,
    bendDirection: 1,
    compress: false,
    stretch: false,
};

/** The same skeleton without its physics constraints and their keys. */
async function withoutPhysics(): Promise<SkeletonModel> {
    const { constraints: _, ...rest } = RIG;

    return importSkeleton(
        JSON.stringify({ ...rest, skins: [{ name: 'default' }], animations: { move: (RIG.animations as Json).move } }),
    );
}

describe('the physics state of the 4.3 pose engine', () => {
    it('is counted in the bytes of an instance, and a skeleton without physics has none', async () => {
        const model = await importSkeleton(TEXT);
        const bare = await withoutPhysics();
        const pose = createPose(prepareRig(model));
        const plain = createPose(prepareRig(bare));
        const engine = await createPoseEngine(bare);

        engine.update(0.1);
        const before = Array.from(engine.state.world);

        expect(pose.solve.physics.length).toBe(5 * PHYSICS_STATE);
        expect(plain.solve.physics.length).toBe(0);
        // without constraints the pose is the pose state itself, and the update order is all that is added
        expect(plain.solve.split).toBeNull();
        expect([plain.local, plain.colors, plain.values]).toEqual([
            plain.state.local,
            plain.state.colors,
            plain.solve.values,
        ]);
        // a byte for each bone that may have to be posed again, and the place and the forces of the last update
        const noted = bare.bones.count + PLACED_SIZE * 8;

        expect(poseBytes(plain)).toBe(poseStateBytes(plain.state) + noted);
        // four bytes for each bone of the update order: all but the one that needs a skin
        expect(engine.bytes).toBe(poseStateBytes(engine.state) + noted + (bare.bones.count - 1) * 4);
        expect(poseBytes(pose)).toBeGreaterThanOrEqual(poseBytes(plain) + pose.solve.physics.byteLength);
        // the physics calls do nothing there
        engine.physics = 'reset';
        engine.physicsTranslate(5, 5);
        engine.physicsRotate(1, 2, 30);
        engine.update(0.1);
        expect(Array.from(engine.state.world)).toEqual(before);
    });

    it('advances with the skeleton time, which every update adds to', async () => {
        const pair = await pairOf();
        const steps = [0.1, 0.017, 0, 1 / 3, 0.25];

        for (const dt of steps) updateBoth(pair, dt);
        expect(pair.engine.state.time).toBe(pair.skeleton.time);
        expect(pair.engine.state.time).toBe(steps.reduce((sum, dt) => sum + dt, 0));
        // a time that jumps back is no time passed
        pair.engine.state.time = 0.2;
        pair.skeleton.time = 0.2;
        playBoth(pair, 0, MOVE, true);
        expect(run(pair, 0.04, 10, 'after the time was set back')).toEqual([]);
    });
});
