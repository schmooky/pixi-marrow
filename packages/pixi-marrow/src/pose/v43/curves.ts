import { FIRST, SETUP, type Timeline43 } from './types';

const LINEAR = 0;
const STEPPED = 1;
const BEZIER = 2;
const BEZIER_SIZE = 18;

/**
 * Reads a 32-bit number. A missing index gives NaN, which is what the `undefined` of the official
 * runtime turns into in arithmetic and in comparisons.
 */
export function f32(array: Float32Array, index: number): number {
    return array[index] ?? Number.NaN;
}

/** Reads a 64-bit number. A missing index gives NaN, like {@link f32}. */
export function f64(array: Float64Array, index: number): number {
    return array[index] ?? Number.NaN;
}

/**
 * The official `Timeline.search`: the index of the last key at or before `time`.
 *
 * @param step Floats per key.
 */
export function search(frames: Float32Array, time: number, step: number): number {
    const n = frames.length;

    for (let i = step; i < n; i += step) {
        if (f32(frames, i) > time) return i - step;
    }

    return n - step;
}

/**
 * The official `CurveTimeline.getBezierValue`: the value of one curve at `time`.
 *
 * The key before `time` starts at `frameIndex` in `frames` and takes `entries` floats. The value
 * the curve is for is `valueOffset` floats into the key. The samples of the curve start at `i`
 * in `curves`.
 */
function bezierValue(
    frames: Float32Array,
    curves: Float32Array,
    entries: number,
    time: number,
    frameIndex: number,
    valueOffset: number,
    i: number,
): number {
    if (f32(curves, i) > time) {
        const x = f32(frames, frameIndex);
        const y = f32(frames, frameIndex + valueOffset);

        return y + ((time - x) / (f32(curves, i) - x)) * (f32(curves, i + 1) - y);
    }
    const n = i + BEZIER_SIZE;

    for (i += 2; i < n; i += 2) {
        if (f32(curves, i) >= time) {
            const x = f32(curves, i - 2);
            const y = f32(curves, i - 1);

            return y + ((time - x) / (f32(curves, i) - x)) * (f32(curves, i + 1) - y);
        }
    }
    frameIndex += entries;
    const x = f32(curves, n - 2);
    const y = f32(curves, n - 1);

    return y + ((time - x) / (f32(frames, frameIndex) - x)) * (f32(frames, frameIndex + valueOffset) - y);
}

/** The official `CurveTimeline1.getCurveValue`: the value of a timeline with one value per key. */
export function curveValue(frames: Float32Array, curves: Float32Array, time: number): number {
    let i = frames.length - 2;

    for (let ii = 2; ii <= i; ii += 2) {
        if (f32(frames, ii) > time) {
            i = ii - 2;
            break;
        }
    }
    const curveType = f32(curves, i >> 1);

    if (curveType === LINEAR) {
        const before = f32(frames, i);
        const value = f32(frames, i + 1);

        return value + ((time - before) / (f32(frames, i + 2) - before)) * (f32(frames, i + 3) - value);
    }
    if (curveType === STEPPED) return f32(frames, i + 1);

    return bezierValue(frames, curves, 2, time, i, 1, curveType - BEZIER);
}

/**
 * Reads every value of a timeline at `time` into `out`, as the official timelines with more than
 * one value per key do.
 */
export function sampleKey(timeline: Timeline43, time: number, out: Float64Array): void {
    const { frames, curves, entries } = timeline;
    const i = search(frames, time, entries);
    const curveType = f32(curves, i / entries);

    if (curveType === LINEAR) {
        const before = f32(frames, i);
        const t = (time - before) / (f32(frames, i + entries) - before);

        for (let k = 1; k < entries; k++) {
            const value = f32(frames, i + k);

            out[k - 1] = value + (f32(frames, i + entries + k) - value) * t;
        }
    } else if (curveType === STEPPED) {
        for (let k = 1; k < entries; k++) out[k - 1] = f32(frames, i + k);
    } else {
        for (let k = 1; k < entries; k++) {
            out[k - 1] = bezierValue(frames, curves, entries, time, i, k, curveType + BEZIER_SIZE * (k - 1) - BEZIER);
        }
    }
}

/** The official `CurveTimeline1.beforeFirstKey`: the value of a property before the first key. */
export function beforeFirstKey(from: number, alpha: number, current: number, setup: number): number {
    if (from === SETUP) return setup;
    if (from === FIRST) return current + (setup - current) * alpha;

    return current;
}

/**
 * What the official timelines do to `count` values before the first key. From the setup pose they
 * take the setup values. From the first pose they mix toward them. Otherwise nothing changes.
 */
export function towardSetup(
    values: Float64Array,
    setup: Float64Array,
    index: number,
    count: number,
    from: number,
    alpha: number,
): void {
    if (from === SETUP) {
        for (let i = index; i < index + count; i++) values[i] = f64(setup, i);
    } else if (from === FIRST) {
        for (let i = index; i < index + count; i++) {
            const value = f64(values, i);

            values[i] = value + (f64(setup, i) - value) * alpha;
        }
    }
}
