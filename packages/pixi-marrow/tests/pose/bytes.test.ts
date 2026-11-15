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
            // No pose of its own for constraints. An engine keeps what skipping needs: its update
            // order and a mark per bone, 5 bytes per bone at most, and the placement it compares
            expect(engine.bytes).toBeGreaterThanOrEqual(state + player);
            expect(engine.bytes).toBeLessThanOrEqual(state + player + model.bones.count * 5 + 72);
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

/** Collects garbage and lets Node settle what it counts for array buffers. */
async function settled(): Promise<number> {
    const collect: unknown = Reflect.get(globalThis, 'gc');

    if (typeof collect !== 'function')
        throw new Error('gc() is not exposed: run the tests with the config of the package');
    for (let i = 0; i < 3; i++) {
        collect();
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const { heapUsed, arrayBuffers } = process.memoryUsage();

    return heapUsed + arrayBuffers;
}

/** The bytes of heap and of array buffers that one more engine of a model takes, measured over many. */
async function measuredBytes(model: SkeletonModel): Promise<{ real: number; counted: number }> {
    const engines = [await createPoseEngine(model)];
    const count = 400;
    const before = await settled();

    for (let i = 0; i < count; i++) engines.push(await createPoseEngine(model));
    const real = ((await settled()) - before) / count;

    return { real, counted: engines[0]?.bytes ?? 0 };
}

describe('what engine.bytes does not count', () => {
    it.each(['4.2', '4.3'])(
        'is no array per slot: %s slots without a deform share one empty array',
        async (version) => {
            const model = await modelOf(`${version}/spineboy-pro.json`);
            const first = await createPoseEngine(model);
            const second = await createPoseEngine(model);
            const empty = first.state.deform[0];

            expect(empty?.length).toBe(0);
            expect(first.state.deform.every((deform) => deform === empty)).toBe(true);
            expect(second.state.deform.every((deform) => deform === empty)).toBe(true);
            // a deform gets an array of its own, in the instance that plays it
            for (let animation = 0; animation < model.animations.length; animation++) {
                first.setAnimation(0, animation, true);
                for (let i = 0; i < 3; i++) first.update(1 / 30);
            }
            const deformed = first.state.deform.filter((deform) => deform !== empty);

            expect(deformed.length).toBeGreaterThan(0);
            expect(deformed.every((deform) => deform.length > 0)).toBe(true);
            expect(new Set(deformed).size).toBe(deformed.length);
            expect(second.state.deform.every((deform) => deform === empty)).toBe(true);
            expect(empty?.length).toBe(0);
        },
    );

    it.each(['4.2', '4.3'])('is about the same for a small and a large %s skeleton', async (version) => {
        const small = await measuredBytes(await modelOf(`${version}/coin-pro.json`));
        const large = await measuredBytes(await modelOf(`${version}/spineboy-pro.json`));

        // the objects of an instance: 5 to 8 kB in Node 24. An empty array per slot made it 16 kB for spineboy
        for (const { real, counted } of [small, large]) {
            expect(real - counted).toBeGreaterThan(0);
            expect(real - counted).toBeLessThan(11_000);
        }
        expect(large.real - large.counted - (small.real - small.counted)).toBeLessThan(3000);
    });
});
