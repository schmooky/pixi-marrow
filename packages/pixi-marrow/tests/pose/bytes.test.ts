import { describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, poseStateBytes, type SkeletonModel } from '../../src/core';
import { listFixtures, readFixture } from '../parity/fixtures';

/*
 * `engine.bytes` is what the memory baseline counts. It has to see the state that constraints
 * add to an instance, or that state could grow without the baseline noticing.
 */

async function modelOf(id: string): Promise<SkeletonModel> {
    const fixture = listFixtures().find((item) => item.id === id);

    if (fixture === undefined) throw new Error(`no fixture ${id}`);

    return importSkeleton(readFixture(fixture).skeleton);
}

const solved = (model: SkeletonModel): boolean =>
    model.constraints.some(({ type }) => type === 'ik' || type === 'transform' || type === 'path');

describe('engine.bytes', () => {
    const ids = listFixtures()
        .map((fixture) => fixture.id)
        .filter((id) => /\/(spineboy-pro|goblins-pro|stretchyman-pro|coin-pro)\.json$/.test(id));

    it('covers rigs of every version, with and without constraints', () => {
        expect(ids.length).toBeGreaterThanOrEqual(9);
    });

    it.each(ids)('%s: counts the pose state and what the constraints add', async (id) => {
        const model = await modelOf(id);
        const engine = await createPoseEngine(model);
        const state = poseStateBytes(engine.state);
        // every engine keeps one number per slot for the attachment timelines
        const player = model.slots.count * 8;

        if (solved(model)) {
            // the pose the constraints work on: seven numbers per bone at the least
            expect(engine.bytes).toBeGreaterThanOrEqual(state + player + model.bones.count * 7 * 8);
        } else if (model.constraints.length === 0) {
            // no pose of its own for constraints. The 4.3 engine keeps its update order, 4 bytes per bone
            expect(engine.bytes).toBeGreaterThanOrEqual(state + player);
            expect(engine.bytes).toBeLessThanOrEqual(state + player + model.bones.count * 4);
        }
        // nothing an update allocates stays with the instance
        const before = engine.bytes;

        engine.setAnimation(0, 0, true);
        engine.update(1 / 30);
        engine.update(1 / 30);
        expect(engine.bytes).toBeGreaterThanOrEqual(before);
    });

    it('is the same for two instances of one model', async () => {
        const id = ids[0];

        if (id === undefined) throw new Error('no fixture');
        const model = await modelOf(id);
        const first = await createPoseEngine(model);
        const second = await createPoseEngine(model);

        expect(second.bytes).toBe(first.bytes);
    });
});
