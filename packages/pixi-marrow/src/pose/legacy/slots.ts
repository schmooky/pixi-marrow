import type { EventKey } from '../../model/timelines';
import type { PoseState } from '../state';
import { LAST_TIME, SHARED, search, TIME } from './curves';
import { factsOf, type Rig } from './rig';
import { findAttachment, setSlotAttachment } from './skeleton';
import { stampDrawOrder, stampSlot } from './stamps';
import { FIRST, type LegacyTimeline, MIX_OUT, SETUP } from './timelines';

const SEQUENCE_ENTRIES = 3;
const SEQUENCE_HOLD = 0;
const SEQUENCE_ONCE = 1;
const SEQUENCE_LOOP = 2;
const SEQUENCE_PINGPONG = 3;
const SEQUENCE_ONCE_REVERSE = 4;
const SEQUENCE_LOOP_REVERSE = 5;
const SEQUENCE_PINGPONG_REVERSE = 6;

/** The official `AttachmentTimeline.apply`. The engine calls it only while mixing out with blend `add`. */
export function applyAttachment(
    rig: Rig,
    pose: PoseState,
    timeline: LegacyTimeline,
    blend: number,
    direction: number,
): void {
    const time = Number(SHARED[TIME]);
    const slot = timeline.target;
    const setupName = rig.model.slots.attachments[slot] ?? null;

    if (direction === MIX_OUT) {
        if (blend === SETUP) setSlotAttachment(rig, pose, slot, findAttachment(rig, pose, slot, setupName));
    } else if (time < Number(timeline.frames[0])) {
        if (blend === SETUP || blend === FIRST) {
            setSlotAttachment(rig, pose, slot, findAttachment(rig, pose, slot, setupName));
        }
    } else {
        const name = timeline.attachmentNames[search(timeline.frames, 1)] ?? null;

        setSlotAttachment(rig, pose, slot, findAttachment(rig, pose, slot, name));
    }
}

/** The official `DrawOrderTimeline.apply`. The draw order is stamped when a position gets another slot. */
export function applyDrawOrder(pose: PoseState, timeline: LegacyTimeline, blend: number, direction: number): void {
    const time = Number(SHARED[TIME]);
    const drawOrder = pose.drawOrder;
    let order: Int16Array | null = null;
    let changed = false;

    if (direction === MIX_OUT) {
        if (blend !== SETUP) return;
    } else if (time < Number(timeline.frames[0])) {
        if (blend !== SETUP && blend !== FIRST) return;
    } else {
        order = timeline.drawOrders[search(timeline.frames, 1)] ?? null;
    }
    for (let i = 0, n = order === null ? drawOrder.length : order.length; i < n; i++) {
        const slot = order === null ? i : Number(order[i]);

        if (drawOrder[i] !== slot) changed = true;
        drawOrder[i] = slot;
    }
    if (changed) stampDrawOrder(pose);
}

/**
 * Wraps the index of a sequence frame into the `count` frames of the sequence. `mode` is the
 * number of the official `SequenceMode`.
 */
function sequenceIndex(mode: number, start: number, count: number): number {
    let index = start;

    switch (mode) {
        case SEQUENCE_ONCE:
            return Math.min(count - 1, index);
        case SEQUENCE_LOOP:
            return index % count;
        case SEQUENCE_PINGPONG: {
            const n = (count << 1) - 2;

            index = n === 0 ? 0 : index % n;

            return index >= count ? n - index : index;
        }
        case SEQUENCE_ONCE_REVERSE:
            return Math.max(count - 1 - index, 0);
        case SEQUENCE_LOOP_REVERSE:
            return count - 1 - (index % count);
        case SEQUENCE_PINGPONG_REVERSE: {
            const n = (count << 1) - 2;

            index = n === 0 ? 0 : (index + count - 1) % n;

            return index >= count ? n - index : index;
        }
        default:
            return index;
    }
}

/** Sets the sequence index of a slot and stamps the slot when the index is a new one. */
function setSequenceIndex(pose: PoseState, slot: number, index: number): void {
    // the array holds 32-bit integers: compare what it will hold
    if (pose.sequenceIndices[slot] !== (index | 0)) stampSlot(pose, slot);
    pose.sequenceIndices[slot] = index;
}

/**
 * The official `SequenceTimeline.apply`. The 4.2 runtime resets the index while mixing out with
 * blend `setup` and changes nothing while mixing out otherwise. The 4.1 runtime ignores the direction.
 */
export function applySequence(
    rig: Rig,
    pose: PoseState,
    timeline: LegacyTimeline,
    blend: number,
    direction: number,
): void {
    const time = Number(SHARED[TIME]);
    const slot = timeline.target;
    const { frames, attachment } = timeline;
    const shown = pose.attachments[slot] ?? null;

    // the slot must show the attachment, or one that takes its timelines from it
    if (shown !== attachment && (shown === null || factsOf(rig, shown).timeline !== attachment)) return;
    if (direction === MIX_OUT && !rig.v41) {
        if (blend === SETUP) setSequenceIndex(pose, slot, -1);

        return;
    }
    if (time < Number(frames[0])) {
        if (blend === SETUP || blend === FIRST) setSequenceIndex(pose, slot, -1);

        return;
    }
    const i = search(frames, SEQUENCE_ENTRIES);
    const before = Number(frames[i]);
    const modeAndIndex = Number(frames[i + 1]);
    const delay = Number(frames[i + 2]);

    if (timeline.sequenceCount < 0) return;
    const mode = modeAndIndex & 0xf;
    let index = modeAndIndex >> 4;

    if (mode !== SEQUENCE_HOLD) {
        index += ((time - before) / delay + 0.00001) | 0;
        index = sequenceIndex(mode, index, timeline.sequenceCount);
    }
    setSequenceIndex(pose, slot, index);
}

/**
 * Adds the events of the keys after the last time in `SHARED`, up to the time in `SHARED`, to `fired`.
 *
 * @param checkEnd False when the last time is the start of a new loop. Then the official code
 * does not compare it with the last key.
 */
function collectEvents(timeline: LegacyTimeline, fired: EventKey[], checkEnd: boolean): void {
    const { frames, events } = timeline;
    const frameCount = frames.length;
    const last = Number(SHARED[LAST_TIME]);
    const time = Number(SHARED[TIME]);

    if (checkEnd && last >= Number(frames[frameCount - 1])) return;
    if (time < Number(frames[0])) return;
    let i = 0;

    if (!(last < Number(frames[0]))) {
        // the official search for the last time, plus one: the first key after it
        i = 1;
        while (i < frameCount && !(Number(frames[i]) > last)) i++;
        const frameTime = Number(frames[i]);

        // events with the same time fire together
        while (i > 0 && Number(frames[i - 1]) === frameTime) i--;
    }
    for (; i < frameCount && time >= Number(frames[i]); i++) {
        const event = events[i];

        if (event !== undefined) fired.push(event);
    }
}

/**
 * The official `EventTimeline.apply`: adds the events after the last time up to the time to
 * `fired`. Both times are read from `SHARED`. A last time after the time means the animation looped.
 */
export function applyEvents(timeline: LegacyTimeline, fired: EventKey[]): void {
    const last = Number(SHARED[LAST_TIME]);
    const time = Number(SHARED[TIME]);

    if (!(last > time)) {
        collectEvents(timeline, fired, true);

        return;
    }
    // fire the events up to the end of the loop first, then those from its start
    SHARED[TIME] = Number.MAX_VALUE;
    collectEvents(timeline, fired, true);
    SHARED[TIME] = time;
    SHARED[LAST_TIME] = -1;
    collectEvents(timeline, fired, false);
    SHARED[LAST_TIME] = last;
}
