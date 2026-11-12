import type { SpineVersion } from '../base/version';
import { ClipParts } from './clip-triangles-parts';
import { type ClippedTriangles, clipTriangles } from './clip-triangles-store';
import { judgeTriangles, partsAreTame, VERDICT_CUT } from './clip-triangles-verdict';

export type { ClippedTriangles } from './clip-triangles-store';
export { createClippedTriangles } from './clip-triangles-store';
export { VERDICT_CUT, VERDICT_NOTHING, VERDICT_WHOLE } from './clip-triangles-verdict';

/*
 * Clipping on the CPU: the triangles of a slot are cut against a clip polygon, as the official
 * `SkeletonClipping.clipTriangles` cuts them. The result has the official vertices in the
 * official order, so a renderer that batches can draw clipped slots without a mask.
 *
 * How a renderer uses the kernel for one slot:
 *
 * 1. Once per clip and update, at the slot of the clipping attachment: `clipper.start` with the
 *    polygon as `ClipShape` shapes it, and its triangles. Every slot up to the end slot uses that
 *    polygon.
 * 2. Per slot: `clipper.verdict` says without output whether the clip leaves nothing of the slot,
 *    leaves it as it is, or cuts it. Only for the last one, remember `out.vertexCount` and
 *    `out.indexCount` and call `clipper.clip` with the positions, texture coordinates and
 *    triangles of the slot. It appends to `out` and returns how many indices it took. Fewer than
 *    asked means `out` is full: `clipper.grow(out)` and call again for the rest.
 * 3. The slot now owns the vertices and indices of `out` from the remembered counts on. Its
 *    indices count from the vertex that was passed as `base`.
 *
 * Where the result is equal to the official one. The official clipper computes in 64 bits. Its
 * renderers hand it positions and texture coordinates that are 32-bit floats and a polygon of
 * 64-bit numbers, and they store the result in 32-bit arrays. The kernel takes the same input,
 * does the same arithmetic in the same order in 64 bits and stores into `Float32Array`. So the
 * stored numbers have the bits the official renderer stores.
 *
 * That holds when the triangles given to `start` are those of the ear clipping of the polygon in
 * its pose, which is what the official clipper cuts. `ClipShape` can hand out triangles it cut
 * once from the vertices of the attachment. Ear clipping can decide otherwise there when three
 * vertices are on a line. The parts are then others: the same area is kept, with other vertices.
 *
 * The versions differ, and `start` takes the version:
 *
 * - How an edge cuts: 4.1 against 4.2 and 4.3. See `clip-triangles-cut.ts`.
 * - The parts of the polygon: 4.1 and 4.2 against 4.3. See `clip-triangles-parts.ts`.
 * - The weights of a new vertex in its triangle. 4.3 divides by `d0 * d2 - d1 * d4`, 4.1 and 4.2
 *   by `d0 * d2 + d1 * (y1 - y3)`. The two differ only in the sign of a zero, for a triangle
 *   without area. With the cuts of 4.1 that decides the sign of an infinite texture coordinate.
 *   With the cuts of 4.2 and 4.3 such a coordinate is not a number either way.
 * - 4.3 `inverse` keeps what is outside of the polygon: every edge splits off a polygon. The
 *   `convex` flag of 4.3 only changes the polygon, which is the business of the caller.
 */

/**
 * Clips triangles against the polygon of a clipping attachment on the CPU. The result is the one
 * of the official `SkeletonClipping.clipTriangles` of a version: the same vertices in the same
 * order, with the same bits once stored as 32-bit floats, and the same indices.
 *
 * One clipper serves every clip of every skeleton, one after the other: `start` sets the
 * polygon, and `clip` cuts the triangles of one slot against it. Nothing is allocated once the
 * arrays are as large as the largest polygon and slot. A triangle without area that is cut gets
 * texture coordinates that are not numbers, as in the official clipper.
 *
 * @example
 * const clipper = new TriangleClipper();
 * const out = createClippedTriangles(256, 768);
 * // at the slot of the clipping attachment, with the polygon of a `ClipShape`
 * clipper.start(model.version, shape.polygon, shape.vertexCount, shape.triangles, shape.indexCount, clip.inverse, clip.convex);
 * // for every slot up to the end slot: positions with x, y per vertex, statics with u, v and one more number
 * const verdict = clipper.verdict(positions, first * 2, 2, triangles, 0, triangles.length);
 * // VERDICT_NOTHING: the slot is not drawn. VERDICT_WHOLE: it is drawn as it is. VERDICT_CUT:
 * const base = out.vertexCount;
 * const firstIndex = out.indexCount;
 * let done = 0;
 * for (;;) {
 *     done += clipper.clip(positions, first * 2, 2, statics, first * 3, 3, triangles, done, triangles.length - done, out, base);
 *     if (done === triangles.length) break;
 *     clipper.grow(out);
 * }
 * // the slot draws out.indices from firstIndex to out.indexCount, and they count from vertex `base`
 */
export class TriangleClipper {
    /** The convex parts of the polygon of the last {@link start}. */
    readonly parts: ClipParts = new ClipParts();
    /** Whether the edges cut as 4.1 does. */
    private legacy = false;
    /** Whether a new vertex gets its texture coordinates with the division of 4.3. */
    private uv43 = false;
    /** The most vertices one triangle leaves in exact arithmetic. */
    private triangleVertices = 0;
    /** The most indices one triangle leaves in exact arithmetic. */
    private triangleIndices = 0;
    /** Whether {@link verdict} can reason about the numbers of the parts: 0 not looked at yet, 1 yes, 2 no. */
    private tame = 0;

    /**
     * Sets the polygon that the next calls of {@link clip} cut against, as the official
     * `clipStart` of a version prepares it.
     *
     * The polygon is the shaped one, which `ClipShape` computes: clockwise, and the convex hull
     * for a 4.3 attachment that is `inverse` or `convex` and not convex by itself. `triangles`
     * are those of the ear clipping of that polygon. Throws a `MarrowError` for a polygon without
     * a vertex.
     *
     * @example
     * clipper.start('4.3', shape.polygon, shape.vertexCount, shape.triangles, shape.indexCount, clip.inverse, clip.convex);
     *
     * @param polygon x, y per vertex, 64-bit as in the official clipper.
     * @param vertexCount How many vertices the polygon has.
     *
     * @param triangles Three vertex numbers per triangle.
     * @param indexCount How many numbers of `triangles` are valid.
     *
     * @param inverse The `inverse` flag of the clipping attachment. Not read for 4.1 and 4.2.
     *
     * @param convex The `convex` flag of the clipping attachment. Not read for 4.1 and 4.2.
     *
     * @param moved Whether the polygon is the one of the last call at another place: the same
     * triangles and the same shape, not mirrored. The parts are then placed again and not cut
     * again, which is the official result unless three vertices are on a line. See `ClipParts.set`.
     */
    start(
        version: SpineVersion,
        polygon: Float64Array,
        vertexCount: number,
        triangles: Int32Array,
        indexCount: number,
        inverse: boolean,
        convex: boolean,
        moved = false,
    ): void {
        const { parts } = this;

        parts.set(version, polygon, vertexCount, triangles, indexCount, inverse, convex, moved);
        this.tame = 0;
        this.legacy = version === '4.1';
        this.uv43 = version === '4.3';
        // inside: a part of n edges turns a triangle into n + 3 vertices at most, a fan of n + 1 triangles
        this.triangleVertices = parts.inverse ? parts.edges * 4 + 3 : parts.edges + parts.count * 3;
        this.triangleIndices = (parts.inverse ? parts.edges * 4 + 1 : parts.edges + parts.count) * 3;
    }

    /**
     * The most vertices that many triangles leave for the polygon of the last {@link start}, in
     * exact arithmetic. A part of n edges cuts a triangle to n + 3 vertices at most. An inverse
     * clip of n edges leaves 4n + 3 at most.
     *
     * Rounding can pass the bound. 4.1 puts a cut on the clip edge, and a triangle with a corner
     * on a corner of the polygon was seen to leave one vertex more. No such triangle was found
     * for 4.2 and 4.3. So {@link clip} does not rely on the bound and checks the room itself. A
     * bound that holds under rounding is of no use: every edge can add half of the vertices again.
     *
     * A triangle that the polygon does not cut leaves 3 vertices, so the bound is loose for most
     * slots.
     *
     * @example
     * const most = clipper.vertexBound(triangles.length / 3);
     */
    vertexBound(triangles: number): number {
        return triangles * this.triangleVertices;
    }

    /**
     * The most indices that many triangles leave for the polygon of the last {@link start}, in
     * exact arithmetic. See {@link vertexBound} for what rounding does to it.
     *
     * @example
     * const most = clipper.indexBound(triangles.length / 3);
     */
    indexBound(triangles: number): number {
        return triangles * this.triangleIndices;
    }

    /**
     * Says what {@link clip} would write for the triangles of one slot, without writing it. The
     * answer comes from the box around the vertices, so it costs little.
     *
     * - `VERDICT_NOTHING`, 0: `clip` would write nothing. The slot is not drawn.
     * - `VERDICT_WHOLE`, 1: `clip` would write every triangle with its three positions as they
     *   are, in their order, and nothing else. The slot can be drawn with its own vertices.
     * - `VERDICT_CUT`, 2: anything else, and every case that the box does not settle.
     *
     * 0 and 1 are never said where `clip` writes something else. A triangle that lies inside of
     * the polygon across two of its parts is split by `clip`, so it gets 2. For an inverse clip
     * `clip` turns the corners of a triangle outside of the polygon once per edge it passes, so 1
     * is said only where they end up in their order. The texture coordinates `clip` writes for an
     * inverse clip are computed again and can differ from those of the slot in the last bits.
     *
     * @example
     * const verdict = clipper.verdict(positions, first * 2, 2, triangles, 0, triangles.length);
     * if (verdict === VERDICT_CUT) clipper.clip(positions, first * 2, 2, uvs, first * 2, 2, triangles, 0, triangles.length, out, out.vertexCount);
     *
     * @param indices Three vertex numbers per triangle.
     * @param indexStart The first number of `indices` to read.
     *
     * @param indexCount How many numbers to read, three per triangle.
     */
    verdict(
        positions: Float32Array,
        positionAt: number,
        positionStride: number,
        indices: Uint16Array,
        indexStart: number,
        indexCount: number,
    ): 0 | 1 | 2 {
        const { parts } = this;

        if (this.tame === 0) this.tame = partsAreTame(parts) ? 1 : 2;
        if (this.tame === 2) return VERDICT_CUT;

        return judgeTriangles(
            parts,
            this.legacy,
            positions,
            positionAt,
            positionStride,
            indices,
            indexStart,
            indexCount,
        );
    }

    /**
     * Clips the triangles of one slot against the polygon of the last {@link start} and appends
     * what is left to `out`: `out.vertexCount` and `out.indexCount` grow.
     *
     * Returns how many numbers of `indices` it took. A number below `indexCount` means that `out`
     * had no room for the next triangle. Nothing of that triangle is written then. Make `out`
     * larger, for example with {@link grow}, and call again for the rest with the same `base`.
     *
     * Vertex `k` of the slot has its position at `positions[positionAt + k * positionStride]` and
     * its texture coordinates at `uvs[uvAt + k * uvStride]`, each followed by the second number.
     * The arrays of `out` must not be the input arrays.
     *
     * @example
     * const base = out.vertexCount;
     * const taken = clipper.clip(positions, 0, 2, uvs, 0, 2, triangles, 0, triangles.length, out, base);
     * if (taken < triangles.length) clipper.grow(out);
     *
     * @param indices Three vertex numbers per triangle.
     * @param indexStart The first number of `indices` to read.
     *
     * @param indexCount How many numbers to read, three per triangle.
     *
     * @param base The vertex of `out` that index 0 stands for. With `out.vertexCount` from before
     * the first call for the slot the indices are those of the official clipper. With 0 they
     * count from the start of `out`.
     */
    clip(
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
        return clipTriangles(
            this.parts,
            this.legacy,
            this.uv43,
            positions,
            positionAt,
            positionStride,
            uvs,
            uvAt,
            uvStride,
            indices,
            indexStart,
            indexCount,
            out,
            base,
        );
    }

    /**
     * Replaces the arrays of `out` by larger ones with the same content: twice the room, and the
     * room of one more triangle. So a loop that grows after every short {@link clip} ends.
     *
     * @example
     * while (done < count) {
     *     done += clipper.clip(positions, 0, 2, uvs, 0, 2, triangles, done, count - done, out, base);
     *     if (done < count) clipper.grow(out);
     * }
     */
    grow(out: ClippedTriangles): void {
        const numbers = (Math.min(out.positions.length, out.uvs.length) + Math.max(this.triangleVertices, 3)) << 1;
        const indices = (out.indices.length + Math.max(this.triangleIndices, 3)) << 1;
        const positions = new Float32Array(numbers);
        const uvs = new Float32Array(numbers);
        const wider = out.indices instanceof Uint32Array ? new Uint32Array(indices) : new Uint16Array(indices);

        positions.set(out.positions.subarray(0, out.vertexCount << 1));
        uvs.set(out.uvs.subarray(0, out.vertexCount << 1));
        wider.set(out.indices.subarray(0, out.indexCount));
        out.positions = positions;
        out.uvs = uvs;
        out.indices = wider;
    }
}
