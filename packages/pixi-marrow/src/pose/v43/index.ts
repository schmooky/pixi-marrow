import { MarrowError } from '../../base/errors';
import type { SkeletonModel } from '../../model/model';
import type { PoseEngine, PoseEvent, TrackEntry, TrackFields } from '../engine';
import { createPoseState, type PoseState } from '../state';
import { applyTracks } from './apply';
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
import { createPlayer, type Player43 } from './player';
import { prepareRig } from './rig';
import { setSkin, setupPoseBones, setupPoseSlots, updateActive } from './skeleton';
import type { Clip43, Pose43 } from './types';
import { updateTracks } from './update';
import { updateWorld } from './world';

const invalid = (message: string, fix: string): MarrowError => new MarrowError('invalid-data', message, { fix });

/** What `takeEvents` returns when nothing happened. Frozen, because every engine returns this one list. */
const NO_EVENTS: PoseEvent[] = [];

Object.freeze(NO_EVENTS);

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
    private readonly pose: Pose43;
    private readonly player: Player43;

    constructor(model: SkeletonModel) {
        const rig = prepareRig(model);

        this.state = createPoseState(model);
        this.pose = { rig, state: this.state };
        this.player = createPlayer(this.pose);
        // what a new official Skeleton holds: the setup pose, found through the default skin
        setupPoseBones(this.pose);
        setupPoseSlots(this.pose);
        updateActive(this.pose);
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

    update(dt: number): void {
        updateTracks(this.player, dt);
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
 * and `Skeleton`. It starts in the setup pose. Constraints are not applied. The timelines that
 * animate them change nothing, but they count when entries mix, as in the official runtime.
 *
 * @example
 * const engine = createEngine43(await importSkeleton(bytes));
 * engine.setAnimation(0, 0, true);
 * engine.update(1 / 60);
 */
export function createEngine43(model: SkeletonModel): PoseEngine {
    return new Engine43(model);
}
