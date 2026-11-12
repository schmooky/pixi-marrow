import { cutInside, cutOutside, cutScratch } from './clip-triangles-cut';
import type { ClipParts } from './clip-triangles-parts';

/*
 * The output of the clip kernel and the code that fills it: what is left of one triangle goes to
 * the arrays of the caller as the official `clipTriangles` writes it. See `clip-triangles.ts`.
 */

/**
 * The clipped triangles of the slots of a clip, in arrays the caller owns. `clip` appends at the
 * two counts and never replaces an array. A renderer reads a slot from the counts it remembered
 * before the slot was clipped.
 *
 * @example
 * const out = createClippedTriangles(256, 768);
 * out.vertexCount = 0;
 * out.indexCount = 0;
 */
export interface ClippedTriangles {
    /** x, y per vertex, in the space of the input positions. */
    positions: Float32Array;
    /** u, v per vertex. As long as {@link positions}. */
    uvs: Float32Array;
    /**
     * Three vertex numbers per triangle. A polygon of the clipper is a fan around its first
     * vertex. The official 4.3 clipper stores 16 bits, and so more than 65,535 vertices in one
     * slot wrap around there. A `Uint32Array` keeps them.
     */
    indices: Uint16Array | Uint32Array;
    /** How many vertices are in use. The caller sets it to 0 to start over. */
    vertexCount: number;
    /** How many numbers of {@link indices} are in use. The caller sets it to 0 to start over. */
    indexCount: number;
}

/**
 * Makes an empty output with room for that many vertices and indices.
 *
 * @example
 * const out = createClippedTriangles(256, 768);
 * const wide = createClippedTriangles(100_000, 300_000, true);
 *
 * @param wide Whether the indices are 32-bit.
 */
export function createClippedTriangles(vertices: number, indices: number, wide = false): ClippedTriangles {
    return {
        positions: new Float32Array(vertices << 1),
        uvs: new Float32Array(vertices << 1),
        indices: wide ? new Uint32Array(indices) : new Uint16Array(indices),
        vertexCount: 0,
        indexCount: 0,
    };
}

/** Reads the position and the texture coordinates of one corner of a triangle into the scratch. */
function loadCorner(
    corner: number,
    vertex: number,
    positions: Float32Array,
    positionAt: number,
    positionStride: number,
    uvs: Float32Array,
    uvAt: number,
    uvStride: number,
): void {
    const { triangle } = cutScratch;
    const p = positionAt + vertex * positionStride;
    const t = uvAt + vertex * uvStride;

    triangle[corner << 1] = Number(positions[p]);
    triangle[(corner << 1) + 1] = Number(positions[p + 1]);
    triangle[6 + (corner << 1)] = Number(uvs[t]);
    triangle[7 + (corner << 1)] = Number(uvs[t + 1]);
}

/**
 * Appends the triangle of the scratch as it is. Returns false, and writes nothing, when `out`
 * has no room for it. `room` is how many vertices `out` can hold.
 */
function storeTriangle(out: ClippedTriangles, room: number, base: number): boolean {
    const { positions, uvs, indices, vertexCount, indexCount } = out;

    if (vertexCount + 3 > room || indexCount + 3 > indices.length) return false;
    const { triangle } = cutScratch;
    const index = vertexCount - base;

    for (let i = 0, w = vertexCount << 1; i < 6; i++, w++) {
        positions[w] = Number(triangle[i]);
        uvs[w] = Number(triangle[i + 6]);
    }
    indices[indexCount] = index;
    indices[indexCount + 1] = index + 1;
    indices[indexCount + 2] = index + 2;
    out.vertexCount = vertexCount + 3;
    out.indexCount = indexCount + 3;

    return true;
}

/**
 * Appends a polygon that was cut from the triangle of the scratch: `count` vertices of `source`
 * from `at` on. They get the texture coordinates the official clipper gives them, and a fan of
 * triangles. Returns false, and writes nothing, when `out` has no room for it.
 *
 * A polygon of two vertices adds its vertices and no triangle, as the official code does.
 *
 * @param uv43 Whether the weights of a vertex are divided as the 4.3 `clipTriangles` divides.
 */
function storePolygon(
    source: Float64Array,
    at: number,
    count: number,
    out: ClippedTriangles,
    room: number,
    base: number,
    uv43: boolean,
): boolean {
    const { positions, uvs, indices, vertexCount, indexCount } = out;
    const indexEnd = indexCount + (count > 2 ? (count - 2) * 3 : 0);

    if (vertexCount + count > room || indexEnd > indices.length) return false;
    const { triangle } = cutScratch;
    const x1 = Number(triangle[0]);
    const y1 = Number(triangle[1]);
    const x2 = Number(triangle[2]);
    const y2 = Number(triangle[3]);
    const x3 = Number(triangle[4]);
    const y3 = Number(triangle[5]);
    const u1 = Number(triangle[6]);
    const v1 = Number(triangle[7]);
    const u2 = Number(triangle[8]);
    const v2 = Number(triangle[9]);
    const u3 = Number(triangle[10]);
    const v3 = Number(triangle[11]);
    const d0 = y2 - y3;
    const d1 = x3 - x2;
    const d2 = x1 - x3;
    const d4 = y3 - y1;
    const d = 1 / (uv43 ? d0 * d2 - d1 * d4 : d0 * d2 + d1 * (y1 - y3));

    for (let i = at, end = at + (count << 1), w = vertexCount << 1; i < end; i += 2, w += 2) {
        const x = Number(source[i]);
        const y = Number(source[i + 1]);
        const c0 = x - x3;
        const c1 = y - y3;
        const a = (d0 * c0 + d1 * c1) * d;
        const b = (d4 * c0 + d2 * c1) * d;
        const c = 1 - a - b;

        positions[w] = x;
        positions[w + 1] = y;
        uvs[w] = u1 * a + u2 * b + u3 * c;
        uvs[w + 1] = v1 * a + v2 * b + v3 * c;
    }
    const index = vertexCount - base;

    for (let i = 1, w = indexCount; w < indexEnd; i++, w += 3) {
        indices[w] = index;
        indices[w + 1] = index + i;
        indices[w + 2] = index + i + 1;
    }
    out.vertexCount = vertexCount + count;
    out.indexCount = indexEnd;

    return true;
}

/**
 * Clips the triangle of the scratch against every part, as the official `clipTriangles` loops:
 * a part that holds the whole triangle ends the loop. Returns false when `out` is full.
 */
function clipInside(
    parts: ClipParts,
    legacy: boolean,
    uv43: boolean,
    out: ClippedTriangles,
    room: number,
    base: number,
): boolean {
    const { vertices, starts, count } = parts;

    for (let part = 0; part < count; part++) {
        const left = cutInside(vertices, Number(starts[part]), Number(starts[part + 1]) - 4, legacy);

        if (left < 0) return storeTriangle(out, room, base);
        if (left > 0 && !storePolygon(cutScratch.polygon, 0, left, out, room, base, uv43)) return false;
    }

    return true;
}

/**
 * Keeps what of the triangle of the scratch is outside of the first part, as the 4.3
 * `clipTriangles` does for an `inverse` clip. Returns false when `out` is full.
 */
function clipOutside(parts: ClipParts, out: ClippedTriangles, room: number, base: number): boolean {
    const used = cutOutside(parts.vertices, 0, Number(parts.starts[1]) - 4);
    const { fragments } = cutScratch;

    for (let at = 0; at < used; ) {
        const size = Number(fragments[at]);

        if (!storePolygon(fragments, at + 1, size >> 1, out, room, base, false)) return false;
        at += size + 1;
    }

    return true;
}

/**
 * Clips triangles against the parts of a clip polygon and appends what is left to `out`. This is
 * the loop of `TriangleClipper.clip`, which documents the arguments. Returns how many numbers of
 * `indices` it took: fewer than `indexCount` when `out` had no room for the next triangle.
 *
 * @example
 * const taken = clipTriangles(clipper.parts, false, true, positions, 0, 2, uvs, 0, 2, triangles, 0, triangles.length, out, 0);
 *
 * @param legacy Whether the edges cut as 4.1 does.
 * @param uv43 Whether the weights of a new vertex are divided as the 4.3 `clipTriangles` divides.
 */
export function clipTriangles(
    parts: ClipParts,
    legacy: boolean,
    uv43: boolean,
    positions: Float32Array,
    positionAt: number,
    positionStride: number,
    uvs: Float32Array,
    uvAt: number,
    uvStride: number,
    indices: Uint16Array,
    indexStart: number,
    indexCount: number,
    out: ClippedTriangles,
    base: number,
): number {
    const room = Math.min(out.positions.length, out.uvs.length) >> 1;

    for (let i = 0; i < indexCount; i += 3) {
        const at = indexStart + i;
        const vertexMark = out.vertexCount;
        const indexMark = out.indexCount;

        loadCorner(0, Number(indices[at]), positions, positionAt, positionStride, uvs, uvAt, uvStride);
        loadCorner(1, Number(indices[at + 1]), positions, positionAt, positionStride, uvs, uvAt, uvStride);
        loadCorner(2, Number(indices[at + 2]), positions, positionAt, positionStride, uvs, uvAt, uvStride);
        const fits = parts.inverse
            ? clipOutside(parts, out, room, base)
            : clipInside(parts, legacy, uv43, out, room, base);

        if (!fits) {
            out.vertexCount = vertexMark;
            out.indexCount = indexMark;

            return i;
        }
    }

    return indexCount;
}
