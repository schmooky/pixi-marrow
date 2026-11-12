import { LOCAL_STRIDE, type PoseState, WORLD_STRIDE } from '../state';
import { C_IK, C_PATH, C_PHYSICS, C_TRANSFORM, type LegacyConstraint } from './constraints';
import { SHARED, STAMP, STAMPED } from './curves';
import { solveIk } from './ik';
import { COS_QUARTER, DEG_RAD, NORMAL, QUARTER, SIN_QUARTER } from './math';
import { solvePath } from './path';
import { solvePhysics } from './physics';
import { physicsStays, restEveryPhysics, restPhysics, watchPhysics } from './physics-rest';
import type { Solver } from './solver';
import { solveTransform } from './transform';
import { updateBone } from './world';

/*
 * The official `Skeleton.updateWorldTransform`, in two ways that give the same world transforms.
 *
 * `poseAll` runs every entry of the update cache, as the official code does, and stamps every
 * bone. It is the way after a call that may have changed anything, and the way for a skeleton
 * that is busy: when three of four bones move in every update, looking for those that do not
 * costs more than computing them. It can also compare the world transforms it computes with
 * those before, and stamp only the bones that changed: the way for a skeleton whose physics keeps
 * nearly every entry running while few bones move.
 *
 * `poseChanges` runs only what changed since the last update. A world transform that it leaves as
 * it is would come out with the same bits. A free bone is computed when its own pose changed or
 * its parent got a new stamp in this update. A group of entries, as groups.ts sorts them, runs as
 * a whole when something it reads from outside changed. A group that starts late first runs the
 * entries it has passed: they read nothing that changed, so they give what they gave in the
 * update before, which is what the later entries of the group have to start from.
 *
 * There a free bone that is computed gets a new stamp, and so do the bones of a group that runs.
 * A group with a physics constraint is the exception. It also runs while its last run changed one
 * of its bones or left the constraint in motion, so it can run without a change: a bone of it
 * gets a new stamp when its world transform differs from the one it had before the group ran.
 */

/** A skeleton is busy when this many of `BUSY_OF` bones got a new stamp in an update. */
const BUSY_MOVES = 3;
const BUSY_OF = 4;
/** Nearly every entry ran when this many of `RUN_OF` did. Below that, leaving out the others pays for the looking. */
const RUN_MOST = 15;
const RUN_OF = 16;
/** The longest a busy skeleton goes on before it is looked at again, in updates. */
const LONGEST_BUSY = 64;
/** The longest a skeleton goes on before its physics constraints are asked again whether they rest, in passes. */
const LONGEST_MOTION = 64;

/** Scratch of a pass: the world transforms before it, of the bones that are compared after it. */
let saved = new Float64Array(0);
/** Scratch, per group: the number of the last pass in which the group ran. */
let ran = new Uint32Array(0);
/** Scratch of a pass, per group that runs: 1 when the run changed a bone or left a physics constraint in motion. */
let changed = new Uint8Array(0);
/** The number of the running pass. Every pass of every skeleton has its own, so `ran` needs no clearing. */
let passId = 0;
/** Scratch of a pass: how many bones of groups got a new stamp. */
let settledAnew = 0;
/** Scratch of a pass: how many entries ran, without those of groups that the pass found at rest. */
let worked = 0;
/** Scratch: where a pass that compares world transforms writes the stamps of the bones it computes, to no effect. */
let unused = new Uint32Array(0);
/** Scratch of a pass: true when it asks physics constraints whether they are at rest. */
let asking = false;
/** Scratch of a pass: true when a physics constraint that was asked is not at rest. */
let inMotion = false;

/** Makes the scratch arrays long enough for a skeleton. They grow when a larger skeleton is first updated. */
function makeRoom(bones: number, groups: number): void {
    if (saved.length < bones * WORLD_STRIDE) {
        saved = new Float64Array(bones * WORLD_STRIDE);
        unused = new Uint32Array(bones);
    }
    if (ran.length < groups) {
        ran = new Uint32Array(groups);
        changed = new Uint8Array(groups);
    }
}

/** True when the world transform at `w` has the bits that were saved before the pass. */
function kept(world: Float64Array, w: number): boolean {
    for (let c = w; c < w + WORLD_STRIDE; c++) {
        const now = Number(world[c]);
        const before = Number(saved[c]);

        if (now !== before || (now === 0 && 1 / now !== 1 / before)) return false;
    }

    return true;
}

/** True when what the entry at cache position `i` reads has changed in this update. `stamp` is the version of the update. */
function entryNeeds(solver: Solver, i: number, entry: number, stamp: number): boolean {
    const { pose, moved, noted, rig } = solver;
    const { boneStamps } = pose;
    const { readStart, reads } = solver.cache.groups;

    if (entry >= 0) {
        const parent = Number(rig.model.bones.parents[entry]);

        return moved[entry + 1] !== 0 || (parent >= 0 && boneStamps[parent] === stamp);
    }
    const constraint = rig.plan.constraints[-1 - entry];

    if (constraint === undefined || noted[constraint.index] !== 0) return true;
    // a bone that is read has a new stamp when its world transform or, for a free bone, its pose changed
    for (let r = Number(readStart[i]), n = Number(readStart[i + 1]); r < n; r++) {
        if (boneStamps[Number(reads[r])] === stamp) return true;
    }

    // a path lies in a slot: its attachment and its deform are stamped there
    return constraint.kind === C_PATH && pose.slotStamps[constraint.target] === stamp;
}

/** Solves a constraint by its kind. What a timeline noted about it is used up. */
function solveConstraint(solver: Solver, constraint: LegacyConstraint): void {
    solver.noted[constraint.index] = 0;
    if (constraint.kind === C_IK) solveIk(solver, constraint);
    else if (constraint.kind === C_TRANSFORM) solveTransform(solver, constraint);
    else if (constraint.kind === C_PATH) solvePath(solver, constraint);
    else solvePhysics(solver, constraint);
}

/**
 * For a group with a physics constraint: stamps the bones whose world transform is final after
 * the entry at `i`, when it is not the one they had. A physics constraint that left its bone as
 * it was may be at rest. In a pass that asks, it is asked: if it is not, or was not asked, the
 * group runs again in the next update. After its last entry the group ends: it has to run in the
 * next update when this run changed something.
 */
function endEntry(solver: Solver, i: number, group: number, stamp: number, entry: number): void {
    const { world, boneStamps } = solver.pose;
    const { settleStart, settled, last, entryStart } = solver.cache.groups;
    // a list is asked only for a place it can have: a miss below zero is slow
    const constraint = entry < 0 ? solver.rig.plan.constraints[-1 - entry] : undefined;

    for (let at = Number(settleStart[i]), n = Number(settleStart[i + 1]); at < n; at++) {
        const bone = Number(settled[at]);

        if (kept(world, bone * WORLD_STRIDE)) continue;
        boneStamps[bone] = stamp;
        changed[group] = 1;
        SHARED[STAMPED] = 1;
        settledAnew++;
    }
    if (constraint?.kind === C_PHYSICS && changed[group] === 0 && !(asking && physicsStays(solver, constraint))) {
        changed[group] = 1;
        inMotion = true;
    }
    if (last[i] === 0) return;
    // a group that is at rest now does not run in the next update: its entries do not count as run
    if (changed[group] === 0) worked -= Number(entryStart[group + 1]) - Number(entryStart[group]);
    solver.restlessCount += Number(changed[group]) - Number(solver.restless[group]);
    solver.restless[group] = Number(changed[group]);
}

/** Runs the entry of a group at cache position `i`, as the official update would. */
function runEntry(solver: Solver, i: number, group: number, stamp: number): void {
    const { rig, pose } = solver;
    const entry = Number(solver.cache.entries[i]);
    const constraint = entry < 0 ? rig.plan.constraints[-1 - entry] : undefined;

    if (asking && constraint?.kind === C_PHYSICS) watchPhysics(solver, constraint);
    if (constraint !== undefined) solveConstraint(solver, constraint);
    else updateBone(pose, solver.applied, rig.model.bones.parents, entry, rig.v41);
    if (solver.cache.groups.checks[i] !== 0) endEntry(solver, i, group, stamp, entry);
}

/**
 * Starts a group at its entry at cache position `i`. The applied pose of its bones starts at the
 * local pose, and the entries of the group that the pass has gone by are run. The bones get a
 * new stamp. Those of a group with a physics constraint do not: their world transforms are kept
 * to compare with.
 */
function startGroup(solver: Solver, group: number, i: number, stamp: number): void {
    const { applied, pose, moved } = solver;
    const { local, world, boneStamps } = pose;
    const { boneStart, bones, entryStart, entries } = solver.cache.groups;
    const compares = solver.cache.groups.physical[group] !== 0;
    const first = Number(boneStart[group]);
    const end = Number(boneStart[group + 1]);

    for (let at = first; at < end; at++) {
        const bone = Number(bones[at]);
        const w = bone * WORLD_STRIDE;
        const o = bone * LOCAL_STRIDE;

        // a skeleton with a group has an applied pose of its own
        for (let c = 0; c < LOCAL_STRIDE; c++) applied[o + c] = Number(local[o + c]);
        moved[bone + 1] = 0;
        if (!compares) boneStamps[bone] = stamp;
        else for (let c = 0; c < WORLD_STRIDE; c++) saved[w + c] = Number(world[w + c]);
    }
    if (!compares) {
        settledAnew += end - first;
        SHARED[STAMPED] = 1;
    }
    ran[group] = passId;
    changed[group] = 0;
    for (let at = Number(entryStart[group]); Number(entries[at]) < i; at++) {
        runEntry(solver, Number(entries[at]), group, stamp);
        worked++;
    }
}

/**
 * Decides whether a group that does not run yet starts at its entry at cache position `i`, and
 * starts it. A group at rest starts when the entry reads something new. The entries before it
 * read nothing new. A group that stays at rest to its last entry has the time of its physics counted.
 */
function groupStarts(solver: Solver, group: number, i: number, entry: number, stamp: number): boolean {
    const { physicsStart, physics, last } = solver.cache.groups;

    if (solver.restless[group] !== 0 || entryNeeds(solver, i, entry, stamp)) {
        startGroup(solver, group, i, stamp);

        return true;
    }
    if (last[i] === 0) return false;
    for (let at = Number(physicsStart[group]), n = Number(physicsStart[group + 1]); at < n; at++) {
        const constraint = solver.rig.plan.constraints[Number(physics[at])];

        if (constraint !== undefined) restPhysics(solver, constraint);
    }

    return false;
}

/**
 * Notes after an update that looked for changes whether the next ones compute everything
 * without looking. A skeleton is busy when most of its bones got a new stamp: `stamped` of them
 * did. Then every bone is stamped. Nearly all of its entries can also run while few of its bones
 * change, when its physics swings in its last bits: `run` of them did. Then the world transforms
 * are compared as a whole, which costs less than keeping every group apart. Either way goes on
 * for twice as long when the next look finds the same.
 */
function noteBusy(solver: Solver, stamped: number, run: number): void {
    const { posed, entries } = solver.cache;
    const busy = stamped * BUSY_OF >= posed * BUSY_MOVES;

    if (!busy && run * RUN_OF < entries.length * RUN_MOST) {
        solver.busy = 0;
        solver.busyFor = 0;

        return;
    }
    solver.busyFor = Math.min(Math.max(2, solver.busyFor * 2), LONGEST_BUSY);
    solver.busy = solver.busyFor;
    solver.compares = !busy;
    // no group is looked at until the next look: that one asks the physics constraints whether they rest
    if (!busy) solver.motion = 0;
}

/**
 * Computes the world transforms that changed since the last update, as the comment at the top
 * says, and notes whether the skeleton is busy.
 *
 * Inherit mode `normal` of a bone with a parent, which nearly every bone has, is computed in the
 * loop itself: the parent transform times the applied pose. As functions of their own its steps
 * are too long for V8 to inline. The cosine and the sine of a bone that is not turned are not
 * computed, as world.ts explains.
 */
function poseChanges(solver: Solver): void {
    const { pose, applied, rig, moved } = solver;
    const { world, inherit, boneStamps, local } = pose;
    const { entries, groups } = solver.cache;
    const { of, checks } = groups;
    const parents = rig.model.bones.parents;
    const stamp = Number(SHARED[STAMP]);
    const n = entries.length;
    let free = 0;

    makeRoom(rig.model.bones.count, groups.count);
    passId = (passId + 1) >>> 0;
    settledAnew = 0;
    worked = 0;
    asking = solver.motion <= 0;
    inMotion = false;
    for (let i = 0; i < n; i++) {
        const entry = Number(entries[i]);
        const group = Number(of[i]);
        const parent = entry < 0 ? -1 : Number(parents[entry]);
        const o = entry * LOCAL_STRIDE;
        // the applied pose of a free bone is its local pose: no constraint writes or reads it
        const from = group >= 0 ? applied : local;

        if (group >= 0) {
            if (ran[group] !== passId && !groupStarts(solver, group, i, entry, stamp)) continue;
        } else if (moved[entry + 1] === 0 && (parent < 0 || boneStamps[parent] !== stamp)) {
            continue;
        } else {
            boneStamps[entry] = stamp;
            moved[entry + 1] = 0;
            free++;
        }
        worked++;
        if (entry < 0 || parent < 0 || inherit[entry] !== NORMAL) {
            if (group >= 0) runEntry(solver, i, group, stamp);
            else updateBone(pose, local, parents, entry, rig.v41);
            continue;
        }
        const w = entry * WORLD_STRIDE;
        const p = parent * WORLD_STRIDE;
        const pa = Number(world[p]);
        const pb = Number(world[p + 1]);
        const pc = Number(world[p + 2]);
        const pd = Number(world[p + 3]);
        const x = Number(from[o]);
        const y = Number(from[o + 1]);
        const rotation = Number(from[o + 2]);
        const scaleX = Number(from[o + 3]);
        const scaleY = Number(from[o + 4]);
        const rx = (rotation + Number(from[o + 5])) * DEG_RAD;
        const ry = (rotation + 90 + Number(from[o + 6])) * DEG_RAD;
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
        if (group >= 0 && checks[i] !== 0) endEntry(solver, i, group, stamp, entry);
    }
    if (free > 0) SHARED[STAMPED] = 1;
    moved[0] = 0;
    // Physics that is in motion is asked again after a wait that doubles. Asking costs about a step of
    // the simulation, and the official one comes to rest late: its numbers go on changing in their last bits.
    if (!asking) solver.motion--;
    else {
        solver.motionFor = inMotion ? Math.min(Math.max(1, solver.motionFor * 2), LONGEST_MOTION) : 0;
        solver.motion = solver.motionFor;
    }
    noteBusy(solver, free + settledAnew, worked);
}

/** Stamps the bones whose world transform is not the one that was saved before the pass. */
function stampChanged(pose: PoseState, stamp: number): void {
    const { world, boneStamps } = pose;

    for (let bone = 0, w = 0, n = world.length; w < n; bone++, w += WORLD_STRIDE) {
        if (kept(world, w)) continue;
        boneStamps[bone] = stamp;
        SHARED[STAMPED] = 1;
    }
}

/**
 * Computes every world transform, as the official update does. It stamps every bone, or with
 * `compares` the bones whose world transform is not the one before. After it every group with a
 * physics constraint counts as restless, so that the next update that looks for changes runs it
 * and finds whether it is at rest. The bones that are noted as moved stay noted: the caller
 * clears them before an update that looks.
 */
function poseAll(solver: Solver, compares: boolean): void {
    const { pose, applied, rig, moved, restless } = solver;
    const { world, inherit, local } = pose;
    const entries = solver.cache.entries;
    const { physical, physicalCount, unlisted } = solver.cache.groups;
    const parents = rig.model.bones.parents;
    const constraints = rig.plan.constraints;
    const v41 = rig.v41;
    const stamp = Number(SHARED[STAMP]);

    if (applied !== local) applied.set(local);
    if (compares) {
        makeRoom(rig.model.bones.count, 0);
        saved.set(world);
    }
    // A store per entry costs less than filling the stamps in one call, and leaves the bones that are
    // not posed. A pass that compares stamps afterwards: its stores go where nothing reads them.
    const boneStamps = compares ? unused : pose.boneStamps;
    for (let i = 0, n = entries.length; i < n; i++) {
        const entry = Number(entries[i]);
        const constraint = entry < 0 ? constraints[-1 - entry] : undefined;

        if (constraint !== undefined) {
            solveConstraint(solver, constraint);
            continue;
        }
        const parent = Number(parents[entry]);

        boneStamps[entry] = stamp;
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
    if (compares) stampChanged(pose, stamp);
    else {
        for (let at = 0, n = unlisted.length; at < n; at++) boneStamps[Number(unlisted[at])] = stamp;
        SHARED[STAMPED] = 1;
    }
    moved[0] = 0;
    if (solver.restlessCount !== physicalCount) restless.set(physical);
    solver.restlessCount = physicalCount;
}

/**
 * The official `Skeleton.updateWorldTransform` with the physics mode of the solver, for a
 * skeleton whose stamps are open. It computes what changed since the last call and stamps the
 * bones whose world transform is a new one. When nothing changed and nothing is in motion, it
 * only counts the time of the physics constraints. A busy skeleton is computed as a whole, and
 * looked at again from time to time. An inactive bone keeps the world transform it had.
 */
export function updateWorldTransform(solver: Solver): void {
    const { pose, moved } = solver;
    const placed =
        !Object.is(pose.x, solver.x) ||
        !Object.is(pose.y, solver.y) ||
        !Object.is(pose.scaleX, solver.scaleX) ||
        !Object.is(pose.scaleY, solver.scaleY) ||
        pose.yDown !== solver.yDown;
    // a path lies in a slot: when this update stamped one, a path may have another shape
    const reshaped = solver.cache.groups.paths && Number(SHARED[STAMPED]) !== 0;

    if (placed) {
        solver.x = pose.x;
        solver.y = pose.y;
        solver.scaleX = pose.scaleX;
        solver.scaleY = pose.scaleY;
        solver.yDown = pose.yDown;
    }
    if (placed || solver.all) {
        solver.all = false;
        solver.busy = 0;
        poseAll(solver, false);
        moved.fill(0);
    } else if (!reshaped && moved[0] === 0 && solver.restlessCount === 0) {
        restEveryPhysics(solver);
    } else if (solver.busy > 1) {
        poseAll(solver, solver.compares);
        // the next update looks: it must find only what that update moved
        if (--solver.busy === 1) moved.fill(0);
    } else {
        poseChanges(solver);
    }
}
