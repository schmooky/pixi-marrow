import { f64, i32 } from './read';

/*
 * Ear clipping, ported from the official `Triangulator.triangulate`. The official 4.1, 4.2 and
 * 4.3 cores give the same triangles: 4.3 only rewrote how the neighbors of a vertex are found.
 * The official `decompose`, which merges the triangles into convex polygons for the CPU clipper,
 * is not ported. A stencil mask draws the triangles as they are.
 */

/*
 * The official `Triangulator.positiveArea` says whether three points turn clockwise or lie on a
 * line: `p1x * (p3y - p2y) + p2x * (p1y - p3y) + p3x * (p2y - p1y) >= 0`. It is written out where
 * it is used, and no function here takes a float or returns one, except the reader, which is
 * small enough to be inlined always. A float that crosses a call that is not inlined is
 * allocated, and the JavaScript engine does not inline every call of loops this deep.
 */

/** The official `Triangulator.isConcave` for the vertex at a position of the vertices that are left. */
function isConcave(at: number, count: number, vertices: Float64Array, order: Int32Array): boolean {
    const previous = i32(order, at > 0 ? at - 1 : count - 1) << 1;
    const current = i32(order, at) << 1;
    const next = i32(order, at + 1 < count ? at + 1 : 0) << 1;
    const p1x = f64(vertices, previous);
    const p1y = f64(vertices, previous + 1);
    const p2x = f64(vertices, current);
    const p2y = f64(vertices, current + 1);
    const p3x = f64(vertices, next);
    const p3y = f64(vertices, next + 1);

    return !(p1x * (p3y - p2y) + p2x * (p1y - p3y) + p3x * (p2y - p1y) >= 0);
}

/** Whether the tip at a position can be cut off: it is convex and its triangle holds no concave vertex. */
function isEar(
    vertices: Float64Array,
    order: Int32Array,
    concave: Uint8Array,
    count: number,
    previous: number,
    at: number,
    next: number,
): boolean {
    if (concave[at] === 1) return false;
    const p1 = i32(order, previous) << 1;
    const p2 = i32(order, at) << 1;
    const p3 = i32(order, next) << 1;
    const p1x = f64(vertices, p1);
    const p1y = f64(vertices, p1 + 1);
    const p2x = f64(vertices, p2);
    const p2y = f64(vertices, p2 + 1);
    const p3x = f64(vertices, p3);
    const p3y = f64(vertices, p3 + 1);

    for (let other = next + 1 < count ? next + 1 : 0; other !== previous; ) {
        if (concave[other] === 1) {
            const v = i32(order, other) << 1;
            const vx = f64(vertices, v);
            const vy = f64(vertices, v + 1);

            // positiveArea of p3, p1, v, then of p1, p2, v, then of p2, p3, v
            if (
                p3x * (vy - p1y) + p1x * (p3y - vy) + vx * (p1y - p3y) >= 0 &&
                p1x * (vy - p2y) + p2x * (p1y - vy) + vx * (p2y - p1y) >= 0 &&
                p2x * (vy - p3y) + p3x * (p2y - vy) + vx * (p3y - p2y) >= 0
            ) {
                return false;
            }
        }
        if (++other === count) other = 0;
    }

    return true;
}

/**
 * The position of the tip to cut off next. Without an ear the official code takes the last
 * vertex that is not concave, or the first vertex. So a polygon that crosses itself ends too.
 */
function findEar(vertices: Float64Array, order: Int32Array, concave: Uint8Array, count: number): number {
    let previous = count - 1;
    let at = 0;
    let next = 1;

    while (!isEar(vertices, order, concave, count, previous, at, next)) {
        if (next === 0) {
            while (at > 0 && concave[at] === 1) at--;

            return at;
        }
        previous = at;
        at = next;
        if (++next === count) next = 0;
    }

    return at;
}

/**
 * Cuts a polygon into triangles by ear clipping, as the official `Triangulator.triangulate` does,
 * with the same triangles in the same order. The scratch arrays are kept between calls, so a call
 * allocates only for a polygon with more vertices than every polygon before it.
 *
 * The polygon must be clockwise, as the official `SkeletonClipping.makeClockwise` leaves it. It
 * may be concave. A polygon that crosses itself gives the triangles the official code gives.
 *
 * @example
 * const triangulator = new Triangulator();
 * // an L shape, clockwise with y up
 * const polygon = Float64Array.of(0, 0, 0, 2, 1, 2, 1, 1, 2, 1, 2, 0);
 * const count = triangulator.triangulate(polygon, 6);
 * const indices = triangulator.triangles.subarray(0, count); // 12 numbers, three per triangle
 */
export class Triangulator {
    /**
     * Three vertex numbers per triangle. Only the first numbers are valid: as many as the last
     * call of {@link triangulate} returned. The array is replaced when a larger polygon needs room.
     */
    triangles: Int32Array = new Int32Array(0);
    /** The vertices that are not cut off yet, in polygon order. */
    private order: Int32Array = new Int32Array(0);
    /** 1 for each vertex of `order` where the polygon turns the other way. */
    private concave: Uint8Array = new Uint8Array(0);

    /**
     * Writes the triangles of a polygon to {@link triangles} and returns how many numbers it
     * wrote: three for each vertex past the second, and 0 for fewer than three vertices.
     *
     * @param vertices x, y per vertex, 64-bit as in the official clipper. Numbers past `vertexCount` vertices are not read.
     * @param vertexCount How many vertices the polygon has.
     */
    triangulate(vertices: Float64Array, vertexCount: number): number {
        if (vertexCount < 3) return 0;
        if (this.order.length < vertexCount) {
            this.order = new Int32Array(vertexCount);
            this.concave = new Uint8Array(vertexCount);
            this.triangles = new Int32Array((vertexCount - 2) * 3);
        }
        const { order, concave, triangles } = this;
        let count = vertexCount;
        let written = 0;

        for (let i = 0; i < count; i++) order[i] = i;
        for (let i = 0; i < count; i++) concave[i] = isConcave(i, count, vertices, order) ? 1 : 0;
        while (count > 3) {
            const at = findEar(vertices, order, concave, count);

            triangles[written] = i32(order, at > 0 ? at - 1 : count - 1);
            triangles[written + 1] = i32(order, at);
            triangles[written + 2] = i32(order, at + 1 < count ? at + 1 : 0);
            written += 3;
            order.copyWithin(at, at + 1, count);
            concave.copyWithin(at, at + 1, count);
            count--;
            const before = at > 0 ? at - 1 : count - 1;
            const after = at < count ? at : 0;

            concave[before] = isConcave(before, count, vertices, order) ? 1 : 0;
            concave[after] = isConcave(after, count, vertices, order) ? 1 : 0;
        }
        triangles[written] = i32(order, 2);
        triangles[written + 1] = i32(order, 0);
        triangles[written + 2] = i32(order, 1);

        return written + 3;
    }
}
