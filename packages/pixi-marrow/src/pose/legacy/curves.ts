/** The curve type of a key that interpolates in a straight line. */
const LINEAR = 0;
/** The curve type of a key that holds its value. */
const STEPPED = 1;
/** Curve types from this number on are Bezier: the type minus this number is the index of the samples. */
const BEZIER = 2;
/** Floats one Bezier curve takes in a `curves` array. */
const BEZIER_SIZE = 18;

/*
 * Reading numbers in this engine: `Number(array[index])`.
 *
 * `Number` turns the `undefined` of a read outside the array into NaN. The official runtime
 * computes with `undefined` there, and arithmetic and comparisons treat it as NaN, so both give
 * the same results. The read is written out instead of put into a helper function: once the hot
 * functions of the engine are compiled together, a call that returns a number costs an allocation.
 */

/**
 * The index of the last key at or before `time`, as the official `Timeline.search` finds it.
 * `step` is the number of floats per key.
 */
export function search(frames: Float32Array, time: number, step: number): number {
    const n = frames.length;

    for (let i = step; i < n; i += step) {
        if (Number(frames[i]) > time) return i - step;
    }

    return n - step;
}

/**
 * The official `CurveTimeline.getBezierValue`, written to `out` at `valueOffset - 1`.
 *
 * `frameIndex` is the index of the key in `frames`. `valueOffset` is the offset of the value
 * inside the key. `entries` is the number of floats per key. The index of the Bezier samples
 * is worked out here, from the curve type of the key: as an argument it would be a float.
 */
function bezierValue(
    frames: Float32Array,
    curves: Float32Array,
    time: number,
    frameIndex: number,
    valueOffset: number,
    entries: number,
    out: Float64Array,
): void {
    const i = Number(curves[frameIndex / entries]) + BEZIER_SIZE * (valueOffset - 1) - BEZIER;
    // the straight piece of the curve that holds `time` runs from x, y to endX, endY
    let x = Number(frames[frameIndex]);
    let y = Number(frames[frameIndex + valueOffset]);
    let endX = Number(curves[i]);
    let endY = Number(curves[i + 1]);

    if (!(endX > time)) {
        const n = i + BEZIER_SIZE;
        let ii = i + 2;

        while (ii < n && !(Number(curves[ii]) >= time)) ii += 2;
        const last = ii < n ? ii : n;

        x = Number(curves[last - 2]);
        y = Number(curves[last - 1]);
        // after the last sample the piece ends at the next key
        endX = ii < n ? Number(curves[ii]) : Number(frames[frameIndex + entries]);
        endY = ii < n ? Number(curves[ii + 1]) : Number(frames[frameIndex + entries + valueOffset]);
    }
    out[valueOffset - 1] = y + ((time - x) / (endX - x)) * (endY - y);
}

/**
 * The values of a timeline at `time`, written to `out`. `entries` is the number of floats per
 * key: the time plus the values.
 *
 * For a timeline with one value this is the official `CurveTimeline1.getCurveValue`. Results
 * go to an array because a number returned from a call can cost an allocation.
 */
export function curveValues(
    frames: Float32Array,
    curves: Float32Array,
    time: number,
    entries: number,
    out: Float64Array,
): void {
    const i = search(frames, time, entries);
    const curveType = Number(curves[i / entries]);

    if (curveType === LINEAR) {
        const before = Number(frames[i]);
        const t = (time - before) / (Number(frames[i + entries]) - before);

        for (let v = 1; v < entries; v++) {
            const value = Number(frames[i + v]);

            out[v - 1] = value + (Number(frames[i + entries + v]) - value) * t;
        }
    } else if (curveType === STEPPED) {
        for (let v = 1; v < entries; v++) out[v - 1] = Number(frames[i + v]);
    } else {
        for (let v = 1; v < entries; v++) bezierValue(frames, curves, time, i, v, entries, out);
    }
}

/**
 * The official `DeformTimeline.getCurvePercent`, written to `out[0]`: how far `time` is between
 * the key at `frame` and the next key, from 0 to 1.
 */
export function curvePercent(
    frames: Float32Array,
    curves: Float32Array,
    time: number,
    frame: number,
    out: Float64Array,
): void {
    const curveType = Number(curves[frame]);
    const i = curveType - BEZIER;
    const start = Number(frames[frame]);

    if (curveType === LINEAR) {
        out[0] = (time - start) / (Number(frames[frame + 1]) - start);
    } else if (curveType === STEPPED) {
        out[0] = 0;
    } else if (Number(curves[i]) > time) {
        out[0] = (Number(curves[i + 1]) * (time - start)) / (Number(curves[i]) - start);
    } else {
        const n = i + BEZIER_SIZE;
        let ii = i + 2;

        while (ii < n && !(Number(curves[ii]) >= time)) ii += 2;
        const last = ii < n ? ii : n;
        const x = Number(curves[last - 2]);
        const y = Number(curves[last - 1]);

        if (ii < n) out[0] = y + ((time - x) / (Number(curves[ii]) - x)) * (Number(curves[ii + 1]) - y);
        else out[0] = y + ((1 - y) * (time - x)) / (Number(frames[frame + 1]) - x);
    }
}
