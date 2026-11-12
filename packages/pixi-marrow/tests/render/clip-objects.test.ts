import { type Buffer, type Container, type Geometry, Mesh, type Shader, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createPoseEngine } from '../../src/pose/engine';
import { SkeletonView } from '../../src/render/skeleton-view';
import { clipGroups } from './clip-check';
import { FRAME, loadRig, play, type Rig, step } from './rig';

/*
 * How many Pixi objects an instance creates for a clip. Every one of them is heap that each
 * instance pays: in Chrome a mesh with its matrices and bounds is about 1.1 kB, a geometry about
 * 0.8 kB, a buffer about 0.65 kB without its data, a shader about 1.4 kB and a container about
 * 0.75 kB. The coin holds a third more heap with its clip than without.
 *
 * The counts are upper bounds. A count that grows is a regression and fails here. A count that
 * shrinks is progress: lower the bound then, so that it stays tight.
 */

/** The Pixi objects under the container of a view, by kind. */
interface Census {
    /** Containers that are no mesh, with the container of the view itself. */
    containers: number;
    /** Containers that draw through a mask mesh. */
    masked: number;
    meshes: number;
    geometries: Set<Geometry>;
    buffers: Set<Buffer>;
    shaders: Set<Shader>;
    /** The typed arrays behind the buffers. */
    arrays: Set<unknown>;
}

/** Counts the objects of a view, hidden ones too: they are held all the same. */
function census(view: SkeletonView): Census {
    const found: Census = {
        containers: 0,
        masked: 0,
        meshes: 0,
        geometries: new Set(),
        buffers: new Set(),
        shaders: new Set(),
        arrays: new Set(),
    };
    const visit = (node: Container): void => {
        if (node instanceof Mesh) {
            found.meshes++;
            found.geometries.add(node.geometry);
            if (node.shader !== null) found.shaders.add(node.shader);
            for (const buffer of node.geometry.buffers) {
                found.buffers.add(buffer);
                found.arrays.add(buffer.data);
            }

            return;
        }
        found.containers++;
        if (node.mask instanceof Mesh) found.masked++;
        for (const child of node.children) visit(child);
    };

    visit(view.container);

    return found;
}

/** The counts of a census as plain numbers. */
function counts(view: SkeletonView): Record<string, number> {
    const found = census(view);

    return {
        containers: found.containers,
        masked: found.masked,
        meshes: found.meshes,
        geometries: found.geometries.size,
        buffers: found.buffers.size,
        shaders: found.shaders.size,
        arrays: found.arrays.size,
    };
}

/** The coin with its animation played for a moment, so that every object it needs exists. */
async function coin(version: string, clip: boolean): Promise<Rig> {
    const rig = await loadRig(`${version}/coin-pro.skel`, (model) => {
        if (!clip) model.slots.attachments[model.slots.names.indexOf('clipping')] = null;
    });

    play(rig, 'animation');
    // the coin turns once in the animation, so its clip polygon shows both vertex orders
    for (let frame = 0; frame < 90; frame++) step(rig, FRAME);

    return rig;
}

/** Fails for a count above its bound, and names it. */
function expectAtMost(actual: Record<string, number>, bounds: Record<string, number>): void {
    for (const [kind, bound] of Object.entries(bounds)) {
        expect(actual[kind], `${kind} of one instance`).toBeLessThanOrEqual(bound);
    }
}

describe.each(['4.2', '4.3'])('the Pixi objects of a %s coin', (version) => {
    it('are one mesh, one geometry and four buffers without the clip', async () => {
        const rig = await coin(version, false);

        expect(rig.view.stats).toMatchObject({ clips: 0, drawCalls: 1 });
        // positions, texture coordinates, colors and the indices of the one draw range
        expectAtMost(counts(rig.view), {
            containers: 1,
            masked: 0,
            meshes: 1,
            geometries: 1,
            buffers: 4,
            shaders: 1,
            arrays: 4,
        });
    });

    it('are at most a container, two meshes, two geometries, three buffers and a shader more with the clip', async () => {
        const plain = counts((await coin(version, false)).view);
        const rig = await coin(version, true);
        const clipped = counts(rig.view);

        expect(rig.view.stats).toMatchObject({ clips: 1, drawCalls: 4, maskDraws: 2 });
        // the clipped range and the mask are a mesh, a geometry and an index buffer each. The mask
        // also has a buffer for its polygon. The container carries the mask, which draws with the
        // one shader of all masks
        expectAtMost(clipped, {
            containers: 2,
            masked: 1,
            meshes: 3,
            geometries: 3,
            buffers: 7,
            shaders: 2,
            arrays: 7,
        });
        expectAtMost(
            Object.fromEntries(Object.entries(clipped).map(([kind, count]) => [kind, count - (plain[kind] ?? 0)])),
            { containers: 1, masked: 1, meshes: 2, geometries: 2, buffers: 3, shaders: 1, arrays: 3 },
        );
    });

    it('include one mask of one mesh, one geometry and two buffers', async () => {
        const rig = await coin(version, true);
        const groups = clipGroups(rig.view);
        const mask = groups[0]?.mask;

        expect(groups.length).toBe(1);
        expect(mask?.children.length).toBe(0);
        expect(mask?.geometry.buffers.length).toBe(2);
        // 39 vertices, and 37 triangles: 111 indices and a 0 that makes the count even
        expect(mask?.geometry.getBuffer('aPosition').data.length).toBe(39 * 2);
        expect(mask?.geometry.indexBuffer.data.length).toBe(112);
        expect(mask?.geometry.indexCount).toBe(111);
    });

    it('share the triangles of the mask between instances: the polygon is the one array a clip adds', async () => {
        const rig = await coin(version, true);
        const engine = await createPoseEngine(rig.model);
        const view = new SkeletonView(
            rig.model,
            rig.atlas,
            rig.atlas.pages.map(() => Texture.WHITE),
        );
        const second: Rig = { ...rig, engine, view };

        play(second, 'animation');
        for (let frame = 0; frame < 90; frame++) step(second, FRAME);
        const [first, other] = [census(rig.view), census(view)];
        const both = [...first.arrays].filter((array) => other.arrays.has(array));
        const [mask, otherMask] = [clipGroups(rig.view)[0]?.mask, clipGroups(view)[0]?.mask];

        // two instances at the same place of the animation draw their masks from one index array
        expect(mask?.geometry.indexBuffer.data).toBe(otherMask?.geometry.indexBuffer.data);
        expect(both).toContain(mask?.geometry.indexBuffer.data);
        // and each has its own polygon
        expect(mask?.geometry.getBuffer('aPosition').data).not.toBe(otherMask?.geometry.getBuffer('aPosition').data);
        expect(both).not.toContain(mask?.geometry.getBuffer('aPosition').data);
        // what one instance holds alone: the arrays of its vertices, two index arrays and the polygon
        expect(first.arrays.size - both.length).toBeLessThanOrEqual(6);
        // no object is shared that was not shared before: the meshes, geometries and buffers are per instance
        expect([...first.buffers].filter((buffer) => other.buffers.has(buffer))).toEqual([]);
    });
});
