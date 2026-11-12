import { LOCAL_STRIDE, type PoseState, WORLD_STRIDE } from '../state';
import { cacheOf, type UpdateCache } from './cache';
import { C_IK, C_PATH, C_TRANSFORM } from './constraints';
import { solveIk } from './ik';
import { COS_QUARTER, DEG_RAD, NORMAL, QUARTER, SIN_QUARTER } from './math';
import { solvePath } from './path';
import { solvePhysics } from './physics';
import { createPhysicsState, PHYSICS_UPDATE, setPhysicsToSetupPose } from './physics-state';
import type { Rig } from './rig';
import { solveTransform } from './transform';
import { updateBone } from './world';

/**
 * What one skeleton instance keeps for its constraints, next to its pose: the official applied
 * pose of the bones, the animated values of the constraints and the update order.
 */
export interface Solver {
    readonly rig: Rig;
    readonly pose: PoseState;
    /**
     * The official ax, ay, arotation, ascaleX, ascaleY, ashearX and ashearY of each bone, in the
     * layout of the local pose. An update starts them at the local pose. Constraints change them.
     * A skeleton without constraints has no array of its own here: this is its local pose, which
     * nothing but timelines writes then. A physics constraint leaves the applied pose of its bone
     * as it was when nothing in the update order reads it.
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
}

/** Makes the active skin of the pose the one the solver sorts for: the official `updateCache`. */
export function useSkin(solver: Solver): void {
    solver.cache = cacheOf(solver.rig, solver.pose.skin);
    solver.pose.active.set(solver.cache.boneActive);
}

/**
 * Sets every constraint to its setup values: the constraint part of the official
 * `setBonesToSetupPose`. The simulation of a physics constraint keeps its state.
 */
export function setConstraintsToSetupPose(solver: Solver): void {
    solver.values.set(solver.rig.plan.setup);
    setPhysicsToSetupPose(solver.rig.plan, solver.physics);
}

/** The constraint state of a new skeleton instance: setup values and the update order without a skin. */
export function createSolver(rig: Rig, pose: PoseState): Solver {
    const solver: Solver = {
        rig,
        pose,
        applied: rig.plan.constraints.length > 0 ? new Float64Array(rig.model.bones.count * LOCAL_STRIDE) : pose.local,
        values: Float64Array.from(rig.plan.setup),
        physics: createPhysicsState(rig.plan),
        mode: PHYSICS_UPDATE,
        cache: cacheOf(rig, pose.skin),
    };

    return solver;
}

/** True when the timelines of a constraint apply: the official `constraint.active`. */
export function constraintIsActive(solver: Solver, constraint: number): boolean {
    return solver.cache.constraintActive[constraint] === 1;
}

/** Solves the constraint at an index of the constraint list, by its kind. */
function solveConstraint(solver: Solver, index: number): void {
    const constraint = solver.rig.plan.constraints[index];

    if (constraint === undefined) return;
    if (constraint.kind === C_IK) solveIk(solver, constraint);
    else if (constraint.kind === C_TRANSFORM) solveTransform(solver, constraint);
    else if (constraint.kind === C_PATH) solvePath(solver, constraint);
    else solvePhysics(solver, constraint);
}

/**
 * The official `Skeleton.updateWorldTransform` with the physics mode of the solver. It starts the
 * applied pose of every bone at its local pose, then updates bones and solves constraints in the
 * order of the update cache. An inactive bone keeps the world transform it had.
 *
 * Inherit mode `normal` of a bone with a parent, which nearly every bone has, is computed in the
 * loop itself: the parent transform times the applied pose. As functions of their own its steps
 * are too long for V8 to inline. The cosine and the sine of a bone that is not turned are not
 * computed, as world.ts explains.
 */
export function updateWorldTransform(solver: Solver): void {
    const { pose, applied, rig } = solver;
    const { world, inherit } = pose;
    const entries = solver.cache.entries;
    const parents = rig.model.bones.parents;
    const v41 = rig.v41;

    if (applied !== pose.local) applied.set(pose.local);
    for (let i = 0, n = entries.length; i < n; i++) {
        const entry = Number(entries[i]);

        if (entry < 0) {
            solveConstraint(solver, -1 - entry);
            continue;
        }
        const parent = Number(parents[entry]);

        if (parent < 0 || inherit[entry] !== NORMAL) {
            updateBone(pose, applied, parents, entry, v41);
            continue;
        }
        const o = entry * LOCAL_STRIDE;
        const w = entry * WORLD_STRIDE;
        const p = parent * WORLD_STRIDE;
        const pa = Number(world[p]);
        const pb = Number(world[p + 1]);
        const pc = Number(world[p + 2]);
        const pd = Number(world[p + 3]);
        const x = Number(applied[o]);
        const y = Number(applied[o + 1]);
        const rotation = Number(applied[o + 2]);
        const scaleX = Number(applied[o + 3]);
        const scaleY = Number(applied[o + 4]);
        const rx = (rotation + Number(applied[o + 5])) * DEG_RAD;
        const ry = (rotation + 90 + Number(applied[o + 6])) * DEG_RAD;
        let cosX = 1;
        let sinX = rx;
        let cosY = COS_QUARTER;
        let sinY = SIN_QUARTER;

        if (rx !== 0) {
            cosX = Math.cos(rx);
            sinX = Math.sin(rx);
        }
        if (ry !== QUARTER) {
            cosY = Math.cos(ry);
            sinY = Math.sin(ry);
        }
        const la = cosX * scaleX;
        const lb = cosY * scaleY;
        const lc = sinX * scaleX;
        const ld = sinY * scaleY;

        world[w + 4] = pa * x + pb * y + Number(world[p + 4]);
        world[w + 5] = pc * x + pd * y + Number(world[p + 5]);
        world[w] = pa * la + pb * lc;
        world[w + 1] = pa * lb + pb * ld;
        world[w + 2] = pc * la + pd * lc;
        world[w + 3] = pc * lb + pd * ld;
    }
}
