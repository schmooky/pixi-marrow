/*
 * Bakes outside the frame. A bake plays an animation once on an engine of its own and keeps
 * every frame, which takes milliseconds per second of animation, more on a phone. The update
 * that first finds an animation without a clip starts the bake and plays live. The bake runs in
 * idle time, one frame of the animation per step, as many steps as a slice has time for.
 */

/** Work in steps. `step` does the next one and returns true once the work is over. */
export interface SteppedWork {
    step(): boolean;
}

/** The longest a slice waits for idle time before it runs anyway, in milliseconds. */
const IDLE_TIMEOUT = 1000;
/** How long a slice works without an idle deadline: with a timer, or after the wait ran out. In milliseconds. */
const SLICE = 4;
/** A slice stops while this much of its time is left, in milliseconds. */
const MARGIN = 1;

const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());

/** A deadline of {@link SLICE} milliseconds from now: the milliseconds that are left. */
function sliceFromNow(): () => number {
    const end = now() + SLICE;

    return () => end - now();
}

/** Runs a slice in idle time: `requestIdleCallback` where it exists, else a timer. */
function inIdleTime(slice: (left: () => number) => void): void {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(
            (deadline) => slice(deadline.didTimeout ? sliceFromNow() : () => deadline.timeRemaining()),
            { timeout: IDLE_TIMEOUT },
        );
    } else setTimeout(() => slice(sliceFromNow()), 0);
}

/**
 * Runs stepped work in idle time, a slice at a time. Each slice does one step at least, so that
 * the work goes on in a game that is never idle, and more while the slice has time.
 *
 * @example
 * bakeInIdleTime({ step: () => recorder.step() });
 */
export function bakeInIdleTime(work: SteppedWork): void {
    const slice = (left: () => number): void => {
        while (!work.step()) {
            if (left() <= MARGIN) {
                inIdleTime(slice);

                return;
            }
        }
    };

    inIdleTime(slice);
}
