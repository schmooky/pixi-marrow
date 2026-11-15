import type { Container, Renderer } from 'pixi.js';
import type { BuiltScene } from './lab';

/*
 * The clock of the lab. A scene plays at the rate of the screen, as in a game: one update and
 * one render per animation frame of the page, by the time that passed. The clock counts the
 * frames the screen gets and times the two parts of each on the CPU. The update is what the
 * scene and pixi-marrow do to advance every skeleton. The render is `renderer.render(stage)`,
 * the work of the CPU that hands the frame to the GPU. Nothing waits for the GPU on purpose, so
 * a GPU that cannot keep up shows as frames that the screen did not get.
 */

/** The longest step of a frame in seconds, so that the scene does not jump after a stall. */
const LONGEST_STEP = 0.1;

/** What the clock needs: the renderer, the stage it draws and the draw counter. */
export interface Clock {
    renderer: Renderer;
    stage: Container;
    draws: { count: number };
    /** True once the page was hidden while the scene played, which spoils the times. */
    hidden: boolean;
    /**
     * The time between frames of every frame the run played, the warm-up too. The rate of the
     * screen during the run is read from it, since a screen can change its rate under load.
     */
    seen: number[];
    /** The step of the timer in milliseconds, which no time of the run is finer than. */
    step: number;
}

/** The times of the frames a scene played, in milliseconds. */
export interface FrameTimes {
    /** The time between the animation frame of a frame and the one before. */
    gaps: number[];
    update: number[];
    render: number[];
    /** The most draw calls a frame took. */
    draws: number;
}

/** Thrown when the page was hidden while the scene played. The runner plays it again. */
export class HiddenError extends Error {
    constructor() {
        super('the page was hidden while the scene played');
    }
}

/** Waits for the next animation frame of the page, and gives its time. */
const nextFrame = (): Promise<number> => new Promise((done) => requestAnimationFrame(done));

/**
 * Plays a scene for some milliseconds at the rate of the screen and times every frame.
 *
 * @param onFrame Called after every frame with the times so far and the milliseconds played.
 * @throws {HiddenError} When the page was hidden while the scene played.
 */
export async function play(
    clock: Clock,
    scene: BuiltScene,
    milliseconds: number,
    onFrame?: (times: FrameTimes, played: number) => void,
): Promise<FrameTimes> {
    const { renderer, stage, draws } = clock;
    const times: FrameTimes = { gaps: [], update: [], render: [], draws: 0 };
    let last = await nextFrame();
    const start = last;

    clock.hidden = false;
    for (;;) {
        const now = await nextFrame();

        if (clock.hidden) throw new HiddenError();
        const gap = now - last;

        last = now;
        const begin = performance.now();

        scene.step(Math.min(gap / 1000, LONGEST_STEP));
        const updated = performance.now();

        draws.count = 0;
        renderer.render(stage);
        const rendered = performance.now();

        times.gaps.push(gap);
        clock.seen.push(gap);
        times.update.push(updated - begin);
        times.render.push(rendered - updated);
        if (draws.count > times.draws) times.draws = draws.count;
        onFrame?.(times, now - start);
        if (now - start >= milliseconds) return times;
    }
}

/**
 * Counts the draw calls of the page on WebGL2 and on WebGPU. A draw of any kind counts once.
 * It wraps the methods of the prototypes, so it counts every context of the page.
 */
export function countDraws(): { count: number } {
    const draws = { count: 0 };
    const counted: [{ prototype: object } | undefined, string[]][] = [
        [Reflect.get(globalThis, 'GPURenderPassEncoder'), ['draw', 'drawIndexed']],
        [
            Reflect.get(globalThis, 'WebGL2RenderingContext'),
            ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced', 'drawRangeElements'],
        ],
    ];

    for (const [type, names] of counted) {
        if (type === undefined) continue;
        for (const name of names) {
            const original: unknown = Reflect.get(type.prototype, name);

            if (typeof original !== 'function') continue;
            Reflect.set(type.prototype, name, function (this: unknown, ...args: unknown[]) {
                draws.count++;

                return original.apply(this, args);
            });
        }
    }

    return draws;
}

/** The median of some numbers. */
export function median(values: readonly number[]): number {
    return quantile(values, 0.5);
}

/** The value below which a share of some numbers lies. */
export function quantile(values: readonly number[], share: number): number {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);

    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? Number.NaN;
}

/**
 * The time between the frames that came on time, in milliseconds: the median of the shortest
 * gaps. A frame that came late is one refresh or more behind, so the shortest tenth of the gaps
 * lies at the rate of the screen even when the scene drops many frames.
 *
 * @example
 * const hz = Math.round(1000 / frameInterval(clock.seen));
 */
export function frameInterval(gaps: readonly number[]): number {
    const short = quantile(gaps, 0.1);

    return median(gaps.filter((gap) => gap < short * 1.5));
}

/** The refresh rate of the screen in Hz, from the time between animation frames. */
export async function refreshRate(frames = 40): Promise<number> {
    const gaps: number[] = [];
    let last = await nextFrame();

    for (let i = 0; i < frames; i++) {
        const now = await nextFrame();

        gaps.push(now - last);
        last = now;
    }

    return Math.round(1000 / median(gaps));
}

/** Milliseconds the measure of the timer may take at most. */
const TIMER_PROBE = 50;

/**
 * The step of `performance.now()` in milliseconds. A browser rounds it against timing attacks:
 * Chrome to 0.1 ms, Safari and Firefox to about 1 ms where the page is not isolated from other
 * origins. A time below one step reads as 0 or one step, so no time is worth more decimals.
 *
 * @example
 * const step = timerStep(); // 1 in Safari, 0.1 in Chrome
 */
export function timerStep(): number {
    const steps: number[] = [];
    const start = performance.now();
    let last = start;

    while (steps.length < 20) {
        const now = performance.now();

        if (now !== last) {
            steps.push(now - last);
            last = now;
        }
        if (now - start > TIMER_PROBE) break;
    }

    return steps.length === 0 ? TIMER_PROBE : median(steps);
}

/** True for a timer too coarse for the times of a frame: Safari and Firefox on a page that is not isolated. */
export const coarseTimer = (step: number): boolean => step >= 0.5;

/**
 * A time in milliseconds with as many decimals as a timer of some step can tell: none for a
 * step of 1 ms, one for 0.1 ms, two below. A time under one step is "under" it.
 *
 * @example
 * formatMs(0.42, 1); // "under 1"
 * formatMs(3.14159, 0.1); // "3.1"
 */
export function formatMs(value: number, step: number): string {
    if (!Number.isFinite(value)) return 'unknown';
    const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;

    if (value < step) return `under ${Math.max(step, 10 ** -decimals).toFixed(decimals)}`;

    return value.toFixed(decimals);
}
