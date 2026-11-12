/** The curve type of a key that interpolates in a straight line. */
export const CURVE_LINEAR = 0;
/** The curve type of a key that holds its value. */
export const CURVE_STEPPED = 1;
/** Curve types from this number on are Bezier: the type minus this number is the index of the samples. */
export const CURVE_BEZIER = 2;
/** Floats one Bezier curve takes in a `curves` array. */
export const CURVE_BEZIER_SIZE = 18;
const LINEAR = CURVE_LINEAR;
const STEPPED = CURVE_STEPPED;
const BEZIER = CURVE_BEZIER;
const BEZIER_SIZE = CURVE_BEZIER_SIZE;

/*
 * Reading numbers in this engine: `Number(array[index])`.
 *
 * `Number` turns the `undefined` of a read outside the array into NaN. The official runtime
 * computes with `undefined` there, and arithmetic and comparisons treat it as NaN, so both give
 * the same results. The read is written out instead of put into a helper function: a call that
 * returns a number with a fraction allocates unless V8 inlines it.
 *
 * For the same reason no function that an update runs takes or returns a time or an alpha. Those
 * numbers go through `SHARED`. An update must not allocate.
 */

/**
 * The numbers the functions of one update share. No call keeps them across a return, so every
 * engine uses this one array. It is longer than 64 bytes on purpose: V8 stores such an array
 * outside its heap, and compiled code reads it at a fixed address.
 */
export const SHARED: Float64Array = new Float64Array(16);
/** The official `time` of `Timeline.apply`. */
export const TIME = 0;
/** The official `lastTime` of `Timeline.apply`. Only event timelines read it. */
export const LAST_TIME = 1;
/** The official `alpha` of `Timeline.apply`. */
export const ALPHA = 2;
/** The official `getAnimationTime` of the entry that is applied. */
export const ANIMATION_TIME = 3;
/** The alpha of the held timelines of an entry that is mixed out. */
export const ALPHA_HOLD = 4;
/** The alpha of the timelines of an entry that fade out with its mix. */
export const ALPHA_MIX = 5;
/** The seconds the tracks advance by in this update, times the time scale of the player. */
export const DELTA = 6;
/** How far the mix of the entry that is applied is, from 0 to 1. */
export const MIX = 7;
/** The version the running update or command raises the pose to when it changes something: see stamps.ts. */
export const STAMP = 8;
/** 1 once the running update or command has set a stamp. */
export const STAMPED = 9;

/**
 * The index of the last key at or before the time in `SHARED`, as the official `Timeline.search`
 * finds it. `step` is the number of floats per key.
 */
export function search(frames: Float32Array, step: number): number {
    const time = Number(SHARED[TIME]);
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
    frameIndex: number,
    valueOffset: number,
    entries: number,
    out: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
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
 * The values of a timeline at the time in `SHARED`, written to `out`. `entries` is the number of floats per
 * key: the time plus the values.
 *
 * For a timeline with one value this is the official `CurveTimeline1.getCurveValue`. Results
 * go to an array because a number returned from a call can cost an allocation.
 */
export function curveValues(frames: Float32Array, curves: Float32Array, entries: number, out: Float64Array): void {
    const time = Number(SHARED[TIME]);
    const n = frames.length;
    // the official search, written out: this is the busiest loop of the timelines
    let i = n - entries;

    for (let ii = entries; ii < n; ii += entries) {
        if (Number(frames[ii]) > time) {
            i = ii - entries;
            break;
        }
    }
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
        for (let v = 1; v < entries; v++) bezierValue(frames, curves, i, v, entries, out);
    }
}

/**
 * {@link curveValues} for a timeline with one value per key, written to `out[0]`. Most timelines
 * of an animation are of this kind. The general function is fast only when V8 inlines it where
 * the number of values is known, which it stops doing when the caller grows. This one does not
 * depend on that: the number of values is written into it, and so is the Bezier case.
 */
export function curveValue(frames: Float32Array, curves: Float32Array, out: Float64Array): void {
    const time = Number(SHARED[TIME]);
    const n = frames.length;
    let i = n - 2;

    for (let ii = 2; ii < n; ii += 2) {
        if (Number(frames[ii]) > time) {
            i = ii - 2;
            break;
        }
    }
    const curveType = Number(curves[i >> 1]);
    let value = Number(frames[i + 1]);

    if (curveType === LINEAR) {
        const before = Number(frames[i]);

        value += (Number(frames[i + 3]) - value) * ((time - before) / (Number(frames[i + 2]) - before));
    } else if (curveType !== STEPPED) {
        // the straight piece of the curve that holds `time` runs from x, y to endX, endY
        const c = curveType - BEZIER;
        const end = c + BEZIER_SIZE;
        let x = Number(frames[i]);
        let endX = Number(curves[c]);
        let endY = Number(curves[c + 1]);

        if (!(endX > time)) {
            let at = c + 2;

            while (at < end && !(Number(curves[at]) >= time)) at += 2;
            x = Number(curves[(at < end ? at : end) - 2]);
            value = Number(curves[(at < end ? at : end) - 1]);
            // after the last sample the piece ends at the next key
            endX = at < end ? Number(curves[at]) : Number(frames[i + 2]);
            endY = at < end ? Number(curves[at + 1]) : Number(frames[i + 3]);
        }
        value += ((time - x) / (endX - x)) * (endY - value);
    }
    out[0] = value;
}

/**
 * {@link bezierValue} for both values of a key with two values, written to `out[0]` and `out[1]`
 * in one call. `i` is the index of the key in `frames`.
 */
export function bezierPair(frames: Float32Array, curves: Float32Array, i: number, out: Float64Array): void {
    const time = Number(SHARED[TIME]);
    const curveType = Number(curves[i / 3]);

    for (let v = 1; v < 3; v++) {
        // the straight piece of the curve that holds `time` runs from x, y to endX, endY
        const c = curveType + BEZIER_SIZE * (v - 1) - BEZIER;
        const end = c + BEZIER_SIZE;
        let x = Number(frames[i]);
        let y = Number(frames[i + v]);
        let endX = Number(curves[c]);
        let endY = Number(curves[c + 1]);

        if (!(endX > time)) {
            let at = c + 2;

            while (at < end && !(Number(curves[at]) >= time)) at += 2;
            x = Number(curves[(at < end ? at : end) - 2]);
            y = Number(curves[(at < end ? at : end) - 1]);
            // after the last sample the piece ends at the next key
            endX = at < end ? Number(curves[at]) : Number(frames[i + 3]);
            endY = at < end ? Number(curves[at + 1]) : Number(frames[i + 3 + v]);
        }
        out[v - 1] = y + ((time - x) / (endX - x)) * (endY - y);
    }
}

/**
 * The first `count` values of a timeline at the time in `SHARED`, written to `out`. This is {@link curveValues}
 * for a timeline whose keys end in values that do not interpolate, as the flags of an IK key.
 */
export function leadingCurveValues(
    frames: Float32Array,
    curves: Float32Array,
    entries: number,
    count: number,
    out: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const i = search(frames, entries);
    const curveType = Number(curves[i / entries]);

    if (curveType === LINEAR) {
        const before = Number(frames[i]);
        const t = (time - before) / (Number(frames[i + entries]) - before);

        for (let v = 1; v <= count; v++) {
            const value = Number(frames[i + v]);

            out[v - 1] = value + (Number(frames[i + entries + v]) - value) * t;
        }
    } else if (curveType === STEPPED) {
        for (let v = 1; v <= count; v++) out[v - 1] = Number(frames[i + v]);
    } else {
        for (let v = 1; v <= count; v++) bezierValue(frames, curves, i, v, entries, out);
    }
}

/**
 * The official `DeformTimeline.getCurvePercent`, written to `out[0]`: how far the time in `SHARED` is between
 * the key at `frame` and the next key, from 0 to 1.
 */
export function curvePercent(frames: Float32Array, curves: Float32Array, frame: number, out: Float64Array): void {
    const time = Number(SHARED[TIME]);
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
