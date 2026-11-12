import { MarrowError } from '../../base/errors';
import type { SkeletonModel } from '../../model/model';
import type { PhysicsMode, PoseEngine, PoseEvent, TrackEntry, TrackFields } from '../engine';
import { createPoseState, type PoseState, poseStateBytes } from '../state';
import { applyTracks } from './apply';
import { configureEntry, LegacyEntry } from './entry';
import { updateWorldTransform } from './pass';
import { rotatePhysics, translatePhysics } from './physics-state';
import {
    addAnimation,
    addEmptyAnimation,
    clearTrack,
    clearTracks,
    LegacyPlayer,
    setAnimation,
    setEmptyAnimation,
    setMix,
} from './player';
import { clipOf, type Rig, rigOf } from './rig';
import { initPose, setBonesToSetupPose, setSkin, setSlotsToSetupPose } from './skeleton';
import { createSolver, type Solver, stirPhysics } from './solver';
import { closeStamps, openStamps } from './stamps';
import { updateTracks } from './update';

/** What `takeEvents` returns when nothing happened. Frozen, because every engine returns this one list. */
const NO_EVENTS: PoseEvent[] = [];

Object.freeze(NO_EVENTS);

/** The physics modes. The index of a mode is the number of the official `Physics` of that name. */
const PHYSICS_MODES: readonly PhysicsMode[] = ['none', 'reset', 'update', 'pose'];

/** The pose engine for 4.1 and 4.2: the official `AnimationState` and `Skeleton` of those versions in one object. */
class LegacyEngine implements PoseEngine {
    readonly state: PoseState;
    private readonly rig: Rig;
    private readonly solver: Solver;
    private readonly player: LegacyPlayer;
    private mode: PhysicsMode = 'update';
    /**
     * The version of the pose as this engine last left it. Another version means that someone else
     * wrote the pose. Only {@link begin} reads it and only {@link end} writes it, so that no call
     * of the engine can take a version over that it did not raise itself.
     */
    private seen: number;

    constructor(rig: Rig, pose: PoseState, solver: Solver) {
        this.rig = rig;
        this.state = pose;
        this.solver = solver;
        this.player = new LegacyPlayer(rig, pose, solver);
        this.seen = pose.version;
    }

    /**
     * Starts a call that can raise the version: an update, or a command that changes the pose.
     * It first looks whether someone else wrote the pose since the engine last left it. If so,
     * the next update applies the timelines and computes every world transform, whatever this
     * call and the calls after it do. That is noted here, before the call raises the version
     * itself, because afterwards the two raises cannot be told apart.
     */
    private begin(): void {
        if (this.state.version !== this.seen) {
            this.player.stirred = true;
            this.solver.all = true;
        }
        openStamps(this.state);
    }

    /** Ends a call that {@link begin} started: closes its stamps and keeps the version the engine leaves. */
    private end(): void {
        closeStamps(this.state);
        this.seen = this.state.version;
    }

    /** Ends a command that changed the pose: the next update applies the timelines again. */
    private changed(): void {
        this.end();
        this.player.stirred = true;
    }

    get bytes(): number {
        const { applied, values, physics, moved, noted, restless } = this.solver;
        // a skeleton without constraints has no applied pose of its own
        const own = applied === this.state.local ? 0 : applied.byteLength;
        const constraints = own + values.byteLength + physics.byteLength;
        // what an update needs to know which world transforms to compute
        const notes = moved.byteLength + noted.byteLength + restless.byteLength;

        return poseStateBytes(this.state) + constraints + notes + this.player.attachmentState.byteLength;
    }

    get physics(): PhysicsMode {
        return this.mode;
    }

    set physics(value: PhysicsMode) {
        const mode = PHYSICS_MODES.indexOf(value);

        if (mode < 0) {
            throw new MarrowError('invalid-data', `"${value}" is not a physics mode.`, {
                fix: `Set one of ${PHYSICS_MODES.join(', ')}.`,
            });
        }
        // every physics constraint runs anew in the new mode
        if (this.solver.mode !== mode) this.solver.all = true;
        this.mode = value;
        this.solver.mode = mode;
    }

    physicsTranslate(x: number, y: number): void {
        translatePhysics(this.solver.physics, x, y);
        stirPhysics(this.solver);
    }

    physicsRotate(x: number, y: number, degrees: number): void {
        rotatePhysics(this.solver.physics, x, y, degrees);
        stirPhysics(this.solver);
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

    setMix(from: number, to: number, duration: number): void {
        setMix(this.player, from, to, duration);
    }

    setAnimation(track: number, animation: number, loop: boolean): TrackEntry {
        return setAnimation(this.player, track, clipOf(this.rig, animation), loop);
    }

    addAnimation(track: number, animation: number, loop: boolean, delay: number): TrackEntry {
        return addAnimation(this.player, track, clipOf(this.rig, animation), loop, delay);
    }

    setEmptyAnimation(track: number, mixDuration: number): TrackEntry {
        return setEmptyAnimation(this.player, track, mixDuration);
    }

    addEmptyAnimation(track: number, mixDuration: number, delay: number): TrackEntry {
        return addEmptyAnimation(this.player, track, mixDuration, delay);
    }

    configure(entry: TrackEntry, fields: TrackFields): void {
        if (!(entry instanceof LegacyEntry)) {
            throw new MarrowError('invalid-data', 'The track entry was not made by a 4.1 or 4.2 pose engine.', {
                fix: 'Pass an entry that setAnimation or addAnimation of this engine returned.',
            });
        }
        configureEntry(entry, fields, this.rig.v41);
        this.player.stirred = true;
    }

    clearTrack(track: number): void {
        clearTrack(this.player, track);
    }

    clearTracks(): void {
        clearTracks(this.player);
    }

    setSkin(skin: number): void {
        this.begin();
        setSkin(this.rig, this.state, this.solver, skin);
        this.changed();
    }

    setupPose(): void {
        this.begin();
        setBonesToSetupPose(this.rig, this.state, this.solver);
        setSlotsToSetupPose(this.rig, this.state, this.solver);
        this.changed();
    }

    setupPoseBones(): void {
        this.begin();
        setBonesToSetupPose(this.rig, this.state, this.solver);
        this.changed();
    }

    setupPoseSlots(): void {
        this.begin();
        setSlotsToSetupPose(this.rig, this.state, this.solver);
        this.changed();
    }

    update(dt: number): void {
        const { state, player, solver } = this;

        this.begin();
        // a test asks for the whole update: nothing counts as known to be as it was
        if (!this.rig.skips) {
            player.stirred = true;
            solver.all = true;
        }
        updateTracks(player, dt);
        state.time += dt;
        // an entry started or ended: a skeleton that was busy may not be any more, so look soon
        if (player.stirred && solver.busy > 2) solver.busy = 2;
        applyTracks(player);
        updateWorldTransform(solver);
        this.end();
    }

    takeEvents(): PoseEvent[] {
        const events = this.player.events;

        // nothing happened in most updates: no new list for those
        if (events.length === 0) return NO_EVENTS;
        this.player.events = [];

        return events;
    }
}

/**
 * Creates the pose engine for a Spine 4.1 or 4.2 skeleton. It is a port of the official 4.2
 * runtime, with the 4.1 formulas where the two differ. The pose starts as the setup pose without a skin.
 *
 * IK, transform, path and physics constraints are solved as the official runtime solves them.
 * Spine 4.1 has no physics constraints.
 *
 * Throws a {@link MarrowError} for a constraint that points at a bone or a slot the model does not have.
 * It also throws for a physics constraint with a step of zero or less, which would never end an update.
 *
 * @example
 * const engine = createLegacyEngine(await importSkeleton(bytes));
 * engine.setAnimation(0, 0, true);
 * engine.update(1 / 60);
 */
export function createLegacyEngine(model: SkeletonModel): PoseEngine {
    const rig = rigOf(model);
    const pose = createPoseState(model);
    const solver = createSolver(rig, pose);

    openStamps(pose);
    initPose(rig, pose, solver);
    // a new state starts at version 1 with every stamp at 1
    pose.boneStamps.fill(pose.version);
    pose.slotStamps.fill(pose.version);
    pose.drawOrderStamp = pose.version;

    return new LegacyEngine(rig, pose, solver);
}
