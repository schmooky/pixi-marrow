import { describe, expect, it } from 'vitest';
import { createPoseEngine, type PoseEngine, type SkeletonModel } from '../../src/core';
import { animationIndex, FRAME, importRig, VERSIONS } from '../api/helpers';

/*
 * `PoseEngine.deform`, which `lod` turns off for a skeleton drawn small. Off, every deform is
 * cleared at once and the deform timelines are left out. Back on, the next update applies them
 * again, also when the pose rested and the engine would skip the apply as one that repeats.
 */

/** A rig with deform timelines and the animation that has them, in every version. */
const RIGS = [
    { file: 'goblins-pro', skin: 'goblin', animation: 'walk', loop: true },
    { file: 'alien-pro', skin: null, animation: 'death', loop: false },
] as const;

/** An engine that plays an animation on track 0 from the setup pose. */
async function playing(model: SkeletonModel, rig: (typeof RIGS)[number]): Promise<PoseEngine> {
    const engine = await createPoseEngine(model);

    if (rig.skin !== null) engine.setSkin(model.skins.findIndex((skin) => skin.name === rig.skin));
    engine.setAnimation(0, animationIndex(model, rig.animation), rig.loop);

    return engine;
}

/** The slots with a deform, and their lengths. */
function deformed(engine: PoseEngine): number[] {
    return [...engine.state.deformLengths].flatMap((length, slot) => (length > 0 ? [slot] : []));
}

/** Expects two engines to hold the same pose: world transforms, deforms and attachments. */
function expectSamePose(actual: PoseEngine, expected: PoseEngine): void {
    const a = actual.state;
    const b = expected.state;

    expect([...a.world]).toEqual([...b.world]);
    expect([...a.deformLengths]).toEqual([...b.deformLengths]);
    expect(a.attachments).toEqual(b.attachments);
    for (let slot = 0; slot < b.deformLengths.length; slot++) {
        const length = Number(b.deformLengths[slot]);

        expect([...(a.deform[slot] ?? new Float64Array(0)).subarray(0, length)]).toEqual([
            ...(b.deform[slot] ?? new Float64Array(0)).subarray(0, length),
        ]);
    }
}

describe.each(VERSIONS)('the deform switch of the %s engine', (version) => {
    it.each(RIGS)('clears every deform at once and leaves the timelines out: $file', async (rig) => {
        const { model } = await importRig(`${version}/${rig.file}.skel`);
        const engine = await playing(model, rig);

        for (let i = 0; i < 20; i++) engine.update(FRAME);
        const shown = deformed(engine);
        const before = engine.state.version;

        expect(shown.length).toBeGreaterThan(0);
        expect(engine.deform).toBe(true);
        engine.deform = false;
        expect(engine.deform).toBe(false);
        expect(deformed(engine)).toEqual([]);
        // a view sees the change by the stamps, before any update
        expect(engine.state.version).not.toBe(before);
        for (const slot of shown) expect(Number(engine.state.slotStamps[slot])).toBe(engine.state.version);
        for (let i = 0; i < 30; i++) {
            engine.update(FRAME);
            expect(deformed(engine)).toEqual([]);
        }
        // a second write of the same value changes nothing
        const kept = engine.state.version;

        engine.deform = false;
        expect(engine.state.version).toBe(kept);
    });

    it.each(RIGS)('applies the deform again in the next update after it is back on: $file', async (rig) => {
        const { model } = await importRig(`${version}/${rig.file}.skel`);
        const engine = await playing(model, rig);
        const reference = await playing(model, rig);

        for (let i = 0; i < 10; i++) {
            engine.update(FRAME);
            reference.update(FRAME);
        }
        engine.deform = false;
        for (let i = 0; i < 15; i++) {
            engine.update(FRAME);
            reference.update(FRAME);
        }
        engine.deform = true;
        engine.update(FRAME);
        reference.update(FRAME);
        expect(deformed(engine).length).toBeGreaterThan(0);
        expectSamePose(engine, reference);
    });

    it('brings the deform back to a pose that rests at the end of its animation', async () => {
        const rig = RIGS[1];
        const { model } = await importRig(`${version}/${rig.file}.skel`);
        const engine = await playing(model, rig);
        const reference = await playing(model, rig);
        const steps = Math.ceil((model.animations[animationIndex(model, rig.animation)]?.duration ?? 0) / FRAME) + 90;

        // long past the end, the engine skips the applies that repeat
        for (let i = 0; i < steps; i++) {
            engine.update(FRAME);
            reference.update(FRAME);
        }
        engine.deform = false;
        for (let i = 0; i < 70; i++) engine.update(FRAME);
        expect(deformed(engine)).toEqual([]);
        engine.deform = true;
        engine.update(FRAME);
        reference.update(FRAME);
        expect(deformed(engine).length).toBeGreaterThan(0);
        expectSamePose(engine, reference);
    });
});
