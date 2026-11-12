import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { convexHull, polygonArea, reduceConvexPolygon } from '../../src/geometry/convex';
import { boxOutside, isConvex, seeded } from './outline-checks';

/** The hull of a list of points, as its own array. */
function hullOf(points: number[]): Float64Array {
    const out = new Float64Array(points.length);
    const count = convexHull(Float64Array.from(points), points.length / 2, out);

    return out.slice(0, count * 2);
}

/** The polygon `reduceConvexPolygon` gives for a hull. */
function reduce(hull: Float64Array, maxVertices: number): Float64Array {
    const out = new Float64Array(Math.max(hull.length, maxVertices * 2));
    const count = reduceConvexPolygon(hull, hull.length / 2, maxVertices, out);

    return out.slice(0, count * 2);
}

/** The corners of the unit squares of random pixels on a small grid: what the hull of an image is made of. */
function pixelCorners(random: () => number, size: number, fill: number): number[] {
    const points: number[] = [];

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (random() < fill) points.push(x, y, x + 1, y, x, y + 1, x + 1, y + 1);
        }
    }

    return points;
}

/** How far the vertices of `inner` stick out of the convex polygon `outer`. */
const outside = (outer: Float64Array, inner: Float64Array): number =>
    Math.max(
        ...Array.from({ length: inner.length / 2 }, (_, i) => {
            const x = inner[i * 2] ?? 0;
            const y = inner[i * 2 + 1] ?? 0;

            return boxOutside(outer, x, y, x, y);
        }),
    );

const bounds = (polygon: Float64Array): { minX: number; minY: number; maxX: number; maxY: number } => {
    const xs = Array.from(polygon).filter((_, i) => i % 2 === 0);
    const ys = Array.from(polygon).filter((_, i) => i % 2 === 1);

    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
};

/** Cuts a convex polygon with the half plane left of the line from a to b, where its inside lies. */
function clip(polygon: number[], ax: number, ay: number, bx: number, by: number): number[] {
    const side = (x: number, y: number): number => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const out: number[] = [];

    for (let i = 0; i < polygon.length; i += 2) {
        const x = polygon[i] ?? 0;
        const y = polygon[i + 1] ?? 0;
        const nextX = polygon[(i + 2) % polygon.length] ?? 0;
        const nextY = polygon[(i + 3) % polygon.length] ?? 0;
        const here = side(x, y);
        const there = side(nextX, nextY);

        if (here >= 0) out.push(x, y);
        if (here >= 0 !== there >= 0) {
            const t = here / (here - there);

            out.push(x + (nextX - x) * t, y + (nextY - y) * t);
        }
    }

    return out;
}

/**
 * The least area of a polygon made of the four sides of the bounding box and at most `extra`
 * lines of hull edges, found by trying every choice of lines.
 */
function bruteLeastArea(hull: Float64Array, extra: number): number {
    const { minX, minY, maxX, maxY } = bounds(hull);
    const count = hull.length / 2;
    const edges: number[][] = [];
    let least = Number.POSITIVE_INFINITY;

    for (let i = 0; i < count; i++) {
        const next = (i + 1) % count;
        const edge = [hull[i * 2] ?? 0, hull[i * 2 + 1] ?? 0, hull[next * 2] ?? 0, hull[next * 2 + 1] ?? 0];

        if (edge[0] !== edge[2] && edge[1] !== edge[3]) edges.push(edge);
    }
    for (let choice = 0; choice < 1 << edges.length; choice++) {
        const chosen = edges.filter((_, i) => (choice >> i) & 1);

        if (chosen.length > extra) continue;
        const polygon = chosen.reduce(
            (cut, edge) => clip(cut, edge[0] ?? 0, edge[1] ?? 0, edge[2] ?? 0, edge[3] ?? 0),
            [minX, minY, maxX, minY, maxX, maxY, minX, maxY],
        );

        least = Math.min(least, polygonArea(polygon, polygon.length / 2));
    }

    return least;
}

describe('polygonArea', () => {
    it('gives the area for either winding', () => {
        expect(polygonArea([0, 0, 4, 0, 4, 3, 0, 3], 4)).toBe(12);
        expect(polygonArea([0, 3, 4, 3, 4, 0, 0, 0], 4)).toBe(12);
        expect(polygonArea([1, 1, 5, 1, 1, 4], 3)).toBe(6);
        expect(polygonArea([], 0)).toBe(0);
    });
});

describe('convexHull', () => {
    it('keeps the corners and drops points inside and on the edges', () => {
        const hull = hullOf([0, 0, 2, 0, 1, 1, 2, 2, 0, 2, 1, 0, 2, 1, 0, 1, 1, 2]);

        // from the leftmost point, clockwise on a page where y points down
        expect(Array.from(hull)).toEqual([0, 0, 2, 0, 2, 2, 0, 2]);
        expect(isConvex(hull)).toBe(true);
    });

    it('gives fewer than 3 vertices for points on one line, for one point and for none', () => {
        expect(Array.from(hullOf([0, 0, 1, 1, 2, 2, 3, 3]))).toEqual([0, 0, 3, 3]);
        expect(Array.from(hullOf([5, 7]))).toEqual([5, 7]);
        expect(Array.from(hullOf([]))).toEqual([]);
        expect(hullOf([4, 4, 4, 4, 4, 4]).length).toBeLessThan(6);
    });

    it('holds every point of random sets and uses only points of the set', () => {
        const random = seeded(7);

        for (let round = 0; round < 200; round++) {
            const points = Array.from({ length: 2 * (3 + Math.floor(random() * 40)) }, () => Math.floor(random() * 30));
            const hull = hullOf(points);

            if (hull.length < 6) continue;
            expect(isConvex(hull)).toBe(true);
            expect(outside(hull, Float64Array.from(points))).toBe(0);
            for (let i = 0; i < hull.length; i += 2) {
                const found = points.some((x, at) => at % 2 === 0 && x === hull[i] && points[at + 1] === hull[i + 1]);

                expect(found).toBe(true);
            }
        }
    });
});

describe('reduceConvexPolygon', () => {
    it('returns a hull that is small enough unchanged', () => {
        const hull = hullOf([0, 0, 6, 0, 8, 3, 6, 7, 0, 7]);

        expect(Array.from(reduce(hull, 8))).toEqual(Array.from(hull));
        expect(Array.from(reduce(hull, 5))).toEqual(Array.from(hull));
    });

    it('cuts the cheapest corners of an octagon', () => {
        // a 10x10 square with corners cut by 1, 2, 3 and 4: the larger the cut, the more a line saves
        const hull = hullOf([1, 0, 8, 0, 10, 2, 10, 7, 7, 10, 4, 10, 0, 6, 0, 1]);

        expect(Array.from(reduce(hull, 8))).toEqual(Array.from(hull));
        // the line of the smallest cut goes first
        expect(Array.from(reduce(hull, 7))).toEqual([0, 0, 8, 0, 10, 2, 10, 7, 7, 10, 4, 10, 0, 6]);
        expect(Array.from(reduce(hull, 6))).toEqual([0, 0, 10, 0, 10, 7, 7, 10, 4, 10, 0, 6]);
        expect(Array.from(reduce(hull, 5))).toEqual([0, 0, 10, 0, 10, 10, 4, 10, 0, 6]);
        expect(Array.from(reduce(hull, 4))).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
    });

    it('only grows the polygon, stays in the bounding box and keeps to the vertex limit', () => {
        const random = seeded(11);

        for (let round = 0; round < 300; round++) {
            // points on an ellipse and some anywhere: hulls with many edges and with few
            const count = 5 + Math.floor(random() * 60);
            const points = Array.from({ length: count }, (_, i) => {
                const angle = random() * Math.PI * 2;
                const radius = i % 3 === 0 ? random() : 1;

                return [50 + Math.cos(angle) * 40 * radius, 30 + Math.sin(angle) * 25 * radius];
            }).flat();
            const hull = hullOf(points);
            const box = bounds(hull);

            for (const maxVertices of [4, 5, 6, 8, 12]) {
                const reduced = reduce(hull, maxVertices);
                const reducedBox = bounds(reduced);

                expect(reduced.length / 2).toBeLessThanOrEqual(maxVertices);
                expect(isConvex(reduced)).toBe(true);
                expect(outside(reduced, hull)).toBeLessThan(1e-9);
                expect(reducedBox.minX).toBeGreaterThanOrEqual(box.minX);
                expect(reducedBox.minY).toBeGreaterThanOrEqual(box.minY);
                expect(reducedBox.maxX).toBeLessThanOrEqual(box.maxX);
                expect(reducedBox.maxY).toBeLessThanOrEqual(box.maxY);
                expect(polygonArea(reduced, reduced.length / 2)).toBeGreaterThanOrEqual(
                    polygonArea(hull, hull.length / 2) - 1e-9,
                );
            }
        }
    });

    it('handles hulls that touch the bounding box in single points', () => {
        const diamond = hullOf([5, 0, 10, 5, 5, 10, 0, 5]);
        const triangle = hullOf([0, 0, 10, 3, 2, 9]);
        const many = hullOf(
            Array.from({ length: 24 }, (_, i) => [Math.cos(i / 3.82) * 9, Math.sin(i / 3.82) * 9]).flat(),
        );

        expect(Array.from(reduce(diamond, 4))).toEqual(Array.from(diamond));
        expect(Array.from(reduce(triangle, 4))).toEqual(Array.from(triangle));
        for (const maxVertices of [4, 5, 7, 8]) {
            const reduced = reduce(many, maxVertices);

            expect(reduced.length / 2).toBeLessThanOrEqual(maxVertices);
            expect(isConvex(reduced)).toBe(true);
            expect(outside(reduced, many)).toBeLessThan(1e-9);
        }
    });

    it('finds the least area that any choice of hull edges gives', () => {
        const random = seeded(23);
        let compared = 0;

        for (let round = 0; round < 400; round++) {
            const hull = hullOf(pixelCorners(random, 5 + Math.floor(random() * 4), 0.15 + random() * 0.5));
            const box = bounds(hull);

            if (hull.length / 2 < 6 || hull.length / 2 > 16) continue;
            for (const maxVertices of [4, 5, 6, 7, 8]) {
                if (hull.length / 2 <= maxVertices) continue;
                const reduced = reduce(hull, maxVertices);
                const area = polygonArea(reduced, reduced.length / 2);
                const least = bruteLeastArea(hull, maxVertices - 4);

                // moving new vertices to the grid adds at most 1/16 pixel along the outline
                expect(area).toBeGreaterThanOrEqual(least - 1e-9);
                expect(area).toBeLessThanOrEqual(least + (box.maxX - box.minX + box.maxY - box.minY) / 8);
                compared++;
            }
        }
        expect(compared).toBeGreaterThan(300);
    });

    it('puts new vertices on a grid of 1/16 pixel, away from the hull', () => {
        const random = seeded(31);

        for (let round = 0; round < 100; round++) {
            const hull = hullOf(pixelCorners(random, 9, 0.3));

            for (const value of reduce(hull, 6)) expect(Number.isInteger(value * 16)).toBe(true);
        }
    });

    it('throws for a vertex limit below 4 or one that is not a whole number', () => {
        const hull = hullOf([0, 0, 6, 0, 8, 3, 6, 7, 0, 7]);

        for (const maxVertices of [3, 0, -1, 4.5, Number.NaN]) {
            expect(() => reduce(hull, maxVertices)).toThrow(MarrowError);
        }
        expect(() => reduce(hull, 3)).toThrow(/at least 4/);
    });
});
