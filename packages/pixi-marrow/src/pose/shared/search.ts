/*
 * The official `Timeline.search` looks at the keys one after another, from the first. That is
 * the fastest way for the few keys a timeline has as a rule, and the engines do the same. A
 * timeline with many keys is searched by halves here, which finds the same key: the two ways
 * differ only when the times of the keys do not rise, and then the official way is taken.
 */

/** A timeline with more keys than this is searched by halves. */
export const LONG_KEYS = 32;

/** Per array of keys: true when the times of its keys rise, so that a search by halves finds the official key. */
const rising = new WeakMap<Float32Array, boolean>();

/** True when no key from the second on has a time before the key ahead of it, and none has a time that is no number. */
function rises(frames: Float32Array, step: number): boolean {
    const n = frames.length;

    if (n % step !== 0) return false;
    for (let i = step; i < n; i += step) {
        const time = Number(frames[i]);

        // the first key is not looked at by the search. A time that is no number fails both comparisons
        if (i === step ? Number.isNaN(time) : !(time >= Number(frames[i - step]))) return false;
    }

    return true;
}

/**
 * The official `Timeline.search` for a timeline with many keys: the index in `frames` of the key
 * before the first key, from the second on, whose time is after the time. The last key when
 * there is none.
 *
 * The time is read from `shared` at `at`, and not passed: a number with a fraction that is passed
 * to a call can cost an allocation. A time that is no number gives the last key, as officially.
 *
 * @param step Floats per key.
 *
 * @example
 * const i = frames.length > LONG_KEYS * 2 ? searchLong(frames, 2, SHARED, TIME) : linear(frames);
 */
export function searchLong(frames: Float32Array, step: number, shared: Float64Array, at: number): number {
    const time = Number(shared[at]);
    const n = frames.length;
    let sorted = rising.get(frames);

    if (sorted === undefined) {
        sorted = rises(frames, step);
        rising.set(frames, sorted);
    }
    if (!sorted) {
        for (let i = step; i < n; i += step) {
            if (Number(frames[i]) > time) return i - step;
        }

        return n - step;
    }
    // the first key from the second on whose time is after the time, or one past the last
    let low = 1;
    let high = n / step;

    while (low < high) {
        const middle = (low + high) >>> 1;

        if (Number(frames[middle * step]) > time) high = middle;
        else low = middle + 1;
    }

    return (low - 1) * step;
}
