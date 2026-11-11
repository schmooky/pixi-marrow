import { LOCAL_STRIDE } from '../state';
import { beforeFirstKey, curveValue, f32, f64, sampleKey, search, towardSetup } from './curves';
import { CURRENT, SETUP, type Timeline43, type TimelineKernel } from './types';

/** The official `CurveTimeline1.getRelativeValue`: a timeline value that is added to the setup value. */
function relativeValue(
    timeline: Timeline43,
    time: number,
    alpha: number,
    from: number,
    add: boolean,
    current: number,
    setup: number,
): number {
    if (time < f32(timeline.frames, 0)) return beforeFirstKey(from, alpha, current, setup);
    const value = curveValue(timeline.frames, timeline.curves, time);

    if (from === SETUP) return setup + value * alpha;

    return current + (add ? value : value + setup - current) * alpha;
}

/**
 * The mixing of the official scale timelines.
 *
 * @param value The timeline value times the setup scale.
 */
function mixScale(
    value: number,
    alpha: number,
    from: number,
    add: boolean,
    out: boolean,
    current: number,
    setup: number,
): number {
    if (alpha === 1 && !add) return value;
    let base = from === SETUP ? setup : current;

    if (add) return base + (value - setup) * alpha;
    if (out) return base + (Math.abs(value) * Math.sign(base) - base) * alpha;
    base = Math.abs(base) * Math.sign(value);

    return base + (value - base) * alpha;
}

/**
 * The official rotate, translateX, translateY, shearX and shearY timelines: one number of a bone,
 * relative to its setup value.
 */
export const applyRelative: TimelineKernel = (pose, timeline, _lastTime, time, _events, alpha, from, add) => {
    const { local, active } = pose.state;

    if (active[timeline.target] !== 1) return;
    const i = timeline.target * LOCAL_STRIDE + timeline.offset;

    local[i] = relativeValue(timeline, time, alpha, from, add, f64(local, i), f64(pose.rig.model.bones.setup, i));
};

/** The official scaleX and scaleY timelines: one scale of a bone, as a factor of its setup scale. */
export const applyScale: TimelineKernel = (pose, timeline, _lastTime, time, _events, alpha, from, add, out) => {
    const { local, active } = pose.state;

    if (active[timeline.target] !== 1) return;
    const i = timeline.target * LOCAL_STRIDE + timeline.offset;
    const current = f64(local, i);
    const setup = f64(pose.rig.model.bones.setup, i);

    if (time < f32(timeline.frames, 0)) {
        local[i] = beforeFirstKey(from, alpha, current, setup);

        return;
    }
    const value = curveValue(timeline.frames, timeline.curves, time) * setup;

    local[i] = mixScale(value, alpha, from, add, out, current, setup);
};

/** The official translate and shear timelines: two numbers of a bone, relative to their setup values. */
export const applyPair: TimelineKernel = (pose, timeline, _lastTime, time, _events, alpha, from, add) => {
    const { local, active } = pose.state;

    if (active[timeline.target] !== 1) return;
    const setup = pose.rig.model.bones.setup;
    const i = timeline.target * LOCAL_STRIDE + timeline.offset;

    if (time < f32(timeline.frames, 0)) {
        towardSetup(local, setup, i, 2, from, alpha);

        return;
    }
    const sample = pose.rig.scratch.sample;

    sampleKey(timeline, time, sample);
    const x = f64(sample, 0);
    const y = f64(sample, 1);

    if (from === SETUP) {
        local[i] = f64(setup, i) + x * alpha;
        local[i + 1] = f64(setup, i + 1) + y * alpha;
    } else if (add) {
        local[i] = f64(local, i) + x * alpha;
        local[i + 1] = f64(local, i + 1) + y * alpha;
    } else {
        local[i] = f64(local, i) + (f64(setup, i) + x - f64(local, i)) * alpha;
        local[i + 1] = f64(local, i + 1) + (f64(setup, i + 1) + y - f64(local, i + 1)) * alpha;
    }
};

/** The official scale timeline: both scales of a bone, as factors of their setup scales. */
export const applyScalePair: TimelineKernel = (pose, timeline, _lastTime, time, _events, alpha, from, add, out) => {
    const { local, active } = pose.state;

    if (active[timeline.target] !== 1) return;
    const setup = pose.rig.model.bones.setup;
    const i = timeline.target * LOCAL_STRIDE + timeline.offset;

    if (time < f32(timeline.frames, 0)) {
        towardSetup(local, setup, i, 2, from, alpha);

        return;
    }
    const sample = pose.rig.scratch.sample;

    sampleKey(timeline, time, sample);
    const setupX = f64(setup, i);
    const setupY = f64(setup, i + 1);

    local[i] = mixScale(f64(sample, 0) * setupX, alpha, from, add, out, f64(local, i), setupX);
    local[i + 1] = mixScale(f64(sample, 1) * setupY, alpha, from, add, out, f64(local, i + 1), setupY);
};

/** The official inherit timeline: how a bone inherits its parent transform. It does not interpolate. */
export const applyInherit: TimelineKernel = (pose, timeline, _lastTime, time, _events, _alpha, from, _add, out) => {
    const { inherit, active } = pose.state;
    const bone = timeline.target;

    if (active[bone] !== 1) return;
    if (out || time < f32(timeline.frames, 0)) {
        if (from !== CURRENT) inherit[bone] = pose.rig.model.bones.inherit[bone] ?? 0;

        return;
    }
    inherit[bone] = f32(timeline.frames, search(timeline.frames, time, 2) + 1);
};
