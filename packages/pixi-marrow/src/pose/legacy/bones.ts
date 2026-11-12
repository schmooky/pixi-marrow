import { LOCAL_STRIDE } from '../state';
import { ALPHA, curveValues, SHARED, search, TIME } from './curves';
import { ADD, FIRST, type LegacyTimeline, MIX_OUT, SETUP } from './timelines';

/** The offset of x in the local pose of a bone. y follows it. */
export const LOCAL_X = 0;
/** The offset of y in the local pose of a bone. */
export const LOCAL_Y = 1;
/** The offset of the rotation in the local pose of a bone. */
export const LOCAL_ROTATION = 2;
/** The offset of scaleX in the local pose of a bone. scaleY follows it. */
export const LOCAL_SCALE_X = 3;
/** The offset of scaleY in the local pose of a bone. */
export const LOCAL_SCALE_Y = 4;
/** The offset of shearX in the local pose of a bone. shearY follows it. */
export const LOCAL_SHEAR_X = 5;
/** The offset of shearY in the local pose of a bone. */
export const LOCAL_SHEAR_Y = 6;

/*
 * The functions below write their result into the pose and take key values from a scratch array.
 * A number that is returned from a call or computed for one can cost an allocation.
 */

/** Sets the local value at `i` before the first key of its timeline, the same way for every kind. */
function beforeFirstKey(local: Float64Array, setupPose: Float64Array, i: number, blend: number): void {
    const alpha = Number(SHARED[ALPHA]);
    const setup = Number(setupPose[i]);

    if (blend === SETUP) {
        local[i] = setup;
    } else if (blend === FIRST) {
        const current = Number(local[i]);

        local[i] = current + (setup - current) * alpha;
    }
}

/**
 * A timeline with one value that is added to the setup value: rotate, translateX, translateY,
 * shearX and shearY. `property` is the offset in the local pose. `values` is scratch space.
 *
 * `sumFirst` picks the order of one sum. The official 4.1 timelines for x, y and shear add the
 * setup value to the key value first. Every other case adds it to the current value first.
 */
export function applyRelative(
    timeline: LegacyTimeline,
    local: Float64Array,
    setupPose: Float64Array,
    property: number,
    blend: number,
    sumFirst: boolean,
    values: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const alpha = Number(SHARED[ALPHA]);
    const { frames, curves } = timeline;
    const i = timeline.target * LOCAL_STRIDE + property;

    if (time < Number(frames[0])) {
        beforeFirstKey(local, setupPose, i, blend);

        return;
    }
    curveValues(frames, curves, 2, values);
    const value = Number(values[0]);
    const current = Number(local[i]);
    const setup = Number(setupPose[i]);

    if (blend === SETUP) local[i] = setup + value * alpha;
    else if (blend === ADD) local[i] = current + value * alpha;
    else if (sumFirst) local[i] = current + (setup + value - current) * alpha;
    else local[i] = current + (value + (setup - current)) * alpha;
}

/**
 * Sets the scale at `i` from the key value `values[v]` when it is not fully applied: the official
 * sign rules. Mixing out keeps the sign of the pose, mixing in takes the sign of the key.
 */
function mixScale(
    local: Float64Array,
    setupPose: Float64Array,
    i: number,
    values: Float64Array,
    v: number,
    blend: number,
    direction: number,
): void {
    const alpha = Number(SHARED[ALPHA]);
    const current = Number(local[i]);
    const setup = Number(setupPose[i]);
    const value = Number(values[v]) * setup;
    const base = blend === SETUP ? setup : current;

    if (blend === ADD) {
        local[i] = current + (value - setup) * alpha;
    } else if (direction === MIX_OUT) {
        // the official signum of the base
        local[i] = base + (Math.abs(value) * (base > 0 ? 1 : base < 0 ? -1 : 0) - base) * alpha;
    } else {
        // the official signum of the key value
        const start = Math.abs(base) * (value > 0 ? 1 : value < 0 ? -1 : 0);

        local[i] = start + (value - start) * alpha;
    }
}

/**
 * A timeline with one scale value: scaleX or scaleY. `property` is the offset in the local pose.
 * `values` is scratch space.
 *
 * `v41` picks the order of one sum. With additive blend and full alpha the official 4.1 timeline
 * subtracts the setup value from the key value first, the 4.2 timeline adds the current value first.
 */
export function applyScaleValue(
    timeline: LegacyTimeline,
    local: Float64Array,
    setupPose: Float64Array,
    property: number,
    blend: number,
    direction: number,
    v41: boolean,
    values: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const alpha = Number(SHARED[ALPHA]);
    const { frames, curves } = timeline;
    const i = timeline.target * LOCAL_STRIDE + property;

    if (time < Number(frames[0])) {
        beforeFirstKey(local, setupPose, i, blend);

        return;
    }
    curveValues(frames, curves, 2, values);
    if (alpha !== 1) {
        mixScale(local, setupPose, i, values, 0, blend, direction);

        return;
    }
    const current = Number(local[i]);
    const setup = Number(setupPose[i]);
    const value = Number(values[0]) * setup;

    if (blend !== ADD) local[i] = value;
    else if (v41) local[i] = current + (value - setup);
    else local[i] = current + value - setup;
}

/**
 * A timeline with two values that are added to the setup values: translate and shear.
 * `property` is the offset of the first value in the local pose. `values` is scratch space.
 */
export function applyRelativePair(
    timeline: LegacyTimeline,
    local: Float64Array,
    setupPose: Float64Array,
    property: number,
    blend: number,
    values: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const alpha = Number(SHARED[ALPHA]);
    const { frames, curves } = timeline;
    const i = timeline.target * LOCAL_STRIDE + property;

    if (time < Number(frames[0])) {
        beforeFirstKey(local, setupPose, i, blend);
        beforeFirstKey(local, setupPose, i + 1, blend);

        return;
    }
    curveValues(frames, curves, 3, values);
    for (let v = 0; v < 2; v++) {
        const current = Number(local[i + v]);
        const setup = Number(setupPose[i + v]);
        const value = Number(values[v]);

        if (blend === SETUP) local[i + v] = setup + value * alpha;
        else if (blend === ADD) local[i + v] = current + value * alpha;
        else local[i + v] = current + (setup + value - current) * alpha;
    }
}

/** The scale timeline: two scale values. `values` is scratch space. */
export function applyScalePair(
    timeline: LegacyTimeline,
    local: Float64Array,
    setupPose: Float64Array,
    blend: number,
    direction: number,
    values: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const alpha = Number(SHARED[ALPHA]);
    const { frames, curves } = timeline;
    const i = timeline.target * LOCAL_STRIDE + LOCAL_SCALE_X;

    if (time < Number(frames[0])) {
        beforeFirstKey(local, setupPose, i, blend);
        beforeFirstKey(local, setupPose, i + 1, blend);

        return;
    }
    curveValues(frames, curves, 3, values);
    for (let v = 0; v < 2; v++) {
        const setup = Number(setupPose[i + v]);
        const value = Number(values[v]) * setup;

        if (alpha !== 1) mixScale(local, setupPose, i + v, values, v, blend, direction);
        else if (blend === ADD) local[i + v] = Number(local[i + v]) + (value - setup);
        else local[i + v] = value;
    }
}

/** The inherit timeline of 4.2: sets how a bone inherits its parent transform. */
export function applyInherit(
    timeline: LegacyTimeline,
    inherit: Uint8Array,
    setupInherit: Uint8Array,
    blend: number,
    direction: number,
): void {
    const time = Number(SHARED[TIME]);
    const { frames, target } = timeline;
    const setup = setupInherit[target] ?? 0;

    if (direction === MIX_OUT) {
        if (blend === SETUP) inherit[target] = setup;
    } else if (time < Number(frames[0])) {
        if (blend === SETUP || blend === FIRST) inherit[target] = setup;
    } else {
        inherit[target] = Number(frames[search(frames, 2) + 1]);
    }
}
