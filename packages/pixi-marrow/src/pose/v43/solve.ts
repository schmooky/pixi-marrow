import { LOCAL_STRIDE, WORLD_STRIDE } from '../state';
import { updateLocalTransform } from './bone-pose';
import { solveIk } from './ik';
import { COS_QUARTER, DEG_RAD, NORMAL, QUARTER, SIN_QUARTER } from './math';
import { solvePath } from './path';
import { solvePhysics } from './physics';
import { solveSlider } from './slider';
import { keepLeaks, resetApplied } from './split';
import { solveTransform } from './transform';
import type { Pose43 } from './types';
import { updateBoneWorld } from './world';

/*
 * How the code that an update runs handles numbers.
 *
 * A typed array is read in place, as `Number(array[i])`. A read past the end gives NaN, as
 * `undefined` does in the official arithmetic. Once V8 has optimized a function, `Number` on a
 * number costs nothing. A helper function for the read is not always inlined, and a call that
 * takes or returns a number that is not whole allocates. An update must not allocate.
 *
 * For the same reason the numbers of one solution stay in the variables of one function where
 * that is possible. Where functions have to share them, they go through a small array of the
 * module and not through arguments.
 */

/** Solves one constraint of the update cache. */
function solveConstraint(pose: Pose43, index: number): void {
    const plan = pose.rig.solver.plans[index];

    if (plan === undefined) return;
    switch (plan.type) {
        case 'ik':
            solveIk(pose, plan);
            break;
        case 'transform':
            solveTransform(pose, plan);
            break;
        case 'path':
            solvePath(pose, plan);
            break;
        case 'physics':
            solvePhysics(pose, plan);
            break;
        case 'slider':
            solveSlider(pose, plan);
            break;
    }
}

/**
 * The official `skeleton._update++`: a new number that marks what this update has done. The
 * marks are bytes, so the numbers run from 1 to 255. Before they start over every mark is cleared,
 * and no mark of an older update can pass for one of this update.
 */
function nextStamp(pose: Pose43): number {
    const { solve } = pose;

    if (solve.stamp === 255) {
        solve.worldStamps.fill(0);
        solve.localStamps.fill(0);
        solve.stamp = 0;
    }
    solve.stamp++;

    return solve.stamp;
}

/**
 * The official `Skeleton.updateWorldTransform`: resets every applied pose to the animated pose,
 * then runs the update cache. That computes the world transform of every active bone and solves
 * the active constraints, in the official order. Physics constraints run in the mode of
 * `Solve43.physicsMode`.
 *
 * `PoseState.world` holds the result. `PoseState.local` is not changed. A bone that is not active
 * keeps the world transform it had. `pose` is the animated pose of the engine.
 *
 * The official `Inherit.Normal` of a bone with a parent, which nearly every bone has, is computed
 * in the loop itself. As a function of its own it is too long for V8 to inline.
 */
export function updateWorld(pose: Pose43): void {
    const { state, solve } = pose;
    const { cache, cacheLength, worldStamps, localStamps, inherit } = solve;
    const { world } = state;
    const { parents } = pose.rig.model.bones;
    // with no constraint active every active bone is in the cache once, after its parents, and reads its animated pose
    const plain = solve.solved === 0;
    const local = plain ? state.local : solve.local;
    let stamp = 0;

    if (solve.split !== null) resetApplied(pose);
    if (!plain) {
        // the official reset cache, for every bone. A bone without a constrained pose reads its animated pose.
        stamp = nextStamp(pose);
        local.set(state.local);
    }
    for (let i = 0; i < cacheLength; i++) {
        const item = Number(cache[i]);

        if (!plain) {
            if (item < 0) {
                solveConstraint(pose, ~item);
                continue;
            }
            // the official BonePose.update: a world transform from this update stays
            if (worldStamps[item] === stamp) continue;
            // a bone that a constraint moved in the world gets its local numbers first
            if (localStamps[item] === stamp) updateLocalTransform(pose, item);
            else worldStamps[item] = stamp;
        }
        const parent = Number(parents[item]);
        const mode = Number(inherit[item]);

        if (parent < 0 || mode !== NORMAL) {
            updateBoneWorld(state, local, item, parent, mode);
            continue;
        }
        const p = parent * WORLD_STRIDE;
        const l = item * LOCAL_STRIDE;
        const o = item * WORLD_STRIDE;
        const pa = Number(world[p]);
        const pb = Number(world[p + 1]);
        const pc = Number(world[p + 2]);
        const pd = Number(world[p + 3]);
        const x = Number(local[l]);
        const y = Number(local[l + 1]);
        const rotation = Number(local[l + 2]);
        const scaleX = Number(local[l + 3]);
        const scaleY = Number(local[l + 4]);
        const rx = (rotation + Number(local[l + 5])) * DEG_RAD;
        const ry = (rotation + 90 + Number(local[l + 6])) * DEG_RAD;
        // a bone that is not turned needs no cosine and no sine: see world.ts
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

        world[o + 4] = pa * x + pb * y + Number(world[p + 4]);
        world[o + 5] = pc * x + pd * y + Number(world[p + 5]);
        world[o] = pa * la + pb * lc;
        world[o + 1] = pa * lb + pb * ld;
        world[o + 2] = pc * la + pd * lc;
        world[o + 3] = pc * lb + pd * ld;
    }
    if (solve.split !== null) keepLeaks(pose);
}
