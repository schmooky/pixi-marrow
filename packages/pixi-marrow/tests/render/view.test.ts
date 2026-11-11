import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import type { TimelineKind } from '../../src/model/timelines';
import { u8, u16 } from '../../src/render/read';
import { listFixtures } from '../parity/fixtures';
import {
    expectKernel,
    FRAME,
    loadRig,
    meshes,
    play,
    type Rig,
    readDrawn,
    slotIndex,
    step,
    vertexData,
    visibleSlots,
} from './rig';

/** Timelines that can change which slots are visible, or their order. */
const INDEX_KINDS: readonly TimelineKind[] = ['attachment', 'drawOrder', 'drawOrderFolder', 'rgba', 'alpha', 'rgba2'];

/** The animations of a rig that key none of the given timeline kinds. */
const animationsWithout = (rig: Rig, kinds: readonly TimelineKind[]): string[] =>
    rig.model.animations
        .filter((animation) => animation.timelines.every((timeline) => !kinds.includes(timeline.kind)))
        .map((animation) => animation.name);

describe('SkeletonView', () => {
    it('draws the setup pose with the positions of the geometry kernel', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');

        step(rig, 0);
        const drawn = expectKernel(rig);

        expect(drawn.length).toBeGreaterThan(10);
        expect(rig.view.stats).toMatchObject({ templateBuilds: 1, indexRebuilds: 1, positionUploads: 1, drawCalls: 1 });
        expect(rig.view.stats.indices).toBe(meshes(rig.view)[0]?.geometry.indexCount);
        // every visible slot has a vertex range of its own
        const ranges = drawn
            .map((item) => [item.first, item.first + item.count])
            .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));

        ranges.forEach((range, i) => {
            expect(range[0]).toBeGreaterThanOrEqual(ranges[i - 1]?.[1] ?? 0);
        });
        expect(ranges.at(-1)?.[1]).toBeLessThanOrEqual(rig.view.stats.vertices);
    });

    // every official export: both formats of every version
    it.each(listFixtures().map((fixture) => fixture.id))('follows the kernel while %s plays', async (id) => {
        const rig = await loadRig(id);
        const skins = rig.model.skins.length > 1 ? [rig.model.skins.length - 1] : [-1];

        for (const skin of skins) {
            rig.engine.setSkin(skin);
            rig.engine.setupPoseSlots();
            for (const animation of rig.model.animations.slice(0, 4)) {
                play(rig, animation.name);
                for (let frame = 0; frame < 5; frame++) {
                    step(rig, Math.max(animation.duration, FRAME) / 4.5);
                    expectKernel(rig);
                }
            }
        }
        // one build for the default skin, one more when a skin was set
        expect(rig.view.stats.templateBuilds).toBe(rig.model.skins.length > 1 ? 2 : 1);
        expect(rig.view.stats.drawCalls).toBe(meshes(rig.view).length);
        expect(rig.view.stats.indices).toBe(meshes(rig.view).reduce((sum, mesh) => sum + mesh.geometry.indexCount, 0));
    });

    it('never rewrites the index buffer while an animation without such keys plays', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const quiet = animationsWithout(rig, INDEX_KINDS);

        expect(quiet).toContain('walk');
        step(rig, 0);
        const { positions, statics, colors } = vertexData(rig.view);
        const indices = meshes(rig.view)[0]?.geometry.indexBuffer.data;
        const before = { indices: Array.from(indices ?? []), statics: Array.from(statics), colors: Array.from(colors) };
        let frames = 0;

        for (const animation of quiet) {
            play(rig, animation);
            for (let frame = 0; frame < 40; frame++, frames++) step(rig);
        }
        expect(rig.view.stats).toMatchObject({
            templateBuilds: 1,
            indexRebuilds: 1,
            positionUploads: frames + 1,
            colorUploads: 1,
            uvUploads: 0,
        });
        // the same arrays, and only the positions changed
        const after = vertexData(rig.view);

        expect(after.positions).toBe(positions);
        expect(after.statics).toBe(statics);
        expect(meshes(rig.view)[0]?.geometry.indexBuffer.data).toBe(indices);
        expect(Array.from(indices ?? [])).toEqual(before.indices);
        expect(Array.from(statics)).toEqual(before.statics);
        expect(Array.from(colors)).toEqual(before.colors);
        expectKernel(rig);
    });

    it('rewrites the index buffer only, when attachment keys play', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');

        step(rig, 0);
        const { positions, statics } = vertexData(rig.view);
        const uvs = Array.from(statics);

        // portal shows and hides the portal pieces and the muzzle flashes
        play(rig, 'portal');
        for (let frame = 0; frame < 90; frame++) {
            step(rig);
            expectKernel(rig);
        }
        expect(rig.view.stats.indexRebuilds).toBeGreaterThan(3);
        expect(rig.view.stats.indexRebuilds).toBeLessThan(60);
        expect(rig.view.stats).toMatchObject({ templateBuilds: 1, uvUploads: 0, drawCalls: 1 });
        expect(vertexData(rig.view).positions).toBe(positions);
        expect(Array.from(vertexData(rig.view).statics)).toEqual(uvs);
    });

    it('rewrites the index buffer when a slot is hidden, shown or reordered, and at no other time', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const { state } = rig.engine;
        const { stats } = rig.view;
        const head = slotIndex(rig, 'head');
        const update = (): number => {
            rig.view.update(state);
            readDrawn(rig);

            return stats.indexRebuilds;
        };

        step(rig, 0);
        expect(update()).toBe(1);
        const vertices = Array.from(vertexData(rig.view).statics);
        const shown = state.attachments[head] ?? null;

        // no attachment
        state.attachments[head] = null;
        expect(update()).toBe(2);
        expect(update()).toBe(2);
        state.attachments[head] = shown;
        expect(update()).toBe(3);
        // alpha 0 hides, any other alpha does not
        state.colors[head * 4 + 3] = 0;
        expect(update()).toBe(4);
        expect(visibleSlots(rig).some((item) => item.slot === head)).toBe(false);
        state.colors[head * 4 + 3] = 0.5;
        expect(update()).toBe(5);
        state.colors[head * 4 + 3] = 0.25;
        expect(update()).toBe(5);
        // an inactive bone
        const bone = rig.model.slots.bones[head] ?? 0;

        state.active[bone] = 0;
        expect(update()).toBe(6);
        state.active[bone] = 1;
        expect(update()).toBe(7);
        // the draw order of two visible slots
        const swap = (a: number, b: number): void => {
            const at = state.drawOrder.indexOf(a);
            const other = state.drawOrder.indexOf(b);

            state.drawOrder[at] = b;
            state.drawOrder[other] = a;
        };
        const [first, second] = visibleSlots(rig).map((item) => item.slot);

        swap(first ?? 0, second ?? 0);
        expect(update()).toBe(8);
        expect(update()).toBe(8);
        // two hidden slots trade places: the picture is the same
        const hidden = Array.from(state.drawOrder).filter((slot) => state.attachments[slot] == null);

        expect(hidden.length).toBeGreaterThan(1);
        swap(hidden[0] ?? 0, hidden[1] ?? 0);
        expect(update()).toBe(8);
        expect(stats).toMatchObject({ templateBuilds: 1, uvUploads: 0 });
        expect(Array.from(vertexData(rig.view).statics)).toEqual(vertices);
    });

    it('draws nothing for a clipping attachment and says that clipping was ignored', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const { state } = rig.engine;
        const clip = rig.model.skins
            .flatMap((skin) => skin.attachments)
            .find((item) => item.attachment.type === 'clipping');

        step(rig, 0);
        expect(rig.view.stats.clippingIgnored).toBe(0);
        if (clip === undefined) throw new Error('spineboy has a clipping attachment');
        const indices = rig.view.stats.indices;

        state.attachments[clip.slot] = clip.attachment;
        rig.view.update(state);
        expect(rig.view.stats.clippingIgnored).toBe(1);
        // nothing is clipped and nothing more is drawn
        expect(rig.view.stats.indices).toBe(indices);
        readDrawn(rig);
        state.active[rig.model.slots.bones[clip.slot] ?? 0] = 0;
        rig.view.update(state);
        expect(rig.view.stats.clippingIgnored).toBe(0);
    });

    it('does not read past the end of an array without a word', () => {
        expect(u8(Uint8Array.of(7, 9), 1)).toBe(9);
        expect(u16(Uint16Array.of(7, 65535), 1)).toBe(65535);
        expect(() => u8(new Uint8Array(2), 2)).toThrow(MarrowError);
        expect(() => u16(new Uint16Array(2), -1)).toThrow(/read index -1 of an array of 2 numbers/);
    });

    it('throws for a pose of another model', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const other = await loadRig('4.2/raptor-pro.skel');

        expect(() => rig.view.update(other.engine.state)).toThrow(MarrowError);
    });
});
