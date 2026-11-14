import type { Container, Rectangle } from 'pixi.js';
import type { MarrowAsset } from 'pixi-marrow';

/*
 * The lab: pages that show how pixi-marrow plays on the device that opens them, a phone above
 * all. Every skeleton has the settings a game gets when it sets none. A test is a module of
 * `src/lab/tests`. It names the rigs it loads and builds its scene. The runner plays the scene
 * at the rate of the screen, as a game does, and shows the frame rate and the time per frame.
 */

/** What a test builds its scene with. */
export interface BuildContext {
    /** The container of the scene. Its children are destroyed with it at the end. */
    stage: Container;
    /** The loaded rigs by file name, without the extension. */
    assets: ReadonlyMap<string, MarrowAsset>;
    /** The box of each rig in skeleton units, read from an instance that plays its first animation. */
    frames: ReadonlyMap<string, Rectangle>;
    /** The size of the area of the scene in CSS pixels, below the head of the page. */
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
    /** Makes the scene hold another number of skeletons. A test that grows has it. */
    resize?(count: number): void;
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
    /** How many skeletons the scene has by default. A test that grows starts there. */
    count: number;
    /** What the skeletons are, in the plural, as in "bees". */
    noun: string;
    /** True for a test that adds skeletons until the frames drop. */
    grows?: boolean;
}

/** A test of the lab. */
export interface LabTest extends LabInfo {
    /** The rigs to load, as file names of `/rigs` without the extension. */
    rigs: readonly string[];
    /** Seconds the scene plays for its result, where the test needs another time than the run. */
    seconds?: number;
    build(context: BuildContext): BuiltScene;
}

/** Types a test module. */
export const defineTest = (test: LabTest): LabTest => test;

/** The settings of a run, from the address of the page. */
export interface RunSettings {
    renderer: 'webgl' | 'webgpu';
    /** Seconds the scene plays for its result, or null for the time of the test. */
    seconds: number | null;
    /** The number of skeletons, or null for the default of the test. */
    count: number | null;
}

/** A whole number from the address, within limits, or null. */
function wholeNumber(query: URLSearchParams, name: string, low: number, high: number): number | null {
    const value = Number(query.get(name));

    return query.has(name) && Number.isInteger(value) && value >= low && value <= high ? value : null;
}

/**
 * Reads the settings of a run from the address. Every one has a default, so a plain link runs.
 *
 * @example
 * readSettings(new URLSearchParams('?renderer=webgpu&n=100'));
 */
export function readSettings(query: URLSearchParams): RunSettings {
    return {
        renderer: query.get('renderer') === 'webgpu' ? 'webgpu' : 'webgl',
        seconds: wholeNumber(query, 'seconds', 3, 120),
        count: wholeNumber(query, 'n', 1, 2000),
    };
}
