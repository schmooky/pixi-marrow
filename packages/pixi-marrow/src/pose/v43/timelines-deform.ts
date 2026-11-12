import { MarrowError } from '../../base/errors';
import { ALPHA, PERCENT, SHARED, search, TIME } from './curves';
import { followerInfo, stampSlot, timelineActive } from './slots';
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
function resizeDeform(pose: Pose43, slot: number, length: number): Float64Array {
    const used = pose.deformLengths[slot] ?? 0;
    let deform = pose.deform[slot];

    if (deform === undefined || deform.length < length) {
        const longer = new Float64Array(length);

        if (deform !== undefined) longer.set(deform.subarray(0, used));
        pose.deform[slot] = longer;
        deform = longer;
    }
    if (used > 0 && length > used) deform.fill(Number.NaN, used, length);
    pose.deformLengths[slot] = length;

    return deform;
}

/*
 * The four ways the keyed vertices get into a deform. `v2` is null at the last key. Otherwise the
 * value of a vertex is between `v1` and `v2`, by the percent in `SHARED`.
 *
 * Each returns true when a number of the deform is not what it was. The two that replace the
 * deform first look for the first number that differs and write from there on. A deform that
 * moves differs in its first number, so the look costs it next to nothing. One that holds is
 * found to be the same, and its slot keeps its stamp.
 */

/** Adds the keyed offsets to the deform. `setup` holds the setup positions of a mesh without weights. */
function addKeyed(
    deform: Float64Array,
    v1: Float32Array,
    v2: Float32Array | null,
    setup: Float32Array | null,
    count: number,
): boolean {
    const percent = Number(SHARED[PERCENT]);
    const alpha = Number(SHARED[ALPHA]);
    let changed = false;

    for (let i = 0; i < count; i++) {
        const prev = Number(v1[i]);
        const keyed = v2 === null ? prev : prev + (Number(v2[i]) - prev) * percent;
        const current = Number(deform[i]);
        const value = current + (setup === null ? keyed : keyed - Number(setup[i])) * alpha;

        if (!changed && !Object.is(value, current)) changed = true;
        deform[i] = value;
    }

    return changed;
}

/** Replaces the deform with the keyed values, at full alpha. */
function setKeyed(deform: Float64Array, v1: Float32Array, v2: Float32Array | null, count: number): boolean {
    const percent = Number(SHARED[PERCENT]);
    let i = 0;

    if (v2 === null || percent === 0) {
        while (i < count && Object.is(Number(v1[i]), Number(deform[i]))) i++;
        if (i === count) return false;
        for (; i < count; i++) deform[i] = Number(v1[i]);

        return true;
    }
    for (; i < count; i++) {
        const prev = Number(v1[i]);

        if (!Object.is(prev + (Number(v2[i]) - prev) * percent, Number(deform[i]))) break;
    }
    if (i === count) return false;
    for (; i < count; i++) {
        const prev = Number(v1[i]);

        deform[i] = prev + (Number(v2[i]) - prev) * percent;
    }

    return true;
}

/** Mixes the keyed values in from the setup pose. */
function mixKeyedFromSetup(
    deform: Float64Array,
    v1: Float32Array,
    v2: Float32Array | null,
    setup: Float32Array | null,
    count: number,
): boolean {
    const percent = Number(SHARED[PERCENT]);
    const alpha = Number(SHARED[ALPHA]);
    let changed = false;

    for (let i = 0; i < count; i++) {
        const prev = Number(v1[i]);
        const keyed = v2 === null ? prev : prev + (Number(v2[i]) - prev) * percent;
        const base = setup === null ? 0 : Number(setup[i]);
        const value = setup === null ? keyed * alpha : base + (keyed - base) * alpha;

        if (!changed && !Object.is(value, Number(deform[i]))) changed = true;
        deform[i] = value;
    }

    return changed;
}

/** Mixes the keyed values in from the current deform. */
function mixKeyed(deform: Float64Array, v1: Float32Array, v2: Float32Array | null, count: number): boolean {
    const percent = Number(SHARED[PERCENT]);
    const alpha = Number(SHARED[ALPHA]);
    let changed = false;

    for (let i = 0; i < count; i++) {
        const prev = Number(v1[i]);
        const keyed = v2 === null ? prev : prev + (Number(v2[i]) - prev) * percent;
        const current = Number(deform[i]);
        const value = current + (keyed - current) * alpha;

        if (!changed && !Object.is(value, current)) changed = true;
        deform[i] = value;
    }

    return changed;
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

/*
 * A deform timeline that stands at a key writes the vertices of that key in every update. The
 * engine notes the key a deform holds, in `Solve43.held`. While the note stands, the same key
 * again writes nothing and needs no look at the numbers. Everything else that writes a deform
 * takes the note away. An engine with sliders keeps no notes: its slots can have two poses.
 */

/** The key whose vertices the deform of a slot holds, as far as the engine knows. Null when it does not know. */
function heldKey(pose: Pose43, slot: number): Float32Array | null {
    return pose.solve.held?.[slot] ?? null;
}

/** Notes the key whose vertices the deform of a slot holds now. Null when it holds something else. */
function holdKey(pose: Pose43, slot: number, key: Float32Array | null): void {
    const { solve } = pose;

    if (solve.split !== null) return;
    if (solve.held === null) {
        if (key === null) return;
        solve.held = new Array<Float32Array | null>(pose.rig.model.slots.count).fill(null);
    }
    solve.held[slot] = key;
}

/** The official `DeformTimeline.applyBeforeFirst`: what a slot's deform does before the first key. */
function applyBeforeFirst(pose: Pose43, timeline: Timeline43, slot: number, from: number): void {
    const info = followerInfo(pose, slot, timeline);

    if (info === null) return;
    const alpha = Number(SHARED[ALPHA]);

    holdKey(pose, slot, null);
    // an empty deform counts as the setup pose
    if (pose.deformLengths[slot] === 0 || from === SETUP || (from === FIRST && alpha === 1)) {
        if (pose.deformLengths[slot] !== 0) stampSlot(pose, slot);
        pose.deformLengths[slot] = 0;

        return;
    }
    if (from !== FIRST) return;
    const count = timeline.vertices[0]?.length ?? 0;
    const deform = resizeDeform(pose, slot, count);
    const setup = setupVertices(pose, slot, info);

    stampSlot(pose, slot);

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
    // an empty deform counts as the setup pose
    const fromSetup = from === SETUP || pose.deformLengths[slot] === 0;
    const count = timeline.vertices[0]?.length ?? 0;
    const setup = setupVertices(pose, slot, info);
    const replaces = !(add && !fromSetup) && Number(SHARED[ALPHA]) === 1;
    // the deform becomes the vertices of one key, as they are
    const key = replaces && (v2 === null || Number(SHARED[PERCENT]) === 0) ? v1 : null;

    if (key !== null && heldKey(pose, slot) === key && pose.deformLengths[slot] === count) return;
    // a deform of another length is another deform, whatever its numbers are
    let changed = pose.deformLengths[slot] !== count;
    const deform = resizeDeform(pose, slot, count);

    if (replaces) changed = setKeyed(deform, v1, v2, count) || changed;
    else if (add && !fromSetup) changed = addKeyed(deform, v1, v2, setup, count) || changed;
    else if (fromSetup) changed = mixKeyedFromSetup(deform, v1, v2, setup, count) || changed;
    else changed = mixKeyed(deform, v1, v2, count) || changed;
    holdKey(pose, slot, key);
    if (changed) stampSlot(pose, slot);
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
