import { LOCAL_STRIDE, type PoseState } from '../state';
import { cacheOf, type UpdateCache } from './cache';
import { createPhysicsState, PHYSICS_UPDATE, setPhysicsToSetupPose } from './physics-state';
import type { Rig } from './rig';
import { stampBone } from './stamps';

/**
 * What one skeleton instance keeps for its constraints and for its world transforms, next to its
 * pose. It is the official applied pose of the bones, the animated values of the constraints and
 * the update order. It also notes what changed since the world transforms were last computed.
 */
export interface Solver {
    readonly rig: Rig;
    readonly pose: PoseState;
    /**
     * The official ax, ay, arotation, ascaleX, ascaleY, ashearX and ashearY of each bone, in the
     * layout of the local pose. A bone starts them at its local pose when it is computed, and
     * constraints change them. A skeleton without constraints has no array of its own here: this
     * is its local pose, which nothing but timelines writes then. A physics constraint leaves the
     * applied pose of its bone as it was when nothing in the update order reads it.
     */
    readonly applied: Float64Array;
    /**
     * The animated values of each IK, transform and path constraint, `CONSTRAINT_STRIDE` numbers
     * each. Timelines change them.
     */
    readonly values: Float64Array;
    /**
     * The animated values and the simulation state of each physics constraint, `PHYSICS_STRIDE`
     * numbers each. It has no bytes for a skeleton without physics constraints.
     */
    readonly physics: Float64Array;
    /** How physics constraints run in an update: the number of the official `Physics`. */
    mode: number;
    /** The update cache of the active skin. */
    cache: UpdateCache;
    /**
     * What the timelines changed since the world transforms were last computed. The first place
     * is 1 when anything did. Then comes one place per bone: 1 when its local pose or its inherit
     * mode has other bits than before.
     */
    readonly moved: Uint8Array;
    /** Per constraint: 1 when a timeline changed its values since the world transforms were last computed. */
    readonly noted: Uint8Array;
    /**
     * Per group of the update cache: 1 when it has a physics constraint and its last run changed
     * one of its bones or left the constraint in motion. Such a group runs in the next update
     * whatever else happens.
     */
    restless: Uint8Array;
    /** How many groups are restless. */
    restlessCount: number;
    /** True when the next update computes every world transform: after a command that may change any of them. */
    all: boolean;
    /**
     * Above 1 while the skeleton is busy: most of its bones got a new stamp when it was last
     * looked at. Then an update computes everything without looking, and counts this down. At 1
     * the next update looks again.
     */
    busy: number;
    /** How many updates the skeleton was last left busy for. It doubles while a look finds it busy again. */
    busyFor: number;
    /**
     * True when the skeleton is busy because most of its entries run, while few of its bones
     * change. Then an update that computes everything stamps only the bones that changed.
     */
    compares: boolean;
    /**
     * How many passes that look for changes go by before the physics constraints are asked again
     * whether they are at rest. Until then a group whose physics constraint is not known to rest runs.
     */
    motion: number;
    /** How many passes the last wait of `motion` was. It doubles while a constraint that is asked is in motion. */
    motionFor: number;
    /** The position, the scale and the direction of the y axis the world transforms were last computed with. */
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    yDown: boolean;
}

/**
 * Makes the active skin of the pose the one the solver sorts for: the official `updateCache`.
 * Bones that become active or inactive are stamped. The stamps must be open.
 */
export function useSkin(solver: Solver): void {
    const cache = cacheOf(solver.rig, solver.pose.skin);
    const active = solver.pose.active;

    for (let bone = 0; bone < active.length; bone++) {
        if (active[bone] !== cache.boneActive[bone]) stampBone(solver.pose, bone);
    }
    active.set(cache.boneActive);
    solver.cache = cache;
    // the groups are those of the new update order
    solver.restless = new Uint8Array(cache.groups.count);
    solver.restlessCount = 0;
    solver.all = true;
}

/**
 * Sets every constraint to its setup values: the constraint part of the official
 * `setBonesToSetupPose`. The simulation of a physics constraint keeps its state.
 */
export function setConstraintsToSetupPose(solver: Solver): void {
    solver.values.set(solver.rig.plan.setup);
    setPhysicsToSetupPose(solver.rig.plan, solver.physics);
    solver.all = true;
}

/** Notes that the animated values or the state of a constraint changed, for the next world transforms. */
export function noteConstraint(solver: Solver, constraint: number): void {
    solver.noted[constraint] = 1;
    solver.moved[0] = 1;
}

/** The constraint state of a new skeleton instance: setup values and the update order without a skin. */
export function createSolver(rig: Rig, pose: PoseState): Solver {
    const bones = rig.model.bones.count;
    const cache = cacheOf(rig, pose.skin);

    return {
        rig,
        pose,
        applied: rig.plan.constraints.length > 0 ? new Float64Array(bones * LOCAL_STRIDE) : pose.local,
        values: Float64Array.from(rig.plan.setup),
        physics: createPhysicsState(rig.plan),
        mode: PHYSICS_UPDATE,
        cache,
        moved: new Uint8Array(bones + 1),
        noted: new Uint8Array(rig.plan.constraints.length),
        restless: new Uint8Array(cache.groups.count),
        restlessCount: 0,
        all: true,
        busy: 0,
        busyFor: 0,
        compares: false,
        motion: 0,
        motionFor: 0,
        x: pose.x,
        y: pose.y,
        scaleX: pose.scaleX,
        scaleY: pose.scaleY,
        yDown: pose.yDown,
    };
}

/** Makes every group with a physics constraint run in the next update: the state of the physics was changed from outside. */
export function stirPhysics(solver: Solver): void {
    const { physicsStart, count } = solver.cache.groups;

    for (let group = 0; group < count; group++) {
        if (physicsStart[group] === physicsStart[group + 1] || solver.restless[group] !== 0) continue;
        solver.restless[group] = 1;
        solver.restlessCount++;
    }
}

/** True when the timelines of a constraint apply: the official `constraint.active`. */
export function constraintIsActive(solver: Solver, constraint: number): boolean {
    return solver.cache.constraintActive[constraint] === 1;
}
