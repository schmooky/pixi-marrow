import type { PoseState } from '../state';
import { ALPHA, curvePercent, SHARED, search, TIME } from './curves';
import { factsOf, type Rig } from './rig';
import { ADD, FIRST, type LegacyTimeline, SETUP } from './timelines';

/**
 * Sets how many numbers of a slot's deform are in use: the official `deform.length = length`.
 * Numbers that were not in use before read as NaN, as the holes of the official array do in sums.
 */
function resizeDeform(pose: PoseState, slot: number, length: number): Float64Array {
    const used = pose.deformLengths[slot] ?? 0;
    let deform = pose.deform[slot] ?? new Float64Array(0);

    if (deform.length < length) {
        const longer = new Float64Array(length);

        longer.set(deform.subarray(0, used));
        pose.deform[slot] = longer;
        deform = longer;
    }
    if (length > used) deform.fill(Number.NaN, used, length);
    pose.deformLengths[slot] = length;

    return deform;
}

/*
 * In the loops below a vertex value is the value of the key `from`, or with `to` the value
 * between the two keys at the percentage in `values[0]`. The loops write the value out instead of
 * calling a function for it, and take the percentage from an array. A number that is returned
 * from a call or computed for one can cost an allocation.
 */

/** Full alpha, not additive: the deform becomes the key values. */
function setDeform(
    deform: Float64Array,
    count: number,
    from: Float32Array,
    to: Float32Array | null,
    values: Float64Array,
): void {
    const percent = Number(values[0]);

    for (let i = 0; i < count; i++) {
        const prev = Number(from[i]);

        deform[i] = to === null ? prev : prev + (Number(to[i]) - prev) * percent;
    }
}

/**
 * Blend `add`: adds the key values to the deform. `setup` holds the setup positions of a mesh
 * without weights, whose keys are positions. It is null for a mesh with weights, whose keys are offsets.
 */
function addDeform(
    deform: Float64Array,
    count: number,
    from: Float32Array,
    to: Float32Array | null,
    values: Float64Array,
    setup: Float32Array | null,
): void {
    const alpha = Number(SHARED[ALPHA]);
    const percent = Number(values[0]);

    for (let i = 0; i < count; i++) {
        const prev = Number(from[i]);
        const value = to === null ? prev : prev + (Number(to[i]) - prev) * percent;

        deform[i] = Number(deform[i]) + (setup === null ? value : value - Number(setup[i])) * alpha;
    }
}

/** Blend `setup` below full alpha: mixes from the setup shape to the key values. `setup` is as in {@link addDeform}. */
function mixDeformFromSetup(
    deform: Float64Array,
    count: number,
    from: Float32Array,
    to: Float32Array | null,
    values: Float64Array,
    setup: Float32Array | null,
): void {
    const alpha = Number(SHARED[ALPHA]);
    const percent = Number(values[0]);

    for (let i = 0; i < count; i++) {
        const prev = Number(from[i]);
        const value = to === null ? prev : prev + (Number(to[i]) - prev) * percent;

        if (setup === null) {
            deform[i] = value * alpha;
        } else {
            const start = Number(setup[i]);

            deform[i] = start + (value - start) * alpha;
        }
    }
}

/** Blends `first` and `replace` below full alpha: mixes from the current deform to the key values. */
function mixDeform(
    deform: Float64Array,
    count: number,
    from: Float32Array,
    to: Float32Array | null,
    values: Float64Array,
): void {
    const alpha = Number(SHARED[ALPHA]);
    const percent = Number(values[0]);

    for (let i = 0; i < count; i++) {
        const prev = Number(from[i]);
        const value = to === null ? prev : prev + (Number(to[i]) - prev) * percent;
        const current = Number(deform[i]);

        deform[i] = current + (value - current) * alpha;
    }
}

/** Before the first key with blend `first`: moves the deform toward the setup shape. */
function mixDeformToSetup(deform: Float64Array, count: number, setup: Float32Array | null): void {
    const alpha = Number(SHARED[ALPHA]);
    if (setup === null) {
        const rest = 1 - alpha;

        for (let i = 0; i < count; i++) deform[i] = Number(deform[i]) * rest;
    } else {
        for (let i = 0; i < count; i++) {
            const current = Number(deform[i]);

            deform[i] = current + (Number(setup[i]) - current) * alpha;
        }
    }
}

/** The deform before the first key of a timeline: cleared, or moved toward the setup shape for blend `first`. */
function deformBeforeFirstKey(
    pose: PoseState,
    slot: number,
    count: number,
    blend: number,
    setup: Float32Array | null,
): void {
    const alpha = Number(SHARED[ALPHA]);
    if (blend === SETUP || (blend === FIRST && alpha === 1)) pose.deformLengths[slot] = 0;
    else if (blend === FIRST) mixDeformToSetup(resizeDeform(pose, slot, count), count, setup);
}

/** The deform at or after the first key of a timeline. `values` is scratch space. */
function deformFromKeys(
    deform: Float64Array,
    timeline: LegacyTimeline,
    first: Float32Array,
    blend: number,
    setup: Float32Array | null,
    values: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const alpha = Number(SHARED[ALPHA]);
    const { frames, curves, vertices } = timeline;
    const count = first.length;
    let from = vertices[frames.length - 1] ?? first;
    let to: Float32Array | null = null;

    if (!(time >= Number(frames[frames.length - 1]))) {
        // between two keys, at the percentage that goes to values[0]
        const frame = search(frames, 1);

        curvePercent(frames, curves, frame, values);
        from = vertices[frame] ?? first;
        to = vertices[frame + 1] ?? first;
    }
    if (blend === ADD) addDeform(deform, count, from, to, values, setup);
    else if (alpha === 1) setDeform(deform, count, from, to, values);
    else if (blend === SETUP) mixDeformFromSetup(deform, count, from, to, values, setup);
    else mixDeform(deform, count, from, to, values);
}

/** The official `DeformTimeline.apply`. `values` is scratch space. */
export function applyDeform(
    rig: Rig,
    pose: PoseState,
    timeline: LegacyTimeline,
    mixBlend: number,
    values: Float64Array,
): void {
    const time = Number(SHARED[TIME]);
    const slot = timeline.target;
    const shown = pose.attachments[slot] ?? null;
    const first = timeline.vertices[0];

    if (shown === null || first === undefined) return;
    const facts = factsOf(rig, shown);

    // the slot must show an attachment that takes its timelines from the one this timeline deforms
    if (facts.timeline !== timeline.attachment || facts.geometry === null) return;
    // a slot without a deform starts from the setup shape
    const blend = pose.deformLengths[slot] === 0 ? SETUP : mixBlend;
    const setup = facts.geometry.bones === null ? facts.geometry.vertices : null;

    if (time < Number(timeline.frames[0])) {
        deformBeforeFirstKey(pose, slot, first.length, blend, setup);
    } else {
        deformFromKeys(resizeDeform(pose, slot, first.length), timeline, first, blend, setup, values);
    }
}
