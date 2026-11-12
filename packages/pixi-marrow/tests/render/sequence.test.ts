import { describe, expect, it } from 'vitest';
import { SPINE_VERSIONS } from '../../src/base/version';
import { resolveSequenceIndex } from '../../src/geometry/atlas-regions';
import { syntheticRig } from '../geometry/synthetic';
import {
    createRig,
    drawPose,
    expectKernel,
    loadRig,
    play,
    type Rig,
    readDrawn,
    readUVs,
    slotIndex,
    step,
    vertexData,
} from './rig';

/** The region each visible slot with a sequence is at. */
function framesOf(rig: Rig): string {
    const { sequenceIndices } = rig.engine.state;

    return readDrawn(rig)
        .filter((item) => item.attachment.sequence !== null)
        .map(
            (item) =>
                `${item.slot}:${resolveSequenceIndex(item.attachment.sequence, sequenceIndices[item.slot] ?? -1)}`,
        )
        .join(' ');
}

describe('sequences', () => {
    it.each(['4.1/dragon-ess.skel', '4.2/dragon-ess.json', '4.3/dragon-ess.skel', '4.3/diamond-pro.skel'])(
        'rewrites the texture coordinates of %s when a slot shows another region, and nothing else',
        async (id) => {
            const rig = await loadRig(id);
            const { stats } = rig.view;
            let changes = 0;

            step(rig, 0);
            let frames = framesOf(rig);

            expect(frames).not.toBe('');
            for (const animation of rig.model.animations) {
                play(rig, animation.name);
                for (let frame = 0; frame < 40; frame++) {
                    const uploads = stats.uvUploads;

                    step(rig, 1 / 24);
                    expectKernel(rig);
                    // an upload exactly when a visible sequence moved on
                    const now = framesOf(rig);

                    if (now !== frames) changes++;
                    expect(stats.uvUploads - uploads).toBeLessThanOrEqual(1);
                    if (stats.uvUploads !== uploads) expect(now).not.toBe(frames);
                    frames = now;
                }
            }
            expect(changes).toBeGreaterThan(3);
            expect(stats.uvUploads).toBeGreaterThan(3);
            expect(stats.uvUploads).toBeLessThanOrEqual(changes);
            expect(stats.templateBuilds).toBe(1);
        },
    );

    it.each(SPINE_VERSIONS)('shows the setup region first and follows the keys of a %s rig', async (version) => {
        const rig = await createRig(syntheticRig(version));
        const flame = slotIndex(rig, 'flame');
        const { state } = rig.engine;

        step(rig, 0);
        // the sequence starts at its setup index, which is the second region
        expect(
            resolveSequenceIndex(
                state.attachments[flame]?.type === 'region' ? state.attachments[flame].sequence : null,
                -1,
            ),
        ).toBe(1);
        expectKernel(rig);
        expect(rig.view.stats.uvUploads).toBe(0);
        play(rig, 'sequence');
        for (let frame = 0; frame < 24; frame++) {
            step(rig, 0.05);
            expectKernel(rig);
        }
        expect(rig.view.stats.uvUploads).toBeGreaterThan(2);
        expect(rig.view.stats.templateBuilds).toBe(1);
    });

    it('leaves the other vertices alone', async () => {
        const rig = await createRig(syntheticRig('4.2'));
        const flame = slotIndex(rig, 'flame');
        const { state } = rig.engine;

        step(rig, 0);
        const drawn = readDrawn(rig).find((item) => item.slot === flame);
        const before = Array.from(vertexData(rig.view).statics);

        if (drawn === undefined) throw new Error('the flame is visible');
        state.sequenceIndices[flame] = 2;
        drawPose(rig.view, state);
        const after = Array.from(vertexData(rig.view).statics);
        const changed = after.flatMap((value, at) => (Object.is(value, before[at]) ? [] : [Math.floor(at / 3)]));

        expect(rig.view.stats.uvUploads).toBe(1);
        expect(changed.length).toBeGreaterThan(0);
        expect(changed.every((vertex) => vertex >= drawn.first && vertex < drawn.first + 4)).toBe(true);
        expect(readUVs(vertexData(rig.view).statics, drawn.first, 4)).not.toEqual(
            readUVs(Float32Array.from(before), drawn.first, 4),
        );
        // back to the setup region: the same numbers as at the start
        state.sequenceIndices[flame] = -1;
        drawPose(rig.view, state);
        expect(Array.from(vertexData(rig.view).statics)).toEqual(before);
        expect(rig.view.stats.uvUploads).toBe(2);
    });
});
