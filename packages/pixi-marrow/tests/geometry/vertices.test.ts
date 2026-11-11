import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { importSkeleton } from '../../src/formats/import';
import { f32, f64, float, i16, i32 } from '../../src/geometry/read';
import { computeWorldVertices, transformPoints } from '../../src/geometry/vertices';
import type { VertexData } from '../../src/model/attachments';
import { createAttachmentLookup, meshSource } from '../../src/pose/shared/lookup';
import { syntheticRig } from './synthetic';

/*
 * Numbers worked out by hand. The parity test and the synthetic rig compare the same functions
 * with the official cores bit for bit.
 */

/**
 * Three bones in the layout of `PoseState.world`. Bone 0 is not moved. Bone 1 is turned by a
 * quarter and moved to 10, 20. Bone 2 is scaled by 2 and moved to -5, 3.
 */
const WORLD = Float64Array.of(1, 0, 0, 1, 0, 0, 0, -1, 1, 0, 10, 20, 2, 0, 0, 2, -5, 3);
const NO_DEFORM = new Float64Array(0);

const UNWEIGHTED: VertexData = {
    vertices: Float32Array.of(1, 2, 3, 4, -5, 6),
    bones: null,
    worldVerticesLength: 6,
};

/** Three vertices with 1, 2 and 3 bones. Per bone: x, y and a weight. */
const WEIGHTED: VertexData = {
    vertices: Float32Array.of(1, 2, 1, 3, 4, 0.25, 1, -1, 0.75, 2, 2, 0.5, 0, 0, 0.25, 1, 1, 0.25),
    bones: Int16Array.of(1, 1, 2, 1, 2, 3, 0, 1, 2),
    worldVerticesLength: 6,
};
/** An x and a y for each of the 6 weights. */
const WEIGHTED_DEFORM = Float64Array.of(1, 1, 0, 0, 2, 0, 0, 0, 0, 4, -1, -1);

function world(
    data: VertexData,
    bone: number,
    deform: Float64Array = NO_DEFORM,
    start?: number,
    count?: number,
): number[] {
    const out = new Float64Array(count ?? data.worldVerticesLength - (start ?? 0));

    computeWorldVertices(data, WORLD, bone, deform, deform.length, out, 0, 2, start, count);

    return Array.from(out);
}

describe('transformPoints', () => {
    it('places points with the world transform of a bone, up to the end', () => {
        const out = new Float32Array(6).fill(9);

        transformPoints(Float32Array.of(1, 2, 3, 4, 5, 6), 2, WORLD, 1, out, 0, 4, 2);
        expect(Array.from(out)).toEqual([6, 23, 4, 25, 9, 9]);
    });
});

describe('computeWorldVertices without weights', () => {
    it('places the vertices with the world transform of the bone of the slot', () => {
        expect(world(UNWEIGHTED, 0)).toEqual([1, 2, 3, 4, -5, 6]);
        expect(world(UNWEIGHTED, 1)).toEqual([8, 21, 6, 23, 4, 15]);
        expect(world(UNWEIGHTED, 2)).toEqual([-3, 7, 1, 11, -15, 15]);
    });

    it('takes a deform as the vertices', () => {
        expect(world(UNWEIGHTED, 2, Float64Array.of(10, 20, 30, 40, 50, 60))).toEqual([15, 43, 55, 83, 95, 123]);
    });

    it('ignores a deform array whose length in use is 0', () => {
        const out = new Float64Array(6);

        // an engine keeps the array of a slot and sets its length to 0 when the deform ends
        computeWorldVertices(UNWEIGHTED, WORLD, 1, Float64Array.of(10, 20, 30, 40, 50, 60), 0, out);
        expect(Array.from(out)).toEqual([8, 21, 6, 23, 4, 15]);
    });

    it('starts at a later vertex and stops after the count', () => {
        expect(world(UNWEIGHTED, 1, NO_DEFORM, 2)).toEqual([6, 23, 4, 15]);
        expect(world(UNWEIGHTED, 1, NO_DEFORM, 2, 2)).toEqual([6, 23]);
        expect(world(UNWEIGHTED, 2, Float64Array.of(10, 20, 30, 40, 50, 60), 4)).toEqual([95, 123]);
    });

    it('writes one pair every stride numbers from the offset on', () => {
        const out = new Float32Array(11).fill(9);

        computeWorldVertices(UNWEIGHTED, WORLD, 1, NO_DEFORM, 0, out, 1, 4);
        expect(Array.from(out)).toEqual([9, 8, 21, 9, 9, 6, 23, 9, 9, 4, 15]);
    });
});

describe('computeWorldVertices with weights', () => {
    it('blends the positions that each bone gives a vertex by their weights', () => {
        // the bone of the slot plays no part: every weight names its bone
        expect(world(WEIGHTED, 0)).toEqual([8, 21, -0.75, 6.5, 2.75, 7.25]);
        expect(world(WEIGHTED, 2)).toEqual([8, 21, -0.75, 6.5, 2.75, 7.25]);
    });

    it('adds a deform to the position of every weight', () => {
        expect(world(WEIGHTED, 0, WEIGHTED_DEFORM)).toEqual([7, 22, 2.25, 6.5, 1.25, 6.75]);
    });

    it('ignores a deform array whose length in use is 0', () => {
        const out = new Float64Array(6);

        computeWorldVertices(WEIGHTED, WORLD, 0, WEIGHTED_DEFORM, 0, out);
        expect(Array.from(out)).toEqual([8, 21, -0.75, 6.5, 2.75, 7.25]);
    });

    it('starts at a later vertex and stops after the count', () => {
        expect(world(WEIGHTED, 0, NO_DEFORM, 2)).toEqual([-0.75, 6.5, 2.75, 7.25]);
        expect(world(WEIGHTED, 0, NO_DEFORM, 2, 2)).toEqual([-0.75, 6.5]);
        expect(world(WEIGHTED, 0, NO_DEFORM, 4)).toEqual([2.75, 7.25]);
        expect(world(WEIGHTED, 0, WEIGHTED_DEFORM, 2)).toEqual([2.25, 6.5, 1.25, 6.75]);
        expect(world(WEIGHTED, 0, WEIGHTED_DEFORM, 4)).toEqual([1.25, 6.75]);
    });

    it('writes one pair every stride numbers from the offset on', () => {
        const out = new Float32Array(9).fill(9);

        computeWorldVertices(WEIGHTED, WORLD, 0, NO_DEFORM, 0, out, 2, 3, 2);
        expect(Array.from(out)).toEqual([9, 9, -0.75, 6.5, 9, 2.75, 7.25, 9, 9]);
    });
});

describe('computeWorldVertices on a linked mesh', () => {
    it('places the vertices of the source of the mesh', async () => {
        const model = await importSkeleton(syntheticRig('4.3').skeleton);
        const lookup = createAttachmentLookup(model);
        const slot = model.slots.names.indexOf('weighted');
        const linked = lookup.get(lookup.defaultSkin, slot, 'weighted-linked');
        const parent = lookup.get(lookup.defaultSkin, slot, 'weighted');

        if (linked?.type !== 'mesh' || parent?.type !== 'mesh') throw new Error('The rig has no linked mesh');
        const source = meshSource(lookup, linked);
        const fromParent = new Float64Array(10).fill(9);
        const fromLinked = new Float64Array(10).fill(9);
        const own = new Float64Array(10).fill(9);
        // a root, a bone that scales by 2 and two bones that turn by a quarter
        const bones = Float64Array.of(1, 0, 0, 1, 0, 0, 2, 0, 0, 2, -5, 3, 0, -1, 1, 0, 10, 20, 0, -1, 1, 0, -7, 8);

        expect(source).toBe(parent);
        computeWorldVertices(parent, bones, 0, NO_DEFORM, 0, fromParent);
        computeWorldVertices(source, bones, 0, NO_DEFORM, 0, fromLinked);
        expect(Array.from(fromLinked)).toEqual(Array.from(fromParent));
        expect(fromLinked.includes(9)).toBe(false);
        // the linked mesh holds no vertices: it writes nothing
        computeWorldVertices(linked, bones, 0, NO_DEFORM, 0, own);
        expect(Array.from(own)).toEqual(new Array(10).fill(9));
    });
});

describe('arrays that end too early', () => {
    const run = (data: VertexData, bone: number, deform: Float64Array, deformLength: number) => (): void =>
        computeWorldVertices(data, WORLD, bone, deform, deformLength, new Float64Array(6));

    it('refuses a deform shorter than the vertices', () => {
        expect(run(UNWEIGHTED, 0, Float64Array.of(1, 2, 3, 4), 4)).toThrow(MarrowError);
        expect(run(WEIGHTED, 0, Float64Array.of(1, 2, 3, 4), 4)).toThrow(/index 4 of an array of 4 numbers/);
    });

    it('refuses a bone the pose does not have', () => {
        expect(run(UNWEIGHTED, 3, NO_DEFORM, 0)).toThrow(MarrowError);
        expect(run({ ...WEIGHTED, bones: Int16Array.of(1, 7, 2, 1, 2, 3, 0, 1, 2) }, 0, NO_DEFORM, 0)).toThrow(
            MarrowError,
        );
    });

    it('refuses vertices and bones shorter than the vertex count', () => {
        expect(run({ ...UNWEIGHTED, vertices: Float32Array.of(1, 2, 3) }, 0, NO_DEFORM, 0)).toThrow(MarrowError);
        expect(run({ ...WEIGHTED, bones: Int16Array.of(1, 1, 2, 1, 2) }, 0, NO_DEFORM, 0)).toThrow(MarrowError);
        expect(run({ ...WEIGHTED, vertices: Float32Array.of(1, 2, 1) }, 0, NO_DEFORM, 0)).toThrow(MarrowError);
    });
});

describe('readers', () => {
    it('read a number of each array type', () => {
        expect(f32(Float32Array.of(1.5, 2.5), 1)).toBe(2.5);
        expect(f64(Float64Array.of(0.1, 0.2), 1)).toBe(0.2);
        expect(i16(Int16Array.of(-3, 4), 0)).toBe(-3);
        expect(i32(Int32Array.of(70000, 5), 0)).toBe(70000);
        expect(float(Float32Array.of(1.5), 0)).toBe(1.5);
        expect(float(Float64Array.of(0.1), 0)).toBe(0.1);
        expect(f64(Float64Array.of(Number.NaN), 0)).toBeNaN();
    });

    it('throw past the end of the array, where a plain read gives undefined', () => {
        const reads = [
            (): number => f32(new Float32Array(2), 2),
            (): number => f64(new Float64Array(2), 2),
            (): number => i16(new Int16Array(2), 2),
            (): number => i32(new Int32Array(2), 2),
            (): number => float(new Float32Array(2), 2),
            (): number => f64(new Float64Array(2), -1),
        ];

        for (const read of reads) expect(read).toThrow(MarrowError);
        expect(reads[0]).toThrow(/index 2 of an array of 2 numbers/);
    });
});
