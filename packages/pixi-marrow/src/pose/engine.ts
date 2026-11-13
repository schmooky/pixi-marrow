import type { AttachmentData } from '../model/attachments';
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
    /**
     * The entry the event is about. After its `dispose` event an engine may reuse the object for a
     * later entry, so map it to your own data when the event arrives.
     */
    entry: TrackEntry;
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
 * How physics constraints run in an update. The names are those of the official `Physics`.
 *
 * - `none` leaves physics out: the bones keep the pose the animations and other constraints gave.
 * - `reset` puts the physics back to that pose, then runs it.
 * - `update` runs the physics with the time that passed and moves the bones.
 * - `pose` moves the bones to where the physics is, and does not advance it.
 */
export type PhysicsMode = 'none' | 'reset' | 'update' | 'pose';

/**
 * Plays animations on one skeleton instance and keeps its pose in {@link PoseState}.
 *
 * The methods mirror the official `AnimationState` and `Skeleton`, so the same calls on this
 * engine and on the official runtime give the same pose.
 */
export interface PoseEngine {
    readonly state: PoseState;
    /**
     * The bytes of typed arrays this instance holds: its pose state, the values of its constraints
     * and the poses they work on. Track entries are objects and are not counted.
     */
    readonly bytes: number;
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
    /**
     * Makes a skin active, as the official `setSkin` does. -1 for none. The index can also be one
     * that {@link setSkins} made for several skins.
     */
    setSkin(skin: number): void;
    /**
     * Makes several skins of the model active as one. That is what the official runtime does with
     * an empty skin that `Skin.addSkin` filled with each of them, in order, and then `setSkin`.
     * Where two skins hold an attachment under one slot and name, the later one wins. A list of
     * one is {@link setSkin} with that skin, an empty list is no skin.
     *
     * Every instance of a model shares the combined skin of a list, so the same list costs no
     * memory a second time.
     */
    setSkins(skins: readonly number[]): void;
    /** The skins of the model that are active, in the order they were given. Empty for none. */
    readonly skins: readonly number[];
    /**
     * The pose of the slots that {@link setAttachment}, {@link setColor} and {@link setDarkColor}
     * write. It holds the arrays of {@link state}, except in 4.3 for an engine whose sliders pose
     * slots. There it is the animated pose, and the pose state holds what the sliders make of it.
     */
    readonly slotPose: SlotPose;
    /**
     * Shows an attachment in a slot, or nothing: the official `Slot.setAttachment`. A changed
     * attachment resets the sequence index. The deform stays only when the old and the new
     * attachment share their timeline attachment. The attachment stays until an attachment
     * timeline keys the slot, or the setup pose of the slots is set. The attachment the slot
     * shows already changes nothing, so a write in every frame lets the skeleton rest.
     */
    setAttachment(slot: number, attachment: AttachmentData | null): void;
    /**
     * Sets the color of a slot, each part from 0 to 1: the official `slot.color.set`. In 4.3 it
     * is the color of the slot's pose. It stays until a color timeline keys the slot. The color
     * the slot has already changes nothing, so a write in every frame lets the skeleton rest.
     */
    setColor(slot: number, r: number, g: number, b: number, a: number): void;
    /**
     * Sets the dark color of a slot, each part from 0 to 1: the official `slot.darkColor.set`.
     * Throws a `MarrowError` for a slot without a dark color, where the official one is null.
     */
    setDarkColor(slot: number, r: number, g: number, b: number): void;
    /** Resets bones and slots to the setup pose. */
    setupPose(): void;
    setupPoseBones(): void;
    setupPoseSlots(): void;
    /**
     * How physics constraints run in {@link update}. Default `update`. The mode stays until it is
     * set again, so set `reset` for one update only. Spine 4.1 has no physics: there it changes nothing.
     */
    physics: PhysicsMode;
    /**
     * Tells the physics constraints that the skeleton moved by `x`, `y` in the space of its
     * parent, so that they lag behind: the official `Skeleton.physicsTranslate`.
     */
    physicsTranslate(x: number, y: number): void;
    /**
     * Tells the physics constraints that the skeleton turned by `degrees` around `x`, `y`: the
     * official `Skeleton.physicsRotate`.
     */
    physicsRotate(x: number, y: number, degrees: number): void;
    /**
     * Advances every track and the skeleton time by `dt` seconds, applies the animations to the
     * pose, then solves the constraints and computes the world transforms.
     */
    update(dt: number): void;
    /** What happened since the last call, in the order the official listener is called. */
    takeEvents(): PoseEvent[];
}

/**
 * The slots as a write reaches them: the official `slot.pose` in 4.3, the slots themselves
 * before. Read it to change one part of a value, such as the alpha of a color.
 */
export interface SlotPose {
    /** r, g, b, a per slot. */
    readonly colors: Float64Array;
    /** r, g, b per slot. Meaningful where the model's `hasDark` is 1. */
    readonly darkColors: Float64Array;
    readonly attachments: readonly (AttachmentData | null)[];
}

/** Creates one more pose engine for the model it was loaded for. Synchronous. */
export type PoseEngineFactory = () => PoseEngine;

/**
 * Loads the pose engine code for a model's Spine version and returns a factory that creates
 * engines for that model without waiting. Use it when instances are created synchronously.
 *
 * @example
 * const createEngine = await loadPoseEngine(model);
 * const first = createEngine();
 * const second = createEngine();
 */
export async function loadPoseEngine(model: SkeletonModel): Promise<PoseEngineFactory> {
    if (model.version === '4.3') {
        const { createEngine43 } = await import('./v43/index');

        return () => createEngine43(model);
    }
    const { createLegacyEngine } = await import('./legacy/index');

    return () => createLegacyEngine(model);
}

/**
 * Creates a pose engine for a model. The engine for the model's Spine version is loaded on demand:
 * 4.1 and 4.2 share one, 4.3 has its own, because the official runtimes mix animations differently.
 *
 * Every constraint of the three versions is solved: IK, transform, path, physics and sliders.
 *
 * @example
 * const engine = await createPoseEngine(await importSkeleton(bytes));
 * engine.setAnimation(0, 0, true);
 * engine.update(1 / 60);
 * console.log(engine.state.world.subarray(0, 6));
 */
export async function createPoseEngine(model: SkeletonModel): Promise<PoseEngine> {
    return (await loadPoseEngine(model))();
}
