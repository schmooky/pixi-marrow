import { SkeletonClipping as Clipping42, Triangulator as Official42 } from 'spine-core-4.2';
import { Triangulator as Official43 } from 'spine-core-4.3';
import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { importSkeleton } from '../../src/formats/import';
import { Triangulator } from '../../src/geometry/triangulator';
import { listFixtures, readFixture } from '../parity/fixtures';
import { settle, WINDOW } from '../render/heap';

/*
 * The reference is the official `Triangulator` of 4.3, and of 4.2 to show that both give the same
 * triangles. Polygons are clockwise with y up, as the official clipper hands them over.
 */

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

/** A regular polygon, clockwise. */
function regular(corners: number, radius = 10): number[] {
    return Array.from({ length: corners }, (_, i) => {
        const angle = (-2 * Math.PI * i) / corners;

        return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    }).flat();
}

/** A polygon around the origin with a random radius per corner, clockwise: simple, and concave in many corners. */
function starShaped(corners: number, next: () => number): number[] {
    return Array.from({ length: corners }, (_, i) => {
        const angle = (-2 * Math.PI * (i + next() * 0.8)) / corners;
        const radius = 2 + next() * 30;

        return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    }).flat();
}

/** Points in no order: the polygon crosses itself. */
const scattered = (corners: number, next: () => number): number[] =>
    Array.from({ length: corners * 2 }, () => Math.round(next() * 40) - 20);

const SQUARE = [0, 0, 0, 10, 10, 10, 10, 0];
const L_SHAPE = [0, 0, 0, 20, 10, 20, 10, 10, 20, 10, 20, 0];
const ARROW = [0, 0, 10, 20, 20, 0, 10, 5];
const COMB = [0, 0, 0, 10, 2, 10, 2, 4, 4, 4, 4, 10, 6, 10, 6, 4, 8, 4, 8, 10, 10, 10, 10, 0];
const STAR = Array.from({ length: 10 }, (_, i) => {
    const angle = (-2 * Math.PI * i) / 10;
    const radius = i % 2 === 0 ? 10 : 4;

    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}).flat();

/** What the official triangulators give for a polygon. Both must agree. */
function official(polygon: readonly number[]): number[] {
    const triangles = [...new Official43().triangulate([...polygon])];

    expect([...new Official42().triangulate([...polygon])], 'the official 4.2 triangles').toEqual(triangles);

    return triangles;
}

/** What ours gives for the same polygon. */
function ours(triangulator: Triangulator, polygon: readonly number[]): number[] {
    const count = triangulator.triangulate(Float64Array.from(polygon), polygon.length >> 1);

    return Array.from(triangulator.triangles.subarray(0, count));
}

/** Twice the area of a polygon. Positive for a clockwise one with y up. */
function doubleArea(polygon: readonly number[]): number {
    let sum = 0;

    for (let i = 0; i < polygon.length; i += 2) {
        const next = (i + 2) % polygon.length;

        sum += (polygon[next] ?? 0) * (polygon[i + 1] ?? 0) - (polygon[i] ?? 0) * (polygon[next + 1] ?? 0);
    }

    return sum;
}

/** Twice the area of all triangles, each counted positive. */
function doubleAreaOf(polygon: readonly number[], triangles: readonly number[]): number {
    let sum = 0;

    for (let t = 0; t < triangles.length; t += 3) {
        const corners = [0, 1, 2].flatMap((corner) => {
            const vertex = (triangles[t + corner] ?? 0) * 2;

            return [polygon[vertex] ?? 0, polygon[vertex + 1] ?? 0];
        });

        sum += Math.abs(doubleArea(corners));
    }

    return sum;
}

/** The polygons of the clipping attachments in the official example exports, made clockwise. */
async function fixturePolygons(): Promise<{ id: string; polygon: number[] }[]> {
    const polygons: { id: string; polygon: number[] }[] = [];

    for (const fixture of listFixtures().filter((candidate) => candidate.format === 'binary')) {
        const model = await importSkeleton(readFixture(fixture).skeleton);

        for (const { attachment } of model.skins.flatMap((skin) => skin.attachments)) {
            if (attachment.type !== 'clipping' || attachment.bones !== null) continue;
            const polygon = Array.from(attachment.vertices);

            Clipping42.makeClockwise(polygon);
            polygons.push({ id: fixture.id, polygon });
        }
    }

    return polygons;
}

describe('Triangulator', () => {
    it.each([
        ['a triangle', regular(3)],
        ['a square', SQUARE],
        ['a pentagon', regular(5)],
        ['a polygon of 16 corners', regular(16)],
        ['a polygon of 64 corners', regular(64, 300)],
    ])('cuts %s, which is convex, as the official triangulator does', (_, polygon) => {
        const triangles = ours(new Triangulator(), polygon);

        expect(triangles).toEqual(official(polygon));
        expect(triangles.length).toBe((polygon.length / 2 - 2) * 3);
        expect(doubleAreaOf(polygon, triangles)).toBeCloseTo(doubleArea(polygon), 6);
    });

    it.each([
        ['an L', L_SHAPE],
        ['an arrow', ARROW],
        ['a comb', COMB],
        ['a star', STAR],
    ])('cuts %s, which is concave, as the official triangulator does', (_, polygon) => {
        const triangles = ours(new Triangulator(), polygon);

        expect(triangles).toEqual(official(polygon));
        expect(triangles.length).toBe((polygon.length / 2 - 2) * 3);
        // the triangles cover the polygon and nothing else
        expect(doubleAreaOf(polygon, triangles)).toBeCloseTo(doubleArea(polygon), 6);
    });

    it('cuts the clip polygons of the official examples as the official triangulator does', async () => {
        const polygons = await fixturePolygons();
        const triangulator = new Triangulator();

        // the coin and spineboy, in each version. The polygon of the tank has weights
        expect(polygons.length).toBeGreaterThanOrEqual(6);
        expect(Math.max(...polygons.map((item) => item.polygon.length / 2))).toBeGreaterThan(30);
        for (const { id, polygon } of polygons) {
            const triangles = ours(triangulator, polygon);

            expect(triangles, id).toEqual(official(polygon));
            expect(doubleAreaOf(polygon, triangles), id).toBeCloseTo(doubleArea(polygon), 2);
        }
    });

    it('cuts 400 random concave polygons as the official triangulator does', () => {
        const next = random(7);
        const triangulator = new Triangulator();
        let concave = 0;

        for (let i = 0; i < 400; i++) {
            const polygon = starShaped(3 + Math.floor(next() * 38), next);
            const triangles = ours(triangulator, polygon);

            expect(triangles).toEqual(official(polygon));
            expect(doubleAreaOf(polygon, triangles)).toBeCloseTo(doubleArea(polygon), 4);
            if (triangles.some((vertex, at) => at % 3 === 0 && vertex !== 0)) concave++;
        }
        // most of them need more than a fan around the first vertex
        expect(concave).toBeGreaterThan(300);
    });

    it('gives the official triangles for a polygon the official code was not made for', () => {
        const next = random(11);
        const triangulator = new Triangulator();
        const odd: number[][] = [
            // counter-clockwise
            [...SQUARE].reverse(),
            // all on one line
            [0, 0, 1, 1, 2, 2, 3, 3, 4, 4],
            // the same point five times
            [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
            // a number that is none
            [0, 0, 0, 10, Number.NaN, 10, 10, 0, 5, -5],
            // a bow tie
            [0, 0, 10, 10, 10, 0, 0, 10],
        ];

        for (let i = 0; i < 300; i++) odd.push(scattered(4 + Math.floor(next() * 12), next));
        for (const polygon of odd) {
            const triangles = ours(triangulator, polygon);

            expect(triangles).toEqual(official(polygon));
            expect(triangles.length).toBe((polygon.length / 2 - 2) * 3);
        }
    });

    it('has no triangle for fewer than three vertices', () => {
        const triangulator = new Triangulator();

        for (const polygon of [[], [1, 2], [1, 2, 3, 4]]) {
            expect(ours(triangulator, polygon)).toEqual([]);
            expect(official(polygon)).toEqual([]);
        }
    });

    it('keeps its arrays for a polygon that fits and allocates nothing then', () => {
        const triangulator = new Triangulator();
        const next = random(3);
        const polygons = Array.from({ length: 16 }, () => Float64Array.from(starShaped(40, next)));
        const small = Float64Array.from(STAR);
        let numbers = 0;

        triangulator.triangulate(polygons[0] ?? small, 40);
        const { triangles } = triangulator;

        expect(triangles.length).toBe(38 * 3);
        const windows = settle((i) => {
            numbers += triangulator.triangulate(polygons[i % 16] ?? small, 40);
            numbers += triangulator.triangulate(small, 10);
        });

        expect(windows).toBeGreaterThan(0);
        expect(numbers).toBe(windows * WINDOW * (38 + 8) * 3);
        expect(triangulator.triangles).toBe(triangles);
        // a larger polygon gets new arrays, once
        expect(triangulator.triangulate(Float64Array.from(regular(64)), 64)).toBe(62 * 3);
        expect(triangulator.triangles).not.toBe(triangles);
    });

    // last in the file: a read past the end changes how the engine compiles the readers
    it('reads only as many vertices as it is told, and throws when they are not there', () => {
        const triangulator = new Triangulator();
        const padded = Float64Array.of(...L_SHAPE, 1e9, -1e9, Number.NaN, 0);
        const count = triangulator.triangulate(padded, L_SHAPE.length / 2);

        expect(Array.from(triangulator.triangles.subarray(0, count))).toEqual(official(L_SHAPE));
        // not a triangle of undefined numbers
        expect(() => triangulator.triangulate(Float64Array.from(SQUARE), 5)).toThrow(MarrowError);
    });
});
