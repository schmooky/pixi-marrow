import type { Container, Rectangle } from 'pixi.js';
import type { MarrowAsset, MarrowSpineOptions } from 'pixi-marrow';

/*
 * The lab: pages that measure pixi-marrow on the device that opens them, a phone above all. A
 * test is a module of `src/lab/tests`. It names the rigs it loads, the sides it compares and
 * how it builds its scene. The runner loads the rigs, runs every side a few times in turns and
 * shows the result with a text to copy.
 */

/** One way to draw the scene of a test: a name for the result and the options of every skeleton. */
export interface LabSide {
    name: string;
    options: MarrowSpineOptions;
}

/** What a test builds its scene with. */
export interface BuildContext {
    /** The container of the scene. Its children are taken away and destroyed after the block. */
    stage: Container;
    /** The loaded rigs by file name, without the extension. */
    assets: ReadonlyMap<string, MarrowAsset>;
    /** The box of each rig in skeleton units, read from an instance that plays its first animation. */
    frames: ReadonlyMap<string, Rectangle>;
    side: LabSide;
    /** The size of the canvas in CSS pixels. */
    width: number;
    height: number;
    /** How many skeletons the scene has, from the test or from `?n=` of the address. */
    count: number;
}

/** A scene that is built. */
export interface BuiltScene {
    /**
     * One frame of the scene: what the test does to its skeletons, then the update of each by
     * `seconds`. The runner times all of it as the update of the frame.
     */
    step(seconds: number): void;
}

/** What a page says about a test before its code loads. */
export interface LabInfo {
    /** The name in the address, as in `/lab/crowd/`. */
    name: string;
    title: string;
    /** The question the test answers, in one sentence. */
    question: string;
    /** What the scene shows, for `count` skeletons. */
    scene(count: number): string;
    /** How many skeletons the scene has by default. */
    count: number;
}

/** A test of the lab. */
export interface LabTest extends LabInfo {
    /** The rigs to load, as file names of `/rigs` without the extension. */
    rigs: readonly string[];
    /** The sides to compare. The first one is the one every other is compared with. */
    sides: readonly LabSide[];
    /**
     * Frames drawn before a block is timed, and samples timed, where the test needs other
     * numbers than the run: a scene with a cycle times all of it.
     */
    timing?: { warmup: number; samples: number };
    build(context: BuildContext): BuiltScene;
}

/** Types a test module. */
export const defineTest = (test: LabTest): LabTest => test;

/** The settings of a run, from the address of the page. */
export interface RunSettings {
    renderer: 'webgl' | 'webgpu';
    /** How many times every side runs. The sides take turns, so heat and clocks hit all of them alike. */
    rounds: number;
    /** Samples timed per block, and frames per sample. */
    samples: number;
    group: number;
    /** Frames drawn before a block is timed. */
    warmup: number;
    /** The number of skeletons, or null for the default of the test. */
    count: number | null;
}

/** A whole number from the address, within limits, or the default. */
function wholeNumber(query: URLSearchParams, name: string, fallback: number, low: number, high: number): number {
    const value = Number(query.get(name));

    return Number.isInteger(value) && value >= low && value <= high ? value : fallback;
}

/**
 * Reads the settings of a run from the address. Every one has a default, so a plain link runs.
 *
 * @example
 * readSettings(new URLSearchParams('?renderer=webgpu&n=100'));
 */
export function readSettings(query: URLSearchParams): RunSettings {
    const count = wholeNumber(query, 'n', 0, 1, 2000);

    return {
        renderer: query.get('renderer') === 'webgpu' ? 'webgpu' : 'webgl',
        rounds: wholeNumber(query, 'rounds', 3, 1, 10),
        samples: wholeNumber(query, 'samples', 30, 5, 200),
        group: 4,
        warmup: 60,
        count: count === 0 ? null : count,
    };
}
