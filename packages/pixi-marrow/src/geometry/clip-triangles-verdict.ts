import type { ClipParts } from './clip-triangles-parts';

/*
 * A verdict about the triangles of a slot without clipping them: whether the clip kernel would
 * write nothing, would write the triangles as they are, or has to run. The verdict is made from
 * the box around the vertices and costs one pass over the indices and one over the edges.
 *
 * It never says more than the kernel does. The reasons:
 *
 * - The kernel calls a vertex inside of an edge when a rounded expression is above 0. Every step
 *   of that expression grows or shrinks with x alone and with y alone, and rounding keeps that.
 *   So the value of a vertex lies between the values at the corners of a box around it. A box
 *   whose corners are all inside of an edge holds only vertices the kernel calls inside, and a
 *   box whose corners are all outside holds only vertices it calls outside.
 * - Where every vertex is inside of every edge so far, the kernel has cut nothing: each triangle
 *   is still its three vertices. If every edge of a part goes that way, the part keeps the
 *   triangle as it is. If the next edge has every vertex outside, the part keeps nothing.
 * - 4.2 and 4.3 place a cut between two vertices, so a cut cannot leave the box by more than
 *   rounding. After an edge that may have cut, the box gets a pad for that, far above what
 *   rounding adds over any number of edges. A part then keeps nothing when the box with the pad
 *   is outside of one of its edges, whatever the edges before it cut. 4.1 places a cut on the
 *   clip edge and can put it far off when two lines are nearly parallel. For 4.1 the verdict
 *   says nothing about a part once an edge may cut.
 * - The reasoning needs numbers. A position that is none, and a polygon with a number that is
 *   none or beyond 1e150, give the verdict that the kernel has to run.
 */

/** A verdict: the kernel would write nothing for the triangles. Nothing is drawn. */
export const VERDICT_NOTHING = 0;
/** A verdict: the kernel would write the triangles as they are. The slot can be drawn as it is. */
export const VERDICT_WHOLE = 1;
/** A verdict: anything else. The caller runs the kernel. */
export const VERDICT_CUT = 2;

/** What a part does with the box: it keeps every triangle as it is. */
const INSIDE = -1;
/** What a part does with the box: not known without clipping. */
const UNSURE = -2;

/** How far a cut of 4.2 and 4.3 may be thought to leave the box, as a share of its largest coordinate. */
const PAD = 1e-6;
/** The largest polygon coordinate the reasoning is made for: products of two such numbers stay finite. */
const LIMIT = 1e150;

/** The box around the vertices of a slot: the smallest x and y, the largest x and y, then the pad. */
const box = new Float64Array(5);
/** The smallest and the largest value of the side test of one edge in the box. */
const span = new Float64Array(2);

/**
 * Whether every coordinate of the parts is a number that the verdict can reason about.
 *
 * @example
 * const usable = partsAreTame(clipper.parts);
 */
export function partsAreTame(parts: ClipParts): boolean {
    const { vertices } = parts;

    for (let i = 0, end = Number(parts.starts[parts.count]); i < end; i++) {
        if (!(Math.abs(Number(vertices[i])) <= LIMIT)) return false;
    }

    return true;
}

/**
 * Puts the box around the vertices of the triangles into the scratch, and its pad. Returns false
 * when a position is not a finite number.
 */
function measure(
    positions: Float32Array,
    positionAt: number,
    positionStride: number,
    indices: Uint16Array,
    indexStart: number,
    indexCount: number,
): boolean {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    // stays 0 as long as every position is a finite number
    let odd = 0;

    for (let i = indexStart, end = indexStart + indexCount; i < end; i++) {
        const p = positionAt + Number(indices[i]) * positionStride;
        const x = Number(positions[p]);
        const y = Number(positions[p + 1]);

        minX = x < minX ? x : minX;
        maxX = x > maxX ? x : maxX;
        minY = y < minY ? y : minY;
        maxY = y > maxY ? y : maxY;
        odd += x - x + (y - y);
    }
    box[0] = minX;
    box[1] = minY;
    box[2] = maxX;
    box[3] = maxY;
    box[4] = PAD * Math.max(-minX, maxX, -minY, maxY);

    return odd === 0;
}

/**
 * Writes the smallest and the largest value that the side test of an edge has in the box to
 * {@link span}: the test of the version, at the corners of the box.
 *
 * @param padded Whether the box is the one with the pad.
 */
function spanOf(vertices: Float64Array, edge: number, legacy: boolean, padded: boolean): void {
    const pad = padded ? Number(box[4]) : 0;
    const minX = Number(box[0]) - pad;
    const minY = Number(box[1]) - pad;
    const maxX = Number(box[2]) + pad;
    const maxY = Number(box[3]) + pad;
    const edgeX = Number(vertices[edge]);
    const edgeY = Number(vertices[edge + 1]);
    const edgeX2 = Number(vertices[edge + 2]);
    const edgeY2 = Number(vertices[edge + 3]);
    // the two products of the side test, each at both ends of the box
    const a0 = legacy ? (edgeX - edgeX2) * (minY - edgeY2) : (edgeY - edgeY2) * (edgeX - minX);
    const a1 = legacy ? (edgeX - edgeX2) * (maxY - edgeY2) : (edgeY - edgeY2) * (edgeX - maxX);
    const b0 = legacy ? (edgeY - edgeY2) * (minX - edgeX2) : (edgeX - edgeX2) * (edgeY - minY);
    const b1 = legacy ? (edgeY - edgeY2) * (maxX - edgeX2) : (edgeX - edgeX2) * (edgeY - maxY);

    span[0] = Math.min(a0, a1) - Math.max(b0, b1);
    span[1] = Math.max(a0, a1) - Math.min(b0, b1);
}

/**
 * Whether a part keeps nothing because every vertex is outside of an edge. The box is outside of
 * the edge already. After an edge that may have cut, the box with the pad must be outside too.
 */
function keepsNothing(vertices: Float64Array, edge: number, cut: boolean): boolean {
    if (!cut) return true;
    spanOf(vertices, edge, false, true);

    return !(Number(span[1]) > 0);
}

/**
 * What one part does with every triangle in the box of the scratch. The part is the closed
 * polygon whose first edge starts at `first` and whose last edge starts at `last`.
 *
 * Returns {@link INSIDE} when the box is inside of every edge. Returns the number of an edge, from
 * 0, when the part keeps nothing because the box is outside of that edge. Returns {@link UNSURE}
 * otherwise.
 *
 * @param legacy Whether the edges test as 4.1 does.
 * @param inOrder Whether an edge that may cut ends the reasoning. Without it a later edge can
 * still have the whole box outside.
 */
function judgePart(vertices: Float64Array, first: number, last: number, legacy: boolean, inOrder: boolean): number {
    let cut = false;

    for (let edge = first; edge <= last; edge += 2) {
        spanOf(vertices, edge, legacy, false);
        // the smallest value of the test in the box is above 0: every vertex is inside
        if (Number(span[0]) > 0) continue;
        // the largest value is not: every vertex is outside
        if (!(Number(span[1]) > 0) && keepsNothing(vertices, edge, cut)) return (edge - first) >> 1;
        if (inOrder) return UNSURE;
        cut = true;
    }

    return cut ? UNSURE : INSIDE;
}

/**
 * The verdict about the triangles of a slot for the parts of a clip polygon. See
 * `TriangleClipper.verdict`, which calls it with parts whose numbers are tame.
 *
 * @example
 * const verdict = judgeTriangles(clipper.parts, false, positions, 0, 2, triangles, 0, triangles.length);
 *
 * @param legacy Whether the edges test as 4.1 does.
 */
export function judgeTriangles(
    parts: ClipParts,
    legacy: boolean,
    positions: Float32Array,
    positionAt: number,
    positionStride: number,
    indices: Uint16Array,
    indexStart: number,
    indexCount: number,
): 0 | 1 | 2 {
    if (indexCount === 0) return VERDICT_NOTHING;
    if (indexCount % 3 !== 0) return VERDICT_CUT;
    if (!measure(positions, positionAt, positionStride, indices, indexStart, indexCount)) return VERDICT_CUT;
    const { vertices, starts, count } = parts;

    if (parts.inverse) {
        const edge = judgePart(vertices, 0, Number(starts[1]) - 4, false, true);

        // inside of the polygon nothing is kept
        if (edge === INSIDE) return VERDICT_NOTHING;
        // The triangle is kept whole, with its corners turned once per edge it has passed. After
        // three edges they are where they were
        return edge >= 0 && edge % 3 === 2 ? VERDICT_WHOLE : VERDICT_CUT;
    }
    for (let part = 0; part < count; part++) {
        const edge = judgePart(vertices, Number(starts[part]), Number(starts[part + 1]) - 4, legacy, legacy);

        if (edge === INSIDE) return VERDICT_WHOLE;
        if (edge === UNSURE) return VERDICT_CUT;
    }

    return VERDICT_NOTHING;
}
