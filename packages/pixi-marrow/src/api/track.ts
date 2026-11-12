import type { PoseEngine, TrackEntry, TrackFields } from '../pose/engine';
import type { MarrowNames, StopOptions } from './options';

/**
 * A handle on one playing or queued animation. `play` and `queue` of the display object return it.
 *
 * Once the track was disposed the handle keeps its last values, and setting them does nothing.
 */
export interface Track<N extends MarrowNames = MarrowNames> {
    /** The name of the animation. */
    readonly animation: N['animations'];
    /** The index of the track the animation is on. */
    readonly track: number;
    /** True when the animation repeats. */
    loop: boolean;
    /** Multiplies how fast the animation plays. */
    speed: number;
    /** How much of the animation is applied, from 0 to 1. */
    alpha: number;
    /**
     * True when the animation adds to the pose that lower tracks gave. Set it with the `additive`
     * option of `play` and `queue`: the official runtime takes it for a new animation only.
     */
    readonly additive: boolean;
    /** Seconds the animation has played. */
    readonly time: number;
    /**
     * Resolves when an animation that does not loop has played to its end once. It also resolves
     * when the animation ends or is disposed for any reason, whichever comes first. It never rejects.
     */
    readonly finished: Promise<void>;
    /** Stops the track this animation is on. Does nothing once the animation was disposed. */
    stop(options?: Pick<StopOptions, 'mix'>): void;
    /**
     * Sets fields of the official `TrackEntry` by their official names, for what the properties
     * above do not cover. Does nothing once the animation was disposed.
     *
     * Throws a `MarrowError` for a value of the wrong type, and for a field the Spine version
     * of the skeleton lacks. The error names the fields of that version. The rules of the
     * official runtime hold: `mixBlend` and `additive` are for an animation before its first update.
     *
     * @example
     * const aim = hero.play('aim', { track: 1 });
     * aim.configure({ trackEnd: 2, eventThreshold: 0.5 });
     */
    configure(fields: TrackFields): void;
}

/** What a handle needs from the display object that made it. */
export interface TrackOwner {
    readonly engine: PoseEngine;
    stop(options?: StopOptions): void;
}

/** The name a handle for the empty animation carries. Such a handle is never handed out. */
export const EMPTY_ANIMATION = '<empty>';

/**
 * The {@link Track} of one entry of a pose engine.
 *
 * A 4.3 engine reuses its entries. So the handle lets go of its entry when the entry is disposed
 * and answers from the values it had at that moment.
 *
 * @example
 * const handle = new TrackHandle(spine, spine.engine.setAnimation(0, 2, true), 'run', 0.8);
 * handle.speed = 2;
 * await handle.finished;
 */
export class TrackHandle<N extends MarrowNames = MarrowNames> implements Track<N> {
    readonly animation: N['animations'];
    readonly track: number;
    /** True for the empty animation a stop mixes through. Its events are not emitted. */
    readonly hidden: boolean;
    /** The entry of the pose engine, or null once it was disposed. */
    entry: TrackEntry | null;
    private readonly owner: TrackOwner;
    /** The official `animationStart` of the entry, in seconds. The entry of the engine does not show it. */
    private start = 0;
    /** The official `animationEnd` of the entry, in seconds. */
    private end: number;
    /** What {@link additive} answers. The entry of the engine does not show it. */
    private adds = false;
    /** The values the entry had when it was disposed. */
    private lastLoop = false;
    private lastSpeed = 1;
    private lastAlpha = 1;
    private lastTime = 0;
    private settled = false;
    private promise: Promise<void> | null = null;
    private resolve: (() => void) | null = null;

    /** @param duration The duration of the animation in seconds. */
    constructor(owner: TrackOwner, entry: TrackEntry, animation: N['animations'], duration: number) {
        this.owner = owner;
        this.entry = entry;
        this.animation = animation;
        this.track = entry.trackIndex;
        this.hidden = entry.animation === -1;
        this.end = duration;
    }

    get loop(): boolean {
        return this.entry === null ? this.lastLoop : this.entry.loop;
    }

    set loop(value: boolean) {
        this.configure({ loop: value });
    }

    get speed(): number {
        return this.entry === null ? this.lastSpeed : this.entry.timeScale;
    }

    set speed(value: number) {
        this.configure({ timeScale: value });
    }

    get alpha(): number {
        return this.entry === null ? this.lastAlpha : this.entry.alpha;
    }

    set alpha(value: number) {
        this.configure({ alpha: value });
    }

    get additive(): boolean {
        return this.adds;
    }

    get time(): number {
        return this.entry === null ? this.lastTime : this.entry.trackTime;
    }

    get finished(): Promise<void> {
        if (this.promise === null) {
            // made on first use: most handles are never awaited
            this.promise = this.settled
                ? Promise.resolve()
                : new Promise((resolve) => {
                      this.resolve = resolve;
                  });
        }

        return this.promise;
    }

    stop(options: Pick<StopOptions, 'mix'> = {}): void {
        if (this.entry !== null) this.owner.stop({ ...options, track: this.track });
    }

    configure(fields: TrackFields): void {
        if (this.entry === null) return;
        this.owner.engine.configure(this.entry, fields);
        // after the engine took the fields: what its entry does not show is remembered here
        const { animationStart, animationEnd, additive, mixBlend } = fields;

        if (typeof animationStart === 'number') this.start = animationStart;
        if (typeof animationEnd === 'number') this.end = animationEnd;
        if (typeof additive === 'boolean') this.adds = additive;
        if (mixBlend !== undefined) this.adds = mixBlend === 'add';
    }

    /** Resolves {@link finished}. */
    settle(): void {
        this.settled = true;
        this.resolve?.();
        this.resolve = null;
    }

    /**
     * Lets go of the entry at its `dispose` event and resolves {@link finished}. The handle keeps
     * the values the entry has now, because the engine may use the object for another entry.
     */
    release(): void {
        const entry = this.entry;

        if (entry === null) return;
        this.lastLoop = entry.loop;
        this.lastSpeed = entry.timeScale;
        this.lastAlpha = entry.alpha;
        this.lastTime = entry.trackTime;
        this.entry = null;
        this.settle();
    }

    /**
     * The official `getTrackComplete`: the track time at which the animation ends, or ends its
     * current loop.
     */
    trackComplete(): number {
        const time = this.time;
        const duration = this.end - this.start;

        if (duration !== 0) {
            if (this.loop) return duration * (1 + ((time / duration) | 0));
            if (time < duration) return duration;
        }

        return time;
    }
}
