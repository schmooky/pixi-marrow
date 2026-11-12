import { expect } from 'vitest';
import type { SpineVersion } from '../../src/base/version';
import type { ClipShape } from '../../src/render/clip-shape';
import { clipAttachment, expectArea, type MaskSamples } from './clip-check';
import { officialClipper } from './clip-official';

/*
 * What the tests of `ClipShape` share: polygons, bones that move them, and the comparison of a
 * shape with the official `SkeletonClipping` of a version. The real clipper says which points it
 * keeps, and the triangles of the shape must cover those points.
 */

/** One bone that is not moved, in the layout of `PoseState.world`. */
export const WORLD = Float64Array.of(1, 0, 0, 1, 0, 0);
export const NO_DEFORM = new Float64Array(0);

/** A small generator of the same numbers on every run, 0 to 1. */
export function random(seed: number): () => number {
    let state = seed;

    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);

        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A polygon around a center: with a fixed radius it is convex, with random ones mostly not. The numbers fit 32 bits. */
export function around(corners: number, next: () => number, convex: boolean, clockwise = true): number[] {
    const polygon = Array.from({ length: corners }, (_, i) => {
        const angle = ((clockwise ? -2 : 2) * Math.PI * (i + (convex ? 0 : next() * 0.8))) / corners;
        const radius = convex ? 40 : 5 + next() * 60;

        return [Math.fround(12 + Math.cos(angle) * radius), Math.fround(-7 + Math.sin(angle) * radius)];
    });

    return polygon.flat();
}

export const L_SHAPE = [0, 0, 0, 20, 10, 20, 10, 10, 20, 10, 20, 0];

/**
 * One bone in the layout of `PoseState.world` that turns, scales, shears and moves, by chance.
 * A mirrored one flips what it moves, which turns the vertex order of a polygon around.
 */
export function bone(next: () => number, mirrored: boolean): Float64Array {
    const angle = next() * Math.PI * 2;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const scaleX = 0.3 + next() * 2;
    const scaleY = (0.3 + next() * 2) * (mirrored ? -1 : 1);
    const shear = next() - 0.5;

    return Float64Array.of(
        cos * scaleX,
        (cos * shear - sin) * scaleY,
        sin * scaleX,
        (sin * shear + cos) * scaleY,
        (next() - 0.5) * 400,
        (next() - 0.5) * 400,
    );
}

/** A polygon as a bone of {@link bone} places it, vertex by vertex. */
export function placed(polygon: readonly number[], world: Float64Array): number[] {
    const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = world;

    return polygon.map((_, at) => {
        const px = polygon[at & ~1] ?? 0;
        const py = polygon[at | 1] ?? 0;

        return at % 2 === 0 ? a * px + b * py + x : c * px + d * py + y;
    });
}

/** A clipping attachment whose vertices each hang on one bone with weight 1: the encoding with weights. */
export function weighted(polygon: readonly number[]): ReturnType<typeof clipAttachment> {
    const attachment = clipAttachment('weighted', -1, polygon);
    const corners = polygon.length / 2;

    attachment.bones = Int16Array.from({ length: corners * 2 }, (_, at) => (at % 2 === 0 ? 1 : 0));
    attachment.vertices = Float32Array.from({ length: corners * 3 }, (_, at) =>
        at % 3 === 2 ? 1 : (polygon[Math.floor(at / 3) * 2 + (at % 3)] ?? 0),
    );

    return attachment;
}

export interface Flags {
    inverse?: boolean;
    convex?: boolean;
}

/** Shapes a polygon as one version does. */
export function shapeOf(
    shape: ClipShape,
    version: SpineVersion,
    polygon: readonly number[],
    flags: Flags = {},
): ClipShape {
    shape.compute(version, clipAttachment('clip', -1, polygon, flags), WORLD, 0, NO_DEFORM, 0);

    return shape;
}

/** The triangles of a shape as plain numbers. */
export const trianglesOf = (shape: ClipShape): number[] => Array.from(shape.triangles.subarray(0, shape.indexCount));

/** Shapes a polygon and compares the area it keeps with the official clipper of the version. */
export function expectShape(
    shape: ClipShape,
    version: SpineVersion,
    polygon: readonly number[],
    flags: Flags = {},
): MaskSamples {
    const attachment = clipAttachment('clip', -1, polygon, flags);
    const clipper = officialClipper(version, 1);

    shape.compute(version, attachment, WORLD, 0, NO_DEFORM, 0);
    expect(clipper.start(0, attachment, polygon)).toBe(true);
    const samples = expectArea(
        {
            positions: shape.polygon.subarray(0, shape.vertexCount * 2),
            triangles: trianglesOf(shape),
            inverse: shape.inverse,
        },
        polygon,
        clipper,
    );

    clipper.end();

    return samples;
}
