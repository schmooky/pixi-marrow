import { MarrowError } from '../../base/errors';
import type { EventKey } from '../../model/timelines';
import { LAST_TIME, SHARED, search, TIME } from './curves';
import { followerInfo, timelineActive } from './slots';
import { CURRENT, type Pose43, type Timeline43 } from './types';

// The official `SequenceMode` values. A sequence key holds one in its low four bits.
const HOLD = 0;
const ONCE = 1;
const LOOP = 2;
const PINGPONG = 3;
const ONCE_REVERSE = 4;
const LOOP_REVERSE = 5;
const PINGPONG_REVERSE = 6;

/*
 * The sequence, event and draw order timelines. Each reads its times from `SHARED`, for the
 * reasons given in curves.ts.
 */

/** Folds a frame number into a sequence of `count` regions that plays forth and back. */
function pingpong(index: number, count: number): number {
    const n = (count << 1) - 2;
    const folded = n === 0 ? 0 : index % n;

    return folded >= count ? n - folded : folded;
}

/** The region a sequence shows, like the official `SequenceTimeline.applyToSlot` computes it. */
function sequenceIndex(mode: number, index: number, count: number): number {
    switch (mode) {
        case ONCE:
            return Math.min(count - 1, index);
        case LOOP:
            return index % count;
        case PINGPONG:
            return pingpong(index, count);
        case ONCE_REVERSE:
            return Math.max(count - 1 - index, 0);
        case LOOP_REVERSE:
            return count - 1 - (index % count);
        case PINGPONG_REVERSE:
            return pingpong(index + count - 1, count);
        default:
            return index;
    }
}

/**
 * Writes the sequence index of one slot, when the slot shows an attachment the timeline applies to.
 *
 * @param mode The official `SequenceMode` of the key.
 * @param index The frame number the key is at by now. A whole number.
 */
function applySequenceToSlot(pose: Pose43, timeline: Timeline43, slot: number, mode: number, index: number): void {
    const info = followerInfo(pose, slot, timeline);

    if (info === null) return;
    if (info.sequenceCount < 0) {
        const name = pose.rig.model.slots.names[slot];

        throw new MarrowError(
            'invalid-data',
            `A sequence timeline animates the slot "${name}", whose attachment has no sequence.`,
            {
                fix: 'Export the skeleton again from Spine.',
            },
        );
    }
    pose.sequenceIndices[slot] = mode === HOLD ? index : sequenceIndex(mode, index, info.sequenceCount);
}

/** The official sequence timeline: the region of an attachment's sequence, in every slot that follows it. */
export function applySequence(pose: Pose43, timeline: Timeline43, from: number, out: boolean): void {
    const { frames, target, slots } = timeline;
    const time = Number(SHARED[TIME]);

    if (!timelineActive(pose, target, timeline, slots)) return;
    if (out || time < Number(frames[0])) {
        if (from === CURRENT) return;
        const indices = pose.sequenceIndices;

        if (followerInfo(pose, target, timeline) !== null) indices[target] = -1;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i] ?? -1;

            if (followerInfo(pose, slot, timeline) !== null) indices[slot] = -1;
        }

        return;
    }
    const i = search(frames, 3);
    const modeAndIndex = Number(frames[i + 1]);
    const mode = modeAndIndex & 0xf;
    let index = modeAndIndex >> 4;

    // the frames that passed since the key. Whole numbers from here on.
    if (mode !== HOLD) index += ((time - Number(frames[i])) / Number(frames[i + 2]) + 0.00001) | 0;
    applySequenceToSlot(pose, timeline, target, mode, index);
    for (let k = 0; k < slots.length; k++) applySequenceToSlot(pose, timeline, slots[k] ?? -1, mode, index);
}

/**
 * Collects the events of the keys after the last time in `SHARED`, up to the time in `SHARED`.
 *
 * @param checkEnd False when the last time is the start of a new loop. Then the official code
 * does not compare it with the last key.
 */
function collectEvents(timeline: Timeline43, events: EventKey[], checkEnd: boolean): void {
    const frames = timeline.frames;
    const frameCount = frames.length;
    const lastTime = Number(SHARED[LAST_TIME]);
    const time = Number(SHARED[TIME]);

    if (checkEnd && lastTime >= Number(frames[frameCount - 1])) return;
    if (time < Number(frames[0])) return;
    let i = 0;

    if (!(lastTime < Number(frames[0]))) {
        // the official search for the last time, plus one: the first key after it
        i = 1;
        while (i < frameCount && !(Number(frames[i]) > lastTime)) i++;
        const frameTime = Number(frames[i]);

        // keys at one time fire together
        while (i > 0 && Number(frames[i - 1]) === frameTime) i--;
    }
    for (; i < frameCount && time >= Number(frames[i]); i++) {
        const event = timeline.events[i];

        if (event !== undefined) events.push(event);
    }
}

/** The official event timeline: collects the events of the keys after the last time, up to the time. */
export function applyEvent(timeline: Timeline43, events: EventKey[] | null): void {
    if (!events) return;
    const lastTime = Number(SHARED[LAST_TIME]);
    const time = Number(SHARED[TIME]);

    if (!(lastTime > time)) {
        collectEvents(timeline, events, true);

        return;
    }
    // the animation looped: first the events up to its end, then those from its start
    SHARED[TIME] = Number.MAX_VALUE;
    collectEvents(timeline, events, true);
    SHARED[TIME] = time;
    SHARED[LAST_TIME] = -1;
    collectEvents(timeline, events, false);
    SHARED[LAST_TIME] = lastTime;
}

/** The official draw order timeline: the order of every slot. A null key is the setup order. */
export function applyDrawOrder(pose: Pose43, timeline: Timeline43, from: number, out: boolean): void {
    const drawOrder = pose.drawOrder;
    const frames = timeline.frames;
    let order: Int16Array | null = null;

    if (out || Number(SHARED[TIME]) < Number(frames[0])) {
        if (from === CURRENT) return;
    } else {
        order = timeline.orders[search(frames, 1)] ?? null;
    }
    if (order === null) {
        for (let i = 0; i < drawOrder.length; i++) drawOrder[i] = i;
    } else {
        drawOrder.set(order);
    }
}

/**
 * The official draw order folder timeline: the order of the slots of one folder among themselves.
 * The positions the folder takes in the draw order stay. A null key is the setup order.
 */
export function applyDrawOrderFolder(pose: Pose43, timeline: Timeline43, from: number, out: boolean): void {
    const { slots, inFolder, frames } = timeline;
    const drawOrder = pose.drawOrder;
    let order: Int16Array | null = null;

    if (out || Number(SHARED[TIME]) < Number(frames[0])) {
        if (from === CURRENT) return;
    } else {
        order = timeline.orders[search(frames, 1)] ?? null;
    }
    let found = 0;

    for (let i = 0; i < drawOrder.length && found < slots.length; i++) {
        if (inFolder[drawOrder[i] ?? -1] !== 1) continue;
        const next = order === null ? found : (order[found] ?? -1);

        drawOrder[i] = slots[next] ?? -1;
        found++;
    }
    if (found < slots.length) {
        // the official loop runs past the end of the draw order here
        throw new MarrowError(
            'invalid-data',
            'A draw order folder timeline has slots that the draw order does not hold.',
            {
                fix: 'Export the skeleton again from Spine.',
            },
        );
    }
}
