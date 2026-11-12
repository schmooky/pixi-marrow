import { afterEach, describe, expect, it } from 'vitest';
import { drawAndCount, type GpuModel, watchGpu } from './gpu-indices';
import { drawPose, loadRig, meshes, play, type Rig, slotIndex, step } from './rig';

/*
 * The index buffer of a draw range is zero past the indices the range draws, on the GPU too: a
 * Pixi without `Geometry.indexCount` draws the whole buffer. Here the uploads are followed as
 * the installed pixi.js makes them: at once.
 */

const skinOf = (rig: Rig, name: string): number => rig.model.skins.findIndex((skin) => skin.name === name);

describe('the index buffers of the mesh mode on the GPU', () => {
    let gpu: GpuModel | undefined;

    afterEach(() => {
        gpu?.stop();
        gpu = undefined;
    });

    it('hold no index of the layout before, after the skin changed', async () => {
        gpu = watchGpu(false);
        const rig = await loadRig('4.2/goblins-pro.skel');

        rig.engine.setSkin(skinOf(rig, 'goblin'));
        play(rig, 'walk');
        for (let frame = 0; frame < 3; frame++) step(rig, 0.05);
        expect(drawAndCount(gpu, meshes(rig.view))).toBe(0);
        const [first] = meshes(rig.view);
        const before = first?.geometry.indexBuffer.data;
        const count = first?.geometry.indexCount ?? 0;

        rig.engine.setSkin(skinOf(rig, 'goblingirl'));
        step(rig, 0.05);
        // the other skin draws fewer indices from the same array: the rest must be zero on the GPU
        expect(meshes(rig.view)[0]?.geometry.indexBuffer.data).toBe(before);
        expect(meshes(rig.view)[0]?.geometry.indexCount).toBeLessThan(count);
        expect(drawAndCount(gpu, meshes(rig.view))).toBe(0);
        rig.engine.setSkin(skinOf(rig, 'goblin'));
        step(rig, 0.05);
        expect(drawAndCount(gpu, meshes(rig.view))).toBe(0);
    });

    it('hold no index of a pose before, when a view is updated several times between two draws', async () => {
        gpu = watchGpu(false);
        const rig = await loadRig('4.2/spineboy-pro.skel');

        play(rig, 'shoot');
        for (let frame = 0; frame < 24; frame++) {
            step(rig, 1 / 30);
            if (frame % 8 === 0) expect(drawAndCount(gpu, meshes(rig.view)), `frame ${frame}`).toBe(0);
        }
    });

    it('upload the indices that changed and no more', async () => {
        gpu = watchGpu(false);
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const { state } = rig.engine;
        const head = slotIndex(rig, 'head');

        step(rig, 0);
        const [mesh] = meshes(rig.view);

        if (mesh === undefined) throw new Error('the view has no mesh');
        const { indexBuffer } = mesh.geometry;
        const count = mesh.geometry.indexCount;
        const shown = state.attachments[head] ?? null;
        let moved = gpu.moved(indexBuffer);

        // a slot hides: the indices that are left, and zeros over the ones that were there
        state.attachments[head] = null;
        drawPose(rig.view, state);
        const fewer = mesh.geometry.indexCount;

        expect(fewer).toBeLessThan(count);
        expect(gpu.moved(indexBuffer) - moved).toBe(count);
        moved = gpu.moved(indexBuffer);
        // and shows again: the indices of the range, which is all the GPU can hold of it
        state.attachments[head] = shown;
        drawPose(rig.view, state);
        expect(gpu.moved(indexBuffer) - moved).toBe(count);
        expect(drawAndCount(gpu, meshes(rig.view))).toBe(0);
    });
});
