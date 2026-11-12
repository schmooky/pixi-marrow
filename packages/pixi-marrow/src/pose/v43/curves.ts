import { FIRST, SETUP, type Timeline43 } from './types';

const LINEAR = 0;
const STEPPED = 1;
const BEZIER = 2;
const BEZIER_SIZE = 18;

/*
 * How the code that applies timelines handles numbers.
 *
 * A typed array is read in place, as `Number(array[i])`. A read past the end gives NaN, which is
 * what the `undefined` of the official runtime turns into in arithmetic and in comparisons. The
 * read is not put into a helper function: a call that returns a number with a fraction allocates
 * unless V8 inlines it, and V8 does not inline a call on a path that is rarely taken.
 *
 * For the same reason no function here takes or returns a time, an alpha or a sampled value.
 * Those numbers go through `SHARED`. An update must not allocate.
 */

/**
 * The numbers the functions of one apply share. No call keeps them across a return, so every
 * engine uses this one array. It is longer than 64 bytes on purpose: V8 stores such an array
 * outside its heap, and compiled code reads it at a fixed address.
 */
export const SHARED: Float64Array = new Float64Array(16);
/** The first of the values a sampler read from a key. A key has up to seven. */
export const VALUES = 0;
/** The official `DeformTimeline.getCurvePercent` of the key a deform timeline is at. */
export const PERCENT = 7;
/** The official `time` of `Timeline.apply`. */
export const TIME = 8;
/** The official `lastTime` of `Timeline.apply`. */
export const LAST_TIME = 9;
/** The official `alpha` of `Timeline.apply`. */
export const ALPHA = 10;
/** The alpha of the timelines of an entry that fade out with its mix. */
export const ALPHA_MIX = 11;
/** The alpha of the held timelines of an entry that is mixed out. */
export const ALPHA_HOLD = 12;
/** The official `getAnimationTime` of the entry that is applied. */
export const ANIMATION_TIME = 13;
/** The seconds the tracks advance by in this update, times the time scale of the player. */
export const DELTA = 14;

/**
 * Sets the times and the alpha the timelines read: the `lastTime`, `time` and `alpha` of the
 * official `Timeline.apply`.
 */
export function setClock(lastTime: number, time: number, alpha: number): void {
    SHARED[LAST_TIME] = lastTime;
    SHARED[TIME] = time;
    SHARED[ALPHA] = alpha;
}

/**
 * The official `Timeline.search`: the index of the last key at or before the time in `SHARED`.
 *
 * @param step Floats per key.
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
 * The official `CurveTimeline.getBezierValue`: the value of one curve at the time in `SHARED`.
 * Writes it to `SHARED` at `valueOffset - 1`.
 *
 * The key before the time starts at `frameIndex` in `frames` and takes `entries` floats. The value
 * the curve is for is `valueOffset` floats into the key. The samples of the curve start at `i`
 * in `curves`.
 */
function bezierValue(
    frames: Float32Array,
    curves: Float32Array,
    entries: number,
    frameIndex: number,
    valueOffset: number,
    i: number,
): void {
    const time = Number(SHARED[TIME]);
    const out = valueOffset - 1;
    const first = Number(curves[i]);

    if (first > time) {
        const x = Number(frames[frameIndex]);
        const y = Number(frames[frameIndex + valueOffset]);

        SHARED[out] = y + ((time - x) / (first - x)) * (Number(curves[i + 1]) - y);

        return;
    }
    const n = i + BEZIER_SIZE;

    for (i += 2; i < n; i += 2) {
        const end = Number(curves[i]);

        if (end >= time) {
            const x = Number(curves[i - 2]);
            const y = Number(curves[i - 1]);

            SHARED[out] = y + ((time - x) / (end - x)) * (Number(curves[i + 1]) - y);

            return;
        }
    }
    frameIndex += entries;
    const x = Number(curves[n - 2]);
    const y = Number(curves[n - 1]);

    SHARED[out] = y + ((time - x) / (Number(frames[frameIndex]) - x)) * (Number(frames[frameIndex + valueOffset]) - y);
}

/**
 * The official `CurveTimeline1.getCurveValue`: the value of a timeline with one value per key at
 * the time in `SHARED`. Writes it to `SHARED` at `VALUES`.
 */
export function curveValue(frames: Float32Array, curves: Float32Array): void {
    const time = Number(SHARED[TIME]);
    let i = frames.length - 2;

    for (let ii = 2; ii <= i; ii += 2) {
        if (Number(frames[ii]) > time) {
            i = ii - 2;
            break;
        }
    }
    const curveType = Number(curves[i >> 1]);

    if (curveType === LINEAR) {
        const before = Number(frames[i]);
        const value = Number(frames[i + 1]);

        SHARED[VALUES] = value + ((time - before) / (Number(frames[i + 2]) - before)) * (Number(frames[i + 3]) - value);
    } else if (curveType === STEPPED) SHARED[VALUES] = Number(frames[i + 1]);
    else bezierValue(frames, curves, 2, i, 1, curveType - BEZIER);
}

/**
 * Reads the first `count` values of a timeline at the time in `SHARED`, as the official timelines
 * with more than one value per key do. Writes them to `SHARED` from `VALUES` on. Returns where
 * the key before the time starts in `frames`.
 */
export function sampleValues(timeline: Timeline43, count: number): number {
    const { frames, curves, entries } = timeline;
    const time = Number(SHARED[TIME]);
    const n = frames.length;
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

        for (let k = 1; k <= count; k++) {
            const value = Number(frames[i + k]);

            SHARED[k - 1] = value + (Number(frames[i + entries + k]) - value) * t;
        }
    } else if (curveType === STEPPED) {
        for (let k = 1; k <= count; k++) SHARED[k - 1] = Number(frames[i + k]);
    } else {
        for (let k = 1; k <= count; k++) {
            bezierValue(frames, curves, entries, i, k, curveType + BEZIER_SIZE * (k - 1) - BEZIER);
        }
    }

    return i;
}

/**
 * What the official timelines do to `count` values before the first key. From the setup pose they
 * take the setup values. From the first pose they mix toward them by the alpha in `SHARED`.
 * Otherwise nothing changes.
 */
export function towardSetup(
    values: Float64Array,
    setup: Float64Array,
    index: number,
    count: number,
    from: number,
): void {
    if (from === SETUP) {
        for (let i = index; i < index + count; i++) values[i] = Number(setup[i]);
    } else if (from === FIRST) {
        const alpha = Number(SHARED[ALPHA]);

        for (let i = index; i < index + count; i++) {
            const value = Number(values[i]);

            values[i] = value + (Number(setup[i]) - value) * alpha;
        }
    }
}
