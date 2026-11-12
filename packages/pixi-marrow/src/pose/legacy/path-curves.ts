import { atLeast, CURVE_LENGTH, num, PATH_LENGTH, PLACE, pathScratch } from './path-scratch';

/*
 * The curve arithmetic of the official `PathConstraint`: lengths of curves and of their segments,
 * and the point and the direction at a place on a curve. Each function is a piece of the official
 * `computeWorldPositions`, with the same formulas in the same order.
 */

/** The official `addBeforePosition`: a place before the start of the path, on the line through its first handle. */
export function addBeforePosition(temp: Float64Array, i: number, out: Float64Array, o: number): void {
    const p = Number(num[PLACE]);
    const x1 = Number(temp[i]);
    const y1 = Number(temp[i + 1]);
    const dx = Number(temp[i + 2]) - x1;
    const dy = Number(temp[i + 3]) - y1;
    const r = Math.atan2(dy, dx);

    out[o] = x1 + p * Math.cos(r);
    out[o + 1] = y1 + p * Math.sin(r);
    out[o + 2] = r;
}

/** The official `addAfterPosition`: a place after the end of the path, on the line through its last handle. */
export function addAfterPosition(temp: Float64Array, i: number, out: Float64Array, o: number): void {
    const p = Number(num[PLACE]);
    const x1 = Number(temp[i + 2]);
    const y1 = Number(temp[i + 3]);
    const dx = x1 - Number(temp[i]);
    const dy = y1 - Number(temp[i + 1]);
    const r = Math.atan2(dy, dx);

    out[o] = x1 + p * Math.cos(r);
    out[o + 1] = y1 + p * Math.sin(r);
    out[o + 2] = r;
}

/**
 * The official `addCurvePosition`: the point at `num[PLACE]` of the curve whose eight numbers
 * start at `i` in `temp`. The rotation is written when `tangents` is true or the place is the
 * start of the curve.
 */
export function addCurvePosition(temp: Float64Array, i: number, out: Float64Array, o: number, tangents: boolean): void {
    const p = Number(num[PLACE]);
    const x1 = Number(temp[i]);
    const y1 = Number(temp[i + 1]);
    const cx1 = Number(temp[i + 2]);
    const cy1 = Number(temp[i + 3]);
    const cx2 = Number(temp[i + 4]);
    const cy2 = Number(temp[i + 5]);

    if (p === 0 || Number.isNaN(p)) {
        out[o] = x1;
        out[o + 1] = y1;
        out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);

        return;
    }
    const tt = p * p;
    const ttt = tt * p;
    const u = 1 - p;
    const uu = u * u;
    const uuu = uu * u;
    const ut = u * p;
    const ut3 = ut * 3;
    const uut3 = u * ut3;
    const utt3 = ut3 * p;
    const x = x1 * uuu + cx1 * uut3 + cx2 * utt3 + Number(temp[i + 6]) * ttt;
    const y = y1 * uuu + cy1 * uut3 + cy2 * utt3 + Number(temp[i + 7]) * ttt;

    out[o] = x;
    out[o + 1] = y;
    if (!tangents) return;
    if (p < 0.001) out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
    else out[o + 2] = Math.atan2(y - (y1 * uu + cy1 * ut * 2 + cy2 * tt), x - (x1 * uu + cx1 * ut * 2 + cx2 * tt));
}

/**
 * Finds the curve that holds the place `num[PLACE]`, from `first` on, and turns the place into how
 * far it is along that curve. `lengths` holds the length up to the end of each curve. Returns the curve.
 */
export function findCurve(lengths: Float64Array, first: number): number {
    const p = Number(num[PLACE]);
    let curve = first;

    while (p > Number(lengths[curve])) curve++;
    const length = Number(lengths[curve]);

    if (curve === 0) {
        num[PLACE] = p / length;
    } else {
        const prev = Number(lengths[curve - 1]);

        num[PLACE] = (p - prev) / (length - prev);
    }

    return curve;
}

/**
 * Measures every curve of the path in `world`. Writes the length up to the end of each to
 * `curves` and the length of the path to `num[PATH_LENGTH]`.
 */
export function measureCurves(curveCount: number): void {
    const world = pathScratch.world;
    const curves = atLeast(pathScratch.curves, curveCount + 1);
    let pathLength = 0;
    let x1 = Number(world[0]);
    let y1 = Number(world[1]);

    pathScratch.curves = curves;
    for (let i = 0, w = 2; i < curveCount; i++, w += 6) {
        const cx1 = Number(world[w]);
        const cy1 = Number(world[w + 1]);
        const cx2 = Number(world[w + 2]);
        const cy2 = Number(world[w + 3]);
        const x2 = Number(world[w + 4]);
        const y2 = Number(world[w + 5]);
        const tmpx = (x1 - cx1 * 2 + cx2) * 0.1875;
        const tmpy = (y1 - cy1 * 2 + cy2) * 0.1875;
        const dddfx = ((cx1 - cx2) * 3 - x1 + x2) * 0.09375;
        const dddfy = ((cy1 - cy2) * 3 - y1 + y2) * 0.09375;
        let ddfx = tmpx * 2 + dddfx;
        let ddfy = tmpy * 2 + dddfy;
        let dfx = (cx1 - x1) * 0.75 + tmpx + dddfx * 0.16666667;
        let dfy = (cy1 - y1) * 0.75 + tmpy + dddfy * 0.16666667;

        pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
        dfx += ddfx;
        dfy += ddfy;
        ddfx += dddfx;
        ddfy += dddfy;
        pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
        dfx += ddfx;
        dfy += ddfy;
        pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
        dfx += ddfx + dddfx;
        dfy += ddfy + dddfy;
        pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
        curves[i] = pathLength;
        x1 = x2;
        y1 = y2;
    }
    // a read past the last curve computes with NaN, as in the official array
    curves[curveCount] = Number.NaN;
    num[PATH_LENGTH] = pathLength;
}

/**
 * Measures the ten segments of the curve whose numbers start at `ii` in `world`. Writes
 * `segments` and the length of the curve to `num[CURVE_LENGTH]`.
 */
export function measureSegments(world: Float64Array, ii: number): void {
    const segments = pathScratch.segments;
    const x1 = Number(world[ii]);
    const y1 = Number(world[ii + 1]);
    const cx1 = Number(world[ii + 2]);
    const cy1 = Number(world[ii + 3]);
    const cx2 = Number(world[ii + 4]);
    const cy2 = Number(world[ii + 5]);
    const x2 = Number(world[ii + 6]);
    const y2 = Number(world[ii + 7]);
    const tmpx = (x1 - cx1 * 2 + cx2) * 0.03;
    const tmpy = (y1 - cy1 * 2 + cy2) * 0.03;
    const dddfx = ((cx1 - cx2) * 3 - x1 + x2) * 0.006;
    const dddfy = ((cy1 - cy2) * 3 - y1 + y2) * 0.006;
    let ddfx = tmpx * 2 + dddfx;
    let ddfy = tmpy * 2 + dddfy;
    let dfx = (cx1 - x1) * 0.3 + tmpx + dddfx * 0.16666667;
    let dfy = (cy1 - y1) * 0.3 + tmpy + dddfy * 0.16666667;
    let curveLength = Math.sqrt(dfx * dfx + dfy * dfy);

    segments[0] = curveLength;
    for (let s = 1; s < 8; s++) {
        dfx += ddfx;
        dfy += ddfy;
        ddfx += dddfx;
        ddfy += dddfy;
        curveLength += Math.sqrt(dfx * dfx + dfy * dfy);
        segments[s] = curveLength;
    }
    dfx += ddfx;
    dfy += ddfy;
    curveLength += Math.sqrt(dfx * dfx + dfy * dfy);
    segments[8] = curveLength;
    dfx += ddfx + dddfx;
    dfy += ddfy + dddfy;
    curveLength += Math.sqrt(dfx * dfx + dfy * dfy);
    segments[9] = curveLength;
    num[CURVE_LENGTH] = curveLength;
}
