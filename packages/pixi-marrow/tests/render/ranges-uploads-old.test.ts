import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawAndCount, type GpuModel, watchGpu } from './gpu-indices';
import { drawPose, loadRig, meshes, play, type Rig, slotIndex, step } from './rig';

/*
 * The index buffers of the mesh mode on a pixi.js before 8.23. Such a Pixi uploads a WebGL
 * buffer when its geometry is bound, with the size it was told last, and before 8.20 it has no
 * `Geometry.indexCount`: it draws the whole index buffer. In this file the version of Pixi reads
 * 8.16.0, and the uploads are followed as that Pixi makes them.
 */

vi.mock('pixi.js', async (original) => ({ ...(await original<typeof import('pixi.js')>()), VERSION: '8.16.0' }));

const skinOf = (rig: Rig, name: string): number => rig.model.skins.findIndex((skin) => skin.name === name);

describe('the index buffers of the mesh mode on the GPU of an older Pixi', () => {
    let gpu: GpuModel | undefined;

    afterEach(() => {
        gpu?.stop();
        gpu = undefined;
    });

    it('hold no index of a pose before, when a view is updated several times between two draws', async () => {
        gpu = watchGpu(true);
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const { state } = rig.engine;

        step(rig, 0);
        expect(drawAndCount(gpu, meshes(rig.view))).toBe(0);
        const count = meshes(rig.view)[0]?.geometry.indexCount ?? 0;

        // Two slots hide, one per update, and then Pixi draws. The upload of the first update
        // waits, and the second one replaces it: it must still zero what the first one took away
        state.attachments[slotIndex(rig, 'head')] = null;
        drawPose(rig.view, state);
        state.attachments[slotIndex(rig, 'torso')] = null;
        drawPose(rig.view, state);
        expect(meshes(rig.view)[0]?.geometry.indexCount).toBeLessThan(count);
        expect(drawAndCount(gpu, meshes(rig.view))).toBe(0);
        // and an animation that shows and hides slots, drawn in one update of eight
        play(rig, 'shoot');
        for (let frame = 0; frame < 24; frame++) {
            step(rig, 1 / 30);
            if (frame % 8 === 0) expect(drawAndCount(gpu, meshes(rig.view)), `frame ${frame}`).toBe(0);
        }
    });

    it('hold no index of the layout before, after the skin changed', async () => {
        gpu = watchGpu(true);
        const rig = await loadRig('4.2/goblins-pro.skel');

        rig.engine.setSkin(skinOf(rig, 'goblin'));
        play(rig, 'walk');
        for (let frame = 0; frame < 3; frame++) step(rig, 0.05);
        expect(drawAndCount(gpu, meshes(rig.view))).toBe(0);
        for (const skin of ['goblingirl', 'goblin', 'goblingirl']) {
            rig.engine.setSkin(skinOf(rig, skin));
            // two updates and one draw
            step(rig, 0.05);
            step(rig, 0.05);
            expect(drawAndCount(gpu, meshes(rig.view)), skin).toBe(0);
        }
    });
});
