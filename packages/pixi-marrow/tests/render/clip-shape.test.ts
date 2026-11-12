import { SkeletonClipping as Clipping42, Triangulator as Triangulator42 } from 'spine-core-4.2';
import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { SPINE_VERSIONS, type SpineVersion } from '../../src/base/version';
import { ClipShape, checkClip } from '../../src/render/clip-shape';
import { clipAttachment, expectArea, type MaskSamples } from './clip-check';
import { officialClipper } from './clip-official';
import { settle, WINDOW } from './heap';

/*
 * The shape of a clip against the official `SkeletonClipping` of each version: the real clipper
 * says which points it keeps, and the triangles of the shape must cover those points. The bone
 * is not moved, so the polygon in the pose is the polygon of the attachment.
 */

/** One bone that is not moved, in the layout of `PoseState.world`. */
const WORLD = Float64Array.of(1, 0, 0, 1, 0, 0);
const NO_DEFORM = new Float64Array(0);

/** A small generator of the same numbers on every run, 0 to 1. */
function random(seed: number): () => number {
    let state = seed;

    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);

        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A polygon around a center: with a fixed radius it is convex, with random ones mostly not. The numbers fit 32 bits. */
function around(corners: number, next: () => number, convex: boolean, clockwise = true): number[] {
    const polygon = Array.from({ length: corners }, (_, i) => {
        const angle = ((clockwise ? -2 : 2) * Math.PI * (i + (convex ? 0 : next() * 0.8))) / corners;
        const radius = convex ? 40 : 5 + next() * 60;

        return [Math.fround(12 + Math.cos(angle) * radius), Math.fround(-7 + Math.sin(angle) * radius)];
    });

    return polygon.flat();
}

const L_SHAPE = [0, 0, 0, 20, 10, 20, 10, 10, 20, 10, 20, 0];

interface Flags {
    inverse?: boolean;
    convex?: boolean;
}

/** Shapes a polygon as one version does. */
function shapeOf(shape: ClipShape, version: SpineVersion, polygon: readonly number[], flags: Flags = {}): ClipShape {
    shape.compute(version, clipAttachment('clip', -1, polygon, flags), WORLD, 0, NO_DEFORM, 0);

    return shape;
}

/** The triangles of a shape as plain numbers. */
const trianglesOf = (shape: ClipShape): number[] => Array.from(shape.triangles.subarray(0, shape.indexCount));

/** Shapes a polygon and compares the area it keeps with the official clipper of the version. */
function expectShape(
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

describe.each(SPINE_VERSIONS)('ClipShape as Spine %s', (version) => {
    const legacy = version !== '4.3';

    it('keeps the area of a convex polygon, in either winding', () => {
        const next = random(1);
        const shape = new ClipShape();

        for (const corners of [3, 4, 5, 9, 24]) {
            for (const clockwise of [true, false]) {
                const samples = expectShape(shape, version, around(corners, next, true, clockwise));

                expect(shape.vertexCount).toBe(corners);
                expect(shape.indexCount).toBe((corners - 2) * 3);
                expect(shape.inverse).toBe(false);
                expect(samples.kept).toBeGreaterThan(50);
                expect(samples.removed).toBeGreaterThan(50);
            }
        }
    });

    it('keeps the area of 120 concave polygons', () => {
        const next = random(2);
        const shape = new ClipShape();
        let kept = 0;
        let removed = 0;

        for (let i = 0; i < 120; i++) {
            const corners = 4 + Math.floor(next() * 30);
            const samples = expectShape(shape, version, around(corners, next, false, i % 3 !== 0));

            expect(shape.vertexCount).toBe(corners);
            expect(shape.indexCount).toBe((corners - 2) * 3);
            kept += samples.kept;
            removed += samples.removed;
        }
        expect(kept).toBeGreaterThan(5000);
        expect(removed).toBeGreaterThan(5000);
    });

    it('cuts a concave polygon into the triangles of the official triangulator', () => {
        const next = random(4);
        const shape = new ClipShape();

        for (const polygon of [L_SHAPE, [...L_SHAPE].reverse(), around(17, next, false), around(31, next, false)]) {
            const clockwise = [...polygon];

            // what clipStart does before it triangulates. 4.3 gives the same order for these
            Clipping42.makeClockwise(clockwise);
            shapeOf(shape, version, polygon);
            expect(Array.from(shape.polygon.subarray(0, polygon.length))).toEqual(clockwise);
            expect(trianglesOf(shape)).toEqual([...new Triangulator42().triangulate(clockwise)]);
        }
    });

    it(
        legacy
            ? 'cuts a convex polygon by ear clipping, as the official clipper does'
            : 'covers a convex polygon with a fan',
        () => {
            const polygon = around(7, random(5), true);
            const shape = shapeOf(new ClipShape(), version, polygon);
            const fan = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6];

            expect(trianglesOf(shape)).toEqual(legacy ? [...new Triangulator42().triangulate(polygon)] : fan);
            if (legacy) expect(trianglesOf(shape)).not.toEqual(fan);
        },
    );

    it(
        legacy
            ? 'does not know the inverse and convex flags of 4.3'
            : 'keeps what is outside for an inverse clip, around the convex hull',
        () => {
            const next = random(6);
            const shape = new ClipShape();
            let hulls = 0;
            let kept = 0;
            let removed = 0;

            for (let i = 0; i < 40; i++) {
                const corners = 4 + Math.floor(next() * 20);
                const convex = i % 4 === 0;
                const samples = expectShape(shape, version, around(corners, next, convex), { inverse: true });

                expect(shape.inverse).toBe(!legacy);
                kept += samples.kept;
                removed += samples.removed;
                if (legacy || convex) expect(shape.vertexCount).toBe(corners);
                else if (shape.vertexCount < corners) hulls++;
            }
            expect(kept).toBeGreaterThan(4000);
            expect(removed).toBeGreaterThan(4000);
            // a polygon that is not convex lost its inner corners. A few of the random ones are convex
            if (legacy) expect(hulls).toBe(0);
            else expect(hulls).toBeGreaterThan(24);
        },
    );

    it(
        legacy
            ? 'cuts a polygon marked convex like every other'
            : 'takes the convex hull of a polygon that is marked convex and is not',
        () => {
            const next = random(8);
            const shape = new ClipShape();

            for (let i = 0; i < 40; i++) {
                const corners = 5 + Math.floor(next() * 20);
                const polygon = around(corners, next, false);

                expectShape(shape, version, polygon, { convex: true });
                expect(shape.inverse).toBe(false);
                if (legacy) expect(shape.vertexCount).toBe(corners);
                else expect(shape.indexCount).toBe((shape.vertexCount - 2) * 3);
            }
            // the L loses its inner corner in 4.3: 5 corners are left
            expect(shapeOf(shape, version, L_SHAPE, { convex: true }).vertexCount).toBe(legacy ? 6 : 5);
            expect(shapeOf(shape, version, L_SHAPE, { inverse: true }).vertexCount).toBe(legacy ? 6 : 5);
        },
    );

    it('keeps nothing for a polygon without area, as the official clipper does', () => {
        const shape = new ClipShape();

        for (const polygon of [
            [0, 0, 5, 5, 10, 10],
            [3, 3, 3, 3, 3, 3, 3, 3],
            [0, 0, 10, 0, 20, 0, 5, 0],
        ]) {
            const attachment = clipAttachment('flat', -1, polygon);
            const clipper = officialClipper(version, 1);

            shape.compute(version, attachment, WORLD, 0, NO_DEFORM, 0);
            clipper.start(0, attachment, polygon);
            // a triangle around the polygon: nothing of it is left on either side
            expect(clipper.kept([-50, -50, 50, -50, 0, 80])).toBe(0);
            const positions = shape.polygon.subarray(0, shape.vertexCount * 2);
            const area = trianglesOf(shape).reduce((sum, _, at, list) => {
                if (at % 3 !== 0) return sum;
                const [a = 0, b = 0, c = 0] = list.slice(at, at + 3).map((vertex) => vertex * 2);
                const cross =
                    ((positions[b] ?? 0) - (positions[a] ?? 0)) * ((positions[c + 1] ?? 0) - (positions[a + 1] ?? 0)) -
                    ((positions[c] ?? 0) - (positions[a] ?? 0)) * ((positions[b + 1] ?? 0) - (positions[a + 1] ?? 0));

                return sum + Math.abs(cross);
            }, 0);

            expect(area).toBe(0);
        }
    });

    it('moves the polygon with its bone and with a deform', () => {
        const shape = new ClipShape();
        const attachment = clipAttachment('clip', -1, [0, 0, 0, 10, 10, 10, 10, 0]);
        // turned by a quarter, scaled by 2 and moved
        const world = Float64Array.of(9, 9, 9, 9, 9, 9, 0, -2, 2, 0, 100, 50);
        const deform = Float64Array.of(0, 0, 0, 30, 30, 30, 30, 0, 99, 99);

        shape.compute(version, attachment, world, 1, NO_DEFORM, 0);
        const moved = Array.from(shape.polygon.subarray(0, 8));

        expect([...moved].sort((a, b) => a - b)).toEqual([50, 50, 70, 70, 80, 80, 100, 100]);
        // the deform replaces the vertices of an attachment without weights. Numbers past its length do not count
        shape.compute(version, attachment, world, 1, deform, 8);
        expect([...shape.polygon.subarray(0, 8)].sort((a, b) => a - b)).toEqual([40, 40, 50, 50, 100, 100, 110, 110]);
        expect(shape.vertexCount).toBe(4);
    });

    it('allocates nothing for a polygon that fits', () => {
        const next = random(9);
        const shape = new ClipShape();
        const clips = Array.from({ length: 12 }, (_, i) =>
            clipAttachment(`clip${i}`, -1, around(30, next, i % 3 === 0), {
                inverse: i % 4 === 1,
                convex: i % 4 === 2,
            }),
        );
        const first = clips[0];
        let indices = 0;

        if (first === undefined) throw new Error('there are 12 clips');
        for (const clip of clips) shape.compute(version, clip, WORLD, 0, NO_DEFORM, 0);
        const { polygon } = shape;
        const windows = settle((i) => {
            shape.compute(version, clips[i % 12] ?? first, WORLD, 0, NO_DEFORM, 0);
            indices += shape.indexCount;
        });

        expect(windows).toBeGreaterThan(0);
        expect(indices).toBeGreaterThan(windows * WINDOW * 20);
        expect(shape.polygon).toBe(polygon);
    });
});

describe('checkClip', () => {
    it('names the attachment whose polygon has fewer than three vertices', () => {
        const shape = new ClipShape();

        for (const vertices of [0, 1, 2]) {
            const bad = clipAttachment('half-moon', -1, new Array<number>(vertices * 2).fill(1));

            expect(() => checkClip(bad)).toThrow(MarrowError);
            expect(() => checkClip(bad)).toThrow(`"half-moon" has ${vertices} vertices`);
            for (const version of SPINE_VERSIONS) {
                expect(() => shape.compute(version, bad, WORLD, 0, NO_DEFORM, 0)).toThrow(MarrowError);
            }
        }
        expect(() => checkClip(clipAttachment('fine', -1, [0, 0, 1, 0, 0, 1]))).not.toThrow();
    });

    it('refuses more vertices than a mask can index', () => {
        const huge = clipAttachment('huge', -1, []);

        huge.worldVerticesLength = 65536 * 2;
        expect(() => checkClip(huge)).toThrow('"huge" has 65536 vertices');
        huge.worldVerticesLength = 65535 * 2;
        expect(() => checkClip(huge)).not.toThrow();
    });
});
