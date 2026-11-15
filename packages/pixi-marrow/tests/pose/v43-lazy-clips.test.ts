import { describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, type SkeletonModel } from '../../src/core';
import { clipOf, prepareRig } from '../../src/pose/v43/rig';
import { listFixtures, readFixture } from '../parity/fixtures';

/*
 * The 4.3 rig builds the timelines of an animation when the animation is first played, as the
 * rig of the 4.1 and 4.2 engine does. A model with many animations costs what it plays.
 */

async function load(id: string): Promise<SkeletonModel> {
    const fixture = listFixtures().find((candidate) => candidate.id === id);

    if (fixture === undefined) throw new Error(`no fixture ${id}`);

    return importSkeleton(readFixture(fixture).skeleton);
}

const built = (model: SkeletonModel): number[] =>
    prepareRig(model).clips.flatMap((clip, index) => (clip === undefined ? [] : [index]));

describe('the animations of a 4.3 rig', () => {
    it('are built when they are first played, once for every engine of the model', async () => {
        const model = await load('4.3/spineboy-pro.skel');
        const first = await createPoseEngine(model);
        const second = await createPoseEngine(model);

        expect(model.animations.length).toBeGreaterThan(5);
        expect(built(model)).toEqual([]);
        first.setAnimation(0, 3, true);
        expect(built(model)).toEqual([3]);
        const clip = clipOf(prepareRig(model), 3);

        second.setAnimation(0, 3, true);
        second.setAnimation(1, 1, true);
        first.setMix(1, 4, 0.2);
        expect(built(model)).toEqual([1, 3, 4]);
        expect(clipOf(prepareRig(model), 3)).toBe(clip);
        first.holdsSetup(0);
        expect(built(model)).toEqual([0, 1, 3, 4]);
    });

    it('have room for their property ids when they are built later', async () => {
        const model = await load('4.3/spineboy-pro.skel');
        const rig = prepareRig(model);
        const engine = await createPoseEngine(model);
        const before = rig.scratch.owners.length;

        // every animation in turn on two tracks, with a mix: the hold modes claim every property id
        engine.defaultMix = 0.1;
        for (let animation = 0; animation < model.animations.length; animation++) {
            engine.setAnimation(0, animation, true);
            engine.setAnimation(1, (animation + 1) % model.animations.length, true);
            for (let i = 0; i < 4; i++) engine.update(1 / 30);
        }
        const ids = new Set(rig.clips.flatMap((clip) => [...(clip?.ids ?? [])]));

        expect(built(model).length).toBe(model.animations.length);
        expect(rig.scratch.owners.length).toBeGreaterThan(before);
        expect(rig.scratch.stamps.length).toBe(rig.scratch.owners.length);
        expect(Math.max(...ids)).toBeLessThan(rig.scratch.owners.length);
    });

    it('are built with the rig when a slider plays them', async () => {
        const model = await load('4.3/diamond-pro.skel');
        const played = model.constraints.flatMap((constraint) =>
            constraint.type === 'slider' ? [constraint.animation] : [],
        );

        expect(played.length).toBeGreaterThan(0);
        expect(built(model)).toEqual([...new Set(played)].sort((a, b) => a - b));
    });

    it('are refused by index like before', async () => {
        const model = await load('4.3/spineboy-pro.skel');
        const engine = await createPoseEngine(model);

        for (const animation of [-1, model.animations.length, 1.5, Number.NaN]) {
            expect(() => engine.setAnimation(0, animation, true)).toThrow('The skeleton has no animation');
        }
    });
});
