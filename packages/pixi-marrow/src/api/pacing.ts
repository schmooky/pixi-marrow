import type { Renderer } from 'pixi.js';
import type { ResolvedPerf } from './presets';

/** How long a skeleton off the screen waits between two updates in the `throttle` mode, in seconds. */
const THROTTLE = 0.25;
/** Below this size on the screen, in pixels across, `lod: 'auto'` leaves physics out. */
const LOD_SIZE = 96;
/** How far a sum of seconds may fall short of a step and still count as due. */
const EPSILON = 1e-9;
/** A skeleton that no render reached in this many updates counts as off the screen. */
const UNSEEN = 2;

/** Where the pacing of one display object stands. See {@link Pacer.status}. */
export interface PacingStatus {
    /** Updates a second, or `display` for every frame. */
    rate: number | 'display';
    offscreen: ResolvedPerf['offscreen'];
    /** True when the last renders found the skeleton off the screen, or no render reached it. */
    hidden: boolean;
    /** The size on the screen at the last render, in pixels across. Infinite before a render. */
    size: number;
    /** True while `lod` leaves physics out. */
    physicsOff: boolean;
}

/** What the pacing reads of a display object when it is rendered. */
export interface Seen {
    /** The box the skeleton covers, in the coordinates of the screen. */
    getBounds(): { x: number; y: number; width: number; height: number };
}

/**
 * When a display object updates its pose, and with how much time: `updateRate`, `offscreen` and
 * `lod`. A render reports where the skeleton is. An update asks how many seconds to pose.
 *
 * @example
 * const seconds = pacer.take(ticker.deltaMS / 1000);
 * if (seconds >= 0) engine.update(seconds);
 */
export class Pacer {
    /** True when a render must report where the skeleton is. */
    readonly watching: boolean;
    private readonly settings: ResolvedPerf;
    /** Seconds that passed and were not posed yet. */
    private carried = 0;
    private updates = 0;
    private seenAt = 0;
    private onScreen = true;
    private size = Number.POSITIVE_INFINITY;

    constructor(settings: ResolvedPerf) {
        this.settings = settings;
        this.watching = settings.offscreen !== 'update' || settings.lod === 'auto';
    }

    /**
     * The seconds to pose now, or -1 to leave this update out. A rate below the display, and a
     * skeleton off the screen in the `throttle` mode, gather the time until their step is due.
     * A skeleton off the screen in the `pause` mode loses the time.
     *
     * @param small True when the skeleton draws in the batched mode: a rate the `fast` preset set applies to such only.
     */
    take(seconds: number, small: boolean): number {
        const { settings } = this;

        this.updates++;
        const hidden = this.watching && (!this.onScreen || this.updates - this.seenAt > UNSEEN);

        if (hidden && settings.offscreen === 'pause') return -1;
        this.carried += seconds;
        const rate = settings.updateRate;
        const applies = typeof rate === 'number' && (small || settings.given.has('updateRate'));
        let step = applies ? 1 / rate : 0;

        if (hidden && settings.offscreen === 'throttle') step = Math.max(step, THROTTLE);
        // seconds summed frame by frame fall short of a step by a rounding error: that counts as due
        if (this.carried + EPSILON < step) return -1;
        const due = this.carried;

        this.carried = 0;

        return due;
    }

    /** Notes where the skeleton is, from a render of it. */
    seen(owner: Seen, renderer: Renderer): void {
        if (!this.watching) return;
        const box = owner.getBounds();
        const { screen } = renderer;

        this.seenAt = this.updates;
        this.size = Math.max(box.width, box.height);
        this.onScreen =
            box.x < screen.x + screen.width &&
            box.y < screen.y + screen.height &&
            box.x + box.width > screen.x &&
            box.y + box.height > screen.y;
    }

    /**
     * Where the pacing stands, for the perf report: the rate in effect, whether the skeleton
     * counts as off the screen, and its size on the screen at the last render.
     *
     * @param small True when the skeleton draws in the batched mode.
     */
    status(small: boolean): PacingStatus {
        const { settings } = this;
        const rate = settings.updateRate;
        const applies = typeof rate === 'number' && (small || settings.given.has('updateRate'));

        return {
            rate: applies ? rate : 'display',
            offscreen: settings.offscreen,
            hidden: this.watching && (!this.onScreen || this.updates - this.seenAt > UNSEEN),
            size: this.size,
            physicsOff: this.small,
        };
    }

    /** True while `lod: 'auto'` leaves physics out: the skeleton is drawn smaller than the limit. */
    get small(): boolean {
        return this.settings.lod === 'auto' && this.size < LOD_SIZE;
    }
}
