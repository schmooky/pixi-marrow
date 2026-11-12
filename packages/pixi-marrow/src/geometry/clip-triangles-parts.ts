import { MarrowError } from '../base/errors';
import type { SpineVersion } from '../base/version';

/*
 * The convex parts a clip polygon is cut into before triangles are clipped against it, as the
 * official `SkeletonClipping.clipStart` leaves them in `clippingPolygons`. The official versions
 * differ:
 *
 * - 4.1 and 4.2 merge the triangles of the ear clipping with `Triangulator.decompose`, make every
 *   part clockwise again and close it. Their merge step has two slips. It keeps comparing with
 *   the vertex that was last before the first merge, so a polygon takes one more triangle at
 *   most. And after a merge it does not look at the first polygon again.
 * - 4.3 uses a polygon whole when it is convex, when the attachment is `inverse` and when it is
 *   marked `convex`. Other polygons go through a `decompose` without the two slips, with another
 *   formula for the winding, and the parts are closed as they are.
 *
 * The polygon comes shaped: clockwise, and replaced by its hull where 4.3 does that. The official
 * `makeClockwise` and `makeConvex` are not repeated here.
 */

/*
 * The polygons of `decompose` as vertex numbers. The official code keeps their coordinates in
 * arrays of their own. A polygon is a run of vertices from the first step and the vertices the
 * merge step added. Only the polygon that the merge step works on grows, so both are contiguous.
 */

/** The vertex numbers of every polygon of the first step, one polygon after the other. */
let run = new Int32Array(0);
/** Per polygon: where it starts in `run`. */
let first = new Int32Array(0);
/** Per polygon: how many vertices it has in `run`. */
let size = new Int32Array(0);
/** The vertex numbers the merge step added, polygon by polygon. */
let added = new Int32Array(0);
/** Per polygon: where its vertices start in `added`. */
let addedAt = new Int32Array(0);
/** Per polygon: how many vertices it has in `added`. */
let addedCount = new Int32Array(0);
/** Per polygon: 1 when the merge step moved it into another polygon. */
let gone = new Uint8Array(0);

/** Makes room for the polygons of that many triangles. */
function reserve(triangles: number): void {
    if (first.length >= triangles) return;
    run = new Int32Array(triangles * 3);
    first = new Int32Array(triangles);
    size = new Int32Array(triangles);
    added = new Int32Array(triangles);
    addedAt = new Int32Array(triangles);
    addedCount = new Int32Array(triangles);
    gone = new Uint8Array(triangles);
}

/**
 * The official `Triangulator.winding` of three vertices: 1 or -1. 4.3 has another formula than
 * 4.1 and 4.2, and the two can disagree for points that are nearly on a line.
 */
function winding(v: Float64Array, a: number, b: number, c: number, modern: boolean): number {
    const p1x = Number(v[a << 1]);
    const p1y = Number(v[(a << 1) + 1]);
    const p2x = Number(v[b << 1]);
    const p2y = Number(v[(b << 1) + 1]);
    const p3x = Number(v[c << 1]);
    const p3y = Number(v[(c << 1) + 1]);

    if (modern) return p1x * (p3y - p2y) + p2x * (p1y - p3y) + p3x * (p2y - p1y) >= 0 ? 1 : -1;
    const px = p2x - p1x;
    const py = p2y - p1y;

    return p3x * py - p3y * px + px * p1y - p1x * py >= 0 ? 1 : -1;
}

/**
 * The first step of `decompose`: triangles that follow each other around one vertex become one
 * polygon while it stays convex. Returns how many polygons there are.
 */
function joinFans(v: Float64Array, triangles: Int32Array, indexCount: number, modern: boolean): number {
    let polygons = 0;
    let length = 0;
    let base = -1;
    let turn = 0;

    for (let t = 0; t < indexCount; t += 3) {
        const a = Number(triangles[t]);
        const b = Number(triangles[t + 1]);
        const c = Number(triangles[t + 2]);

        if (base === a) {
            const start = Number(first[polygons - 1]);

            if (
                winding(v, Number(run[length - 2]), Number(run[length - 1]), c, modern) === turn &&
                winding(v, c, Number(run[start]), Number(run[start + 1]), modern) === turn
            ) {
                run[length++] = c;
                size[polygons - 1] = length - start;
                continue;
            }
        }
        first[polygons] = length;
        size[polygons] = 3;
        polygons++;
        run[length] = a;
        run[length + 1] = b;
        run[length + 2] = c;
        length += 3;
        turn = winding(v, a, b, c, modern);
        base = a;
    }

    return polygons;
}

/**
 * The second step of `decompose` for one polygon: it takes the tip of every triangle that sits on
 * its closing edge and keeps it convex. `addedLength` is how full `added` is. Returns the new fill.
 */
function absorb(v: Float64Array, polygon: number, polygons: number, addedLength: number, modern: boolean): number {
    const start = Number(first[polygon]);
    const end = start + Number(size[polygon]);
    const firstIndex = Number(run[start]);
    const second = Number(run[start + 1]);
    let lastIndex = Number(run[end - 1]);
    let prevPrev = Number(run[end - 2]);
    let prev = lastIndex;
    const turn = winding(v, prevPrev, prev, firstIndex, modern);
    let length = addedLength;

    for (let other = 0; other < polygons; other++) {
        if (other === polygon || gone[other] === 1 || Number(size[other]) + Number(addedCount[other]) !== 3) continue;
        const at = Number(first[other]);
        const tip = Number(run[at + 2]);

        if (Number(run[at]) !== firstIndex || Number(run[at + 1]) !== lastIndex) continue;
        if (winding(v, prevPrev, prev, tip, modern) !== turn) continue;
        if (winding(v, tip, firstIndex, second, modern) !== turn) continue;
        gone[other] = 1;
        added[length++] = tip;
        addedCount[polygon] = length - addedLength;
        prevPrev = prev;
        prev = tip;
        // 4.1 and 4.2 keep the old last vertex and start again behind the first polygon
        if (modern) lastIndex = tip;
        other = modern ? -1 : 0;
    }

    return length;
}

/** The second step of `decompose` for every polygon, in order. */
function mergeTriangles(v: Float64Array, polygons: number, modern: boolean): void {
    let addedLength = 0;

    addedCount.fill(0, 0, polygons);
    gone.fill(0, 0, polygons);
    for (let polygon = 0; polygon < polygons; polygon++) {
        addedAt[polygon] = addedLength;
        if (gone[polygon] === 0) addedLength = absorb(v, polygon, polygons, addedLength, modern);
    }
}

/**
 * The official 4.1 and 4.2 `SkeletonClipping.makeClockwise` on the `n` numbers of a part from
 * `at` on. A part without area is turned around too. `order` holds the vertex number of every
 * vertex of `v` and is turned with it.
 */
function makeClockwise(v: Float64Array, order: Int32Array, at: number, n: number): void {
    let area = Number(v[at + n - 2]) * Number(v[at + 1]) - Number(v[at]) * Number(v[at + n - 1]);

    for (let i = at, end = at + n - 3; i < end; i += 2) {
        area += Number(v[i]) * Number(v[i + 3]) - Number(v[i + 2]) * Number(v[i + 1]);
    }
    if (area < 0) return;
    for (let i = at, other = at + n - 2, half = at + (n >> 1); i < half; i += 2, other -= 2) {
        const x = Number(v[i]);
        const y = Number(v[i + 1]);
        const vertex = Number(order[i >> 1]);

        v[i] = Number(v[other]);
        v[i + 1] = Number(v[other + 1]);
        order[i >> 1] = Number(order[other >> 1]);
        v[other] = x;
        v[other + 1] = y;
        order[other >> 1] = vertex;
    }
}

/**
 * Whether every corner of a clockwise polygon turns clockwise or not at all. This is the answer
 * of the official 4.3 `makeClockwise`. That function tests the polygon before it turns it around,
 * and a polygon that is turned around gives the same numbers with the other sign.
 */
function turnsOneWay(v: Float64Array, vertexCount: number): boolean {
    const n = vertexCount << 1;
    let prevX = Number(v[n - 2]);
    let prevY = Number(v[n - 1]);
    let currX = Number(v[0]);
    let currY = Number(v[1]);

    // one step past the end closes the polygon with its first vertex
    for (let i = 2; i <= n; i += 2) {
        const nextX = Number(v[i < n ? i : 0]);
        const nextY = Number(v[i < n ? i + 1 : 1]);

        if (!((currX - prevX) * (nextY - currY) - (currY - prevY) * (nextX - currX) <= 0)) return false;
        prevX = currX;
        prevY = currY;
        currX = nextX;
        currY = nextY;
    }

    return true;
}

/**
 * The convex parts of a clip polygon, as the official clipper of a version cuts it. One object
 * serves every clip: it keeps its arrays and allocates only for a polygon larger than every one
 * before it.
 *
 * @example
 * const parts = new ClipParts();
 * // an L shape, clockwise with y up, and its triangles from the ear clipping
 * const polygon = Float64Array.of(0, 0, 0, 2, 1, 2, 1, 1, 2, 1, 2, 0);
 * const triangulator = new Triangulator();
 * const indexCount = triangulator.triangulate(polygon, 6);
 * parts.set('4.2', polygon, 6, triangulator.triangles, indexCount, false, false);
 * console.log(parts.count, parts.vertices.subarray(0, parts.starts[parts.count]));
 */
export class ClipParts {
    /**
     * x, y per vertex of every part, one part after the other. A part repeats its first vertex at
     * its end. Valid up to the last number of {@link starts}.
     */
    vertices: Float64Array = new Float64Array(0);
    /** Per part, and one more: where the part starts in {@link vertices}. */
    starts: Int32Array = new Int32Array(1);
    /** How many parts the polygon has. */
    count = 0;
    /** The edges of all parts together. */
    edges = 0;
    /** Whether the clip keeps what is outside of the polygon. Only a 4.3 attachment can ask for it. */
    inverse = false;
    /** Per vertex of {@link vertices}: the vertex of the polygon it is. Not kept for a polygon that is used whole. */
    private order: Int32Array = new Int32Array(0);
    /** The version of the last polygon that was cut, or null before the first. */
    private version: SpineVersion | null = null;
    /** The vertex count, the index count and the `convex` flag of the last polygon that was cut. */
    private vertexCount = 0;
    private indexCount = 0;
    private hull = false;
    /** Whether the last polygon that was cut is used whole. */
    private whole = false;

    /**
     * Cuts a polygon into the parts of the official clipper of a version.
     *
     * The polygon is the one `clipStart` has shaped: clockwise, and the convex hull for a 4.3
     * attachment that is `inverse` or `convex` and not convex by itself. `triangles` are those of
     * the ear clipping of that polygon. A polygon that 4.3 uses whole does not read them.
     *
     * A hull can have two vertices, and such a polygon clips as in the official runtime: nothing
     * is inside of it. Throws a `MarrowError` for a polygon without a vertex.
     *
     * With `moved` the caller says that the polygon is the one of the last call, moved: the same
     * triangles and the same shape at another place, not mirrored. The parts are then the same
     * vertices at their new places, and nothing is decided again. The official clipper decides
     * again in every pose. Its tests look at the positions and can decide otherwise where three
     * vertices are on a line. `moved` is not followed when the version, a count or a flag differs
     * from the last call.
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
     */
    set(
        version: SpineVersion,
        polygon: Float64Array,
        vertexCount: number,
        triangles: Int32Array,
        indexCount: number,
        inverse: boolean,
        convex: boolean,
        moved = false,
    ): void {
        if (vertexCount < 1) {
            throw new MarrowError('invalid-data', 'A clip polygon without a vertex cannot clip.', {
                fix: 'Give the clipping attachment three vertices or more in the Spine editor and export again.',
            });
        }
        const modern = version === '4.3';
        const flip = modern && inverse;
        const hull = modern && convex;

        if (moved && this.isLast(version, vertexCount, indexCount, flip, hull)) {
            this.place(polygon);

            return;
        }
        this.inverse = flip;
        this.whole = flip || hull || (modern && turnsOneWay(polygon, vertexCount));
        if (this.whole) this.setWhole(polygon, vertexCount);
        else this.decompose(polygon, triangles, indexCount, modern);
        this.version = version;
        this.vertexCount = vertexCount;
        this.indexCount = indexCount;
        this.hull = hull;
    }

    /** Whether a polygon has the version, the counts and the flags of the last one that was cut. */
    private isLast(
        version: SpineVersion,
        vertexCount: number,
        indexCount: number,
        flip: boolean,
        hull: boolean,
    ): boolean {
        if (this.version !== version || this.vertexCount !== vertexCount) return false;
        if (this.inverse !== flip || this.hull !== hull) return false;

        // a polygon that is used whole has no triangles to compare
        return this.whole || this.indexCount === indexCount;
    }

    /** Writes the parts again for the polygon at another place: every vertex of a part from its vertex of the polygon. */
    private place(polygon: Float64Array): void {
        if (this.whole) {
            this.setWhole(polygon, this.vertexCount);

            return;
        }
        const { vertices, order } = this;

        for (let i = 0, end = Number(this.starts[this.count]) >> 1; i < end; i++) {
            const vertex = Number(order[i]) << 1;

            vertices[i << 1] = Number(polygon[vertex]);
            vertices[(i << 1) + 1] = Number(polygon[vertex + 1]);
        }
    }

    /** Makes room for that many numbers and parts. What the arrays hold is lost. */
    private reserve(numbers: number, parts: number): void {
        if (this.vertices.length < numbers) this.vertices = new Float64Array(numbers);
        if (this.starts.length <= parts) this.starts = new Int32Array(parts + 1);
    }

    /** The polygon as one part, closed. */
    private setWhole(polygon: Float64Array, vertexCount: number): void {
        const n = vertexCount << 1;

        this.reserve(n + 2, 1);
        const { vertices, starts } = this;

        for (let i = 0; i < n; i++) vertices[i] = Number(polygon[i]);
        vertices[n] = Number(polygon[0]);
        vertices[n + 1] = Number(polygon[1]);
        starts[0] = 0;
        starts[1] = n + 2;
        this.count = 1;
        this.edges = vertexCount;
    }

    /** The official `Triangulator.decompose`, and what `clipStart` does with its polygons. */
    private decompose(polygon: Float64Array, triangles: Int32Array, indexCount: number, modern: boolean): void {
        const triangleCount = (indexCount / 3) | 0;

        reserve(triangleCount);
        const polygons = joinFans(polygon, triangles, triangleCount * 3, modern);
        let numbers = 0;
        let parts = 0;

        mergeTriangles(polygon, polygons, modern);
        for (let i = 0; i < polygons; i++) {
            if (gone[i] === 1) continue;
            numbers += (Number(size[i]) + Number(addedCount[i]) + 1) << 1;
            parts++;
        }
        this.reserve(numbers, parts);
        if (this.order.length < numbers >> 1) this.order = new Int32Array(numbers >> 1);
        this.count = parts;
        this.edges = (numbers >> 1) - parts;
        this.write(polygon, polygons, modern);
    }

    /** Writes the coordinates of every polygon that is left, each as a closed part. */
    private write(polygon: Float64Array, polygons: number, modern: boolean): void {
        const { vertices, starts, order } = this;
        let w = 0;
        let part = 0;

        for (let i = 0; i < polygons; i++) {
            if (gone[i] === 1) continue;
            const start = w;

            starts[part++] = start;
            w = copy(polygon, run, Number(first[i]), Number(size[i]), vertices, order, w);
            w = copy(polygon, added, Number(addedAt[i]), Number(addedCount[i]), vertices, order, w);
            if (!modern) makeClockwise(vertices, order, start, w - start);
            vertices[w] = Number(vertices[start]);
            vertices[w + 1] = Number(vertices[start + 1]);
            order[w >> 1] = Number(order[start >> 1]);
            w += 2;
        }
        starts[part] = w;
    }
}

/**
 * Copies the coordinates of `count` vertex numbers from `from` on to `out` at `w`, and the
 * numbers to `order`. Returns the next place.
 */
function copy(
    polygon: Float64Array,
    numbers: Int32Array,
    from: number,
    count: number,
    out: Float64Array,
    order: Int32Array,
    w: number,
): number {
    let at = w;

    for (let i = from, end = from + count; i < end; i++, at += 2) {
        const vertex = Number(numbers[i]);

        out[at] = Number(polygon[vertex << 1]);
        out[at + 1] = Number(polygon[(vertex << 1) + 1]);
        order[at >> 1] = vertex;
    }

    return at;
}
