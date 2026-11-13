import type { Renderer } from 'pixi.js';
import type { ResolvedPerf } from './presets';

/** How long a skeleton off the screen waits between two updates in the `throttle` mode, in seconds. */
const THROTTLE = 0.25;
/** Below this size on the screen, in pixels across, `lod: 'auto'` leaves physics out. */
const LOD_SIZE = 96;
/** A skeleton that no render reached in this many updates counts as off the screen. */
const UNSEEN = 2;

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
        if (this.carried < step) return -1;
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

    /** True while `lod: 'auto'` leaves physics out: the skeleton is drawn smaller than the limit. */
    get small(): boolean {
        return this.settings.lod === 'auto' && this.size < LOD_SIZE;
    }
}
