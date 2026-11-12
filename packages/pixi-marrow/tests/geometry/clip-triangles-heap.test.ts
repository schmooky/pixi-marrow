import { describe, expect, it } from 'vitest';
import type { SpineVersion } from '../../src/core';
import { createClippedTriangles, TriangleClipper, VERDICT_CUT } from '../../src/geometry/clip-triangles';
import { Triangulator } from '../../src/geometry/triangulator';
import { random } from '../parity/clip-random';
import { settle, WINDOW } from '../render/heap';

/*
 * The CPU clip kernel allocates nothing once its arrays are as large as the work needs. The
 * method is the one of tests/render/heap.ts: windows of calls until the heap stays as it is.
 */

const CORNERS = 24;
/** Squares per side of the mesh that is clipped. Each square is two triangles. */
const GRID = 8;

/** A polygon around the origin with a random radius per corner, clockwise: concave in many corners. */
function star(next: () => number): Float64Array {
    return Float64Array.from(
        Array.from({ length: CORNERS }, (_, i) => {
            const angle = (-2 * Math.PI * (i + next() * 0.8)) / CORNERS;
            const radius = 4 + next() * 12;

            return [Math.cos(angle) * radius, Math.sin(angle) * radius];
        }).flat(),
    );
}

/** A mesh of squares from -18 to 18: triangles inside, outside and across the polygon. */
function grid(): { positions: Float32Array; uvs: Float32Array; triangles: Uint16Array } {
    const side = GRID + 1;
    const positions = new Float32Array(side * side * 2);
    const uvs = new Float32Array(side * side * 2);
    const triangles: number[] = [];

    for (let row = 0; row < side; row++) {
        for (let column = 0; column < side; column++) {
            const vertex = row * side + column;

            positions.set([(column / GRID) * 36 - 18, (row / GRID) * 36 - 18], vertex * 2);
            uvs.set([column / GRID, row / GRID], vertex * 2);
            if (row < GRID && column < GRID) {
                triangles.push(vertex, vertex + 1, vertex + side, vertex + 1, vertex + side + 1, vertex + side);
            }
        }
    }

    return { positions, uvs, triangles: Uint16Array.from(triangles) };
}

const MODES: [string, SpineVersion, boolean][] = [
    ['4.1', '4.1', false],
    ['4.2', '4.2', false],
    ['4.3', '4.3', false],
    ['4.3 with an inverse clip', '4.3', true],
];

describe('TriangleClipper once warm', () => {
    it.each(MODES)('allocates nothing for %s when the polygon moves every call', (_, version, inverse) => {
        const next = random(17);
        const polygons = Array.from({ length: 16 }, () => star(next));
        // every polygon again, a little further right
        const moved = polygons.map((polygon) => polygon.map((value, i) => value + (i % 2 === 0 ? 1.5 : 0)));
        const { positions, uvs, triangles } = grid();
        const clipper = new TriangleClipper();
        const triangulator = new Triangulator();
        const out = createClippedTriangles(0, 0);
        let taken = 0;
        let vertices = 0;
        let verdicts = 0;
        const run = (i: number): void => {
            const polygon = polygons[i % 16] ?? new Float64Array(0);
            const indexCount = triangulator.triangulate(polygon, CORNERS);

            clipper.start(version, polygon, CORNERS, triangulator.triangles, indexCount, inverse, false);
            // the whole mesh is cut, its first two triangles are in a corner far from the polygon
            verdicts += clipper.verdict(positions, 0, 2, triangles, 0, triangles.length);
            verdicts += clipper.verdict(positions, 0, 2, triangles, 0, 6);
            out.vertexCount = 0;
            out.indexCount = 0;
            taken += clipper.clip(positions, 0, 2, uvs, 0, 2, triangles, 0, triangles.length, out, 0);
            // the same polygon moved: the parts are placed again
            clipper.start(
                version,
                moved[i % 16] ?? polygon,
                CORNERS,
                triangulator.triangles,
                indexCount,
                inverse,
                false,
                true,
            );
            verdicts += clipper.verdict(positions, 0, 2, triangles, 0, triangles.length);
            vertices += out.vertexCount;
        };

        // every polygon once, until the output holds the largest result
        for (let i = 0; i < 16; i++) {
            for (run(i); taken < triangles.length; run(i)) clipper.grow(out);
            taken = 0;
        }
        const arrays = [out.positions, out.uvs, out.indices, clipper.parts.vertices, clipper.parts.starts];

        vertices = 0;
        verdicts = 0;
        const windows = settle(run);

        expect(windows).toBeGreaterThan(0);
        // every call took every triangle, and left some of them
        expect(taken).toBe(windows * WINDOW * triangles.length);
        expect(vertices).toBeGreaterThan(windows * WINDOW * 20);
        // a verdict of cut for the mesh, twice, and one for its corner: nothing inside, whole or cut for an inverse clip
        expect(verdicts).toBeGreaterThanOrEqual(windows * WINDOW * (2 * VERDICT_CUT));
        expect([out.positions, out.uvs, out.indices, clipper.parts.vertices, clipper.parts.starts]).toEqual(arrays);
        expect(out.positions).toBe(arrays[0]);
        expect(clipper.parts.vertices).toBe(arrays[3]);
    });
});
