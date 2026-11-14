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
