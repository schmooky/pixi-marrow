import { describe, expect, it } from 'vitest';
import { SHARED as LEGACY_SHARED, TIME as LEGACY_TIME, search as legacySearch } from '../../src/pose/legacy/curves';
import { LONG_KEYS, searchLong } from '../../src/pose/shared/search';
import { SHARED, search, TIME } from '../../src/pose/v43/curves';

/*
 * The lookup of a key. A timeline with many keys is searched by halves. The result must be the
 * key the official `Timeline.search` finds, for every array of keys and every time.
 */

/** The official `Timeline.search`, as written in spine-core. */
function official(frames: Float32Array, time: number, step: number): number {
    const n = frames.length;

    for (let i = step; i < n; i += step) if (Number(frames[i]) > time) return i - step;

    return n - step;
}

/** A small random number generator with a seed, so that a failure can be run again. */
function random(seed: number): () => number {
    let state = seed;

    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;

        return state / 4294967296;
    };
}

/** Keys with `step` floats each. The times rise by uneven amounts, and some keys share a time. */
function keys(count: number, step: number, next: () => number): Float32Array {
    const frames = new Float32Array(count * step);
    let time = next() < 0.5 ? 0 : next();

    for (let key = 0; key < count; key++) {
        frames[key * step] = time;
        for (let value = 1; value < step; value++) frames[key * step + value] = next() * 100 - 50;
        if (next() > 0.15) time += next() * 0.2;
    }

    return frames;
}

/** The times to look up: every key time, the times around each, and the special numbers. */
function times(frames: Float32Array, step: number): number[] {
    const list = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0, -0, 1e9];

    for (let i = 0; i < frames.length; i += step) {
        const time = Number(frames[i]);

        list.push(time, time - 1e-6, time + 1e-6, (time + Number(frames[i + step] ?? time + 1)) / 2);
    }

    return list;
}

/** Looks a time up with the search of both engines and with the long search itself. */
function found(frames: Float32Array, time: number, step: number): number[] {
    SHARED[TIME] = time;
    LEGACY_SHARED[LEGACY_TIME] = time;

    return [search(frames, step), legacySearch(frames, step), searchLong(frames, step, SHARED, TIME)];
}

describe('the lookup of a key', () => {
    it('finds the official key in timelines of every length, by halves in the long ones', () => {
        const next = random(7);

        for (const step of [1, 2, 3, 5]) {
            for (const count of [1, 2, 3, LONG_KEYS - 1, LONG_KEYS, LONG_KEYS + 1, LONG_KEYS + 2, 100, 257, 1000]) {
                const frames = keys(count, step, next);

                for (const time of times(frames, step)) {
                    const expected = official(frames, time, step);

                    expect(found(frames, time, step), `${count} keys of ${step}, time ${time}`).toEqual([
                        expected,
                        expected,
                        expected,
                    ]);
                }
            }
        }
    });

    it('finds the official key where the times do not rise or are no numbers', () => {
        const next = random(11);

        for (const step of [1, 2, 3]) {
            for (let round = 0; round < 40; round++) {
                const frames = keys(LONG_KEYS + 8 + round, step, next);
                const damaged = 1 + Math.floor(next() * (frames.length / step - 1));

                // one key goes back in time, is no number, or is far ahead of the keys after it
                frames[damaged * step] = [Number.NaN, -5, 1e6, Number(frames[0]) - 1][round % 4] ?? 0;
                for (const time of times(frames, step)) {
                    const expected = official(frames, time, step);

                    expect(found(frames, time, step), `round ${round}, time ${time}`).toEqual([
                        expected,
                        expected,
                        expected,
                    ]);
                }
            }
        }
    });

    it('needs as many looks as the length has halves', () => {
        const frames = new Float32Array(2 * 100_000);
        let looks = 0;

        for (let key = 0; key < 100_000; key++) frames[key * 2] = key / 30;
        const watched = new Proxy(frames, {
            get(target, property) {
                if (typeof property === 'string' && property !== 'length') looks++;

                return Reflect.get(target, property, target);
            },
        });

        // the first search reads every key once, to see that the times rise
        SHARED[TIME] = 1234.5;
        expect(searchLong(frames, 2, SHARED, TIME)).toBe(official(frames, 1234.5, 2));
        SHARED[TIME] = 2000.25;
        expect(searchLong(watched, 2, SHARED, TIME)).toBe(official(frames, 2000.25, 2));
        // the watched array is another object: it is looked at as a whole once
        looks = 0;
        expect(searchLong(watched, 2, SHARED, TIME)).toBe(official(frames, 2000.25, 2));
        expect(looks).toBeLessThan(20);
    });
});
