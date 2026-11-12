/*
 * Measures whether a function allocates once it is warm. Shared by the tests of the view and of
 * the triangulator.
 */

/** Calls per measured window. One small object per call would grow the heap by 8 kB a window. */
export const WINDOW = 500;
/** What a window may grow the heap by: the measurement itself allocates a little. */
const QUIET = 2048;

/**
 * Runs windows of `run` calls until three in a row leave the heap as it was, and returns how many
 * windows that took. Returns -1 when the heap never settles: then every call allocates.
 *
 * The first windows are the warm-up. The JavaScript engine compiles a function in steps, and only
 * the last step stops allocating: Pixi's event emitter, which every buffer upload goes through,
 * allocates its arguments until it was called about 16,000 times.
 */
export function settle(run: (i: number) => void, limit = 150): number {
    let quiet = 0;

    for (let window = 0, i = 0; window < limit; window++) {
        const before = process.memoryUsage().heapUsed;

        for (let n = 0; n < WINDOW; n++, i++) run(i);
        // a collection shrinks the heap by far more than a quiet window moves it
        quiet = Math.abs(process.memoryUsage().heapUsed - before) < QUIET ? quiet + 1 : 0;
        if (quiet === 3) return window + 1;
    }

    return -1;
}
