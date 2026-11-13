import { MarrowError } from '../../base/errors';
import type { AttachmentData } from '../../model/attachments';
import type { SkeletonModel } from '../../model/model';
import type { PhysicsMode, PoseEngine, PoseEvent, PoseSource, SlotPose, TrackEntry, TrackFields } from '../engine';
import { changeSkin, combineSkins } from '../shared/combine-skins';
import { checkDark, checkSlot } from '../shared/slot-writes';
import { nextVersion, type PoseState } from '../state';
import { advanceTracks, holdsSetup, poseBehind, soloEntry } from './advance';
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
import { SHARED, TIME } from './curves';
import { Entry } from './entry';
import { physicsRotate, physicsTranslate } from './physics';
import { createPlayer, type Player43 } from './player';
import { createPose, poseBytes } from './pose';
import { distrust, solvePose } from './rest';
import { prepareRig } from './rig';
import {
    setSkin,
    setupPoseBones,
    setupPoseSlots,
    writeSlotAttachment,
    writeSlotColor,
    writeSlotDark,
} from './skeleton';
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
    source: PoseSource | null = null;
    /**
     * The animation that {@link advance} left the animated pose of the bones behind, or null.
     * Its time is in {@link behindTime}.
     */
    private behind: Clip43 | null = null;
    private behindTime = 0;
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
        this.pose.solve.seen = this.state.version;
    }

    /**
     * Starts a call that can change the pose: a change gets the version after the current one.
     * A version this engine did not leave means that other code wrote the pose state. Then
     * nothing is known about it, and the next update applies and computes everything.
     */
    private open(): void {
        const { solve } = this.pose;

        if (this.state.version !== solve.seen) distrust(this.pose);
        solve.pending = nextVersion(this.state.version);
    }

    /** Ends a call that can change the pose. */
    private close(): void {
        this.pose.solve.seen = this.state.version;
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
        if (number !== this.pose.solve.physicsMode) this.pose.solve.dirty = true;
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
        this.catchUp();
        configureEntry(entry, fields);
    }

    clearTrack(track: number): void {
        const index = checkTrack(track);

        this.catchUp();
        clearTrack(this.player, index);
    }

    clearTracks(): void {
        this.catchUp();
        clearTracks(this.player);
    }

    setSkin(skin: number): void {
        const { lookup } = this.pose.rig;
        const count = lookup.skinCount;

        if (!Number.isInteger(skin) || skin < -1 || skin >= count || (skin >= 0 && lookup.skin(skin) === undefined)) {
            throw invalid(`The skeleton has no skin ${skin}.`, `Pass an index below ${count}, or -1 for no skin.`);
        }
        const before = this.state.skin;

        this.open();
        setSkin(this.pose, skin);
        this.close();
        changeSkin(this.pose.rig.lookup, this.state.model, before, this.state.skin);
    }

    setSkins(skins: readonly number[]): void {
        this.setSkin(combineSkins(this.pose.rig.lookup, this.state.model, skins));
    }

    get skins(): readonly number[] {
        return this.pose.rig.lookup.parts(this.state.skin);
    }

    get slotPose(): SlotPose {
        return this.pose;
    }

    setAttachment(slot: number, attachment: AttachmentData | null): void {
        checkSlot(this.state.model, slot);
        this.open();
        writeSlotAttachment(this.pose, slot, attachment);
        this.close();
    }

    setColor(slot: number, r: number, g: number, b: number, a: number): void {
        checkSlot(this.state.model, slot);
        this.open();
        writeSlotColor(this.pose, slot, r, g, b, a);
        this.close();
    }

    setDarkColor(slot: number, r: number, g: number, b: number): void {
        checkSlot(this.state.model, slot);
        checkDark(this.state.model, slot);
        this.open();
        writeSlotDark(this.pose, slot, r, g, b);
        this.close();
    }

    setupPose(): void {
        this.behind = null;
        this.open();
        setupPoseBones(this.pose);
        setupPoseSlots(this.pose);
        this.close();
    }

    setupPoseBones(): void {
        this.behind = null;
        setupPoseBones(this.pose);
    }

    setupPoseSlots(): void {
        this.open();
        setupPoseSlots(this.pose);
        this.close();
    }

    physicsTranslate(x: number, y: number): void {
        physicsTranslate(this.pose, x, y);
        this.pose.solve.dirty = true;
    }

    physicsRotate(x: number, y: number, degrees: number): void {
        physicsRotate(this.pose, x, y, degrees);
        this.pose.solve.dirty = true;
    }

    update(dt: number): void {
        if (this.source?.update(dt) === true) return;
        this.updateNow(dt);
        this.source?.posed();
    }

    solo(): TrackEntry | null {
        return soloEntry(this.player);
    }

    advance(dt: number, time?: Float64Array): void {
        this.open();
        this.behind = advanceTracks(this.player, dt);
        this.behindTime = Number(SHARED[TIME]);
        if (time !== undefined) time[0] = Number(SHARED[TIME]);
        // the official Skeleton.update
        this.state.time += dt;
        this.close();
    }

    holdsSetup(animation: number, bones?: Uint8Array): boolean {
        return holdsSetup(this.pose, this.clip(animation), bones);
    }

    /**
     * Brings the animated pose of the bones and the constraints to the time {@link advance} left
     * it behind. A baked frame wrote the slots and the world transforms, not these. A command
     * whose result depends on them calls it first: one that clears a track keeps the pose, and a
     * change of alpha mixes from it. A track change that mixes does not need it, because the
     * entry it mixes from writes those values from the setup pose.
     */
    private catchUp(): void {
        if (this.behind === null) return;
        poseBehind(this.pose, this.behind, this.behindTime);
        this.behind = null;
    }

    /** The update without a source: the official `AnimationState.update` and `apply`, then `Skeleton.update` and the world transforms. */
    private updateNow(dt: number): void {
        this.behind = null;
        this.open();
        updateTracks(this.player, dt);
        // the official Skeleton.update
        this.state.time += dt;
        applyTracks(this.player);
        solvePose(this.pose);
        this.close();
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
