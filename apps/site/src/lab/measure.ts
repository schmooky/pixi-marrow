import type { Container, Renderer } from 'pixi.js';
import type { BuiltScene } from './lab';

/*
 * The clock of the lab, after the A/B bench of the repository (scripts/bench/page.js). A timed
 * frame has three parts. The update is what the scene and pixi-marrow do on the CPU to advance
 * every skeleton by 1/60 second. The submit is `renderer.render(stage)`, the CPU work that hands
 * the frame to the GPU. The wait lasts until the GPU has finished that frame. No part waits for
 * vsync, so a frame that takes 3 ms reads 3 ms on a screen of 60 Hz and of 120 Hz.
 *
 * On WebGL the wait is a read of one pixel, which needs the finished picture. On WebGPU it is
 * the promise of the device queue. The page gets an animation frame between two samples, so
 * the browser shows the scene and stays responsive.
 */

/** Seconds every skeleton advances per frame. */
const STEP = 1 / 60;

/** What the clock needs: the renderer, the stage it draws, how to wait for the GPU and the draw counter. */
export interface Clock {
    renderer: Renderer;
    stage: Container;
    wait(): Promise<void> | void;
    draws: { count: number };
    /** True once the page was hidden during a block, which spoils the block. */
    hidden: boolean;
}

/** The times of one block, per sample: the means of the update, the submit and the wait of a frame. */
export interface BlockTimes {
    update: number[];
    submit: number[];
    wait: number[];
    /** The most draw calls a frame of the block took. */
    draws: number;
}

/** Thrown when the page was hidden during a block. The runner runs the block again. */
export class HiddenError extends Error {
    constructor() {
        super('the page was hidden during a block');
    }
}

/** Waits for the next animation frame of the page. */
const nextFrame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()));

/** The wait for the GPU on WebGL: a read of one pixel of the canvas. */
export function readPixelWait(gl: WebGL2RenderingContext): () => void {
    const pixel = new Uint8Array(4);

    return () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
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

/** One frame that is not timed. */
async function frame(clock: Clock, scene: BuiltScene): Promise<void> {
    scene.step(STEP);
    clock.renderer.render(clock.stage);
    await clock.wait();
}

/**
 * Draws frames that are not timed: buffers get their size, the code gets compiled, baked clips
 * get baked and the idle cache takes its images. Every frame gives the page a turn, as the
 * frames of a game do, so a chunk that loads on demand arrives.
 */
export async function warmUp(clock: Clock, scene: BuiltScene, frames: number): Promise<void> {
    for (let i = 0; i < frames; i++) {
        await frame(clock, scene);
        await nextFrame();
    }
}

/**
 * Times `samples` samples of `group` frames each. Nothing is allocated between two readings of
 * the clock. The page gets an animation frame between two samples, which is not timed.
 *
 * @throws {HiddenError} When the page was hidden during the block.
 */
export async function timeBlock(clock: Clock, scene: BuiltScene, samples: number, group: number): Promise<BlockTimes> {
    const { renderer, stage, draws } = clock;
    const update = new Float64Array(samples);
    const submit = new Float64Array(samples);
    const wait = new Float64Array(samples);
    let most = 0;

    clock.hidden = false;
    for (let sample = 0; sample < samples; sample++) {
        let updating = 0;
        let submitting = 0;
        let waiting = 0;

        for (let i = 0; i < group; i++) {
            const start = performance.now();

            scene.step(STEP);
            const updated = performance.now();

            draws.count = 0;
            renderer.render(stage);
            const submitted = performance.now();

            await clock.wait();
            const done = performance.now();

            updating += updated - start;
            submitting += submitted - updated;
            waiting += done - submitted;
            if (draws.count > most) most = draws.count;
        }
        update[sample] = updating / group;
        submit[sample] = submitting / group;
        wait[sample] = waiting / group;
        await nextFrame();
        if (clock.hidden) throw new HiddenError();
    }

    return { update: Array.from(update), submit: Array.from(submit), wait: Array.from(wait), draws: most };
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

/** The medians of an empty stage: what asking the GPU costs, which every frame of a block holds too. */
export async function timeEmpty(clock: Clock, frames: number): Promise<number> {
    const times: number[] = [];

    for (let i = 0; i < frames; i++) {
        const start = performance.now();

        clock.renderer.render(clock.stage);
        await clock.wait();
        times.push(performance.now() - start);
        if (i % 8 === 7) await nextFrame();
    }

    return median(times);
}

/** The refresh rate of the screen in Hz, from the time between animation frames. */
export async function refreshRate(frames = 40): Promise<number> {
    const gaps: number[] = [];
    let last = 0;

    for (let i = 0; i <= frames; i++) {
        await nextFrame();
        const now = performance.now();

        if (i > 0) gaps.push(now - last);
        last = now;
    }

    return Math.round(1000 / median(gaps));
}
