import { MarrowError } from '../../base/errors';
import type { PoseState } from '../state';
import { ALPHA, PERCENT, SHARED, search, TIME } from './curves';
import { followerInfo, timelineActive } from './slots';
import { type AttachmentInfo, FIRST, type Pose43, SETUP, type Timeline43 } from './types';

const LINEAR = 0;
const STEPPED = 1;
const BEZIER = 2;
const BEZIER_SIZE = 18;

/*
 * The deform timeline. It reads its time and its alpha from `SHARED` and keeps how far the time
 * is between two keys there, for the reasons given in curves.ts.
 */

/**
 * The official `DeformTimeline.getCurvePercent`: how far the time in `SHARED` is between a key
 * and the next. Writes it to `SHARED` at `PERCENT`.
 */
function curvePercent(timeline: Timeline43, frame: number): void {
    const { frames, curves } = timeline;
    const time = Number(SHARED[TIME]);
    const type = Number(curves[frame]);

    if (type === LINEAR) {
        const x = Number(frames[frame]);

        SHARED[PERCENT] = (time - x) / (Number(frames[frame + 1]) - x);

        return;
    }
    if (type === STEPPED) {
        SHARED[PERCENT] = 0;

        return;
    }
    let i = type - BEZIER;
    const first = Number(curves[i]);

    if (first > time) {
        const x = Number(frames[frame]);

        SHARED[PERCENT] = (Number(curves[i + 1]) * (time - x)) / (first - x);

        return;
    }
    const n = i + BEZIER_SIZE;

    for (i += 2; i < n; i += 2) {
        const end = Number(curves[i]);

        if (end >= time) {
            const x = Number(curves[i - 2]);
            const y = Number(curves[i - 1]);

            SHARED[PERCENT] = y + ((time - x) / (end - x)) * (Number(curves[i + 1]) - y);

            return;
        }
    }
    const x = Number(curves[n - 2]);
    const y = Number(curves[n - 1]);

    SHARED[PERCENT] = y + ((1 - y) * (time - x)) / (Number(frames[frame + 1]) - x);
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

/*
 * The four ways the keyed vertices get into a deform. `v2` is null at the last key. Otherwise the
 * value of a vertex is between `v1` and `v2`, by the percent in `SHARED`.
 */

/** Adds the keyed offsets to the deform. `setup` holds the setup positions of a mesh without weights. */
function addKeyed(
    deform: Float64Array,
    v1: Float32Array,
    v2: Float32Array | null,
    setup: Float32Array | null,
    count: number,
): void {
    const percent = Number(SHARED[PERCENT]);
    const alpha = Number(SHARED[ALPHA]);

    for (let i = 0; i < count; i++) {
        const prev = Number(v1[i]);
        const keyed = v2 === null ? prev : prev + (Number(v2[i]) - prev) * percent;

        deform[i] = Number(deform[i]) + (setup === null ? keyed : keyed - Number(setup[i])) * alpha;
    }
}

/** Replaces the deform with the keyed values, at full alpha. */
function setKeyed(deform: Float64Array, v1: Float32Array, v2: Float32Array | null, count: number): void {
    const percent = Number(SHARED[PERCENT]);

    if (v2 === null || percent === 0) {
        for (let i = 0; i < count; i++) deform[i] = Number(v1[i]);
    } else {
        for (let i = 0; i < count; i++) {
            const prev = Number(v1[i]);

            deform[i] = prev + (Number(v2[i]) - prev) * percent;
        }
    }
}

/** Mixes the keyed values in from the setup pose. */
function mixKeyedFromSetup(
    deform: Float64Array,
    v1: Float32Array,
    v2: Float32Array | null,
    setup: Float32Array | null,
    count: number,
): void {
    const percent = Number(SHARED[PERCENT]);
    const alpha = Number(SHARED[ALPHA]);

    for (let i = 0; i < count; i++) {
        const prev = Number(v1[i]);
        const keyed = v2 === null ? prev : prev + (Number(v2[i]) - prev) * percent;

        if (setup === null) deform[i] = keyed * alpha;
        else {
            const base = Number(setup[i]);

            deform[i] = base + (keyed - base) * alpha;
        }
    }
}

/** Mixes the keyed values in from the current deform. */
function mixKeyed(deform: Float64Array, v1: Float32Array, v2: Float32Array | null, count: number): void {
    const percent = Number(SHARED[PERCENT]);
    const alpha = Number(SHARED[ALPHA]);

    for (let i = 0; i < count; i++) {
        const prev = Number(v1[i]);
        const keyed = v2 === null ? prev : prev + (Number(v2[i]) - prev) * percent;
        const current = Number(deform[i]);

        deform[i] = current + (keyed - current) * alpha;
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
function applyBeforeFirst(pose: Pose43, timeline: Timeline43, slot: number, from: number): void {
    const info = followerInfo(pose, slot, timeline);

    if (info === null) return;
    const { state } = pose;
    const alpha = Number(SHARED[ALPHA]);

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

        for (let i = 0; i < count; i++) deform[i] = Number(deform[i]) * keep;
    } else {
        for (let i = 0; i < count; i++) {
            const current = Number(deform[i]);

            deform[i] = current + (Number(setup[i]) - current) * alpha;
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
    from: number,
    add: boolean,
): void {
    const info = followerInfo(pose, slot, timeline);

    if (info === null) return;
    const { state } = pose;
    // an empty deform counts as the setup pose
    const fromSetup = from === SETUP || state.deformLengths[slot] === 0;
    const count = timeline.vertices[0]?.length ?? 0;
    const setup = setupVertices(pose, slot, info);
    const deform = resizeDeform(state, slot, count);

    if (add && !fromSetup) addKeyed(deform, v1, v2, setup, count);
    else if (Number(SHARED[ALPHA]) === 1) setKeyed(deform, v1, v2, count);
    else if (fromSetup) mixKeyedFromSetup(deform, v1, v2, setup, count);
    else mixKeyed(deform, v1, v2, count);
}

/** The official deform timeline: the vertices of an attachment, in every slot that follows it. */
export function applyDeform(pose: Pose43, timeline: Timeline43, from: number, add: boolean): void {
    const { frames, target, slots, vertices } = timeline;

    if (!timelineActive(pose, target, timeline, slots)) return;
    if (Number(SHARED[TIME]) < Number(frames[0])) {
        applyBeforeFirst(pose, timeline, target, from);
        for (let i = 0; i < slots.length; i++) applyBeforeFirst(pose, timeline, slots[i] ?? -1, from);

        return;
    }
    let frame = frames.length - 1;
    let v2: Float32Array | null = null;

    SHARED[PERCENT] = 0;
    if (!(Number(SHARED[TIME]) >= Number(frames[frame]))) {
        frame = search(frames, 1);
        curvePercent(timeline, frame);
        v2 = vertices[frame + 1] ?? null;
    }
    const v1 = vertices[frame];

    if (v1 === undefined) return;
    applyToSlot(pose, timeline, target, v1, v2, from, add);
    for (let i = 0; i < slots.length; i++) applyToSlot(pose, timeline, slots[i] ?? -1, v1, v2, from, add);
}
