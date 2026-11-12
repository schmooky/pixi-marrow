import { describe, expect, it } from 'vitest';
import { SPINE_VERSIONS, type SpineVersion } from '../../src/core';
import {
    createClippedTriangles,
    TriangleClipper,
    VERDICT_CUT,
    VERDICT_NOTHING,
    VERDICT_WHOLE,
} from '../../src/geometry/clip-triangles';
import { Triangulator } from '../../src/geometry/triangulator';
import { ClipChecker } from '../parity/clip-check';
import { clusterCase, describeCase, random } from '../parity/clip-random';

/*
 * The verdict of the clip kernel about a slot, without output. It must never say nothing or
 * whole where clipping writes something else: tests/parity/clip-verdict.ts holds every verdict
 * against the output of the kernel and of the official clipper. The random cases of
 * clip-triangles.test.ts and the fixtures go through the same check.
 */

/** Clockwise with y up, as the official clipper shapes a polygon. */
const SQUARE = [0, 0, 0, 10, 10, 10, 10, 0];
const L_SHAPE = [0, 0, 0, 20, 10, 20, 10, 10, 20, 10, 20, 0];

/** A clipper with a polygon that is clockwise already. */
function started(version: SpineVersion, polygon: number[], inverse = false): TriangleClipper {
    const clipper = new TriangleClipper();
    const triangulator = new Triangulator();
    const shaped = Float64Array.from(polygon);
    const indexCount = triangulator.triangulate(shaped, polygon.length / 2);

    clipper.start(version, shaped, polygon.length / 2, triangulator.triangles, indexCount, inverse, false);

    return clipper;
}

/** The verdict about triangles that share no vertex: six numbers each. */
function verdictOf(clipper: TriangleClipper, ...triangles: number[][]): number {
    const positions = Float32Array.from(triangles.flat());
    const indices = Uint16Array.from({ length: positions.length / 2 }, (_, i) => i);

    return clipper.verdict(positions, 0, 2, indices, 0, indices.length);
}

const INSIDE = [1, 1, 5, 1, 1, 5];
const ALSO_INSIDE = [6, 6, 9, 6, 6, 9];
const OUTSIDE = [20, 20, 25, 20, 20, 25];
const ACROSS = [8, 2, 12, 2, 8, 6];

describe.each(SPINE_VERSIONS)('the verdict of TriangleClipper for %s', (version) => {
    it('is whole for triangles inside of a convex polygon', () => {
        expect(verdictOf(started(version, SQUARE), INSIDE)).toBe(VERDICT_WHOLE);
        expect(verdictOf(started(version, SQUARE), INSIDE, ALSO_INSIDE)).toBe(VERDICT_WHOLE);
    });

    it('is nothing for triangles outside of the polygon, and for no triangle', () => {
        expect(verdictOf(started(version, SQUARE), OUTSIDE)).toBe(VERDICT_NOTHING);
        expect(verdictOf(started(version, SQUARE), OUTSIDE, [21, 28, 23, 28, 21, 30])).toBe(VERDICT_NOTHING);
        expect(verdictOf(started(version, SQUARE))).toBe(VERDICT_NOTHING);
        expect(verdictOf(started(version, L_SHAPE), [25, 15, 28, 15, 25, 18])).toBe(VERDICT_NOTHING);
    });

    it('is cut for triangles on two sides of the polygon, of which nothing is left: their box is across it', () => {
        const clipper = started(version, SQUARE);
        const out = createClippedTriangles(16, 48);
        const positions = Float32Array.from([...OUTSIDE, -9, -9, -8, -9, -9, -8]);
        const indices = Uint16Array.of(0, 1, 2, 3, 4, 5);

        expect(clipper.verdict(positions, 0, 2, indices, 0, 6)).toBe(VERDICT_CUT);
        expect(clipper.clip(positions, 0, 2, positions, 0, 2, indices, 0, 6, out, 0)).toBe(6);
        expect([out.vertexCount, out.indexCount]).toEqual([0, 0]);
    });

    it('is cut for triangles across an edge, and for some inside with some outside', () => {
        expect(verdictOf(started(version, SQUARE), ACROSS)).toBe(VERDICT_CUT);
        expect(verdictOf(started(version, SQUARE), INSIDE, ACROSS)).toBe(VERDICT_CUT);
        expect(verdictOf(started(version, SQUARE), INSIDE, OUTSIDE)).toBe(VERDICT_CUT);
    });

    it('is cut for a triangle that touches an edge from inside, and nothing for one that touches it from outside', () => {
        const clipper = started(version, SQUARE);
        const out = createClippedTriangles(16, 48);
        const touching = Float32Array.of(10, 2, 5, 2, 5, 6);

        // a corner on an edge is outside for the official clipper, which then cuts the triangle
        expect(verdictOf(clipper, [10, 2, 5, 2, 5, 6])).toBe(VERDICT_CUT);
        clipper.clip(touching, 0, 2, touching, 0, 2, Uint16Array.of(0, 1, 2), 0, 3, out, 0);
        expect(out.vertexCount).toBeGreaterThan(0);
        expect(verdictOf(clipper, [10, 2, 15, 2, 15, 6])).toBe(VERDICT_NOTHING);
    });

    it('is cut where it cannot reason: three indices are not a triangle count, a position is no number', () => {
        const clipper = started(version, SQUARE);
        const positions = Float32Array.from(INSIDE);

        expect(clipper.verdict(positions, 0, 2, Uint16Array.of(0, 1, 2, 0), 0, 4)).toBe(VERDICT_CUT);
        expect(verdictOf(clipper, [1, 1, 5, Number.NaN, 1, 5])).toBe(VERDICT_CUT);
        expect(verdictOf(clipper, [1, 1, 5, 1, Number.POSITIVE_INFINITY, 5])).toBe(VERDICT_CUT);
        expect(verdictOf(started(version, [0, 0, 0, 1e200, 1e200, 1e200, 1e200, 0]), INSIDE)).toBe(VERDICT_CUT);
        expect(verdictOf(started(version, [0, 0, 0, Number.NaN, 10, 10, 10, 0]), INSIDE)).toBe(VERDICT_CUT);
    });

    it('is asked again for the polygon of the next start', () => {
        const clipper = started(version, [0, 0, 0, 1e200, 1e200, 1e200, 1e200, 0]);
        const shaped = Float64Array.from(SQUARE);

        expect(verdictOf(clipper, INSIDE)).toBe(VERDICT_CUT);
        clipper.start(version, shaped, 4, Int32Array.of(3, 0, 1, 3, 1, 2), 6, false, false);
        expect(verdictOf(clipper, INSIDE)).toBe(VERDICT_WHOLE);
    });
});

describe('the verdict of TriangleClipper for a 4.3 inverse clip', () => {
    it('is nothing inside of the polygon and cut across an edge', () => {
        const clipper = started('4.3', SQUARE, true);

        expect(verdictOf(clipper, INSIDE, ALSO_INSIDE)).toBe(VERDICT_NOTHING);
        expect(verdictOf(clipper, ACROSS)).toBe(VERDICT_CUT);
    });

    it('is whole outside of the polygon only where clipping leaves the corners in their order', () => {
        const clipper = started('4.3', SQUARE, true);
        const out = createClippedTriangles(16, 48);
        const positions = Float32Array.from([-9, 1, -5, 1, -9, 5, 20, 1, 25, 1, 20, 5]);
        const indices = Uint16Array.of(0, 1, 2, 3, 4, 5);

        // left of the square: outside of its first edge, and the official code turns the corners once
        expect(clipper.verdict(positions, 0, 2, indices, 0, 3)).toBe(VERDICT_CUT);
        clipper.clip(positions, 0, 2, positions, 0, 2, indices, 0, 3, out, 0);
        expect(Array.from(out.positions.subarray(0, 6))).toEqual([-5, 1, -9, 5, -9, 1]);
        // right of the square: inside of two edges and outside of the third, so turned three times
        expect(clipper.verdict(positions, 0, 2, indices, 3, 3)).toBe(VERDICT_WHOLE);
        out.vertexCount = 0;
        out.indexCount = 0;
        clipper.clip(positions, 0, 2, positions, 0, 2, indices, 3, 3, out, 0);
        expect(Array.from(out.positions.subarray(0, 6))).toEqual([20, 1, 25, 1, 20, 5]);
    });
});

const SEEDS = [1, 2, 3, 5, 8, 13];
const CASES = 1500;

describe.each(SPINE_VERSIONS)(
    'the verdict against clipping in the kernel and in the official %s clipper',
    (version) => {
        it.each(SEEDS)('is never more than clipping writes for the clusters of seed %i', (seed) => {
            const checker = new ClipChecker(version);
            const next = random(seed);

            for (let i = 0; i < CASES && !checker.problems.full; i++) {
                const { label, clipCase } = clusterCase(next);

                if (!checker.check(`seed ${seed} case ${i} (${label})`, clipCase)) {
                    checker.problems.add(`seed ${seed} case ${i}`, describeCase(clipCase));
                }
            }
            expect(checker.problems.lines).toEqual([]);
            const { nothing, whole, missedNothing, missedWhole } = checker.verdicts;

            // most slots of which nothing or all is left are told without clipping
            expect(nothing).toBeGreaterThan(3000);
            expect(whole).toBeGreaterThan(200);
            expect(missedNothing).toBeLessThan(nothing / 2);
            expect(missedWhole).toBeLessThan(whole / 2);
        });
    },
);
