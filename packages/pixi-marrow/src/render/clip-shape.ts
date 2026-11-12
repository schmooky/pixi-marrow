import type { SpineVersion } from '../base/version';
import { f32, f64 } from '../geometry/read';
import { Triangulator } from '../geometry/triangulator';
import { computeWorldVertices } from '../geometry/vertices';
import type { ClippingAttachmentData } from '../model/attachments';
import { checkClip } from './clip-check';

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
 *
 * Ear clipping is the costly step. Measured in Node 24 on an Apple M4 for the 39 vertices of the
 * coin: 2.4 microseconds per pose with ear clipping, 0.12 without.
 *
 * A polygon without weights and without a deform only moves with one bone. Every pose of it is
 * the same shape, moved, turned, scaled or sheared. Ear clipping asks on which side of a line a
 * point lies, and such a move does not change the answer. The triangles are therefore cut once
 * per attachment and vertex order, from the vertices of the attachment, and every pose of every
 * instance uses them. A bone that mirrors turns the vertex order around, which is the second
 * order. `ClipShape.reuse` turns this off, and the tests compare both ways.
 */

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

/** Whether a polygon is clockwise by the test of the official 4.1 and 4.2 `makeClockwise`, with its order of additions. */
function isClockwise(v: Float64Array, n: number): boolean {
    let area = f64(v, n - 2) * f64(v, 1) - f64(v, 0) * f64(v, n - 1);

    for (let i = 0, end = n - 3; i < end; i += 2) {
        area += f64(v, i) * f64(v, i + 3) - f64(v, i + 2) * f64(v, i + 1);
    }

    return area < 0;
}

/** The official 4.1 and 4.2 `SkeletonClipping.makeClockwise`. Returns whether it turned the vertex order around. */
function makeClockwiseLegacy(v: Float64Array, n: number): boolean {
    if (isClockwise(v, n)) return false;
    reverse(v, n);

    return true;
}

/** Set in what {@link makeClockwise43} returns when every corner turns the same way. */
const CONVEX = 1;
/** Set in what {@link makeClockwise43} returns when it turned the vertex order around. */
const REVERSED = 2;

/** The official 4.3 `SkeletonClipping.makeClockwise`. Returns {@link CONVEX} and {@link REVERSED}, each set or not. */
function makeClockwise43(v: Float64Array, n: number): number {
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

        return REVERSED | (noCW ? CONVEX : 0);
    }

    return noCCW ? CONVEX : 0;
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

/** The triangles of a polygon that is the same shape in every pose, for one vertex order. Never written again. */
interface FixedCut {
    /** Three vertex numbers per triangle. */
    readonly triangles: Int32Array;
    /** The same numbers with 16 bits each, and one more 0 when their count is odd. */
    readonly indices: Uint16Array;
}

/** The cuts of one clipping attachment: of its vertices in the order of the file, and in reverse order. */
interface FixedCuts {
    stored: FixedCut | undefined;
    reversed: FixedCut | undefined;
}

/** The cuts of every clipping attachment that was shown without weights and without a deform. All instances share them. */
const fixedCuts = new WeakMap<ClippingAttachmentData, FixedCuts>();

/** The 16-bit indices of a fan, by how many numbers it has. The fan of a count is the same for every polygon. */
const fans = new Map<number, Uint16Array>();

/** The indices of a fan of `count` numbers around vertex 0, in an array that all masks share. */
function fanIndices(count: number): Uint16Array {
    let indices = fans.get(count);

    if (indices === undefined) {
        // an even count keeps the bytes a multiple of 4, which WebGPU asks of an index buffer
        indices = new Uint16Array(count + (count & 1));
        for (let i = 0, at = 0; at < count; i++, at += 3) {
            indices[at + 1] = i + 1;
            indices[at + 2] = i + 2;
        }
        fans.set(count, indices);
    }

    return indices;
}

/**
 * The polygon of a clipping attachment in a pose, shaped as the official clipper of the model's
 * version shapes it, and cut into the triangles of a mask. One object serves every clip: it keeps
 * its scratch arrays and allocates only for a polygon with more vertices than every one before.
 *
 * A polygon without weights and without a deform is the same shape in every pose. Its triangles
 * are cut once per attachment and vertex order, and every later call hands them out again, see
 * {@link fixedIndices}. That first call allocates the two small arrays that hold them. The model
 * is immutable, so the vertices of an attachment stay what they were when its triangles were cut.
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
    /**
     * The numbers of {@link triangles} as 16-bit indices, in an array that is never written again,
     * or null. It holds {@link indexCount} numbers, and one more 0 when that count is odd. Every
     * mask that shows these triangles can draw from this one array and needs none of its own.
     *
     * It is set for a polygon without weights and without a deform, and for every polygon that
     * is covered by a fan. It is null for a polygon that ear clipping cuts anew in every pose.
     */
    fixedIndices: Uint16Array | null = null;
    /**
     * Whether triangles that hold for every pose are cut once and used again. Default true. With
     * false every call cuts the polygon of its pose, which covers the same area and takes longer,
     * and {@link fixedIndices} stays null. Tests compare the two.
     */
    reuse = true;
    private readonly triangulator: Triangulator = new Triangulator();
    /** The triangles of a fan around vertex 0. A convex polygon needs no ear clipping. */
    private fan: Int32Array = new Int32Array(0);
    /** Room for a second copy of a polygon: the sorted vertices of a hull, or the vertices of an attachment. */
    private scratch: Float64Array = new Float64Array(0);

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
        // without weights and without a deform one bone moves the whole polygon: its shape stays
        const rigid = this.reuse && attachment.bones === null && deformLength === 0;

        checkClip(attachment);
        // a convex hull is built in place and needs room to grow before it shrinks
        if (this.polygon.length < n * 2 + 4) this.polygon = new Float64Array(n * 2 + 4);
        computeWorldVertices(attachment, world, bone, deform, deformLength, this.polygon);
        this.inverse = version === '4.3' && attachment.inverse;
        if (version !== '4.3') {
            const reversed = makeClockwiseLegacy(this.polygon, n);

            if (rigid) this.recall(attachment, n, reversed);
            else this.cut(n);

            return;
        }
        const turned = makeClockwise43(this.polygon, n);

        if ((turned & CONVEX) !== 0) this.spread(n);
        else if (attachment.inverse || attachment.convex) this.spread(this.hull(n));
        else if (rigid) this.recall(attachment, n, (turned & REVERSED) !== 0);
        else this.cut(n);
    }

    /** Cuts the polygon into triangles by ear clipping, as the official clipper does before it decomposes. */
    private cut(n: number): void {
        this.vertexCount = n >> 1;
        this.indexCount = this.triangulator.triangulate(this.polygon, this.vertexCount);
        this.triangles = this.triangulator.triangles;
        this.fixedIndices = null;
    }

    /**
     * Hands out the triangles that were cut for an attachment and a vertex order, and cuts them on
     * the first call. `reversed` says whether the polygon of the pose had its vertex order turned.
     */
    private recall(attachment: ClippingAttachmentData, n: number, reversed: boolean): void {
        let cuts = fixedCuts.get(attachment);

        if (cuts === undefined) {
            cuts = { stored: undefined, reversed: undefined };
            fixedCuts.set(attachment, cuts);
        }
        let cut = reversed ? cuts.reversed : cuts.stored;

        if (cut === undefined) {
            cut = this.cutAttachment(attachment, n, reversed);
            if (reversed) cuts.reversed = cut;
            else cuts.stored = cut;
        }
        this.vertexCount = n >> 1;
        this.indexCount = cut.triangles.length;
        this.triangles = cut.triangles;
        this.fixedIndices = cut.indices;
    }

    /**
     * Cuts the vertices of an attachment into triangles, in the vertex order the polygon of a pose
     * has. No bone is applied. The vertices are the polygon of every pose before its bone moved,
     * turned, scaled or sheared it, and none of that changes which ears ear clipping finds.
     */
    private cutAttachment(attachment: ClippingAttachmentData, n: number, reversed: boolean): FixedCut {
        if (this.scratch.length < n) this.scratch = new Float64Array(n);
        const local = this.scratch;

        for (let i = 0; i < n; i++) local[i] = f32(attachment.vertices, i);
        if (reversed) reverse(local, n);
        // The pose is clockwise in this order. Where the vertices are not, the bone mirrors them:
        // mirrored here too, they are clockwise, as ear clipping needs them
        if (!isClockwise(local, n)) {
            for (let i = 1; i < n; i += 2) local[i] = -f64(local, i);
        }
        const count = this.triangulator.triangulate(local, n >> 1);
        const triangles = this.triangulator.triangles.slice(0, count);
        const indices = new Uint16Array(count + (count & 1));

        indices.set(triangles);

        return { triangles, indices };
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
        // a hull of a polygon without area can have two vertices. A mask draws no empty array
        this.fixedIndices = this.reuse && count > 0 ? fanIndices(count) : null;
    }

    /** Replaces the polygon by its convex hull. Returns twice the vertex count of the hull. */
    private hull(n: number): number {
        if (this.scratch.length < n) this.scratch = new Float64Array(n);

        return makeConvex(this.polygon, n, this.scratch);
    }
}
