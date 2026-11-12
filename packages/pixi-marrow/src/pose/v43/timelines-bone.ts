import { LOCAL_STRIDE } from '../state';
import { ALPHA, curveValue, SHARED, sampleValues, search, TIME, towardSetup, VALUES } from './curves';
import { CURRENT, FIRST, type Pose43, SETUP, type Timeline43 } from './types';

/*
 * The timelines that animate the local numbers of a bone. Each reads its time and its alpha from
 * `SHARED`, for the reasons given in curves.ts.
 */

/**
 * The official rotate, translateX, translateY, shearX and shearY timelines: one number of a bone,
 * relative to its setup value. This is the official `CurveTimeline1.getRelativeValue`.
 */
export function applyRelative(pose: Pose43, timeline: Timeline43, from: number, add: boolean): void {
    const { local } = pose;
    const { active } = pose.state;
    const bone = timeline.target;

    if (active[bone] !== 1) return;
    const i = bone * LOCAL_STRIDE + timeline.offset;
    const setup = Number(pose.rig.model.bones.setup[i]);
    const frames = timeline.frames;
    const alpha = Number(SHARED[ALPHA]);

    if (Number(SHARED[TIME]) < Number(frames[0])) {
        // the official beforeFirstKey
        if (from === SETUP) local[i] = setup;
        else if (from === FIRST) {
            const current = Number(local[i]);

            local[i] = current + (setup - current) * alpha;
        }

        return;
    }
    curveValue(frames, timeline.curves);
    const value = Number(SHARED[VALUES]);

    if (from === SETUP) local[i] = setup + value * alpha;
    else {
        const current = Number(local[i]);

        local[i] = current + (add ? value : value + setup - current) * alpha;
    }
}

/**
 * The mixing of the official scale timelines, for one scale of a bone. The sampled factor is read
 * from `SHARED` at `k` and the result is written to `local` at `i`.
 */
function mixScale(
    local: Float64Array,
    setups: Float64Array,
    i: number,
    k: number,
    from: number,
    add: boolean,
    out: boolean,
): void {
    const alpha = Number(SHARED[ALPHA]);
    const setup = Number(setups[i]);
    const value = Number(SHARED[k]) * setup;

    if (alpha === 1 && !add) {
        local[i] = value;

        return;
    }
    let base = from === SETUP ? setup : Number(local[i]);

    if (add) local[i] = base + (value - setup) * alpha;
    else if (out) local[i] = base + (Math.abs(value) * Math.sign(base) - base) * alpha;
    else {
        base = Math.abs(base) * Math.sign(value);
        local[i] = base + (value - base) * alpha;
    }
}

/** The official scaleX and scaleY timelines: one scale of a bone, as a factor of its setup scale. */
export function applyScale(pose: Pose43, timeline: Timeline43, from: number, add: boolean, out: boolean): void {
    const { local } = pose;
    const { active } = pose.state;

    if (active[timeline.target] !== 1) return;
    const i = timeline.target * LOCAL_STRIDE + timeline.offset;
    const setups = pose.rig.model.bones.setup;
    const frames = timeline.frames;

    if (Number(SHARED[TIME]) < Number(frames[0])) {
        towardSetup(local, setups, i, 1, from);

        return;
    }
    curveValue(frames, timeline.curves);
    mixScale(local, setups, i, VALUES, from, add, out);
}

/** The official translate and shear timelines: two numbers of a bone, relative to their setup values. */
export function applyPair(pose: Pose43, timeline: Timeline43, from: number, add: boolean): void {
    const { local } = pose;
    const { active } = pose.state;

    if (active[timeline.target] !== 1) return;
    const setup = pose.rig.model.bones.setup;
    const i = timeline.target * LOCAL_STRIDE + timeline.offset;

    if (Number(SHARED[TIME]) < Number(timeline.frames[0])) {
        towardSetup(local, setup, i, 2, from);

        return;
    }
    sampleValues(timeline, 2);
    const x = Number(SHARED[VALUES]);
    const y = Number(SHARED[VALUES + 1]);
    const alpha = Number(SHARED[ALPHA]);

    if (from === SETUP) {
        local[i] = Number(setup[i]) + x * alpha;
        local[i + 1] = Number(setup[i + 1]) + y * alpha;
    } else if (add) {
        local[i] = Number(local[i]) + x * alpha;
        local[i + 1] = Number(local[i + 1]) + y * alpha;
    } else {
        const currentX = Number(local[i]);
        const currentY = Number(local[i + 1]);

        local[i] = currentX + (Number(setup[i]) + x - currentX) * alpha;
        local[i + 1] = currentY + (Number(setup[i + 1]) + y - currentY) * alpha;
    }
}

/** The official scale timeline: both scales of a bone, as factors of their setup scales. */
export function applyScalePair(pose: Pose43, timeline: Timeline43, from: number, add: boolean, out: boolean): void {
    const { local } = pose;
    const { active } = pose.state;

    if (active[timeline.target] !== 1) return;
    const setups = pose.rig.model.bones.setup;
    const i = timeline.target * LOCAL_STRIDE + timeline.offset;

    if (Number(SHARED[TIME]) < Number(timeline.frames[0])) {
        towardSetup(local, setups, i, 2, from);

        return;
    }
    sampleValues(timeline, 2);
    mixScale(local, setups, i, VALUES, from, add, out);
    mixScale(local, setups, i + 1, VALUES + 1, from, add, out);
}

/** The official inherit timeline: how a bone inherits its parent transform. It does not interpolate. */
export function applyInherit(pose: Pose43, timeline: Timeline43, from: number, out: boolean): void {
    const { inherit } = pose;
    const { active } = pose.state;
    const bone = timeline.target;
    const frames = timeline.frames;

    if (active[bone] !== 1) return;
    if (out || Number(SHARED[TIME]) < Number(frames[0])) {
        if (from !== CURRENT) inherit[bone] = pose.rig.model.bones.inherit[bone] ?? 0;

        return;
    }
    inherit[bone] = Number(frames[search(frames, 2) + 1]);
}
