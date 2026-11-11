import type { TrackEntry } from '../engine';
import type { Clip43 } from './types';

const NO_MODES = new Uint8Array(0);
const NO_ROTATIONS = new Float64Array(0);

/**
 * A playing or queued animation on a track: the official `TrackEntry`, field for field. The
 * player takes entries from a pool and gives them back when they end, like the official runtime,
 * so an entry must not be used after its `dispose` event.
 */
export class Entry implements TrackEntry {
    /** The animation that is played. The empty animation while the entry is in the pool. */
    clip: Clip43;
    animation = -1;
    previous: Entry | null = null;
    next: Entry | null = null;
    mixingFrom: Entry | null = null;
    mixingTo: Entry | null = null;
    trackIndex = 0;
    loop = false;
    additive = false;
    reverse = false;
    shortestRotation = false;
    keepHold = false;
    eventThreshold = 0;
    mixAttachmentThreshold = 0;
    alphaAttachmentThreshold = 0;
    mixDrawOrderThreshold = 0;
    animationStart = 0;
    animationEnd = 0;
    animationLast = 0;
    nextAnimationLast = 0;
    delay = 0;
    trackTime = 0;
    trackLast = 0;
    nextTrackLast = 0;
    trackEnd = 0;
    timeScale = 0;
    alpha = 0;
    mixTime = 0;
    mixDuration = 0;
    totalAlpha = 0;
    /** The official `timelineMode`: per timeline the `MixFrom` bits and the hold bit. */
    modes: Uint8Array = NO_MODES;
    /** How many numbers of `modes` are in use: the official `timelineMode.length`. */
    modeCount = 0;
    /** The official `timelineHoldMix`: per timeline the entry whose mix fades its hold out, or null. */
    readonly holdMix: (Entry | null)[] = [];
    /** The official `timelinesRotation`: per timeline the total rotation and the last difference. */
    rotations: Float64Array = NO_ROTATIONS;
    /** How many numbers of `rotations` are in use: the official `timelinesRotation.length`. */
    rotationCount = 0;
    private readonly empty: Clip43;

    constructor(empty: Clip43) {
        this.empty = empty;
        this.clip = empty;
    }

    /** The official `reset`: drops the links to other entries and the per timeline state. */
    reset(): void {
        this.next = null;
        this.previous = null;
        this.mixingFrom = null;
        this.mixingTo = null;
        this.clip = this.empty;
        this.animation = -1;
        this.modeCount = 0;
        this.holdMix.length = 0;
        this.rotationCount = 0;
    }

    /** The official `mix`: how far the mix from the previous entry is, from 0 to 1. */
    mix(): number {
        if (this.mixDuration === 0) return 1;
        const mix = this.mixTime / this.mixDuration;

        return mix >= 1 ? 1 : mix;
    }

    /** The official `getAnimationTime`: the track time as a time between the start and the end of the animation. */
    getAnimationTime(): number {
        if (!this.loop) return Math.min(this.trackTime + this.animationStart, this.animationEnd);
        const duration = this.animationEnd - this.animationStart;

        if (duration === 0) return this.animationStart;

        return (this.trackTime % duration) + this.animationStart;
    }

    /** The official `getTrackComplete`: the track time at which the animation ends, or ends its current loop. */
    getTrackComplete(): number {
        const duration = this.animationEnd - this.animationStart;

        if (duration !== 0) {
            if (this.loop) return duration * (1 + ((this.trackTime / duration) | 0));
            if (this.trackTime < duration) return duration;
        }

        return this.trackTime;
    }

    /**
     * Makes room for the modes of `count` timelines. A mode that comes into use is 0, as a missing
     * entry of the official array counts.
     */
    sizeModes(count: number): Uint8Array {
        if (this.modes.length < count) {
            const modes = new Uint8Array(count);

            modes.set(this.modes.subarray(0, this.modeCount));
            this.modes = modes;
        }
        if (count > this.modeCount) this.modes.fill(0, this.modeCount, count);
        this.modeCount = count;

        return this.modes;
    }

    /**
     * Makes room for `count` rotation numbers. They start as NaN, which stands for the `undefined`
     * of a new official array.
     */
    sizeRotations(count: number): void {
        if (this.rotations.length < count) this.rotations = new Float64Array(count);
        this.rotations.fill(Number.NaN, 0, count);
        this.rotationCount = count;
    }
}
