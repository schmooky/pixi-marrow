import { MarrowError } from '../base/errors';
import type { SkeletonModel } from '../model/model';
import type { EventKey } from '../model/timelines';
import type { PoseState } from './state';

/** What a pose engine reports while it plays. The names are those of the official listener. */
export type PoseEventType = 'start' | 'interrupt' | 'end' | 'dispose' | 'complete' | 'event';

/** One thing that happened to a track entry during an update. */
export interface PoseEvent {
    type: PoseEventType;
    /** The track index of the entry. */
    track: number;
    /** The index of the entry's animation in the model, or -1 for the empty animation. */
    animation: number;
    /** For `event`: the key that fired. */
    key?: EventKey;
}

/**
 * A playing or queued animation on a track. The fields mirror the official `TrackEntry` and are
 * read-only here. Change them with {@link PoseEngine.configure}.
 */
export interface TrackEntry {
    readonly trackIndex: number;
    /** The index of the animation in the model, or -1 for the empty animation. */
    readonly animation: number;
    readonly loop: boolean;
    readonly delay: number;
    readonly trackTime: number;
    readonly trackEnd: number;
    readonly timeScale: number;
    readonly alpha: number;
    readonly mixTime: number;
    readonly mixDuration: number;
    readonly reverse: boolean;
    readonly shortestRotation: boolean;
}

/**
 * A field of a track entry that {@link PoseEngine.configure} can set. Each is the official
 * `TrackEntry` field of that name. Some exist in some Spine versions only.
 */
export type TrackField =
    | 'loop'
    | 'delay'
    | 'trackTime'
    | 'trackEnd'
    | 'timeScale'
    | 'alpha'
    | 'mixTime'
    | 'mixDuration'
    | 'reverse'
    | 'shortestRotation'
    | 'eventThreshold'
    | 'animationStart'
    | 'animationEnd'
    | 'animationLast'
    | 'holdPrevious'
    | 'mixBlend'
    | 'attachmentThreshold'
    | 'drawOrderThreshold'
    | 'mixAttachmentThreshold'
    | 'alphaAttachmentThreshold'
    | 'mixDrawOrderThreshold'
    | 'additive'
    | 'keepHold';

/** Values for {@link PoseEngine.configure}. */
export type TrackFields = Partial<Record<TrackField, number | boolean | string>>;

/**
 * Plays animations on one skeleton instance and keeps its pose in {@link PoseState}.
 *
 * The methods mirror the official `AnimationState` and `Skeleton`, so the same calls on this
 * engine and on the official runtime give the same pose.
 */
export interface PoseEngine {
    readonly state: PoseState;
    /** Multiplies the time every track advances by. */
    timeScale: number;
    /** The mix duration between two animations that have none set with {@link setMix}. */
    defaultMix: number;
    /** Sets the mix duration when animation `from` changes to animation `to`. Both are model indices. */
    setMix(from: number, to: number, duration: number): void;
    /** Plays an animation on a track now, replacing what the track holds. */
    setAnimation(track: number, animation: number, loop: boolean): TrackEntry;
    /** Queues an animation after what the track holds. `delay` is as in the official `addAnimation`. */
    addAnimation(track: number, animation: number, loop: boolean, delay: number): TrackEntry;
    /** Mixes a track out to nothing over `mixDuration` seconds. */
    setEmptyAnimation(track: number, mixDuration: number): TrackEntry;
    /** Queues mixing a track out to nothing. */
    addEmptyAnimation(track: number, mixDuration: number, delay: number): TrackEntry;
    /** Sets fields of a track entry. A field this Spine version does not have throws a `MarrowError`. */
    configure(entry: TrackEntry, fields: TrackFields): void;
    /** Removes what a track holds, without mixing out. The pose keeps what the track did to it. */
    clearTrack(track: number): void;
    clearTracks(): void;
    /** Makes a skin active, as the official `setSkin` does. -1 for none. */
    setSkin(skin: number): void;
    /** Resets bones and slots to the setup pose. */
    setupPose(): void;
    setupPoseBones(): void;
    setupPoseSlots(): void;
    /**
     * Advances every track by `dt` seconds, applies the animations to the pose, then computes the
     * world transforms.
     */
    update(dt: number): void;
    /** What happened since the last call, in the order the official listener is called. */
    takeEvents(): PoseEvent[];
}

/** Options for {@link createPoseEngine}. */
export interface PoseEngineOptions {
    /**
     * What to do with a skeleton that has constraints, which this milestone cannot solve.
     * `error` (the default) throws. `ignore` plays the skeleton without them: constraints are not
     * applied and timelines that animate constraints are skipped.
     */
    constraints?: 'error' | 'ignore';
}

/**
 * Creates a pose engine for a model. The engine for the model's Spine version is loaded on demand:
 * 4.1 and 4.2 share one, 4.3 has its own, because the official runtimes mix animations differently.
 *
 * Throws a {@link MarrowError} for a skeleton with constraints, unless `constraints` is `ignore`.
 *
 * @example
 * const engine = await createPoseEngine(await importSkeleton(bytes));
 * engine.setAnimation(0, 0, true);
 * engine.update(1 / 60);
 * console.log(engine.state.world.subarray(0, 6));
 */
export async function createPoseEngine(model: SkeletonModel, options: PoseEngineOptions = {}): Promise<PoseEngine> {
    if (model.constraints.length > 0 && options.constraints !== 'ignore') {
        const types = [...new Set(model.constraints.map((constraint) => constraint.type))];

        throw new MarrowError('unsupported-feature', `The skeleton has ${types.join(', ')} constraints.`, {
            fix: 'Constraints arrive with milestone M3. Until then pass { constraints: "ignore" } to play without them.',
        });
    }
    if (model.version === '4.3') return (await import('./v43/index')).createEngine43(model);

    return (await import('./legacy/index')).createLegacyEngine(model);
}
