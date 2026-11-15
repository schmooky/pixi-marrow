import type { Renderer } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextVersion } from '../../src/pose/state';
import { drawAndCount, type GpuModel, watchGpu } from './gpu-indices';
import { drawPose, loadRig, meshes, play, type Rig, slotIndex, step } from './rig';

/*
 * The index buffers of the mesh mode on a pixi.js before 8.23. Such a Pixi uploads a WebGL
 * buffer when its geometry is bound, with the size it was told last, and before 8.20 it has no
 * `Geometry.indexCount`: it draws the whole index buffer. In this file the version of Pixi reads
 * 8.16.0, and the uploads are followed as that Pixi makes them.
 */

vi.mock('pixi.js', async (original) => ({ ...(await original<typeof import('pixi.js')>()), VERSION: '8.21.0' }));

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

describe('the vertex buffers of the mesh mode on an older Pixi', () => {
    it('upload one stretch with the render, which a WebGL renderer uploads at once', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');

        play(rig, 'walk');
        step(rig, 0);
        const mesh = rig.view.parts.paints.mesh;
        const positions = meshes(rig.view)[0]?.geometry.getBuffer('aPosition');

        if (mesh === undefined || positions === undefined) throw new Error('the view has no mesh');
        const pushed: unknown[] = [];
        const webgl = { buffer: { updateBuffer: (buffer: unknown) => pushed.push(buffer) } } as unknown as Renderer;
        const webgpu = { gpu: {}, buffer: { updateBuffer: () => pushed.push('gpu') } } as unknown as Renderer;
        const update = vi.spyOn(positions, 'update');
        const { stats } = rig.view;
        const head = rig.model.bones.names.indexOf('head');
        /** Moves the head, and with it the slots on it and the meshes with a vertex on it. */
        const nod = (): void => {
            const { state } = rig.engine;

            state.world[head * 6 + 4] = Number(state.world[head * 6 + 4]) + 1;
            state.version = nextVersion(state.version);
            state.boneStamps[head] = state.version;
            rig.view.update(state);
        };

        mesh.flush(webgl);
        update.mockClear();
        pushed.length = 0;
        const before = stats.uploadBytes.positions;

        // two updates and one render: the stretch waits for the render, and is one stretch
        nod();
        nod();
        expect(update).not.toHaveBeenCalled();
        expect(stats.frameBytes).toBe(0);
        mesh.flush(webgl);
        expect(update).toHaveBeenCalledTimes(1);
        const [size = 0, offset = 0] = update.mock.calls[0] ?? [];

        // the vertices the head moves, not the whole buffer, as Pixi uploads a stretch from 8.21 on
        expect(size).toBeGreaterThan(0);
        expect(offset + size).toBeLessThan(positions.data.byteLength);
        expect(stats.uploadBytes.positions - before).toBe(size);
        expect(stats.frameBytes).toBe(size);
        // a WebGL buffer of this Pixi keeps one stretch until it is bound: the renderer uploads it now
        expect(pushed).toEqual([positions]);
        // a render after no update uploads nothing
        mesh.flush(webgl);
        expect(update).toHaveBeenCalledTimes(1);
        // WebGPU writes a stretch when it is told, so nothing is pushed
        nod();
        mesh.flush(webgpu);
        expect(update).toHaveBeenCalledTimes(2);
        expect(pushed).toEqual([positions]);
        // a hidden view uploads when Pixi draws it again
        rig.view.container.visible = false;
        nod();
        mesh.flush(webgl);
        expect(update).toHaveBeenCalledTimes(2);
        rig.view.container.visible = true;
        mesh.flush(webgl);
        expect(update).toHaveBeenCalledTimes(3);
    });
});
