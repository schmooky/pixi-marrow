import { MarrowError } from '../../base/errors';
import type { SkeletonModel } from '../../model/model';
import type { PhysicsMode, PoseEngine, PoseEvent, TrackEntry, TrackFields } from '../engine';
import { createPoseState, type PoseState, poseStateBytes } from '../state';
import { applyTracks } from './apply';
import { configureEntry, LegacyEntry } from './entry';
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
import { createSolver, type Solver, updateWorldTransform } from './solver';
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

    constructor(rig: Rig, pose: PoseState, solver: Solver) {
        this.rig = rig;
        this.state = pose;
        this.solver = solver;
        this.player = new LegacyPlayer(rig, pose, solver);
    }

    get bytes(): number {
        const { applied, values, physics } = this.solver;
        // a skeleton without constraints has no applied pose of its own
        const own = applied === this.state.local ? 0 : applied.byteLength;
        const constraints = own + values.byteLength + physics.byteLength;

        return poseStateBytes(this.state) + constraints + this.player.attachmentState.byteLength;
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
        this.mode = value;
        this.solver.mode = mode;
    }

    physicsTranslate(x: number, y: number): void {
        translatePhysics(this.solver.physics, x, y);
    }

    physicsRotate(x: number, y: number, degrees: number): void {
        rotatePhysics(this.solver.physics, x, y, degrees);
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
    }

    clearTrack(track: number): void {
        clearTrack(this.player, track);
    }

    clearTracks(): void {
        clearTracks(this.player);
    }

    setSkin(skin: number): void {
        setSkin(this.rig, this.state, this.solver, skin);
    }

    setupPose(): void {
        setBonesToSetupPose(this.rig, this.state, this.solver);
        setSlotsToSetupPose(this.rig, this.state);
    }

    setupPoseBones(): void {
        setBonesToSetupPose(this.rig, this.state, this.solver);
    }

    setupPoseSlots(): void {
        setSlotsToSetupPose(this.rig, this.state);
    }

    update(dt: number): void {
        updateTracks(this.player, dt);
        this.state.time += dt;
        applyTracks(this.player);
        updateWorldTransform(this.solver);
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

    initPose(rig, pose, solver);

    return new LegacyEngine(rig, pose, solver);
}
