import { PHYSICS_DATA_STRIDE, PHYSICS_SETUP } from './constraints';
import { ALPHA, curveValues, LAST_TIME, SHARED, TIME } from './curves';
import { MASS_INVERSE, PHYSICS_STRIDE, resetPhysics } from './physics-state';
import { constraintIsActive, type Solver } from './solver';
import { FIRST, K_PHYSICS_INERTIA, K_PHYSICS_RESET, type LegacyTimeline, SETUP } from './timelines';

/*
 * The official `PhysicsConstraintTimeline` with its seven subclasses and the official
 * `PhysicsConstraintResetTimeline`. The target of a timeline is the place of its constraint among
 * the physics constraints. A timeline with the target -1 is for every physics constraint.
 */

/**
 * Mixes one animated value of the physics constraint at place `p` toward the key value in
 * `scratch[0]`: the official `getAbsoluteValue` and `getAbsoluteValue2`. `value` is the offset of
 * the animated value in the state. `before` says that the time is before the first key.
 *
 * A mass timeline reads and writes the mass, and the state holds its inverse. So it inverts on the
 * way in and on the way out, also when it leaves the mass as it is. The official one does the same.
 */
function mixValue(
    solver: Solver,
    p: number,
    value: number,
    blend: number,
    before: boolean,
    scratch: Float64Array,
): void {
    const state = solver.physics;
    const at = p * PHYSICS_STRIDE + value;
    const alpha = Number(SHARED[ALPHA]);
    const mass = value === MASS_INVERSE;
    const stored = Number(state[at]);
    const data = Number(solver.rig.plan.physicsData[p * PHYSICS_DATA_STRIDE + PHYSICS_SETUP + value]);
    const current = mass ? 1 / stored : stored;
    const setup = mass ? 1 / data : data;
    let result = current;

    if (before) {
        if (blend === SETUP) result = setup;
        else if (blend === FIRST) result = current + (setup - current) * alpha;
    } else if (blend === SETUP) {
        result = setup + (Number(scratch[0]) - setup) * alpha;
    } else {
        result = current + (Number(scratch[0]) - current) * alpha;
    }
    state[at] = mass ? 1 / result : result;
}

/**
 * The official `PhysicsConstraintTimeline.apply` of the seven kinds that animate a value. A
 * timeline for every constraint changes the active ones whose data has the global flag of the value.
 */
function applyValue(solver: Solver, timeline: LegacyTimeline, blend: number, scratch: Float64Array): void {
    const { frames, curves, target } = timeline;
    const { physics, physicsGlobal } = solver.rig.plan;
    const value = timeline.kind - K_PHYSICS_INERTIA;
    const bit = 1 << value;
    const time = Number(SHARED[TIME]);
    const before = time < Number(frames[0]);

    if (target !== -1) {
        if (!constraintIsActive(solver, Number(physics[target]))) return;
        if (!before) curveValues(frames, curves, 2, scratch);
        mixValue(solver, target, value, blend, before, scratch);

        return;
    }
    if (time >= Number(frames[0])) curveValues(frames, curves, 2, scratch);
    else scratch[0] = 0;
    for (let p = 0, n = physics.length; p < n; p++) {
        if ((Number(physicsGlobal[p]) & bit) === 0 || !constraintIsActive(solver, Number(physics[p]))) continue;
        mixValue(solver, p, value, blend, before, scratch);
    }
}

/**
 * True when a reset key lies after the last time and at or before the time, both read from
 * `SHARED`.
 *
 * @param checkEnd False when the last time is the start of a new loop. Then the official code
 * does not compare it with the last key.
 */
function resetIsDue(frames: Float32Array, checkEnd: boolean): boolean {
    const last = Number(SHARED[LAST_TIME]);
    const time = Number(SHARED[TIME]);
    const n = frames.length;

    if (checkEnd && last >= Number(frames[n - 1])) return false;
    if (time < Number(frames[0])) return false;
    if (last < Number(frames[0])) return true;
    // the official search for the last time, plus one: the first key after it
    let i = 1;

    while (i < n && !(Number(frames[i]) > last)) i++;

    return time >= Number(frames[i]);
}

/**
 * The official `PhysicsConstraintResetTimeline.apply`: resets the constraint, or every active
 * one, when the time passed a key. A last time after the time means the animation looped.
 */
function applyReset(solver: Solver, timeline: LegacyTimeline): void {
    const { frames, target } = timeline;
    const { pose, physics: state } = solver;
    const physics = solver.rig.plan.physics;
    const last = Number(SHARED[LAST_TIME]);
    const time = Number(SHARED[TIME]);
    let due = false;

    if (target !== -1 && !constraintIsActive(solver, Number(physics[target]))) return;
    if (last > time) {
        // the keys up to the end of the loop first, then those from its start
        SHARED[TIME] = Number.MAX_VALUE;
        due = resetIsDue(frames, true);
        SHARED[TIME] = time;
        SHARED[LAST_TIME] = -1;
        due = resetIsDue(frames, false) || due;
        SHARED[LAST_TIME] = last;
    } else {
        due = resetIsDue(frames, true);
    }
    if (!due) return;
    if (target !== -1) {
        resetPhysics(pose, state, target * PHYSICS_STRIDE);

        return;
    }
    for (let p = 0, n = physics.length; p < n; p++) {
        if (constraintIsActive(solver, Number(physics[p]))) resetPhysics(pose, state, p * PHYSICS_STRIDE);
    }
}

/**
 * Applies a timeline that animates physics constraints. The official `time`, `lastTime` and
 * `alpha` are read from `SHARED`. `scratch` is scratch space for the value of one key.
 */
export function applyPhysicsTimeline(
    solver: Solver,
    timeline: LegacyTimeline,
    blend: number,
    scratch: Float64Array,
): void {
    if (timeline.kind === K_PHYSICS_RESET) applyReset(solver, timeline);
    else applyValue(solver, timeline, blend, scratch);
}
