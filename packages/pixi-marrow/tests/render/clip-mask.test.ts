import { Bounds, Mesh } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { ClipMask } from '../../src/render/clip-mask';
import { ClipShape } from '../../src/render/clip-shape';
import { MeasuredGeometry } from '../../src/render/measured-geometry';
import { createMaskShader } from '../../src/render/shader';
import { clipAttachment } from './clip-check';

/*
 * What a clip mask holds. A mask is created for every clip of every instance, so each object and
 * each array in it is paid that often. These tests pin them: one mesh, one geometry, two buffers,
 * one array for the polygon, and no array for the triangles while the shape has one to share.
 */

/** One bone that is not moved, in the layout of `PoseState.world`. */
const WORLD = Float64Array.of(1, 0, 0, 1, 0, 0);
/** The same bone mirrored, which turns the vertex order of a polygon around. */
const MIRRORED = Float64Array.of(-1, 0, 0, 1, 0, 0);
const NO_DEFORM = new Float64Array(0);
const L_SHAPE = [0, 0, 0, 20, 10, 20, 10, 10, 20, 10, 20, 0];
const QUAD = [0, 0, 0, 10, 10, 10, 10, 0];

const box = new Bounds(0, 0, 20, 20);
const shader = createMaskShader();

/** A mask, and the two buffers of its geometry: the polygon and the triangles. */
function createMask(): { mask: ClipMask; positions: () => unknown; indices: () => unknown } {
    const mask = new ClipMask(shader, () => box);
    const [positionBuffer, indexBuffer] = mask.mesh.geometry.buffers;

    if (positionBuffer === undefined || indexBuffer === undefined) throw new Error('a mask has two buffers');

    return { mask, positions: () => positionBuffer.data, indices: () => indexBuffer.data };
}

/** A shape of a polygon in a pose of the 4.2 clipper. A deform of the same vertices makes it one that is cut per pose. */
function shapeOf(polygon: readonly number[], options: { deformed?: boolean; world?: Float64Array } = {}): ClipShape {
    const shape = new ClipShape();

    place(shape, clipAttachment('clip', -1, polygon), options);

    return shape;
}

function place(
    shape: ClipShape,
    attachment: ReturnType<typeof clipAttachment>,
    options: { deformed?: boolean; world?: Float64Array } = {},
): void {
    const deform = options.deformed ? Float64Array.from(attachment.vertices) : NO_DEFORM;

    shape.compute('4.2', attachment, options.world ?? WORLD, 0, deform, deform.length);
}

describe('ClipMask', () => {
    it('is one mesh with one geometry and two buffers, and shares its first arrays', () => {
        const first = createMask();
        const second = createMask();
        const { mesh } = first.mask;

        expect(mesh).toBeInstanceOf(Mesh);
        expect(mesh.geometry).toBeInstanceOf(MeasuredGeometry);
        expect(mesh.shader).toBe(shader);
        expect(mesh.bounds).toBe(box);
        expect(mesh.children.length).toBe(0);
        expect(mesh.geometry.buffers.length).toBe(2);
        expect(mesh.geometry.indexBuffer).toBe(mesh.geometry.buffers[1]);
        expect(Object.keys(mesh.geometry.attributes)).toEqual(['aPosition']);
        // one triangle without area, in arrays that no mask writes to and all masks share
        expect(Array.from(first.positions() as Float32Array)).toEqual([0, 0, 0, 0, 0, 0]);
        expect(Array.from(first.indices() as Uint16Array)).toEqual([0, 0, 0, 0]);
        expect(second.positions()).toBe(first.positions());
        expect(second.indices()).toBe(first.indices());
        expect(first.mask.bytes).toBe(6 * 4 + 4 * 2);
    });

    it('owns the array of its polygon and draws the triangles from the array of the shape', () => {
        const first = createMask();
        const second = createMask();
        const untouched = first.positions();
        const attachment = clipAttachment('clip', -1, L_SHAPE);
        const shape = new ClipShape();

        place(shape, attachment);
        expect(first.mask.place(shape)).toBe(true);
        expect(second.mask.place(shape)).toBe(true);
        // the polygon: an array per mask, and the one all masks start with was not written
        expect(first.positions()).not.toBe(second.positions());
        expect(Array.from(first.positions() as Float32Array)).toEqual(Array.from(shape.polygon.subarray(0, 12)));
        expect(Array.from(untouched as Float32Array)).toEqual([0, 0, 0, 0, 0, 0]);
        // the triangles: the array of the shape, for both masks
        expect(first.indices()).toBe(shape.fixedIndices);
        expect(second.indices()).toBe(shape.fixedIndices);
        expect(first.mask.mesh.geometry.indexCount).toBe(12);
        expect(first.mask.bytes).toBe(12 * 4 + 12 * 2);
        // the same shape again: the polygon uploads, the triangles do not
        const polygon = first.positions();

        expect(first.mask.place(shape)).toBe(false);
        expect(first.positions()).toBe(polygon);
        // the bone mirrors: the same vertices in reverse order, with triangles of their own
        place(shape, attachment, { world: MIRRORED });
        expect(first.mask.place(shape)).toBe(true);
        expect(first.indices()).toBe(shape.fixedIndices);
        expect(first.indices()).not.toBe(second.indices());
        expect(first.positions()).toBe(polygon);
        expect(first.mask.bytes).toBe(12 * 4 + 12 * 2);
    });

    it('never writes to the first array of all masks, also for a polygon of three vertices', () => {
        const { mask, positions } = createMask();
        const untouched = positions();

        mask.place(shapeOf([5, 5, 5, 9, 9, 5]));
        expect(positions()).not.toBe(untouched);
        expect((positions() as Float32Array).length).toBe(6);
        expect(Array.from(untouched as Float32Array)).toEqual([0, 0, 0, 0, 0, 0]);
        // three indices and a 0 that makes the count even
        expect(mask.mesh.geometry.indexCount).toBe(3);
        expect(mask.bytes).toBe(6 * 4 + 4 * 2);
    });

    it('gets an index array of its own for triangles that are cut per pose, and keeps it', () => {
        const { mask, indices } = createMask();
        const untouched = indices();
        const bent = shapeOf(L_SHAPE, { deformed: true });

        expect(bent.fixedIndices).toBeNull();
        expect(mask.place(bent)).toBe(true);
        const own = indices() as Uint16Array;

        expect(own).not.toBe(untouched);
        expect(Array.from(own)).toEqual(Array.from(bent.triangles.subarray(0, 12)));
        expect(Array.from(untouched as Uint16Array)).toEqual([0, 0, 0, 0]);
        expect(mask.place(bent)).toBe(false);
        // fewer triangles: the rest of the array is zero, which are triangles without area
        const quad = shapeOf(QUAD, { deformed: true });

        expect(mask.place(quad)).toBe(true);
        expect(indices()).toBe(own);
        expect(Array.from(own)).toEqual([...Array.from(quad.triangles.subarray(0, 6)), 0, 0, 0, 0, 0, 0]);
        expect(mask.mesh.geometry.indexCount).toBe(6);
        // the polygon array holds the six vertices of the L and keeps that size
        expect(mask.bytes).toBe(12 * 4 + 12 * 2);
        // a shape with an array to share takes the place of the own array, which stays as it is
        const fixed = shapeOf(QUAD);

        expect(mask.place(fixed)).toBe(true);
        expect(indices()).toBe(fixed.fixedIndices);
        expect(mask.place(fixed)).toBe(false);
        // and back: the own array holds the quad already, and uploads because the mask showed another
        expect(mask.place(quad)).toBe(true);
        expect(indices()).toBe(own);
        expect(mask.place(quad)).toBe(false);
        // more triangles than the own array holds: a longer one
        const star = shapeOf([0, 0, 2, 9, 4, 0, 6, 9, 8, 0, 10, 9, 12, 0, 6, -30], { deformed: true });

        expect(mask.place(star)).toBe(true);
        expect(indices()).not.toBe(own);
        expect((indices() as Uint16Array).length).toBe(18);
        expect(mask.bytes).toBe(16 * 4 + 18 * 2);
    });

    it('counts the longest triangle list it showed, because the GPU buffer never shrinks', () => {
        const { mask, indices } = createMask();

        mask.place(shapeOf(L_SHAPE));
        expect(mask.bytes).toBe(12 * 4 + 12 * 2);
        mask.place(shapeOf(QUAD));
        expect((indices() as Uint16Array).length).toBe(6);
        expect(mask.mesh.geometry.indexCount).toBe(6);
        expect(mask.bytes).toBe(12 * 4 + 12 * 2);
    });

    it('frees its mesh, its geometry and both buffers, and leaves the shader and the shared arrays', () => {
        const { mask } = createMask();
        const other = createMask();
        const shape = shapeOf(L_SHAPE);
        const { mesh } = mask;
        const { geometry } = mesh;
        const buffers = [...geometry.buffers];

        mask.place(shape);
        other.mask.place(shape);
        mask.destroy();
        expect(mesh.destroyed).toBe(true);
        expect(geometry.buffers).toBeNull();
        for (const buffer of buffers) expect(buffer.destroyed).toBe(true);
        expect(mask.bytes).toBe(0);
        expect(shader.glProgram).not.toBeNull();
        // the other mask still draws the triangles both shared
        expect(other.indices()).toBe(shape.fixedIndices);
        expect(Array.from(shape.fixedIndices ?? [])).toEqual(Array.from(shape.triangles.subarray(0, 12)));
        expect(other.mask.place(shape)).toBe(false);
    });
});
