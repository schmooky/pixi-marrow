import { AnimationState, AnimationStateData, Physics, Skeleton } from 'spine-core-4.3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPoseEngine, importSkeleton, WORLD_STRIDE } from '../../src/core';
import { COS_QUARTER, DEG_RAD, QUARTER, SIN_QUARTER } from '../../src/pose/v43/math';
import { readData43 } from '../parity/pose-official43';

/*
 * The 4.3 engine leaves out trig calls whose result is known: the cosine and the sine of the axes
 * of a bone that is not turned, and those of a path bone that it has from the step before. The
 * official core computes every one of them, so it is the engine with the shortcuts turned off.
 */

const ATLAS = ['page.png', 'size: 4, 4', 'filter: Linear, Linear', ''].join('\n');
/** An open path through three knots, with handles a fifth of the way to the next knot. */
const RAIL = {
    type: 'path',
    lengths: [40, 80, 120],
    vertexCount: 9,
    vertices: [-8, 0, 0, 0, 8, 6, 32, 24, 40, 30, 50, 22, 80, -2, 90, -10, 100, -18],
};
/** Bones that are not turned and bones that are, for every way a bone inherits its parent. */
const RIG = JSON.stringify({
    skeleton: { spine: '4.3.39-beta' },
    bones: [
        { name: 'root' },
        { name: 'still', parent: 'root', x: 10, y: 5, scaleX: 1.5 },
        { name: 'turned', parent: 'still', rotation: 33, x: 3 },
        { name: 'minus', parent: 'root', rotation: -0, x: -4, scaleY: -1 },
        { name: 'sheared', parent: 'root', shearX: 10, shearY: -10 },
        { name: 'leaning', parent: 'root', shearX: 7 },
        { name: 'flat', parent: 'still', inherit: 'noScale' },
        { name: 'lean', parent: 'still', rotation: 20, shearX: 4, shearY: 6, inherit: 'noScale' },
        { name: 'alone', parent: 'still', inherit: 'onlyTranslation' },
        { name: 'spun', parent: 'still', rotation: 50, inherit: 'onlyTranslation' },
        { name: 'p1', parent: 'root', length: 12 },
        { name: 'p2', parent: 'p1', length: 12, x: 12 },
        { name: 'p3', parent: 'p2', length: 12, x: 12 },
        { name: 'q1', parent: 'root', length: 9, y: 30 },
        { name: 'q2', parent: 'q1', length: 9, x: 9 },
    ],
    slots: [{ name: 'rail', bone: 'root', attachment: 'rail' }],
    constraints: [
        // a full mix without an offset: the angle of a bone is the one its tip was found with
        { type: 'path', name: 'chain', bones: ['p1', 'p2', 'p3'], slot: 'rail', rotateMode: 'chain', position: 0.1 },
        // a part mix: every angle is new
        { type: 'path', name: 'part', bones: ['q1', 'q2'], slot: 'rail', rotateMode: 'chain', mixRotate: 0.6 },
    ],
    skins: [{ name: 'default', attachments: { rail: { rail: RAIL } } }],
    animations: {
        move: {
            bones: {
                turned: { rotate: [{ value: 0 }, { time: 1, value: 90 }] },
                still: {
                    rotate: [
                        { time: 0.5, value: 0 },
                        { time: 1, value: 25 },
                    ],
                },
                flat: {
                    rotate: [
                        { time: 0.5, value: 0 },
                        { time: 1, value: -40 },
                    ],
                },
            },
            path: { chain: { position: [{ value: 0.1 }, { time: 1, value: 0.7 }] } },
        },
    },
});

/** The arguments `Math.cos` was called with while `run` ran. */
function cosines(run: () => void): number[] {
    const spy = vi.spyOn(Math, 'cos');

    run();
    const seen = spy.mock.calls.map(([angle]) => angle);

    spy.mockRestore();

    return seen;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the trig shortcuts of the 4.3 pose engine', () => {
    it('rest on what the language says about an angle of 0 and on the numbers of the quarter turn', () => {
        expect([Math.cos(0), Math.cos(-0)]).toEqual([1, 1]);
        expect([Object.is(Math.sin(0), 0), Object.is(Math.sin(-0), -0)]).toEqual([true, true]);
        expect(QUARTER).toBe((0 + 90 + 0) * DEG_RAD);
        expect([COS_QUARTER, SIN_QUARTER]).toEqual([Math.cos(QUARTER), Math.sin(QUARTER)]);
    });

    it('give the pose of the official core, which computes every cosine and sine', async () => {
        const model = await importSkeleton(RIG);
        const engine = await createPoseEngine(model);
        const data = readData43({ skeleton: RIG, atlas: ATLAS });
        const skeleton = new Skeleton(data);
        const state = new AnimationState(new AnimationStateData(data));
        const ours: number[] = [];
        const theirs: number[] = [];

        engine.setAnimation(0, 0, true);
        state.setAnimation(0, 'move', true);
        for (let step = 0; step < 24; step++) {
            ours.push(...cosines(() => engine.update(1 / 12)));
            theirs.push(
                ...cosines(() => {
                    state.update(1 / 12);
                    skeleton.update(1 / 12);
                    state.apply(skeleton);
                    skeleton.updateWorldTransform(Physics.update);
                }),
            );
            skeleton.bones.forEach((bone, i) => {
                const pose = bone.appliedPose;
                const expected = [pose.a, pose.b, pose.c, pose.d, pose.worldX, pose.worldY];
                const actual = [...engine.state.world.subarray(i * WORLD_STRIDE, (i + 1) * WORLD_STRIDE)];

                // bit for bit, the sign of a zero included
                expect(actual.map((value, k) => Object.is(value, expected[k]))).toEqual(expected.map(() => true));
            });
        }
        // the official core asks for the cosine of 0 and of the quarter turn, the engine never does
        expect(theirs.filter((angle) => angle === 0 || angle === QUARTER).length).toBeGreaterThan(100);
        expect(ours.filter((angle) => angle === 0 || angle === QUARTER)).toEqual([]);
        // the engine asks for no cosine the official core does not ask for, and for fewer in all
        expect(ours.length).toBeLessThan(theirs.length - 100);
        expect(ours.every((angle) => theirs.includes(angle))).toBe(true);
    });
});
