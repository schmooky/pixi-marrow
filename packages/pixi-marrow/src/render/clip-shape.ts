import { MarrowError } from '../base/errors';
import type { SpineVersion } from '../base/version';
import { f64 } from '../geometry/read';
import { Triangulator } from '../geometry/triangulator';
import { computeWorldVertices } from '../geometry/vertices';
import type { ClippingAttachmentData } from '../model/attachments';

/*
 * The area a clipping attachment keeps, as the official `SkeletonClipping.clipStart` works it out
 * for a pose. The official clipper cuts triangles against the result on the CPU. Here the result
 * becomes the triangles of a stencil mask, so the same area is kept.
 *
 * The official versions differ:
 *
 * - 4.1 and 4.2 make the polygon clockwise and cut it into triangles, always.
 * - 4.3 tests whether the polygon is convex while it makes it clockwise. A convex polygon is used
 *   as it is. A polygon that is not convex is replaced by its convex hull when the attachment is
 *   `inverse` or marked `convex`, and cut into triangles otherwise.
 * - 4.3 `inverse` keeps what is outside of the polygon.
 */

/** A mask draws with 16-bit indices. */
const MAX_VERTICES = 65535;

/**
 * Throws a {@link MarrowError} that names the attachment when its polygon cannot clip: fewer than
 * three vertices, or more than a mask can index. The official runtime does not throw for fewer
 * than three. It then draws nothing of the clipped slots, and with `inverse` all of them.
 *
 * @example
 * const attachment = state.attachments[slot];
 * if (attachment?.type === 'clipping') checkClip(attachment);
 */
export function checkClip(attachment: ClippingAttachmentData): void {
    const vertices = attachment.worldVerticesLength >> 1;

    if (vertices >= 3 && vertices <= MAX_VERTICES) return;
    throw new MarrowError(
        'invalid-data',
        `The clipping attachment "${attachment.name}" has ${vertices} vertices. A clip polygon has 3 to ${MAX_VERTICES}.`,
        { fix: 'Give the clipping attachment three vertices or more in the Spine editor and export again.' },
    );
}

/*
 * None of the functions below takes a float or returns one: they get the arrays and positions in
 * them. A float that crosses a call that is not inlined is allocated, and the JavaScript engine
 * does not inline every call of loops this deep. The reader is small enough to be inlined always.
 */

/** Turns the vertex order around, as the official `makeClockwise` does. `n` is twice the vertex count. */
function reverse(v: Float64Array, n: number): void {
    for (let i = 0, last = n - 2, half = n >> 1; i < half; i += 2) {
        const other = last - i;
        const x = f64(v, i);
        const y = f64(v, i + 1);

        v[i] = f64(v, other);
        v[i + 1] = f64(v, other + 1);
        v[other] = x;
        v[other + 1] = y;
    }
}

/** The official 4.1 and 4.2 `SkeletonClipping.makeClockwise`, with its order of additions. */
function makeClockwiseLegacy(v: Float64Array, n: number): void {
    let area = f64(v, n - 2) * f64(v, 1) - f64(v, 0) * f64(v, n - 1);

    for (let i = 0, end = n - 3; i < end; i += 2) {
        area += f64(v, i) * f64(v, i + 3) - f64(v, i + 2) * f64(v, i + 1);
    }
    if (area < 0) return;
    reverse(v, n);
}

/** The official 4.3 `SkeletonClipping.makeClockwise`. Returns whether every corner turns the same way. */
function makeClockwise43(v: Float64Array, n: number): boolean {
    let noCW = true;
    let noCCW = true;
    let area = 0;
    let prevX = f64(v, n - 2);
    let prevY = f64(v, n - 1);
    let currX = f64(v, 0);
    let currY = f64(v, 1);

    // one step past the end closes the polygon with its first vertex
    for (let i = 2; i <= n; i += 2) {
        const nextX = f64(v, i < n ? i : 0);
        const nextY = f64(v, i < n ? i + 1 : 1);
        const cross = (currX - prevX) * (nextY - currY) - (currY - prevY) * (nextX - currX);

        area += currX * nextY - nextX * currY;
        noCCW = noCCW && cross <= 0;
        noCW = noCW && cross >= 0;
        prevX = currX;
        prevY = currY;
        currX = nextX;
        currY = nextY;
    }
    if (area >= 0) {
        reverse(v, n);

        return noCW;
    }

    return noCCW;
}

/** Sorts the vertices of `v` into `sorted` by x, then by y: the insertion sort of the official `makeConvex`. */
function sortByX(v: Float64Array, n: number, sorted: Float64Array): void {
    sorted[0] = f64(v, 0);
    sorted[1] = f64(v, 1);
    for (let i = 2; i < n; i += 2) {
        const x = f64(v, i);
        const y = f64(v, i + 1);
        let p = i - 2;

        for (; p >= 0; p -= 2) {
            const px = f64(sorted, p);
            const py = f64(sorted, p + 1);

            if (!(px > x || (px === x && py > y))) break;
            sorted[p + 2] = px;
            sorted[p + 3] = py;
        }
        sorted[p + 2] = x;
        sorted[p + 3] = y;
    }
}

/**
 * Adds the point at `from` of `sorted` to a hull chain in `v` that ends at `end`, after it took
 * off the points that would turn the chain the wrong way. The chain keeps what is below `floor`.
 * Returns the new end.
 */
function extendHull(v: Float64Array, end: number, floor: number, sorted: Float64Array, from: number): number {
    const x = f64(sorted, from);
    const y = f64(sorted, from + 1);
    let s = end;

    for (;;) {
        const ax = f64(v, s - 4);
        const ay = f64(v, s - 3);

        if (!((f64(v, s - 2) - ax) * (y - ay) - (f64(v, s - 1) - ay) * (x - ax) >= 0)) break;
        s -= 2;
        if (s === floor) break;
    }
    v[s] = x;
    v[s + 1] = y;

    return s + 2;
}

/**
 * The official 4.3 `SkeletonClipping.makeConvex`: replaces a polygon by its convex hull, in
 * place. `v` needs room for `n * 2 + 4` numbers. Returns twice the vertex count of the hull.
 */
function makeConvex(v: Float64Array, n: number, sorted: Float64Array): number {
    sortByX(v, n, sorted);
    v[0] = f64(sorted, 0);
    v[1] = f64(sorted, 1);
    v[2] = f64(sorted, 2);
    v[3] = f64(sorted, 3);
    let s = 4;

    for (let i = 4; i < n; i += 2) s = extendHull(v, s, 2, sorted, i);
    v[s] = f64(sorted, n - 4);
    v[s + 1] = f64(sorted, n - 3);
    const top = s;

    s += 2;
    for (let i = n - 6; i >= 0; i -= 2) s = extendHull(v, s, top, sorted, i);

    // the last point is the first one again
    return s - 2;
}

/**
 * The polygon of a clipping attachment in a pose, shaped as the official clipper of the model's
 * version shapes it, and cut into the triangles of a mask. One object serves every clip: it keeps
 * its scratch arrays and allocates only for a polygon with more vertices than every one before.
 *
 * @example
 * const shape = new ClipShape();
 * const bone = model.slots.bones[slot] ?? 0;
 * const deform = state.deform[slot] ?? new Float64Array(0);
 * shape.compute(model.version, attachment, state.world, bone, deform, state.deformLengths[slot] ?? 0);
 * console.log(shape.vertexCount, shape.indexCount, shape.inverse);
 */
export class ClipShape {
    /** x, y per vertex in skeleton space, clockwise. Valid up to {@link vertexCount} vertices. */
    polygon: Float64Array = new Float64Array(0);
    /** Three vertex numbers per triangle. Valid up to {@link indexCount} numbers. */
    triangles: Int32Array = new Int32Array(0);
    /** Vertices of the polygon. A convex hull can have fewer than the attachment. */
    vertexCount = 0;
    /** Numbers of {@link triangles} that make up the shape. */
    indexCount = 0;
    /** Whether the clip keeps what is outside of the shape. Only a 4.3 attachment can ask for it. */
    inverse = false;
    private readonly triangulator: Triangulator = new Triangulator();
    /** The triangles of a fan around vertex 0. A convex polygon needs no ear clipping. */
    private fan: Int32Array = new Int32Array(0);
    private sorted: Float64Array = new Float64Array(0);

    /**
     * Places the polygon with the bones of a pose and shapes it. `world`, `deform` and
     * `deformLength` are those of `computeWorldVertices`, and `bone` is the bone of the slot.
     *
     * Throws the {@link MarrowError} of {@link checkClip} for a polygon that cannot clip.
     */
    compute(
        version: SpineVersion,
        attachment: ClippingAttachmentData,
        world: Float64Array,
        bone: number,
        deform: Float64Array,
        deformLength: number,
    ): void {
        const n = attachment.worldVerticesLength;

        checkClip(attachment);
        // a convex hull is built in place and needs room to grow before it shrinks
        if (this.polygon.length < n * 2 + 4) this.polygon = new Float64Array(n * 2 + 4);
        computeWorldVertices(attachment, world, bone, deform, deformLength, this.polygon);
        this.inverse = version === '4.3' && attachment.inverse;
        if (version !== '4.3') {
            makeClockwiseLegacy(this.polygon, n);
            this.cut(n);

            return;
        }
        const convex = makeClockwise43(this.polygon, n);

        if (convex) this.spread(n);
        else if (attachment.inverse || attachment.convex) this.spread(this.hull(n));
        else this.cut(n);
    }

    /** Cuts the polygon into triangles by ear clipping, as the official clipper does before it decomposes. */
    private cut(n: number): void {
        this.vertexCount = n >> 1;
        this.indexCount = this.triangulator.triangulate(this.polygon, this.vertexCount);
        this.triangles = this.triangulator.triangles;
    }

    /** Covers a convex polygon with a fan of triangles. The official clipper uses such a polygon whole. */
    private spread(n: number): void {
        const vertices = n >> 1;
        const count = Math.max(vertices - 2, 0) * 3;

        if (this.fan.length < count) {
            this.fan = new Int32Array(count);
            for (let i = 0, at = 0; at < count; i++, at += 3) {
                this.fan[at + 1] = i + 1;
                this.fan[at + 2] = i + 2;
            }
        }
        this.vertexCount = vertices;
        this.indexCount = count;
        this.triangles = this.fan;
    }

    /** Replaces the polygon by its convex hull. Returns twice the vertex count of the hull. */
    private hull(n: number): number {
        if (this.sorted.length < n) this.sorted = new Float64Array(n);

        return makeConvex(this.polygon, n, this.sorted);
    }
}
