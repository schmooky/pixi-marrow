/*
 * The cutting of one triangle against one convex part of a clip polygon: the official
 * `SkeletonClipping.clip` and, for the 4.3 `inverse`, `clipInverse`. Both walk the edges of the
 * part and cut the polygon that is left of the triangle at each edge. The arithmetic is the
 * official one, in the official order, in 64 bits.
 *
 * The official versions differ in how an edge cuts:
 *
 * - 4.1 tests a point with `deltaX * (y - edgeY2) - deltaY * (x - edgeX2) > 0`. It places a cut
 *   on the clip edge, and for lines that are nearly parallel it takes the start of the edge.
 * - 4.2 and 4.3 test with `ey * (edgeX - x) - ex * (edgeY - y) > 0` and place a cut on the edge
 *   of the triangle. A cut that rounding puts outside of that edge is dropped, and the point
 *   outside of the clip edge is kept. The two versions do the same arithmetic.
 *
 * No function here takes a float or returns one. The triangle and the polygons are in the arrays
 * of {@link cutScratch}, and the functions pass places in arrays and counts.
 */

/** The arrays the cutting functions share with the code that stores what they leave. */
export interface CutScratch {
    /** The triangle that is clipped: x1, y1, x2, y2, x3, y3, then u1, v1, u2, v2, u3, v3. */
    readonly triangle: Float64Array;
    /** x, y per vertex of the polygon the last {@link cutInside} left. */
    polygon: Float64Array;
    /** The second polygon array. An edge reads one and writes the other. */
    spare: Float64Array;
    /**
     * What the last {@link cutOutside} left: polygon after polygon. Each is a count of numbers
     * and then that many numbers, x and y per vertex.
     */
    fragments: Float64Array;
}

/** The scratch arrays of the cutting functions. They grow when a polygon needs room, and stay. */
export const cutScratch: CutScratch = {
    triangle: new Float64Array(12),
    polygon: new Float64Array(64),
    spare: new Float64Array(64),
    fragments: new Float64Array(64),
};

/**
 * How many numbers an edge can write for a polygon of `count` vertices. A vertex gives one vertex
 * at most, and one more where the polygon comes back to the other side of the edge. That happens
 * `count / 2` times at most. One more vertex closes the result. A convex polygon comes back once,
 * but rounding can bend one, so the room is for the worst case.
 */
const room = (count: number): number => (count + (count >> 1) + 1) << 1;

/**
 * One edge of 4.1: cuts the closed polygon of `count` vertices in `input` and writes what is
 * inside of the edge to `output`. Returns the numbers written, plus 1 when the edge cut something.
 */
function edge41(parts: Float64Array, edge: number, input: Float64Array, count: number, output: Float64Array): number {
    const edgeX = Number(parts[edge]);
    const edgeY = Number(parts[edge + 1]);
    const edgeX2 = Number(parts[edge + 2]);
    const edgeY2 = Number(parts[edge + 3]);
    const deltaX = edgeX - edgeX2;
    const deltaY = edgeY - edgeY2;
    let inside = deltaX * (Number(input[1]) - edgeY2) - deltaY * (Number(input[0]) - edgeX2) > 0;
    let w = 0;
    let clipped = 0;

    for (let i = 0, end = count << 1; i < end; i += 2) {
        const inputX2 = Number(input[i + 2]);
        const inputY2 = Number(input[i + 3]);
        const inside2 = deltaX * (inputY2 - edgeY2) - deltaY * (inputX2 - edgeX2) > 0;

        if (inside !== inside2) {
            const inputX = Number(input[i]);
            const inputY = Number(input[i + 1]);
            const c0 = inputY2 - inputY;
            const c2 = inputX2 - inputX;
            const s = c0 * (edgeX2 - edgeX) - c2 * (edgeY2 - edgeY);

            if (Math.abs(s) > 0.000001) {
                const ua = (c2 * (edgeY - inputY) - c0 * (edgeX - inputX)) / s;

                output[w] = edgeX + (edgeX2 - edgeX) * ua;
                output[w + 1] = edgeY + (edgeY2 - edgeY) * ua;
            } else {
                output[w] = edgeX;
                output[w + 1] = edgeY;
            }
            w += 2;
        }
        if (inside2) {
            output[w] = inputX2;
            output[w + 1] = inputY2;
            w += 2;
        }
        if (!(inside && inside2)) clipped = 1;
        inside = inside2;
    }

    return w | clipped;
}

/**
 * One edge of 4.2 and 4.3: cuts the closed polygon of `count` vertices in `input` and writes what
 * is inside of the edge to `output`. Returns the numbers written, plus 1 when the edge cut something.
 */
function edge42(parts: Float64Array, edge: number, input: Float64Array, count: number, output: Float64Array): number {
    const edgeX = Number(parts[edge]);
    const edgeY = Number(parts[edge + 1]);
    const ex = edgeX - Number(parts[edge + 2]);
    const ey = edgeY - Number(parts[edge + 3]);
    let x1 = Number(input[0]);
    let y1 = Number(input[1]);
    let s1 = ey * (edgeX - x1) - ex * (edgeY - y1);
    let w = 0;
    let clipped = 0;

    for (let i = 2, end = count << 1; i <= end; i += 2) {
        const x2 = Number(input[i]);
        const y2 = Number(input[i + 1]);
        const s2 = ey * (edgeX - x2) - ex * (edgeY - y2);

        if (s1 > 0 !== s2 > 0) {
            const ix = x2 - x1;
            const iy = y2 - y1;
            const t = s1 / (ix * ey - iy * ex);

            if (t >= 0 && t <= 1) {
                output[w] = x1 + ix * t;
                output[w + 1] = y1 + iy * t;
                w += 2;
                clipped = 1;
            } else if (!(s2 > 0)) {
                // a cut that is not on the edge of the triangle: the point outside stays
                output[w] = x2;
                output[w + 1] = y2;
                w += 2;
            }
        } else if (!(s1 > 0)) clipped = 1;
        if (s2 > 0) {
            output[w] = x2;
            output[w + 1] = y2;
            w += 2;
        }
        x1 = x2;
        y1 = y2;
        s1 = s2;
    }

    return w | clipped;
}

/** Writes the triangle of the scratch to an array as a closed polygon. */
function loadTriangle(input: Float64Array): void {
    const { triangle } = cutScratch;

    for (let i = 0; i < 6; i++) input[i] = Number(triangle[i]);
    input[6] = Number(triangle[0]);
    input[7] = Number(triangle[1]);
}

/**
 * Cuts the triangle of the scratch to what is inside of one convex part, as the official `clip`
 * does. The part is the closed polygon in `parts` whose first edge starts at `first` and whose
 * last edge starts at `last`.
 *
 * Returns -1 when the triangle is inside of the part as it is. Otherwise it returns the vertex
 * count of what is left, which is then in `cutScratch.polygon`. 0 means nothing is left. Rounding
 * can leave two vertices in 4.2 and 4.3.
 *
 * @param legacy Whether the edges cut as 4.1 does.
 */
export function cutInside(parts: Float64Array, first: number, last: number, legacy: boolean): number {
    let input = cutScratch.spare;
    let output = cutScratch.polygon;
    let count = 3;
    let clipped = 0;

    loadTriangle(input);
    for (let edge = first; ; edge += 2) {
        if (output.length < room(count)) output = new Float64Array(room(count) << 1);
        const written = legacy ? edge41(parts, edge, input, count, output) : edge42(parts, edge, input, count, output);

        count = written >> 1;
        clipped |= written & 1;
        if (count === 0) break;
        output[count << 1] = Number(output[0]);
        output[(count << 1) + 1] = Number(output[1]);
        if (edge === last) break;
        const swap = input;

        input = output;
        output = swap;
    }
    cutScratch.polygon = output;
    cutScratch.spare = input;

    return clipped === 0 ? -1 : count;
}

/**
 * One edge of the 4.3 `clipInverse`. What is inside of the edge goes to `output`. What is outside
 * becomes a polygon in the fragments from `at` on, behind a count of its numbers. Returns the
 * numbers written to `output`.
 */
function edgeOutside(
    parts: Float64Array,
    edge: number,
    input: Float64Array,
    count: number,
    output: Float64Array,
    at: number,
): number {
    const { fragments } = cutScratch;
    const edgeX = Number(parts[edge]);
    const edgeY = Number(parts[edge + 1]);
    const ex = edgeX - Number(parts[edge + 2]);
    const ey = edgeY - Number(parts[edge + 3]);
    let x1 = Number(input[0]);
    let y1 = Number(input[1]);
    let s1 = ey * (edgeX - x1) - ex * (edgeY - y1);
    let w = 0;
    let f = at + 1;

    for (let i = 2, end = count << 1; i <= end; i += 2) {
        const x2 = Number(input[i]);
        const y2 = Number(input[i + 1]);
        const s2 = ey * (edgeX - x2) - ex * (edgeY - y2);
        const ix = x2 - x1;
        const iy = y2 - y1;
        // -1 stands for no crossing
        const t = s1 > 0 !== s2 > 0 ? s1 / (ix * ey - iy * ex) : -1;
        const cut = t >= 0 && t <= 1;

        if (cut) {
            const cx = x1 + ix * t;
            const cy = y1 + iy * t;

            // a cut belongs to both sides
            output[w] = cx;
            output[w + 1] = cy;
            fragments[f] = cx;
            fragments[f + 1] = cy;
            w += 2;
            f += 2;
        }
        // a point outside of the edge whose cut was dropped stays inside, as in `clip`
        if (s2 > 0 || (s1 > 0 && !cut)) {
            output[w] = x2;
            output[w + 1] = y2;
            w += 2;
        } else {
            fragments[f] = x2;
            fragments[f + 1] = y2;
            f += 2;
        }
        x1 = x2;
        y1 = y2;
        s1 = s2;
    }
    fragments[at] = f - at - 1;

    return w;
}

/** Makes room for `numbers` more numbers in the fragments, of which `length` are in use. */
function reserveFragments(length: number, numbers: number): void {
    const { fragments } = cutScratch;

    if (fragments.length >= length + numbers) return;
    cutScratch.fragments = new Float64Array((length + numbers) << 1);
    cutScratch.fragments.set(fragments.subarray(0, length));
}

/**
 * Cuts the triangle of the scratch to what is outside of a convex polygon, as the official 4.3
 * `clipInverse` does: every edge splits off the polygon outside of it. The polygons are then in
 * `cutScratch.fragments`. Returns how many numbers of it are in use. One of fewer than three
 * vertices is dropped.
 *
 * The polygon is the closed one in `parts` whose first edge starts at `first` and whose last edge
 * starts at `last`.
 */
export function cutOutside(parts: Float64Array, first: number, last: number): number {
    let input = cutScratch.spare;
    let output = cutScratch.polygon;
    let count = 3;
    let length = 0;

    loadTriangle(input);
    for (let edge = first; ; edge += 2) {
        if (output.length < room(count)) output = new Float64Array(room(count) << 1);
        reserveFragments(length, room(count));
        const written = edgeOutside(parts, edge, input, count, output, length);
        const size = Number(cutScratch.fragments[length]);

        if (size >= 6) length += size + 1;
        if (written === 0) break;
        count = written >> 1;
        output[written] = Number(output[0]);
        output[written + 1] = Number(output[1]);
        if (edge === last) break;
        const swap = input;

        input = output;
        output = swap;
    }
    cutScratch.polygon = output;
    cutScratch.spare = input;

    return length;
}
