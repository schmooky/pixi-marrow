import { describe, expect, it } from 'vitest';
import { Pacer } from '../../src/api/pacing';
import { resolvePerf } from '../../src/api/presets';

/*
 * The update rate on real displays, found in an audit: rate 30 on a 60 Hz display gave 20 to 23
 * poses a second, because the time over a step was dropped. The pacer is the real one, and the
 * frames come from timestamps as a browser gives them.
 */

/** How a browser reports the time of a frame. */
type Clock = 'exact' | 'jitter' | 'quantised';

/** A random number from 0 to 1 that is the same in every run. */
function seeded(seed: number): () => number {
    let state = seed;

    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;

        return state / 4294967296;
    };
}

/** The timestamps of the frames of a display, in milliseconds, for a number of seconds. */
function timestamps(hz: number, seconds: number, clock: Clock): number[] {
    const random = seeded(hz * 31 + clock.length);
    const stamps: number[] = [];

    for (let frame = 0; frame <= hz * seconds; frame++) {
        const exact = (frame * 1000) / hz;

        if (clock === 'jitter') stamps.push(exact + (random() - 0.5) * 0.1);
        else if (clock === 'quantised') stamps.push(Math.round(exact * 10) / 10);
        else stamps.push(exact);
    }

    return stamps;
}

/** What a pacer made of the frames of a display. */
interface Run {
    /** Poses a second. */
    rate: number;
    /** The fewest and the most frames from one pose to the next. */
    gaps: [number, number];
    /** The seconds that were posed, and the seconds that passed. */
    posed: number;
    passed: number;
}

function run(rate: number, hz: number, clock: Clock, seconds = 10): Run {
    const pacer = new Pacer(resolvePerf(undefined, { updateRate: rate }));
    const stamps = timestamps(hz, seconds, clock);
    const gaps: number[] = [];
    let posed = 0;
    let poses = 0;
    let since = 0;

    for (let i = 1; i < stamps.length; i++) {
        const due = pacer.take((Number(stamps[i]) - Number(stamps[i - 1])) / 1000, false);

        since++;
        if (due < 0) continue;
        posed += due;
        poses++;
        gaps.push(since);
        since = 0;
    }
    const passed = (Number(stamps.at(-1)) - Number(stamps[0])) / 1000;

    // the first gap is from the start, not from a pose
    return { rate: poses / passed, gaps: [Math.min(...gaps.slice(1)), Math.max(...gaps.slice(1))], posed, passed };
}

const CLOCKS: readonly Clock[] = ['exact', 'jitter', 'quantised'];
const DISPLAYS = [60, 90, 120, 144];

describe('the update rate on a display', () => {
    it.each(CLOCKS)('gives 30 poses a second on a 60 Hz display, every other frame, with %s timestamps', (clock) => {
        const result = run(30, 60, clock);

        expect(result.rate).toBeCloseTo(30, 0);
        expect(result.gaps).toEqual([2, 2]);
    });

    it.each(CLOCKS)('gives 60 poses a second on a 60 Hz display, every frame, with %s timestamps', (clock) => {
        const result = run(60, 60, clock);

        expect(result.rate).toBeCloseTo(60, 0);
        expect(result.gaps).toEqual([1, 1]);
    });

    it.each(DISPLAYS.flatMap((hz) => CLOCKS.map((clock) => [hz, clock] as const)))(
        'holds rates of 20, 30 and 60 on a %i Hz display with %s timestamps, in an even rhythm',
        (hz, clock) => {
            for (const rate of [20, 30, 60]) {
                const result = run(rate, hz, clock);
                const frames = hz / rate;

                // within one pose in the 10 seconds, and never more than the display shows
                expect(Math.abs(result.rate - Math.min(rate, hz))).toBeLessThanOrEqual(0.15);
                // a pose comes at the frame nearest to its step: two gaps differ by one frame at most
                expect(result.gaps[0]).toBeGreaterThanOrEqual(Math.max(1, Math.floor(frames)));
                expect(result.gaps[1]).toBeLessThanOrEqual(Math.max(1, Math.ceil(frames)));
                // no time is lost: what was not posed yet waits for the next pose
                expect(result.passed - result.posed).toBeLessThan(1 / Math.min(rate, hz) + 0.001);
            }
        },
    );

    it('poses every frame for a rate above the display, and keeps no time back', () => {
        const result = run(120, 60, 'jitter');

        expect(result.rate).toBeCloseTo(60, 0);
        expect(result.gaps).toEqual([1, 1]);
        expect(result.posed).toBeCloseTo(result.passed, 9);
    });

    it('does not pose in a burst after a long frame', () => {
        const pacer = new Pacer(resolvePerf(undefined, { updateRate: 30 }));
        const due = (seconds: number): boolean => pacer.take(seconds, false) >= 0;

        for (let i = 0; i < 10; i++) due(1 / 60);
        // a tab that was in the background: one frame of a second
        expect(due(1)).toBe(true);
        const after = Array.from({ length: 12 }, () => due(1 / 60));

        // the rhythm of every other frame goes on, with one pose early at the most
        expect(after.filter(Boolean).length).toBeLessThanOrEqual(7);
        expect(after.slice(2).join()).toMatch(/^(true,false,?)+$|^(false,true,?)+$/);
    });

    it('holds the rate of the fast preset on a batched skeleton', () => {
        // on the screen: off it the preset pauses the skeleton
        const pacer = new Pacer(resolvePerf('fast', { offscreen: 'update' }));
        let poses = 0;

        for (let i = 0; i < 600; i++) if (pacer.take(1 / 60 + (i % 2 === 0 ? 5e-5 : -5e-5), true) >= 0) poses++;
        expect(poses).toBe(300);
    });
});
