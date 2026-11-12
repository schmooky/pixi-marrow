import { type Buffer, Container, Mesh } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { createMaskShader, releaseShader } from '../../src/render/shader';
import { clipAttachment, clipGroups, expectClips, maskShape } from './clip-check';
import { settle, WINDOW } from './heap';
import { drawPose, loadRig, meshes, play, type Rig, readDrawn, slotIndex, step, vertexData } from './rig';

/*
 * What a clip costs and when: nothing while no clipping attachment is shown, one small upload
 * per update while one is, and no allocation once the masks exist.
 */

const QUAD = [-220, -160, -180, 240, 260, 210, 230, -190];
const CONCAVE = [-250, -200, -230, 260, 0, 40, 240, 250, 260, -210, 10, -60];

/** Every Pixi buffer the view draws from: those of its meshes and of its masks. */
function buffersOf(rig: Rig): Set<Buffer> {
    const all = [...meshes(rig.view), ...clipGroups(rig.view).map((group) => group.mask)];

    return new Set(all.flatMap((mesh) => mesh.geometry.buffers));
}

/** The mask of the first clip group that draws. */
function firstMask(rig: Rig): Mesh {
    const mask = clipGroups(rig.view)[0]?.mask;

    if (mask === undefined) throw new Error('the view draws no clip group');

    return mask;
}

/** Spineboy in the setup pose with a clip on the gun slot that ends at the head. */
async function clipped(polygon: readonly number[] = QUAD): Promise<Rig> {
    const rig = await loadRig('4.2/spineboy-pro.skel');

    step(rig, 0);
    rig.engine.state.attachments[slotIndex(rig, 'gun')] = clipAttachment('clip', slotIndex(rig, 'head'), polygon);
    drawPose(rig.view, rig.engine.state);

    return rig;
}

describe('a skeleton that shows no clipping attachment', () => {
    it('has the meshes and buffers it had before clipping, and no mask', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const { stats } = rig.view;

        // spineboy has a clipping attachment that these animations do not show
        for (const animation of ['walk', 'run', 'jump']) {
            play(rig, animation);
            for (let frame = 0; frame < 20; frame++) {
                step(rig);
                expect(stats.clips).toBe(0);
            }
        }
        expect(stats).toMatchObject({ drawCalls: 1, maskDraws: 0, maskUploads: 0, maskRebuilds: 0 });
        // one mesh, and nothing else in the container
        expect(rig.view.container.children.length).toBe(1);
        expect(rig.view.container.children[0]).toBeInstanceOf(Mesh);
        // positions, texture coordinates, colors and one index buffer
        expect(buffersOf(rig).size).toBe(4);
        expect(stats.bufferBytes).toBe(
            stats.vertices * 24 + (meshes(rig.view)[0]?.geometry.indexBuffer.data.byteLength ?? 0),
        );
    });

    it('stops paying when the clip ends, and keeps the mask for the next time', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const { stats } = rig.view;
        const { state } = rig.engine;
        const gun = slotIndex(rig, 'gun');
        const shown = () => state.attachments[gun] ?? null;

        step(rig, 0);
        const image = shown();
        const before = stats.bufferBytes;

        state.attachments[gun] = clipAttachment('clip', slotIndex(rig, 'head'), QUAD);
        drawPose(rig.view, state);
        expect(stats).toMatchObject({ clips: 1, maskDraws: 2, drawCalls: 5, maskUploads: 1 });
        const [group] = clipGroups(rig.view);
        const withClip = stats.bufferBytes;

        // the mask and two more ranges, each with an index buffer
        expect(withClip).toBeGreaterThan(before);
        state.attachments[gun] = image;
        for (let frame = 0; frame < 5; frame++) drawPose(rig.view, state);
        // one draw call again, no upload for the mask, and nothing was freed
        expect(stats).toMatchObject({ clips: 0, maskDraws: 0, drawCalls: 1, maskUploads: 1 });
        expect(clipGroups(rig.view)).toEqual([]);
        expect(group?.container.visible).toBe(false);
        expect(stats.bufferBytes).toBe(withClip);
        expect(meshes(rig.view).length).toBe(1);
        readDrawn(rig);
        // the clip again: the same container and the same mask
        state.attachments[gun] = clipAttachment('clip', slotIndex(rig, 'head'), QUAD);
        drawPose(rig.view, state);
        expect(clipGroups(rig.view)[0]?.container).toBe(group?.container);
        expect(clipGroups(rig.view)[0]?.mask).toBe(group?.mask);
        expect(stats.bufferBytes).toBe(withClip);
        expectClips(rig);
    });
});

describe('a clip mask', () => {
    it('uploads its polygon in every update and its triangles when they change', async () => {
        const rig = await clipped(CONCAVE);
        const { stats } = rig.view;
        const { state } = rig.engine;
        const bone = (rig.model.slots.bones[slotIndex(rig, 'gun')] ?? 0) * 6;
        const { positions } = maskShape(firstMask(rig));
        const first = Array.from(positions);

        expect(stats).toMatchObject({ maskUploads: 1, maskRebuilds: 1, indexRebuilds: 2 });
        // the bone of the clip moves: the polygon follows, the triangles and the ranges stay
        for (let frame = 1; frame <= 10; frame++) {
            state.world[bone + 4] = (state.world[bone + 4] ?? 0) + 3;
            drawPose(rig.view, state);
            expectClips(rig);
        }
        expect(stats).toMatchObject({ maskUploads: 11, maskRebuilds: 1, indexRebuilds: 2, drawCalls: 5 });
        first.forEach((value, at) => {
            expect(positions[at]).toBeCloseTo(at % 2 === 0 ? value + 30 : value, 3);
        });
        // the bone is mirrored: the polygon turns around and gets new triangles
        state.world[bone] = -(state.world[bone] ?? 0);
        state.world[bone + 2] = -(state.world[bone + 2] ?? 0);
        drawPose(rig.view, state);
        expectClips(rig);
        expect(stats).toMatchObject({ maskUploads: 12, maskRebuilds: 2, indexRebuilds: 2 });
    });

    it('grows for a polygon with more vertices and keeps its size after that', async () => {
        const rig = await clipped();
        const { stats } = rig.view;
        const { state } = rig.engine;
        const gun = slotIndex(rig, 'gun');
        const head = slotIndex(rig, 'head');
        const small = stats.bufferBytes;
        const rebuilds = stats.indexRebuilds;
        const corners = 40;
        const large = Array.from({ length: corners }, (_, i) => {
            const angle = (-2 * Math.PI * i) / corners;
            const radius = i % 2 === 0 ? 300 : 180;

            return [Math.cos(angle) * radius, Math.sin(angle) * radius];
        }).flat();

        state.attachments[gun] = clipAttachment('star', head, large);
        drawPose(rig.view, state);
        expectClips(rig);
        // 4 vertices and 6 indices became 40 and 114. The ranges did not change
        expect(stats.bufferBytes - small).toBe((corners - 4) * 8 + (114 - 6) * 2);
        expect(stats.indexRebuilds).toBe(rebuilds);
        expect(clipGroups(rig.view)[0]?.mask.geometry.indexCount).toBe(114);
        const grown = stats.bufferBytes;
        const { buffers } = clipGroups(rig.view)[0]?.mask.geometry ?? { buffers: [] };
        const arrays = buffers.map((buffer) => buffer.data);

        state.attachments[gun] = clipAttachment('quad', head, QUAD);
        drawPose(rig.view, state);
        expectClips(rig);
        expect(stats.bufferBytes).toBe(grown);
        // the polygon keeps its array. The triangles are the six numbers of the quad, in their own array
        expect(buffers[0]?.data).toBe(arrays[0]);
        expect(maskShape(firstMask(rig)).triangles.length).toBe(6);
        expect(buffers[1]?.data.length).toBe(6);
    });

    it('keeps an index array of its own only for a polygon that a deform shapes', async () => {
        const rig = await clipped();
        const { stats } = rig.view;
        const { state } = rig.engine;
        const gun = slotIndex(rig, 'gun');
        const head = slotIndex(rig, 'head');
        const [, indexBuffer] = clipGroups(rig.view)[0]?.mask.geometry.buffers ?? [];
        const shared = indexBuffer?.data;
        const deform = (polygon: readonly number[]): void => {
            state.deform[gun] = Float64Array.from(polygon);
            state.deformLengths[gun] = polygon.length;
        };

        expect(stats.maskRebuilds).toBe(1);
        // a deform gives every pose its own shape: the triangles are cut for the pose
        state.attachments[gun] = clipAttachment('bent', head, CONCAVE);
        deform(CONCAVE.map((value, at) => (at === 4 ? value + 30 : value)));
        drawPose(rig.view, state);
        expectClips(rig);
        const own = indexBuffer?.data;

        expect(own).not.toBe(shared);
        expect(own?.length).toBe(12);
        expect(stats.maskRebuilds).toBe(2);
        // the same triangles again: nothing uploads
        drawPose(rig.view, state);
        expect(indexBuffer?.data).toBe(own);
        expect(stats.maskRebuilds).toBe(2);
        // a deformed quad fits the array. The indices it does not use are triangles without area
        state.attachments[gun] = clipAttachment('quad', head, QUAD);
        deform(QUAD);
        drawPose(rig.view, state);
        expectClips(rig);
        expect(indexBuffer?.data).toBe(own);
        expect(Array.from(own ?? []).slice(6)).toEqual(new Array(6).fill(0));
        expect(maskShape(firstMask(rig)).triangles.length).toBe(6);
        expect(stats.maskRebuilds).toBe(3);
        // without the deform the quad is the same shape in every pose and has triangles to share
        state.deformLengths[gun] = 0;
        drawPose(rig.view, state);
        expectClips(rig);
        expect(indexBuffer?.data).not.toBe(own);
        expect(indexBuffer?.data.length).toBe(6);
        expect(stats.maskRebuilds).toBe(4);
        // and back: the array of its own still holds the quad, and uploads again
        deform(QUAD);
        drawPose(rig.view, state);
        expectClips(rig);
        expect(indexBuffer?.data).toBe(own);
        expect(stats.maskRebuilds).toBe(5);
    });

    it('leaves the bounds of the skeleton as they are', async () => {
        const rig = await clipped();
        const stage = new Container();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        stage.addChild(rig.view.container);
        const box = meshes(rig.view)[0]?.bounds;
        const local = stage.getLocalBounds();

        // the mask reports the box of the visible vertices, so Pixi cuts nothing off
        expect(clipGroups(rig.view)[0]?.mask.bounds).toBe(box);
        expect([local.minX, local.minY, local.maxX, local.maxY]).toEqual([box?.minX, box?.minY, box?.maxX, box?.maxY]);
        expect(rig.view.container.getLocalBounds().maxY).toBe(box?.maxY);
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('is freed with the view', async () => {
        const rig = await clipped();
        const buffers = buffersOf(rig);
        const all = meshes(rig.view);
        const groups = clipGroups(rig.view);
        const shaders = new Set(all.map((mesh) => mesh.shader));
        // all masks draw with one shader, which lives while somebody holds it
        const shared = createMaskShader();

        // positions, texture coordinates, colors, three index buffers, and the two buffers of the mask
        expect(buffers.size).toBe(3 + 3 + 2);
        expect(shaders.size).toBe(1);
        expect(groups.map((group) => group.mask.shader)).toEqual([shared]);
        rig.view.destroy();
        for (const buffer of buffers) expect(buffer.destroyed).toBe(true);
        for (const mesh of all) expect(mesh.destroyed).toBe(true);
        for (const group of groups) {
            expect(group.mask.destroyed).toBe(true);
            expect(group.container.destroyed).toBe(true);
        }
        // the shader of the ranges samples the pages of this rig, and nobody else holds it
        for (const shader of shaders) expect(shader?.glProgram).toBeNull();
        expect(shared.glProgram).not.toBeNull();
        releaseShader(shared);
        expect(rig.view.stats).toMatchObject({ drawCalls: 0, maskDraws: 0, clips: 0, bufferBytes: 0 });
    });
});

describe('a clipping attachment that cannot clip', () => {
    it('throws an error that names it, in every update, until the slot shows something else', async () => {
        const rig = await loadRig('4.3/spineboy-pro.skel');
        const { state } = rig.engine;
        const gun = slotIndex(rig, 'gun');

        step(rig, 0);
        const image = state.attachments[gun] ?? null;
        const { indexRebuilds } = rig.view.stats;

        state.attachments[gun] = clipAttachment('two-points', -1, [0, 0, 10, 10]);
        for (let i = 0; i < 3; i++) {
            expect(() => drawPose(rig.view, state)).toThrow(MarrowError);
            expect(() => drawPose(rig.view, state)).toThrow('The clipping attachment "two-points" has 2 vertices');
        }
        // nothing was drawn differently
        expect(rig.view.stats).toMatchObject({ indexRebuilds, clips: 0, maskDraws: 0 });
        state.attachments[gun] = image;
        expect(() => drawPose(rig.view, state)).not.toThrow();
        readDrawn(rig);
    });
});

describe('memory', () => {
    it.each(['4.1', '4.2', '4.3'])(
        'allocates nothing in update once the clips of a %s rig are warm',
        async (version) => {
            const rig = await loadRig(`${version}/spineboy-pro.skel`);
            const { state } = rig.engine;
            const { bones } = rig.model.slots;
            const [gun, neck, torso, eye] = ['gun', 'neck', 'torso', 'eye'].map((name) => slotIndex(rig, name));
            const first = clipAttachment('first', slotIndex(rig, 'rear-shin'), CONCAVE);
            const second = clipAttachment('second', slotIndex(rig, 'head'), QUAD, { inverse: version === '4.3' });
            const world = (bones[gun ?? 0] ?? 0) * 6;

            step(rig, 0);
            const image = state.attachments[neck ?? 0] ?? null;
            const scale = state.world[world] ?? 1;
            const shear = state.world[world + 2] ?? 0;
            // worked out here: a float that `run` computed could be allocated, and that is not the view's doing
            const [mirroredScale, mirroredShear] = [-scale, -shear];

            state.attachments[gun ?? 0] = first;
            // every kind of work a clip knows: the polygon moves and turns around, a clip comes and goes,
            // a slot inside one hides, and a slot moves across the edge of one
            const run = (i: number): void => {
                const at = state.drawOrder.indexOf(torso ?? 0);
                const to = state.drawOrder.indexOf(eye ?? 0);

                state.world[world + 4] = i % 40;
                // the bone is mirrored in every seventh update
                state.world[world] = i % 7 === 0 ? mirroredScale : scale;
                state.world[world + 2] = i % 7 === 0 ? mirroredShear : shear;
                state.attachments[neck ?? 0] = i % 3 === 0 ? image : second;
                state.colors[(torso ?? 0) * 4 + 3] = i % 5 === 0 ? 0 : 1;
                state.drawOrder[at] = eye ?? 0;
                state.drawOrder[to] = torso ?? 0;
                drawPose(rig.view, state);
            };
            const arrays = (): unknown[] => [
                vertexData(rig.view).positions,
                ...rig.view.container.children,
                ...rig.view.container.children.flatMap((child) => child.children),
                ...meshes(rig.view).map((mesh) => mesh.geometry.indexBuffer.data),
                ...clipGroups(rig.view).flatMap((group) => group.mask.geometry.buffers.map((buffer) => buffer.data)),
            ];

            for (let i = 0; i < 30; i++) run(i);
            run(1);
            const before = arrays();
            const { indexRebuilds, maskUploads, maskRebuilds } = rig.view.stats;
            const windows = settle(run);

            expect(windows).toBeGreaterThan(0);
            // the work did run: two masks in two of three updates, new ranges in most, new triangles in some
            expect(rig.view.stats.maskUploads - maskUploads).toBeGreaterThan(windows * WINDOW * 1.5);
            expect(rig.view.stats.indexRebuilds - indexRebuilds).toBeGreaterThan(windows * WINDOW * 0.6);
            expect(rig.view.stats.maskRebuilds - maskRebuilds).toBeGreaterThan(windows * WINDOW * 0.2);
            expect(rig.view.stats.templateBuilds).toBe(1);
            // the same arrays, meshes and containers
            run(1);
            const after = arrays();

            expect(after.length).toBe(before.length);
            after.forEach((item, i) => {
                expect(item).toBe(before[i]);
            });
            expectClips(rig);
        },
    );
});
