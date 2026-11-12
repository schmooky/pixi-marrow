import { LOCAL_STRIDE } from '../state';
import {
    ALPHA,
    bezierPair,
    CURVE_BEZIER,
    CURVE_BEZIER_SIZE,
    CURVE_LINEAR,
    CURVE_STEPPED,
    curveValue,
    SHARED,
    search,
    TIME,
} from './curves';
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
 *
 * Each of them notes in `moved` when a value gets other bits than it had, down to the sign of a
 * zero. The world transforms of an update are computed only for the bones that are noted there,
 * and for what depends on them. `moved` has a place for each bone after its first place, which
 * says that any bone moved.
 */

/** Sets the local value at `i` before the first key of its timeline, the same way for every kind. */
function beforeFirstKey(
    local: Float64Array,
    setupPose: Float64Array,
    i: number,
    blend: number,
    moved: Uint8Array,
    bone: number,
): void {
    const alpha = Number(SHARED[ALPHA]);
    const setup = Number(setupPose[i]);
    const current = Number(local[i]);
    let next = setup;

    if (blend === FIRST) next = current + (setup - current) * alpha;
    else if (blend !== SETUP) return;
    if (next !== current || (next === 0 && 1 / next !== 1 / current)) {
        moved[bone + 1] = 1;
        moved[0] = 1;
    }
    local[i] = next;
}

/**
 * A timeline with one value that is added to the setup value: rotate, translateX, translateY,
 * shearX and shearY. `property` is the offset in the local pose.
 *
 * `sumFirst` picks the order of one sum. The official 4.1 timelines for x, y and shear add the
 * setup value to the key value first. Every other case adds it to the current value first.
 *
 * Most timelines of an animation come through here, so the key lookup of `curveValue` is written
 * out in this function: as a call it costs more than the lookup itself.
 */
export function applyRelative(
    timeline: LegacyTimeline,
    local: Float64Array,
    setupPose: Float64Array,
    property: number,
    blend: number,
    sumFirst: boolean,
    moved: Uint8Array,
): void {
    const time = Number(SHARED[TIME]);
    const alpha = Number(SHARED[ALPHA]);
    const { frames, curves, target } = timeline;
    const i = target * LOCAL_STRIDE + property;
    const n = frames.length;
    let key = n - 2;

    if (time < Number(frames[0])) {
        beforeFirstKey(local, setupPose, i, blend, moved, target);

        return;
    }
    for (let k = 2; k < n; k += 2) {
        if (Number(frames[k]) > time) {
            key = k - 2;
            break;
        }
    }
    const curveType = Number(curves[key >> 1]);
    let value = Number(frames[key + 1]);

    if (curveType === CURVE_LINEAR) {
        const before = Number(frames[key]);

        value += (Number(frames[key + 3]) - value) * ((time - before) / (Number(frames[key + 2]) - before));
    } else if (curveType !== CURVE_STEPPED) {
        // the straight piece of the curve that holds the time runs from x, y to endX, endY
        const c = curveType - CURVE_BEZIER;
        const end = c + CURVE_BEZIER_SIZE;
        let x = Number(frames[key]);
        let endX = Number(curves[c]);
        let endY = Number(curves[c + 1]);

        if (!(endX > time)) {
            let at = c + 2;

            while (at < end && !(Number(curves[at]) >= time)) at += 2;
            x = Number(curves[(at < end ? at : end) - 2]);
            value = Number(curves[(at < end ? at : end) - 1]);
            // after the last sample the piece ends at the next key
            endX = at < end ? Number(curves[at]) : Number(frames[key + 2]);
            endY = at < end ? Number(curves[at + 1]) : Number(frames[key + 3]);
        }
        value += ((time - x) / (endX - x)) * (endY - value);
    }
    const current = Number(local[i]);
    const setup = Number(setupPose[i]);
    let next = 0;

    if (blend === SETUP) next = setup + value * alpha;
    else if (blend === ADD) next = current + value * alpha;
    else if (sumFirst) next = current + (setup + value - current) * alpha;
    else next = current + (value + (setup - current)) * alpha;
    if (next !== current || (next === 0 && 1 / next !== 1 / current)) {
        moved[target + 1] = 1;
        moved[0] = 1;
    }
    local[i] = next;
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
    moved: Uint8Array,
    bone: number,
): void {
    const alpha = Number(SHARED[ALPHA]);
    const current = Number(local[i]);
    const setup = Number(setupPose[i]);
    const value = Number(values[v]) * setup;
    const base = blend === SETUP ? setup : current;
    let next = 0;

    if (blend === ADD) {
        next = current + (value - setup) * alpha;
    } else if (direction === MIX_OUT) {
        // the official signum of the base
        next = base + (Math.abs(value) * (base > 0 ? 1 : base < 0 ? -1 : 0) - base) * alpha;
    } else {
        // the official signum of the key value
        const start = Math.abs(base) * (value > 0 ? 1 : value < 0 ? -1 : 0);

        next = start + (value - start) * alpha;
    }
    if (next !== current || (next === 0 && 1 / next !== 1 / current)) {
        moved[bone + 1] = 1;
        moved[0] = 1;
    }
    local[i] = next;
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
    moved: Uint8Array,
): void {
    const time = Number(SHARED[TIME]);
    const alpha = Number(SHARED[ALPHA]);
    const { frames, curves, target } = timeline;
    const i = target * LOCAL_STRIDE + property;

    if (time < Number(frames[0])) {
        beforeFirstKey(local, setupPose, i, blend, moved, target);

        return;
    }
    curveValue(frames, curves, values);
    if (alpha !== 1) {
        mixScale(local, setupPose, i, values, 0, blend, direction, moved, target);

        return;
    }
    const current = Number(local[i]);
    const setup = Number(setupPose[i]);
    const value = Number(values[0]) * setup;
    let next = value;

    if (blend === ADD) next = v41 ? current + (value - setup) : current + value - setup;
    if (next !== current || (next === 0 && 1 / next !== 1 / current)) {
        moved[target + 1] = 1;
        moved[0] = 1;
    }
    local[i] = next;
}

/**
 * A timeline with two values that are added to the setup values: translate and shear.
 * `property` is the offset of the first value in the local pose. `values` is scratch space.
 *
 * The lookup of a straight or stepped key is written out here, as in {@link applyRelative}. A
 * Bezier key costs one call for both values.
 */
export function applyRelativePair(
    timeline: LegacyTimeline,
    local: Float64Array,
    setupPose: Float64Array,
    property: number,
    blend: number,
    values: Float64Array,
    moved: Uint8Array,
): void {
    const time = Number(SHARED[TIME]);
    const alpha = Number(SHARED[ALPHA]);
    const { frames, curves, target } = timeline;
    const i = target * LOCAL_STRIDE + property;

    if (time < Number(frames[0])) {
        beforeFirstKey(local, setupPose, i, blend, moved, target);
        beforeFirstKey(local, setupPose, i + 1, blend, moved, target);

        return;
    }
    const key = search(frames, 3);
    const curveType = Number(curves[key / 3]);
    let first = Number(frames[key + 1]);
    let second = Number(frames[key + 2]);

    if (curveType === CURVE_LINEAR) {
        const before = Number(frames[key]);
        const t = (time - before) / (Number(frames[key + 3]) - before);

        first += (Number(frames[key + 4]) - first) * t;
        second += (Number(frames[key + 5]) - second) * t;
    } else if (curveType !== CURVE_STEPPED) {
        bezierPair(frames, curves, key, values);
        first = Number(values[0]);
        second = Number(values[1]);
    }
    for (let v = 0; v < 2; v++) {
        const current = Number(local[i + v]);
        const setup = Number(setupPose[i + v]);
        const value = v === 0 ? first : second;
        let next = 0;

        if (blend === SETUP) next = setup + value * alpha;
        else if (blend === ADD) next = current + value * alpha;
        else next = current + (setup + value - current) * alpha;
        if (next !== current || (next === 0 && 1 / next !== 1 / current)) {
            moved[target + 1] = 1;
            moved[0] = 1;
        }
        local[i + v] = next;
    }
}

/**
 * The scale timeline: two scale values. `values` is scratch space. The key lookup is written out
 * as in {@link applyRelativePair}.
 */
export function applyScalePair(
    timeline: LegacyTimeline,
    local: Float64Array,
    setupPose: Float64Array,
    blend: number,
    direction: number,
    values: Float64Array,
    moved: Uint8Array,
): void {
    const time = Number(SHARED[TIME]);
    const alpha = Number(SHARED[ALPHA]);
    const { frames, curves, target } = timeline;
    const i = target * LOCAL_STRIDE + LOCAL_SCALE_X;

    if (time < Number(frames[0])) {
        beforeFirstKey(local, setupPose, i, blend, moved, target);
        beforeFirstKey(local, setupPose, i + 1, blend, moved, target);

        return;
    }
    const key = search(frames, 3);
    const curveType = Number(curves[key / 3]);

    if (curveType === CURVE_LINEAR) {
        const before = Number(frames[key]);
        const t = (time - before) / (Number(frames[key + 3]) - before);
        const first = Number(frames[key + 1]);
        const second = Number(frames[key + 2]);

        values[0] = first + (Number(frames[key + 4]) - first) * t;
        values[1] = second + (Number(frames[key + 5]) - second) * t;
    } else if (curveType === CURVE_STEPPED) {
        values[0] = Number(frames[key + 1]);
        values[1] = Number(frames[key + 2]);
    } else bezierPair(frames, curves, key, values);
    for (let v = 0; v < 2; v++) {
        const setup = Number(setupPose[i + v]);
        const current = Number(local[i + v]);
        const value = Number(values[v]) * setup;
        const next = blend === ADD ? current + (value - setup) : value;

        if (alpha !== 1) {
            mixScale(local, setupPose, i + v, values, v, blend, direction, moved, target);
            continue;
        }
        if (next !== current || (next === 0 && 1 / next !== 1 / current)) {
            moved[target + 1] = 1;
            moved[0] = 1;
        }
        local[i + v] = next;
    }
}

/** The inherit timeline of 4.2: sets how a bone inherits its parent transform. */
export function applyInherit(
    timeline: LegacyTimeline,
    inherit: Uint8Array,
    setupInherit: Uint8Array,
    blend: number,
    direction: number,
    moved: Uint8Array,
): void {
    const time = Number(SHARED[TIME]);
    const { frames, target } = timeline;
    let mode = setupInherit[target] ?? 0;

    if (direction === MIX_OUT) {
        if (blend !== SETUP) return;
    } else if (time < Number(frames[0])) {
        if (blend !== SETUP && blend !== FIRST) return;
    } else {
        mode = Number(frames[search(frames, 2) + 1]);
    }
    // the array holds bytes: compare what it will hold
    if (inherit[target] !== (mode & 255)) {
        moved[target + 1] = 1;
        moved[0] = 1;
    }
    inherit[target] = mode;
}
