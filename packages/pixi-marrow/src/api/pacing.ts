import { Bounds, type Renderer } from 'pixi.js';
import type { ResolvedPerf } from './presets';

/** How long a skeleton off the screen waits between two updates in the `throttle` mode, in seconds. */
const THROTTLE = 0.25;
/** Below this size on the screen, in pixels across, `lod: 'auto'` leaves physics and deform out. */
const LOD_SIZE = 96;
/** What `lod` left out comes back above this size, so a skeleton at the limit does not flip each frame. */
const LOD_BACK = 120;
/**
 * A skeleton that no render reached in more than this many updates, and for longer than
 * UNSEEN_SECONDS of their time, counts as off the screen. A game that updates several times a
 * render stays on it.
 */
const UNSEEN = 2;
const UNSEEN_SECONDS = 0.1;

/** Where the pacing of one display object stands. See {@link Pacer.status}. */
export interface PacingStatus {
    /** Updates a second, or `display` for every frame. */
    rate: number | 'display';
    offscreen: ResolvedPerf['offscreen'];
    /**
     * True when the last renders found the skeleton off the screen or hidden, or no render
     * reached it. A skeleton is hidden when it or a parent has `visible` or `renderable` false.
     */
    hidden: boolean;
    /** The size on the screen at the last render, in pixels across. Infinite before a render. */
    size: number;
    /** True while `lod` leaves physics and deform out. */
    reduced: boolean;
}

/** A display object or one of its parents, as the pacing reads them. */
interface Shown {
    readonly visible: boolean;
    readonly renderable: boolean;
    readonly alpha: number;
    readonly parent: Shown | null;
    /** What Pixi gives the root of a render, and a container that is a render group. */
    readonly renderGroup?: unknown;
}

/** What the pacing reads of a display object when it is rendered. */
export interface Seen extends Shown {
    /** The box the skeleton covers, in the coordinates of the screen, written to `bounds`. */
    getBounds(skipUpdate: boolean, bounds: Bounds): { x: number; y: number; width: number; height: number };
}

/**
 * True when Pixi draws nothing of a display object. It or a parent has `visible` or `renderable`
 * false or an alpha of 0. Pixi still calls `onRender` for such an object, and `getBounds` looks
 * at no parent. The check reads no bounds.
 *
 * Outside of a render the object also counts when no render ever started from the top of its
 * tree: a container without a parent that is no stage.
 *
 * @param rendered True in a render of the object, which says that its tree is drawn.
 *
 * @example
 * if (unseen(hero, false)) console.warn('nothing draws the hero');
 */
export function unseen(owner: Shown, rendered: boolean): boolean {
    let node = owner;

    for (;;) {
        if (!node.visible || !node.renderable || node.alpha === 0) return true;
        if (node.parent === null) return !rendered && node.renderGroup == null;
        node = node.parent;
    }
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
    /** Seconds since the update rate last asked for a pose, less the steps that were posed. */
    private phase = 0;
    private updates = 0;
    private seenAt = 0;
    /** Seconds of the updates since a render reached the skeleton. */
    private since = 0;
    private onScreen = true;
    private size = Number.POSITIVE_INFINITY;
    private shrunk = false;
    private readonly box = new Bounds();

    constructor(settings: ResolvedPerf) {
        this.settings = settings;
        this.watching = settings.offscreen !== 'update' || settings.lod === 'auto';
    }

    /**
     * The seconds to pose now, or -1 to leave this update out. A rate below the display, and a
     * skeleton off the screen in the `throttle` mode, gather the time until their step is due.
     * A skeleton that is {@link paused} is due in every update: its time passes without a pose.
     *
     * A step is due in the update that comes nearest to it: less than half of this update short
     * of it. What is over stays for the next step, so the rate holds on a display of any rate
     * and with timestamps that jitter. After a long frame at most half a step stays, so the
     * updates never come in a burst.
     *
     * @param small True when the skeleton draws in the batched mode: a rate the `fast` preset set applies to such only.
     */
    take(seconds: number, small: boolean): number {
        const { settings } = this;

        this.updates++;
        this.since += seconds;
        const hidden = this.hidden;
        const rate = settings.updateRate;
        const applies = typeof rate === 'number' && (small || settings.given.has('updateRate'));
        let step = applies ? 1 / rate : 0;

        if (hidden && settings.offscreen === 'throttle') step = Math.max(step, THROTTLE);
        else if (hidden && settings.offscreen === 'pause') step = 0;
        this.carried += seconds;
        this.phase += seconds;
        if (this.phase + seconds / 2 < step) return -1;
        this.phase = step > 0 ? Math.min(this.phase - step, step / 2) : 0;
        const due = this.carried;

        this.carried = 0;

        return due;
    }

    /**
     * True while the skeleton is off the screen or hidden in the `pause` mode. Its updates then
     * pass the time and fire the events, and pose and draw nothing.
     */
    get paused(): boolean {
        return this.settings.offscreen === 'pause' && this.hidden;
    }

    /**
     * Notes where the skeleton is, from a render of it. A skeleton that is hidden, or has a
     * hidden parent, counts as off the screen and keeps its size. A skeleton that shows
     * nothing else has an empty box: it counts as on the screen with the size it had, so that
     * it shows when a slot does again.
     */
    seen(owner: Seen, renderer: Renderer): void {
        if (!this.watching) return;
        this.seenAt = this.updates;
        this.since = 0;
        if (unseen(owner, true)) {
            this.onScreen = false;

            return;
        }
        const box = owner.getBounds(false, this.box.clear());
        const { screen } = renderer;

        if (box.width <= 0 && box.height <= 0) {
            this.onScreen = true;

            return;
        }
        this.size = Math.max(box.width, box.height);
        this.shrunk = this.settings.lod === 'auto' && this.size < (this.shrunk ? LOD_BACK : LOD_SIZE);
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
            hidden: this.hidden,
            size: this.size,
            reduced: this.small,
        };
    }

    /**
     * True while `lod: 'auto'` leaves physics and deform out: the skeleton is drawn smaller than 96 pixels.
     * It stays true until the skeleton is drawn at 120 pixels or more.
     */
    get small(): boolean {
        return this.shrunk;
    }

    /**
     * The seconds gathered for the next update, which are posed now. A command that changes the
     * tracks calls it first, so that the time before the command plays what was on the tracks.
     */
    drain(): number {
        const due = this.carried;

        this.carried = 0;

        return due;
    }

    /** True when the last renders found the skeleton off the screen or hidden, or no render reached it for a while. */
    private get hidden(): boolean {
        const unseen = this.updates - this.seenAt > UNSEEN && this.since > UNSEEN_SECONDS;

        return this.watching && (!this.onScreen || unseen);
    }
}
