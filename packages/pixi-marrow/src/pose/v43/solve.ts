import { LOCAL_STRIDE, WORLD_STRIDE } from '../state';
import { updateLocalTransform } from './bone-pose';
import { COS_QUARTER, DEG_RAD, NORMAL, QUARTER, SIN_QUARTER } from './math';
import { nextStamp, solveConstraint } from './solve-step';
import { poseChanged } from './solve-tight';
import type { Solve43 } from './solver-types';
import { keepLeaks, resetApplied } from './split';
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

/*
 * Two ways to run the update cache.
 *
 * The close way looks at what changes: it leaves out bones whose inputs stayed, and it compares
 * what it computes with what was there. Its stamps are tight. The look costs time for every bone
 * that is posed, which pays while most of the skeleton stays as it is.
 *
 * The plain way poses every bone and stamps every bone. It costs what an engine without stamps
 * costs. An update the close way counts the bones that changed. When they are more than one in
 * `BUSY_SHARE`, the next updates go the plain way: see `BUSY`. Then one goes the close way again.
 */

/**
 * How many updates in a row pose every bone without a look, once a large part of the skeleton
 * moves. The numbers are for the first time, the second time in a row, and from then on. One
 * update that moves everything, as a new place does, costs two such updates and not thirty.
 */
const BUSY = [2, 8, 30];

/** More than one bone in this many has to change in an update for the next ones to pose every bone. */
const BUSY_SHARE = 3;

/** The same for an update that follows updates the plain way: it takes less to stay than to start. */
const BUSY_STAY = 4;

/**
 * Ends the updates that pose every bone without a look. Nothing was noted in them, so the next
 * update poses every bone once more and compares.
 */
export function leaveBusy(solve: Solve43): void {
    solve.busy = 0;
    solve.force = true;
    solve.stale = true;
}

/**
 * Runs the update cache the plain way: every bone is posed. `stamp` is the mark of this update,
 * 0 when no constraint is active.
 *
 * The official `Inherit.Normal` of a bone with a parent, which nearly every bone has, is computed
 * in the loop itself. As a function of its own it is too long for V8 to inline.
 */
function poseAll(pose: Pose43, stamp: number): void {
    const { state, solve } = pose;
    const { cache, cacheLength, worldStamps, localStamps, inherit } = solve;
    const { world } = state;
    const { parents } = pose.rig.model.bones;
    // with no constraint active every active bone is in the cache once, after its parents, and reads its animated pose
    const plain = solve.solved === 0;
    const local = plain ? state.local : solve.local;

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
}

/** Gives every bone the pending version as its stamp. For a short list a loop beats a call to `fill`. */
function stampAll(boneStamps: Uint32Array, pending: number): void {
    if (boneStamps.length > 64) boneStamps.fill(pending);
    else for (let i = 0; i < boneStamps.length; i++) boneStamps[i] = pending;
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
 * The bones that changed get the pending version as their stamp. While a large part of the
 * skeleton moves, every bone gets it. When a stamp moved, the version of the pose state is the
 * pending one afterwards, and the function returns true. The pose counts as solved from here on:
 * `Solve43.dirty` is false until something changes what an update reads.
 */
export function updateWorld(pose: Pose43): boolean {
    const { state, solve } = pose;
    const { pending } = solve;
    let stamp = 0;
    let moved = true;

    solve.dirty = false;
    if (solve.split !== null) resetApplied(pose);
    if (solve.solved !== 0) {
        // the official reset cache, for every bone. A bone without a constrained pose reads its animated pose.
        stamp = nextStamp(pose);
        solve.local.set(state.local);
    }
    if (solve.busy > 0) {
        poseAll(pose, stamp);
        stampAll(state.boneStamps, pending);
        if (solve.busy === 1) leaveBusy(solve);
        else solve.busy--;
    } else {
        // bones that are stamped without a look, because `shown` is out of date, say nothing: with
        // them left out, an update that finds little moving decides nothing, and the next one looks again
        const blind = solve.stale ? solve.multiCount : 0;
        const changed = poseChanged(pose, stamp);

        solve.force = false;
        // once a large part moved, a smaller part is enough to stay on the plain way
        const share = solve.streak > 0 ? BUSY_STAY : BUSY_SHARE;

        if ((changed - blind) * share > state.boneStamps.length - blind) {
            solve.busy = BUSY[solve.streak] ?? 30;
            solve.streak++;
        } else if (blind === 0) solve.streak = 0;
        moved = changed > 0;
    }
    // a slider that wrote the animated pose leaves the next update something to do
    if (solve.split !== null && keepLeaks(pose)) solve.dirty = true;
    if (moved) state.version = pending;

    return moved;
}
