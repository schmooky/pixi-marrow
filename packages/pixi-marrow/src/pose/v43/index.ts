import { MarrowError } from '../../base/errors';
import type { SkeletonModel } from '../../model/model';
import type { PhysicsMode, PoseEngine, PoseEvent, TrackEntry, TrackFields } from '../engine';
import type { PoseState } from '../state';
import { applyTracks } from './apply';
import { updateCache } from './cache';
import {
    addAnimation,
    addEmptyAnimation,
    clearTrack,
    clearTracks,
    mixKey,
    setAnimation,
    setEmptyAnimation,
} from './commands';
import { configureEntry } from './configure';
import { Entry } from './entry';
import { physicsRotate, physicsTranslate } from './physics';
import { createPlayer, type Player43 } from './player';
import { createPose, poseBytes } from './pose';
import { prepareRig } from './rig';
import { setSkin, setupPoseBones, setupPoseSlots } from './skeleton';
import { updateWorld } from './solve';
import type { Clip43, Pose43 } from './types';
import { updateTracks } from './update';

const invalid = (message: string, fix: string): MarrowError => new MarrowError('invalid-data', message, { fix });

/** What `takeEvents` returns when nothing happened. Frozen, because every engine returns this one list. */
const NO_EVENTS: PoseEvent[] = [];

Object.freeze(NO_EVENTS);

/** The official `Physics` values, by number. */
const PHYSICS_MODES: readonly PhysicsMode[] = ['none', 'reset', 'update', 'pose'];

/** A track index the official runtime accepts: a whole number from 0. */
function checkTrack(track: number): number {
    if (!Number.isInteger(track) || track < 0) {
        throw invalid(`${track} is not a track index.`, 'Pass a whole number from 0.');
    }

    return track;
}

/** The pose engine for Spine 4.3: the official `AnimationState` and `Skeleton` of one instance. */
class Engine43 implements PoseEngine {
    readonly state: PoseState;
    /** The animated pose: what the player and the setup pose calls write. */
    private readonly pose: Pose43;
    private readonly player: Player43;

    constructor(model: SkeletonModel) {
        this.pose = createPose(prepareRig(model));
        this.state = this.pose.state;
        this.player = createPlayer(this.pose);
        // what a new official Skeleton holds: the setup pose, found through the default skin
        setupPoseBones(this.pose);
        setupPoseSlots(this.pose);
        updateCache(this.pose);
    }

    get bytes(): number {
        return poseBytes(this.pose) + this.player.attachmentStates.byteLength;
    }

    get physics(): PhysicsMode {
        return PHYSICS_MODES[this.pose.solve.physicsMode] ?? 'update';
    }

    set physics(mode: PhysicsMode) {
        const number = PHYSICS_MODES.indexOf(mode);

        if (number < 0) {
            throw invalid(`"${mode}" is no physics mode.`, `Pass one of ${PHYSICS_MODES.join(', ')}.`);
        }
        this.pose.solve.physicsMode = number;
    }

    get timeScale(): number {
        return this.player.timeScale;
    }

    set timeScale(value: number) {
        this.player.timeScale = value;
    }

    get defaultMix(): number {
        return this.player.defaultMix;
    }

    set defaultMix(value: number) {
        this.player.defaultMix = value;
    }

    private clip(animation: number): Clip43 {
        const clip = this.pose.rig.clips[animation];

        if (clip === undefined) {
            const count = this.pose.rig.clips.length;

            throw invalid(
                `The skeleton has no animation ${animation}.`,
                count > 0
                    ? `Pass an index from 0 to ${count - 1}. For the empty animation call setEmptyAnimation.`
                    : 'The skeleton has no animations. For the empty animation call setEmptyAnimation.',
            );
        }

        return clip;
    }

    setMix(from: number, to: number, duration: number): void {
        this.player.mixes.set(mixKey(this.clip(from), this.clip(to)), duration);
    }

    setAnimation(track: number, animation: number, loop: boolean): TrackEntry {
        return setAnimation(this.player, checkTrack(track), this.clip(animation), loop);
    }

    addAnimation(track: number, animation: number, loop: boolean, delay: number): TrackEntry {
        return addAnimation(this.player, checkTrack(track), this.clip(animation), loop, delay);
    }

    setEmptyAnimation(track: number, mixDuration: number): TrackEntry {
        return setEmptyAnimation(this.player, checkTrack(track), mixDuration);
    }

    addEmptyAnimation(track: number, mixDuration: number, delay: number): TrackEntry {
        return addEmptyAnimation(this.player, checkTrack(track), mixDuration, delay);
    }

    configure(entry: TrackEntry, fields: TrackFields): void {
        if (!(entry instanceof Entry)) {
            throw invalid('The track entry is not from this pose engine.', 'Pass an entry that this engine returned.');
        }
        configureEntry(entry, fields);
    }

    clearTrack(track: number): void {
        clearTrack(this.player, checkTrack(track));
    }

    clearTracks(): void {
        clearTracks(this.player);
    }

    setSkin(skin: number): void {
        const count = this.state.model.skins.length;

        if (!Number.isInteger(skin) || skin < -1 || skin >= count) {
            throw invalid(`The skeleton has no skin ${skin}.`, `Pass an index below ${count}, or -1 for no skin.`);
        }
        setSkin(this.pose, skin);
    }

    setupPose(): void {
        setupPoseBones(this.pose);
        setupPoseSlots(this.pose);
    }

    setupPoseBones(): void {
        setupPoseBones(this.pose);
    }

    setupPoseSlots(): void {
        setupPoseSlots(this.pose);
    }

    physicsTranslate(x: number, y: number): void {
        physicsTranslate(this.pose, x, y);
    }

    physicsRotate(x: number, y: number, degrees: number): void {
        physicsRotate(this.pose, x, y, degrees);
    }

    update(dt: number): void {
        updateTracks(this.player, dt);
        // the official Skeleton.update
        this.state.time += dt;
        applyTracks(this.player);
        updateWorld(this.pose);
    }

    takeEvents(): PoseEvent[] {
        const events = this.player.listened;

        // nothing happened in most updates: no new list for those
        if (events.length === 0) return NO_EVENTS;
        this.player.listened = [];

        return events;
    }
}

/**
 * Creates the pose engine for Spine 4.3 skeletons: a port of the official 4.3 `AnimationState`
 * and `Skeleton`. It starts in the setup pose. Every constraint is solved: IK, transform, path
 * and physics constraints and sliders.
 *
 * What a slider animates has an applied pose of its own, as in the official runtime. For slots
 * and the draw order that is the pose in `PoseState`. It follows the animated pose in an update,
 * not in a setup pose call, and before the first update it is that of a new official skeleton.
 *
 * @example
 * const engine = createEngine43(await importSkeleton(bytes));
 * engine.setAnimation(0, 0, true);
 * engine.update(1 / 60);
 */
export function createEngine43(model: SkeletonModel): PoseEngine {
    return new Engine43(model);
}
