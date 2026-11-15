import { type PerformanceEntry, PerformanceObserver, performance } from 'node:perf_hooks';
import type { PoseEngine } from '../../src/core';

/*
 * Measures what a live pose engine allocates per update while its timelines play.
 *
 * A window is a number of updates, each followed by `takeEvents`, as a game makes them. Before a
 * window the garbage is collected, so its young generation starts empty. The growth of the heap
 * over the window is then what the updates allocated, garbage included: nothing was collected
 * in between. That last part is checked and not assumed. Node reports every collection, and a
 * window in which one ran does not count. A collection in a window would hide the garbage.
 */

/** Updates per measured window. */
export const WINDOW = 200;
/** The seconds one update advances. */
const STEP = 1 / 60;
/** What a window may grow the heap by on top of what its events cost: the measurement allocates a little. */
const NOISE = 2048;
/** The bytes of the list that `takeEvents` hands out for an update with events. */
const LIST_BYTES = 192;
/** The bytes of one event in that list. */
const EVENT_BYTES = 64;
/** Updates before the first window: V8 compiles a function in steps, and the first steps allocate. */
const WARM_UP = 20_000;
/** Windows in a row that have to be quiet. */
const QUIET_RUN = 3;

/** One measured window. */
interface Window {
    start: number;
    end: number;
    /** The bytes the heap grew by. */
    bytes: number;
    /** The bytes the events of the window are allowed: a list per update with events, and the events. */
    allowed: number;
}

/** What {@link measureUpdates} found. */
export interface HeapResult {
    /** True when {@link QUIET_RUN} windows in a row stayed in the budget, with no collection inside. */
    quiet: boolean;
    /** How many windows ran. */
    windows: number;
    /** The bytes per update of the last windows, without the allowance for their events. */
    perUpdate: number[];
}

function collector(): () => void {
    const collect: unknown = Reflect.get(globalThis, 'gc');

    if (typeof collect !== 'function') {
        throw new Error(
            'measureUpdates: gc() is not exposed. Run the tests with the config of the package, ' +
                'whose execArgv has --expose-gc.',
        );
    }

    return () => collect();
}

function runWindow(engine: PoseEngine, collect: () => void): Window {
    let allowed = 0;

    collect();
    const start = performance.now();
    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < WINDOW; i++) {
        engine.update(STEP);
        const events = engine.takeEvents().length;

        if (events > 0) allowed += LIST_BYTES + events * EVENT_BYTES;
    }
    const bytes = process.memoryUsage().heapUsed - before;

    return { start, end: performance.now(), bytes, allowed };
}

/** Lets Node deliver the collections it has seen to the observer. */
const delivered = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Updates a playing engine in windows until some in a row allocate no more than their events
 * cost, and no collection ran inside them. The engine must have its animations set.
 *
 * The budget of a window is {@link NOISE} bytes for {@link WINDOW} updates, which is about 10
 * bytes per update. One number on the heap per update is 16 bytes. An update that reports events
 * may also allocate the list it hands out and the events in it.
 *
 * @param limit The most windows to run before the engine counts as allocating.
 */
export async function measureUpdates(engine: PoseEngine, limit = 600): Promise<HeapResult> {
    const collect = collector();
    const collections: PerformanceEntry[] = [];
    const observer = new PerformanceObserver((list) => collections.push(...list.getEntries()));
    const recent: Window[] = [];
    let windows = 0;

    for (let i = 0; i < WARM_UP; i++) {
        engine.update(STEP);
        engine.takeEvents();
    }
    observer.observe({ entryTypes: ['gc'] });
    try {
        while (windows < limit) {
            const window = runWindow(engine, collect);

            windows++;
            recent.push(window);
            if (recent.length > QUIET_RUN) recent.shift();
            if (recent.length < QUIET_RUN || recent.some((w) => Math.abs(w.bytes - w.allowed) > NOISE + w.allowed)) {
                continue;
            }
            await delivered();
            await delivered();
            const hidden = collections.some((gc) => recent.some((w) => gc.startTime > w.start && gc.startTime < w.end));

            if (!hidden) return { quiet: true, windows, perUpdate: recent.map((w) => (w.bytes - w.allowed) / WINDOW) };
            recent.length = 0;
        }
    } finally {
        observer.disconnect();
    }

    return { quiet: false, windows, perUpdate: recent.map((w) => (w.bytes - w.allowed) / WINDOW) };
}
