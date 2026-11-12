import { ALPHA, curveValue, LAST_TIME, SHARED, TIME, VALUES } from './curves';
import { resetPhysics } from './physics';
import { FIRST, type Pose43, SETUP, type Timeline43 } from './types';

/*
 * The timelines that animate physics constraints. A timeline with the target -1 is for every
 * physics constraint whose data has the global flag of the number it animates. Each timeline
 * reads its times and its alpha from `SHARED`, for the reasons given in curves.ts.
 */

/**
 * The official `getAbsoluteValue` of a physics timeline for the number at `i`: mixes the value in
 * `SHARED` into it. `inverse` is true for the mass timeline. The pose holds one divided by the
 * mass, and the official timeline turns it into the mass and back, also where the mass stays.
 *
 * @param before True when the time is before the first key.
 */
function mixValue(
    values: Float64Array,
    setups: Float64Array,
    i: number,
    inverse: boolean,
    from: number,
    add: boolean,
    before: boolean,
): void {
    const alpha = Number(SHARED[ALPHA]);
    const value = Number(SHARED[VALUES]);
    const current = inverse ? 1 / Number(values[i]) : Number(values[i]);
    const setup = inverse ? 1 / Number(setups[i]) : Number(setups[i]);
    let mixed = current;

    if (before) {
        // the official beforeFirstKey
        if (from === SETUP) mixed = setup;
        else if (from === FIRST) mixed = current + (setup - current) * alpha;
    } else if (from === SETUP) mixed = setup + (add ? value : value - setup) * alpha;
    else mixed = current + (add ? value : value - current) * alpha;
    values[i] = inverse ? 1 / mixed : mixed;
}

/**
 * The official `PhysicsConstraintTimeline`: one number of the pose of a physics constraint, as an
 * absolute value. Only the wind and the gravity timelines add.
 *
 * @param inverse True for the mass timeline.
 */
export function applyPhysicsValue(
    pose: Pose43,
    timeline: Timeline43,
    from: number,
    add: boolean,
    inverse: boolean,
): void {
    const { values } = pose;
    const { active } = pose.solve;
    const { setup, physics } = pose.rig.solver;
    const { frames, target, offset } = timeline;
    const time = Number(SHARED[TIME]);
    const before = time < Number(frames[0]);
    const adds = add && timeline.additive;

    if (target !== -1) {
        if (active[target] !== 1) return;
        if (!before) curveValue(frames, timeline.curves);
        mixValue(values, setup, offset, inverse, from, adds, before);

        return;
    }
    // the official code reads the value once, and takes 0 for a time that is no number
    if (time >= Number(frames[0])) curveValue(frames, timeline.curves);
    else SHARED[VALUES] = 0;
    for (let i = 0; i < physics.length; i++) {
        const plan = physics[i];

        if (plan === undefined || active[plan.index] !== 1 || plan.globals[offset] !== 1) continue;
        mixValue(values, setup, plan.at + offset, inverse, from, adds, before);
    }
}

/**
 * True when a reset key is between the last time and the time in `SHARED`: the end of the
 * official `PhysicsConstraintResetTimeline.apply`.
 */
function resetDue(frames: Float32Array): boolean {
    const lastTime = Number(SHARED[LAST_TIME]);
    const time = Number(SHARED[TIME]);
    const n = frames.length;

    if (time < Number(frames[0])) return false;
    if (lastTime < Number(frames[0])) return true;
    // the official search for the last time, plus one: the first key after it
    let next = n;

    for (let i = 1; i < n; i++) {
        if (Number(frames[i]) > lastTime) {
            next = i;
            break;
        }
    }

    return time >= Number(frames[next]);
}

/** Resets the physics constraint of a reset timeline, or every active one for a timeline without a constraint. */
function resetTargets(pose: Pose43, timeline: Timeline43): void {
    const { plans, physics } = pose.rig.solver;
    const { active } = pose.solve;
    const plan = plans[timeline.target];

    if (plan !== undefined) {
        if (plan.type === 'physics') resetPhysics(pose, plan);

        return;
    }
    for (let i = 0; i < physics.length; i++) {
        const each = physics[i];

        if (each !== undefined && active[each.index] === 1) resetPhysics(pose, each);
    }
}

/**
 * The official `PhysicsConstraintResetTimeline`: resets the physics when the time passes a key.
 * A reset changes the state of a constraint, not its pose, so it is the same for every pose.
 */
export function applyPhysicsReset(pose: Pose43, timeline: Timeline43): void {
    const { frames, target } = timeline;
    const lastTime = Number(SHARED[LAST_TIME]);
    const time = Number(SHARED[TIME]);
    const last = Number(frames[frames.length - 1]);

    if (target !== -1 && pose.solve.active[target] !== 1) return;
    if (lastTime > time) {
        // the animation looped: first the keys up to its end, then those from its start
        SHARED[TIME] = Number.MAX_VALUE;
        if (!(lastTime >= last) && resetDue(frames)) resetTargets(pose, timeline);
        SHARED[TIME] = time;
        SHARED[LAST_TIME] = -1;
    } else if (lastTime >= last) return;
    if (resetDue(frames)) resetTargets(pose, timeline);
    SHARED[LAST_TIME] = lastTime;
}
