import { MarrowError } from '../../base/errors';
import type { PoseState } from '../state';
import { f32, f64, search } from './curves';
import { followerInfo, timelineActive } from './slots';
import { type AttachmentInfo, FIRST, type Pose43, SETUP, type Timeline43, type TimelineKernel } from './types';

const LINEAR = 0;
const STEPPED = 1;
const BEZIER = 2;
const BEZIER_SIZE = 18;

/** The official `DeformTimeline.getCurvePercent`: how far `time` is between a key and the next. */
function curvePercent(timeline: Timeline43, time: number, frame: number): number {
    const { frames, curves } = timeline;
    const type = f32(curves, frame);

    if (type === LINEAR) {
        const x = f32(frames, frame);

        return (time - x) / (f32(frames, frame + 1) - x);
    }
    if (type === STEPPED) return 0;
    let i = type - BEZIER;

    if (f32(curves, i) > time) {
        const x = f32(frames, frame);

        return (f32(curves, i + 1) * (time - x)) / (f32(curves, i) - x);
    }
    const n = i + BEZIER_SIZE;

    for (i += 2; i < n; i += 2) {
        if (f32(curves, i) >= time) {
            const x = f32(curves, i - 2);
            const y = f32(curves, i - 1);

            return y + ((time - x) / (f32(curves, i) - x)) * (f32(curves, i + 1) - y);
        }
    }
    const x = f32(curves, n - 2);
    const y = f32(curves, n - 1);

    return y + ((1 - y) * (time - x)) / (f32(frames, frame + 1) - x);
}

/**
 * Sets how many numbers of a slot's deform are in use and returns the array. This is the official
 * `deform.length = length`. Numbers that come into use hold NaN, as an official array holds
 * `undefined` there. Every caller that grows an empty deform writes all of it.
 */
function resizeDeform(state: PoseState, slot: number, length: number): Float64Array {
    const used = state.deformLengths[slot] ?? 0;
    let deform = state.deform[slot];

    if (deform === undefined || deform.length < length) {
        const longer = new Float64Array(length);

        if (deform !== undefined) longer.set(deform.subarray(0, used));
        state.deform[slot] = longer;
        deform = longer;
    }
    if (used > 0 && length > used) deform.fill(Number.NaN, used, length);
    state.deformLengths[slot] = length;

    return deform;
}

/** The value of vertex number `i` at the time of the timeline: a key, or between two keys. */
function keyed(v1: Float32Array, v2: Float32Array | null, i: number, percent: number): number {
    const prev = f32(v1, i);

    return v2 === null ? prev : prev + (f32(v2, i) - prev) * percent;
}

/** Adds the keyed offsets to the deform. `setup` holds the setup positions of a mesh without weights. */
function addKeyed(
    deform: Float64Array,
    v1: Float32Array,
    v2: Float32Array | null,
    percent: number,
    setup: Float32Array | null,
    count: number,
    alpha: number,
): void {
    if (setup === null) {
        for (let i = 0; i < count; i++) deform[i] = f64(deform, i) + keyed(v1, v2, i, percent) * alpha;
    } else {
        for (let i = 0; i < count; i++) {
            deform[i] = f64(deform, i) + (keyed(v1, v2, i, percent) - f32(setup, i)) * alpha;
        }
    }
}

/** Replaces the deform with the keyed values, at full alpha. */
function setKeyed(
    deform: Float64Array,
    v1: Float32Array,
    v2: Float32Array | null,
    percent: number,
    count: number,
): void {
    if (v2 === null || percent === 0) {
        for (let i = 0; i < count; i++) deform[i] = f32(v1, i);
    } else {
        for (let i = 0; i < count; i++) deform[i] = keyed(v1, v2, i, percent);
    }
}

/** Mixes the keyed values in from the setup pose. */
function mixKeyedFromSetup(
    deform: Float64Array,
    v1: Float32Array,
    v2: Float32Array | null,
    percent: number,
    setup: Float32Array | null,
    count: number,
    alpha: number,
): void {
    if (setup === null) {
        for (let i = 0; i < count; i++) deform[i] = keyed(v1, v2, i, percent) * alpha;
    } else {
        for (let i = 0; i < count; i++) {
            const base = f32(setup, i);

            deform[i] = base + (keyed(v1, v2, i, percent) - base) * alpha;
        }
    }
}

/** Mixes the keyed values in from the current deform. */
function mixKeyed(
    deform: Float64Array,
    v1: Float32Array,
    v2: Float32Array | null,
    percent: number,
    count: number,
    alpha: number,
): void {
    for (let i = 0; i < count; i++) {
        const current = f64(deform, i);

        deform[i] = current + (keyed(v1, v2, i, percent) - current) * alpha;
    }
}

/** The setup positions a deform is relative to: the vertices of a mesh without weights, else null. */
function setupVertices(pose: Pose43, slot: number, info: AttachmentInfo): Float32Array | null {
    const geometry = info.geometry;

    if (geometry === null) {
        const name = pose.rig.model.slots.names[slot];

        throw new MarrowError(
            'invalid-data',
            `A deform timeline animates the slot "${name}", whose attachment has no vertices.`,
            { fix: 'Export the skeleton again from Spine.' },
        );
    }

    return geometry.bones === null ? geometry.vertices : null;
}

/** The official `DeformTimeline.applyBeforeFirst`: what a slot's deform does before the first key. */
function applyBeforeFirst(pose: Pose43, timeline: Timeline43, slot: number, alpha: number, from: number): void {
    const info = followerInfo(pose, slot, timeline.attachment);

    if (info === null) return;
    const { state } = pose;

    // an empty deform counts as the setup pose
    if (state.deformLengths[slot] === 0 || from === SETUP || (from === FIRST && alpha === 1)) {
        state.deformLengths[slot] = 0;

        return;
    }
    if (from !== FIRST) return;
    const count = timeline.vertices[0]?.length ?? 0;
    const deform = resizeDeform(state, slot, count);
    const setup = setupVertices(pose, slot, info);

    if (setup === null) {
        const keep = 1 - alpha;

        for (let i = 0; i < count; i++) deform[i] = f64(deform, i) * keep;
    } else {
        for (let i = 0; i < count; i++) {
            const current = f64(deform, i);

            deform[i] = current + (f32(setup, i) - current) * alpha;
        }
    }
}

/** The official `DeformTimeline.applyToSlot`: writes the keyed vertices into the deform of one slot. */
function applyToSlot(
    pose: Pose43,
    timeline: Timeline43,
    slot: number,
    v1: Float32Array,
    v2: Float32Array | null,
    percent: number,
    alpha: number,
    from: number,
    add: boolean,
): void {
    const info = followerInfo(pose, slot, timeline.attachment);

    if (info === null) return;
    const { state } = pose;
    // an empty deform counts as the setup pose
    const fromSetup = from === SETUP || state.deformLengths[slot] === 0;
    const count = timeline.vertices[0]?.length ?? 0;
    const setup = setupVertices(pose, slot, info);
    const deform = resizeDeform(state, slot, count);

    if (add && !fromSetup) addKeyed(deform, v1, v2, percent, setup, count, alpha);
    else if (alpha === 1) setKeyed(deform, v1, v2, percent, count);
    else if (fromSetup) mixKeyedFromSetup(deform, v1, v2, percent, setup, count, alpha);
    else mixKeyed(deform, v1, v2, percent, count, alpha);
}

/** The official deform timeline: the vertices of an attachment, in every slot that follows it. */
export const applyDeform: TimelineKernel = (pose, timeline, _lastTime, time, _events, alpha, from, add) => {
    const { frames, target, slots, vertices } = timeline;

    if (!timelineActive(pose, target, timeline.attachment, slots)) return;
    if (time < f32(frames, 0)) {
        applyBeforeFirst(pose, timeline, target, alpha, from);
        for (let i = 0; i < slots.length; i++) applyBeforeFirst(pose, timeline, slots[i] ?? -1, alpha, from);

        return;
    }
    let frame = frames.length - 1;
    let percent = 0;
    let v2: Float32Array | null = null;

    if (!(time >= f32(frames, frame))) {
        frame = search(frames, time, 1);
        percent = curvePercent(timeline, time, frame);
        v2 = vertices[frame + 1] ?? null;
    }
    const v1 = vertices[frame];

    if (v1 === undefined) return;
    applyToSlot(pose, timeline, target, v1, v2, percent, alpha, from, add);
    for (let i = 0; i < slots.length; i++) {
        applyToSlot(pose, timeline, slots[i] ?? -1, v1, v2, percent, alpha, from, add);
    }
};
