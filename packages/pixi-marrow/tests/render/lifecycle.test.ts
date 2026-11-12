import { type Buffer, Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { syntheticRig } from '../geometry/synthetic';
import { clipGroups } from './clip-check';
import { settle, WINDOW } from './heap';
import {
    createRig,
    drawPose,
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

/** The smallest box around the vertices of the visible slots, read from the position buffer. */
function boxOf(rig: Rig): { minX: number; minY: number; maxX: number; maxY: number } {
    const { positions } = vertexData(rig.view);
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    for (const { first, count } of readDrawn(rig)) {
        for (let vertex = first; vertex < first + count; vertex++) {
            const x = positions[vertex * 2] ?? Number.NaN;
            const y = positions[vertex * 2 + 1] ?? Number.NaN;

            box.minX = Math.min(box.minX, x);
            box.maxX = Math.max(box.maxX, x);
            box.minY = Math.min(box.minY, y);
            box.maxY = Math.max(box.maxY, y);
        }
    }

    return box;
}

describe('bounds', () => {
    it('gives Pixi the box of the visible vertices without a scan of the vertex buffer', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const stage = new Container();

        stage.addChild(rig.view.container);
        play(rig, 'run');
        step(rig, 0.1);
        const mesh = meshes(rig.view)[0];
        const bounds = mesh?.bounds;

        expect(bounds).toMatchObject(boxOf(rig));
        // hidden attachments keep stale vertices in the buffer. They do not count.
        expect(vertexData(rig.view).positions.length / 2).toBeGreaterThan(visibleSlots(rig).length * 4);
        // asked again without an update: the same object, not measured again
        const { positions } = vertexData(rig.view);
        const first = readDrawn(rig)[0]?.first ?? 0;
        const kept = positions[first * 2] ?? 0;

        positions[first * 2] = 1e6;
        expect(mesh?.bounds).toBe(bounds);
        expect(mesh?.bounds.maxX).toBeLessThan(1e6);
        positions[first * 2] = kept;
        // Pixi measures the container through the mesh
        const local = stage.getLocalBounds();

        expect([local.minX, local.minY, local.maxX, local.maxY]).toEqual([
            bounds?.minX,
            bounds?.minY,
            bounds?.maxX,
            bounds?.maxY,
        ]);
        step(rig, 0.1);
        expect(mesh?.bounds).toMatchObject(boxOf(rig));
        expect(stage.getLocalBounds().maxY).toBe(boxOf(rig).maxY);
    });

    it('shares one box between the meshes of a skeleton with more ranges', async () => {
        const rig = await loadRig('4.2/tank-pro.skel');

        step(rig, 0);
        const all = meshes(rig.view);

        expect(all.length).toBeGreaterThan(1);
        for (const mesh of all) expect(mesh.bounds).toBe(all[0]?.bounds);
        expect(all[0]?.bounds).toMatchObject(boxOf(rig));
    });
});

describe('destroy', () => {
    it('frees the buffers, the meshes and the shaders, and leaves the textures', async () => {
        const rig = await loadRig('4.2/tank-pro.skel');

        step(rig, 0);
        const all = meshes(rig.view);
        const buffers = new Set<Buffer>(all.flatMap((mesh) => mesh.geometry.buffers));
        const shaders = new Set(all.map((mesh) => mesh.shader));
        const texture = all[0]?.shader?.resources.uTexture0;

        // positions, texture coordinates, colors, and an index buffer per mesh
        expect(buffers.size).toBe(3 + all.length);
        rig.view.destroy();
        for (const buffer of buffers) {
            expect(buffer.destroyed).toBe(true);
            expect(buffer.data).toBeNull();
        }
        for (const mesh of all) expect(mesh.destroyed).toBe(true);
        for (const shader of shaders) expect(shader?.glProgram).toBeNull();
        expect(rig.view.container.destroyed).toBe(true);
        expect(texture.destroyed).toBe(false);
        expect(rig.view.stats).toMatchObject({ drawCalls: 0, vertices: 0, indices: 0, bufferBytes: 0 });
        // a second call does nothing, an update says what is wrong
        expect(() => rig.view.destroy()).not.toThrow();
        expect(() => drawPose(rig.view, rig.engine.state)).toThrow(MarrowError);
    });

    it('destroys a view that never drew', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');

        expect(rig.view.container.children.length).toBe(0);
        expect(() => rig.view.destroy()).not.toThrow();
    });
});

describe('memory', () => {
    it('holds 24 bytes per vertex, or 28 with dark colors, and 2 per index', async () => {
        const light = await loadRig('4.2/spineboy-pro.skel');
        const dark = await loadRig('4.2/coin-pro.skel');

        step(light, 0);
        step(dark, 0);
        for (const [rig, perVertex] of [
            [light, 24],
            [dark, 28],
        ] as const) {
            const indexBytes = meshes(rig.view).reduce(
                (sum, mesh) => sum + mesh.geometry.indexBuffer.data.byteLength,
                0,
            );
            // the coin shows a clipping attachment: its mask holds 39 vertices of 8 bytes and 112 indices
            const maskBytes = clipGroups(rig.view).reduce(
                (sum, group) =>
                    sum + group.mask.geometry.buffers.reduce((bytes, buffer) => bytes + buffer.data.byteLength, 0),
                0,
            );

            expect(maskBytes).toBe(rig === dark ? 39 * 8 + 112 * 2 : 0);
            expect(rig.view.stats.bufferBytes).toBe(rig.view.stats.vertices * perVertex + indexBytes + maskBytes);
            expect(indexBytes % 4).toBe(0);
        }
    });

    it.each(['4.2/spineboy-pro.skel', '4.3/tank-pro.skel'])(
        'allocates nothing in update once %s is warm',
        async (id) => {
            const rig = await loadRig(id);
            const { state } = rig.engine;
            const visible = (): number[] => visibleSlots(rig).map((item) => item.slot);

            play(rig, rig.model.animations[0]?.name ?? '');
            step(rig);
            const [a = 0, b = 0, c = 0] = visible();
            const other = rig.model.skins[rig.lookup.defaultSkin]?.attachments.find(
                (item) =>
                    item.slot === c && item.attachment !== state.attachments[c] && item.attachment.type === 'region',
            );
            const shown = state.attachments[c] ?? null;
            // every kind of work the view knows: positions, colors, hiding, reordering, another attachment
            const run = (i: number): void => {
                const at = state.drawOrder.indexOf(a);
                const to = state.drawOrder.indexOf(b);

                state.world[4] = i % 50;
                state.colors[a * 4] = (i % 16) / 16;
                state.colors[b * 4 + 3] = i % 3 === 0 ? 0 : 1;
                state.drawOrder[at] = b;
                state.drawOrder[to] = a;
                if (other !== undefined) state.attachments[c] = i % 5 === 0 ? other.attachment : shown;
                drawPose(rig.view, state);
            };
            const arrays = (): unknown[] => [
                vertexData(rig.view).positions,
                vertexData(rig.view).statics,
                vertexData(rig.view).colorBytes,
                ...rig.view.container.children,
                ...meshes(rig.view).map((mesh) => mesh.geometry.indexBuffer.data),
            ];

            run(0);
            const before = arrays();
            const { indexRebuilds, colorUploads, positionUploads } = rig.view.stats;
            const windows = settle(run);

            expect(windows).toBeGreaterThan(0);
            // the work did run: an index rewrite and a color upload in most updates
            expect(rig.view.stats.positionUploads - positionUploads).toBe(windows * WINDOW);
            expect(rig.view.stats.indexRebuilds - indexRebuilds).toBeGreaterThan(windows * WINDOW * 0.6);
            expect(rig.view.stats.colorUploads - colorUploads).toBeGreaterThan(windows * WINDOW * 0.6);
            expect(rig.view.stats.templateBuilds).toBe(1);
            // the same arrays and the same meshes
            const after = arrays();

            expect(after.length).toBe(before.length);
            after.forEach((array, i) => {
                expect(array).toBe(before[i]);
            });
        },
    );

    it('allocates nothing when a sequence steps', async () => {
        const rig = await createRig(syntheticRig('4.2'));
        const flame = slotIndex(rig, 'flame');
        const { state } = rig.engine;
        const run = (i: number): void => {
            state.sequenceIndices[flame] = i % 3;
            drawPose(rig.view, state);
        };

        step(rig, 0);
        const uploads = rig.view.stats.uvUploads;
        const windows = settle(run);

        expect(windows).toBeGreaterThan(0);
        expect(rig.view.stats.uvUploads - uploads).toBe(windows * WINDOW);
    });
});
