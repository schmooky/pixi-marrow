import { ALPHA, curveValue, SHARED, sampleValues, TIME, towardSetup, VALUES } from './curves';
import { IK_BEND_DIRECTION, IK_COMPRESS, IK_STRETCH } from './solver-types';
import { CURRENT, FIRST, type Pose43, SETUP, type Timeline43 } from './types';

/*
 * The timelines that animate IK, transform and path constraints and sliders. They write the pose
 * of a constraint and leave a constraint alone that is not active. `offset` of a timeline is
 * where its first number is among the constraint poses. Each reads its time and its alpha from
 * `SHARED`, for the reasons given in curves.ts.
 */

/** Gives an IK constraint the bend direction, compress and stretch of its setup pose. */
function setupFlags(values: Float64Array, setup: Float64Array, i: number): void {
    values[i + IK_BEND_DIRECTION] = Number(setup[i + IK_BEND_DIRECTION]);
    values[i + IK_COMPRESS] = Number(setup[i + IK_COMPRESS]);
    values[i + IK_STRETCH] = Number(setup[i + IK_STRETCH]);
}

/**
 * The official `IkConstraintTimeline`: the mix and the softness of an IK constraint are mixed.
 * The bend direction, compress and stretch are taken from the key as they are.
 */
export function applyIkConstraint(pose: Pose43, timeline: Timeline43, from: number, out: boolean): void {
    const { values } = pose;
    const { setup } = pose.rig.solver;
    const { frames } = timeline;

    if (pose.solve.active[timeline.target] !== 1) return;
    const i = timeline.offset;

    if (Number(SHARED[TIME]) < Number(frames[0])) {
        towardSetup(values, setup, i, 2, from);
        if (from !== CURRENT) setupFlags(values, setup, i);

        return;
    }
    const key = sampleValues(timeline, 2);
    const base = from === SETUP ? setup : values;
    const alpha = Number(SHARED[ALPHA]);
    const mix = Number(base[i]);
    const softness = Number(base[i + 1]);

    values[i] = mix + (Number(SHARED[VALUES]) - mix) * alpha;
    values[i + 1] = softness + (Number(SHARED[VALUES + 1]) - softness) * alpha;
    if (!out) {
        values[i + IK_BEND_DIRECTION] = Number(frames[key + 3]);
        values[i + IK_COMPRESS] = Number(frames[key + 4]) !== 0 ? 1 : 0;
        values[i + IK_STRETCH] = Number(frames[key + 5]) !== 0 ? 1 : 0;
    } else if (from === SETUP) setupFlags(values, setup, i);
}

/**
 * The official `TransformConstraintTimeline` and `PathConstraintMixTimeline`: every mix of a
 * constraint. They mix from the setup pose or from the current pose, and add when `add` is true.
 */
export function applyConstraintMixes(pose: Pose43, timeline: Timeline43, from: number, add: boolean): void {
    const { values } = pose;
    const { setup } = pose.rig.solver;

    if (pose.solve.active[timeline.target] !== 1) return;
    const i = timeline.offset;
    const count = timeline.entries - 1;

    if (Number(SHARED[TIME]) < Number(timeline.frames[0])) {
        towardSetup(values, setup, i, count, from);

        return;
    }
    sampleValues(timeline, count);
    const base = from === SETUP ? setup : values;
    const alpha = Number(SHARED[ALPHA]);

    for (let k = 0; k < count; k++) {
        const start = Number(base[i + k]);
        const value = Number(SHARED[VALUES + k]);

        values[i + k] = add ? start + value * alpha : start + (value - start) * alpha;
    }
}

/**
 * The official `PathConstraintPositionTimeline`, `PathConstraintSpacingTimeline`, `SliderTimeline`
 * and `SliderMixTimeline`: one number of a constraint, as an absolute value. This is the official
 * `CurveTimeline1.getAbsoluteValue`.
 *
 * @param add The `add` the official timeline passes on. The position timeline and the slider
 * timelines pass their own. The spacing timeline passes false.
 */
export function applyConstraintValue(pose: Pose43, timeline: Timeline43, from: number, add: boolean): void {
    const { values } = pose;

    if (pose.solve.active[timeline.target] !== 1) return;
    const i = timeline.offset;
    const current = Number(values[i]);
    const setup = Number(pose.rig.solver.setup[i]);
    const frames = timeline.frames;
    const alpha = Number(SHARED[ALPHA]);

    if (Number(SHARED[TIME]) < Number(frames[0])) {
        // the official beforeFirstKey
        if (from === SETUP) values[i] = setup;
        else if (from === FIRST) values[i] = current + (setup - current) * alpha;

        return;
    }
    curveValue(frames, timeline.curves);
    const value = Number(SHARED[VALUES]);
    const base = from === SETUP ? setup : current;

    values[i] = base + (add ? value : value - base) * alpha;
}
