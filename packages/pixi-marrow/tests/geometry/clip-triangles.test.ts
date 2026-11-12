import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { SPINE_VERSIONS, type SpineVersion } from '../../src/core';
import { type ClippedTriangles, createClippedTriangles, TriangleClipper } from '../../src/geometry/clip-triangles';
import { Triangulator } from '../../src/geometry/triangulator';
import { type ClipCase, ClipChecker, type ClipSlot } from '../parity/clip-check';
import { describeCase, random, randomCase } from '../parity/clip-random';

/*
 * The CPU clip kernel. The reference is the official `SkeletonClipping` of each version: see
 * tests/parity/clip-check.ts for what is compared and where. The fixtures have a test file of
 * their own.
 */

/** Clockwise with y up, as the official clipper shapes a polygon. */
const SQUARE = [0, 0, 0, 10, 10, 10, 10, 0];
const L_SHAPE = [0, 0, 0, 20, 10, 20, 10, 10, 20, 10, 20, 0];
const COMB = [0, 0, 0, 10, 2, 10, 2, 4, 4, 4, 4, 10, 6, 10, 6, 4, 8, 4, 8, 10, 10, 10, 10, 0];
const UVS = [0, 0, 1, 0, 0, 1];
/** Cuts three corners off the square: the most vertices a triangle and a square can share. */
const SEVEN = [7.6, -2.8, 13, 8, -68, 35];

/** A regular polygon, clockwise. */
function regular(corners: number, radius = 10): number[] {
    return Array.from({ length: corners }, (_, i) => {
        const angle = (-2 * Math.PI * i) / corners;

        return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    }).flat();
}

/** A polygon with its vertices in the other order. */
function reversed(polygon: readonly number[]): number[] {
    const out: number[] = [];

    for (let i = polygon.length - 2; i >= 0; i -= 2) out.push(polygon[i] ?? 0, polygon[i + 1] ?? 0);

    return out;
}

/** A slot of triangles that share no vertex: six numbers each. */
function slotOf(...triangles: number[][]): ClipSlot {
    const positions = triangles.flat();

    return {
        positions: Float32Array.from(positions),
        uvs: Float32Array.from(triangles.flatMap(() => UVS)),
        triangles: Uint16Array.from({ length: positions.length / 2 }, (_, i) => i),
    };
}

const caseOf = (polygon: number[], slots: ClipSlot[], inverse = false, convex = false): ClipCase => ({
    polygon,
    inverse,
    convex,
    slots,
});

/** A clipper with a polygon that is clockwise already. */
function started(version: SpineVersion, polygon: number[], inverse = false): TriangleClipper {
    const clipper = new TriangleClipper();
    const triangulator = new Triangulator();
    const shaped = Float64Array.from(polygon);
    const indexCount = triangulator.triangulate(shaped, polygon.length / 2);

    clipper.start(version, shaped, polygon.length / 2, triangulator.triangles, indexCount, inverse, false);

    return clipper;
}

/** Clips a whole slot into an output that is large enough. */
function clipInto(clipper: TriangleClipper, slot: ClipSlot, out: ClippedTriangles, base = out.vertexCount): number {
    return clipper.clip(slot.positions, 0, 2, slot.uvs, 0, 2, slot.triangles, 0, slot.triangles.length, out, base);
}

/** The area of the triangles of an output. */
function areaOf(out: ClippedTriangles): number {
    const { positions, indices } = out;
    let sum = 0;

    for (let t = 0; t < out.indexCount; t += 3) {
        const [a = 0, b = 0, c = 0] = indices.subarray(t, t + 3);
        const [ax = 0, ay = 0] = positions.subarray(a * 2, a * 2 + 2);
        const [bx = 0, by = 0] = positions.subarray(b * 2, b * 2 + 2);
        const [cx = 0, cy = 0] = positions.subarray(c * 2, c * 2 + 2);

        sum += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    }

    return sum;
}

const INSIDE = [1, 1, 5, 1, 1, 5];
const OUTSIDE = [20, 20, 25, 20, 20, 25];
/** Half of it is right of the square. */
const ACROSS = [8, 2, 12, 2, 8, 6];

describe.each(SPINE_VERSIONS)('TriangleClipper for %s', (version) => {
    it('keeps a triangle inside of the polygon as it is', () => {
        const out = createClippedTriangles(16, 48);

        expect(clipInto(started(version, SQUARE), slotOf(INSIDE), out)).toBe(3);
        expect(Array.from(out.positions.subarray(0, out.vertexCount * 2))).toEqual(INSIDE);
        expect(Array.from(out.uvs.subarray(0, out.vertexCount * 2))).toEqual(UVS);
        expect(Array.from(out.indices.subarray(0, out.indexCount))).toEqual([0, 1, 2]);
    });

    it('leaves nothing of a triangle outside of the polygon', () => {
        const out = createClippedTriangles(16, 48);

        expect(clipInto(started(version, SQUARE), slotOf(OUTSIDE), out)).toBe(3);
        expect([out.vertexCount, out.indexCount]).toEqual([0, 0]);
    });

    it('cuts a triangle at an edge and gives the new vertices their place in the texture', () => {
        const out = createClippedTriangles(16, 48);
        const checker = new ClipChecker(version);

        clipInto(started(version, SQUARE), slotOf(ACROSS), out);
        // the triangle has an area of 8, and the corner of 2 right of the square is cut off
        expect(areaOf(out)).toBeCloseTo(6, 5);
        expect(out.vertexCount).toBe(4);
        // u grows with x along the triangle and v with y
        for (let vertex = 0; vertex < out.vertexCount; vertex++) {
            expect(out.uvs[vertex * 2]).toBeCloseTo(((out.positions[vertex * 2] ?? 0) - 8) / 4, 5);
            expect(out.uvs[vertex * 2 + 1]).toBeCloseTo(((out.positions[vertex * 2 + 1] ?? 0) - 2) / 4, 5);
        }
        checker.check('square', caseOf(SQUARE, [slotOf(INSIDE, OUTSIDE, ACROSS, SEVEN)]));
        expect(checker.problems.lines).toEqual([]);
    });

    it.each([
        ['a square', SQUARE],
        ['an L', L_SHAPE],
        ['a comb', COMB],
        ['a polygon of 16 corners', regular(16)],
        ['a polygon of 64 corners, which needs more room than the scratch arrays start with', regular(64, 12)],
    ])('clips against %s as the official clipper does, in both windings', (_, polygon) => {
        const checker = new ClipChecker(version);
        const slot = slotOf(INSIDE, OUTSIDE, ACROSS, SEVEN, [-30, -30, 40, -30, 5, 45], [0, 0, 10, 0, 10, 10]);

        checker.check('clockwise', caseOf(polygon, [slot]));
        checker.check('counter-clockwise', caseOf(reversed(polygon), [slot, slot]));
        expect(checker.problems.lines).toEqual([]);
        expect(checker.tally.vertices).toBeGreaterThan(20);
        expect(checker.tally.pastBound).toBe(0);
    });

    it('counts the indices of a slot from the base it is given', () => {
        const clipper = started(version, SQUARE);
        const out = createClippedTriangles(32, 96);
        const slot = slotOf(INSIDE, ACROSS);

        clipInto(clipper, slot, out);
        const { vertexCount, indexCount } = out;
        const first = Array.from(out.indices.subarray(0, indexCount));

        // a second slot with its own base has the numbers of the first
        clipInto(clipper, slot, out);
        expect(Array.from(out.indices.subarray(indexCount, out.indexCount))).toEqual(first);
        // with a base of 0 its numbers count from the start of the output
        out.vertexCount = vertexCount;
        out.indexCount = indexCount;
        clipInto(clipper, slot, out, 0);
        expect(Array.from(out.indices.subarray(indexCount, out.indexCount))).toEqual(
            first.map((index) => index + vertexCount),
        );
        expect(out.vertexCount).toBe(vertexCount * 2);
    });

    it('stops at the triangle that does not fit, writes nothing of it and goes on after the output grew', () => {
        const clipper = started(version, L_SHAPE);
        // the second triangle lies across several parts of the L
        const slot = slotOf(INSIDE, [-5, 5, 25, 5, 5, 25], INSIDE, ACROSS);
        const count = slot.triangles.length;
        const whole = createClippedTriangles(64, 192);
        let out = createClippedTriangles(0, 0);
        let done = 0;
        let stops = 0;

        clipInto(clipper, slot, whole);
        while (done < count) {
            const before = [out.vertexCount, out.indexCount];
            const taken = clipper.clip(
                slot.positions,
                0,
                2,
                slot.uvs,
                0,
                2,
                slot.triangles,
                done,
                count - done,
                out,
                0,
            );

            expect(taken % 3).toBe(0);
            done += taken;
            if (done === count) break;
            // nothing of the triangle that did not fit is counted
            if (taken === 0) expect([out.vertexCount, out.indexCount]).toEqual(before);
            // one vertex more room each time, so that a triangle stops at each of its parts
            const larger = createClippedTriangles(out.positions.length / 2 + 1, out.indices.length + 3);

            larger.positions.set(out.positions);
            larger.uvs.set(out.uvs);
            larger.indices.set(out.indices);
            larger.vertexCount = out.vertexCount;
            larger.indexCount = out.indexCount;
            out = larger;
            stops++;
        }
        expect(stops).toBeGreaterThan(whole.vertexCount / 2);
        expect([out.vertexCount, out.indexCount]).toEqual([whole.vertexCount, whole.indexCount]);
        expect(out.positions.subarray(0, out.vertexCount * 2)).toEqual(
            whole.positions.subarray(0, out.vertexCount * 2),
        );
        expect(out.uvs.subarray(0, out.vertexCount * 2)).toEqual(whole.uvs.subarray(0, out.vertexCount * 2));
        expect(out.indices.subarray(0, out.indexCount)).toEqual(whole.indices.subarray(0, out.indexCount));
    });

    it('grows an output to twice its room and one more triangle, with what it holds', () => {
        const clipper = started(version, SQUARE);
        const out = createClippedTriangles(4, 6);
        const { positions, uvs, indices } = out;

        expect(clipInto(clipper, slotOf(INSIDE, SEVEN), out)).toBe(3);
        clipper.grow(out);
        expect([out.positions.length, out.uvs.length, out.indices.length]).toEqual([30, 30, 42]);
        expect([out.vertexCount, out.indexCount]).toEqual([3, 3]);
        expect(out.positions.subarray(0, 6)).toEqual(positions.subarray(0, 6));
        expect(out.uvs.subarray(0, 6)).toEqual(uvs.subarray(0, 6));
        expect(out.indices.subarray(0, 3)).toEqual(indices.subarray(0, 3));
    });

    it('keeps the width of the indices when the output grows', () => {
        const clipper = started(version, SQUARE);
        const narrow = createClippedTriangles(0, 0);
        const wide = createClippedTriangles(0, 0, true);

        clipper.grow(narrow);
        clipper.grow(wide);
        expect(narrow.indices).toBeInstanceOf(Uint16Array);
        expect(wide.indices).toBeInstanceOf(Uint32Array);
        expect(clipInto(clipper, slotOf(SEVEN), wide)).toBe(3);
        expect(clipInto(clipper, slotOf(SEVEN), narrow)).toBe(3);
        expect(Array.from(wide.indices.subarray(0, wide.indexCount))).toEqual(
            Array.from(narrow.indices.subarray(0, narrow.indexCount)),
        );
    });

    it('gives a bound that a triangle across every edge of a square reaches', () => {
        const clipper = started(version, SQUARE);
        const out = createClippedTriangles(16, 48);

        clipInto(clipper, slotOf(SEVEN), out);
        expect([out.vertexCount, out.indexCount]).toEqual([7, 15]);
        expect([clipper.vertexBound(1), clipper.indexBound(1)]).toEqual([7, 15]);
        expect([clipper.vertexBound(10), clipper.indexBound(10)]).toEqual([70, 150]);
    });

    it('throws for a polygon without a vertex', () => {
        const clipper = new TriangleClipper();

        expect(() => clipper.start(version, new Float64Array(0), 0, new Int32Array(0), 0, false, false)).toThrow(
            MarrowError,
        );
    });
});

describe('TriangleClipper for a 4.3 inverse clip', () => {
    it('keeps what is outside of the polygon', () => {
        const clipper = started('4.3', SQUARE, true);
        const out = createClippedTriangles(64, 192);

        clipInto(clipper, slotOf(INSIDE), out);
        expect([out.vertexCount, out.indexCount]).toEqual([0, 0]);
        clipInto(clipper, slotOf(OUTSIDE), out);
        expect(areaOf(out)).toBeCloseTo(12.5, 5);
        out.vertexCount = 0;
        out.indexCount = 0;
        clipInto(clipper, slotOf(ACROSS), out);
        expect(areaOf(out)).toBeCloseTo(2, 5);
    });

    it('gives a bound of four vertices per edge and three more', () => {
        const clipper = started('4.3', SQUARE, true);
        const out = createClippedTriangles(64, 192);

        expect([clipper.vertexBound(1), clipper.indexBound(1)]).toEqual([19, 51]);
        // a triangle around the square: every edge splits a polygon off
        clipInto(clipper, slotOf([-30, -30, 40, -30, 5, 45]), out);
        expect(out.vertexCount).toBeLessThanOrEqual(19);
        expect(out.vertexCount).toBeGreaterThanOrEqual(15);
    });

    it('clips as the official clipper does, also with a hull of two vertices and many edges', () => {
        const checker = new ClipChecker('4.3');
        const slot = slotOf(INSIDE, OUTSIDE, ACROSS, SEVEN, [-30, -30, 40, -30, 5, 45], [0, 0, 10, 0, 10, 10]);

        // 200 corners need more room for the polygon inside than any test before
        for (const polygon of [SQUARE, L_SHAPE, COMB, regular(200, 12), [0, 0, 5, 5, 10, 10, 3, 3]]) {
            checker.check('inverse', caseOf(polygon, [slot], true, false));
            checker.check('convex', caseOf(polygon, [slot], false, true));
            checker.check('inverse and convex', caseOf(polygon, [slot], true, true));
        }
        expect(checker.problems.lines).toEqual([]);
        expect(checker.tally.pastBound).toBe(0);
    });
});

const SEEDS = [1, 2, 3, 5, 8, 13];
const CASES = 1500;

describe.each(SPINE_VERSIONS)('TriangleClipper against the official %s clipper', (version) => {
    it.each(SEEDS)('clips the random cases of seed %i to the official vertices and indices', (seed) => {
        const checker = new ClipChecker(version);
        const next = random(seed);

        for (let i = 0; i < CASES && !checker.problems.full; i++) {
            const { label, clipCase } = randomCase(next);

            if (!checker.check(`seed ${seed} case ${i} (${label})`, clipCase)) {
                checker.problems.add(`seed ${seed} case ${i}`, describeCase(clipCase));
            }
        }
        expect(checker.problems.lines).toEqual([]);
        // the cases reach polygons of several parts, full outputs and what the bound allows
        expect(checker.tally.decomposed).toBeGreaterThan(300);
        expect(checker.tally.stops).toBeGreaterThan(5000);
        expect(checker.tally.vertices).toBeGreaterThan(checker.tally.triangles * 3);
        // The bound is the one of exact arithmetic, and some triangles reach it. 4.1 puts a cut on
        // the clip edge, and a triangle with a corner on a corner of the polygon can pass the
        // bound by a vertex. 4.2 and 4.3 put a cut on the edge of the triangle and stay below
        expect(checker.tally.atBound).toBeGreaterThan(5);
        expect(checker.tally.pastBound).toBeLessThanOrEqual(version === '4.1' ? 1 : 0);
        expect(checker.tally.pastBy).toBeLessThanOrEqual(1);
    });
});
