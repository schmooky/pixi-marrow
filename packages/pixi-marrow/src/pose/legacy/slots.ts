import type { EventKey } from '../../model/timelines';
import type { PoseState } from '../state';
import { search } from './curves';
import { factsOf, type Rig } from './rig';
import { findAttachment, setSlotAttachment } from './skeleton';
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
    time: number,
    blend: number,
    direction: number,
): void {
    const slot = timeline.target;
    const setupName = rig.model.slots.attachments[slot] ?? null;

    if (direction === MIX_OUT) {
        if (blend === SETUP) setSlotAttachment(rig, pose, slot, findAttachment(rig, pose, slot, setupName));
    } else if (time < Number(timeline.frames[0])) {
        if (blend === SETUP || blend === FIRST) {
            setSlotAttachment(rig, pose, slot, findAttachment(rig, pose, slot, setupName));
        }
    } else {
        const name = timeline.attachmentNames[search(timeline.frames, time, 1)] ?? null;

        setSlotAttachment(rig, pose, slot, findAttachment(rig, pose, slot, name));
    }
}

/** The official `DrawOrderTimeline.apply`. */
export function applyDrawOrder(
    pose: PoseState,
    timeline: LegacyTimeline,
    time: number,
    blend: number,
    direction: number,
): void {
    const drawOrder = pose.drawOrder;
    let order: Int16Array | null = null;

    if (direction === MIX_OUT) {
        if (blend !== SETUP) return;
    } else if (time < Number(timeline.frames[0])) {
        if (blend !== SETUP && blend !== FIRST) return;
    } else {
        order = timeline.drawOrders[search(timeline.frames, time, 1)] ?? null;
    }
    if (order === null) {
        for (let i = 0; i < drawOrder.length; i++) drawOrder[i] = i;
    } else {
        drawOrder.set(order);
    }
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

/**
 * The official `SequenceTimeline.apply`. The 4.2 runtime resets the index while mixing out with
 * blend `setup` and changes nothing while mixing out otherwise. The 4.1 runtime ignores the direction.
 */
export function applySequence(
    rig: Rig,
    pose: PoseState,
    timeline: LegacyTimeline,
    time: number,
    blend: number,
    direction: number,
): void {
    const slot = timeline.target;
    const { frames, attachment } = timeline;
    const shown = pose.attachments[slot] ?? null;

    // the slot must show the attachment, or one that takes its timelines from it
    if (shown !== attachment && (shown === null || factsOf(rig, shown).timeline !== attachment)) return;
    if (direction === MIX_OUT && !rig.v41) {
        if (blend === SETUP) pose.sequenceIndices[slot] = -1;

        return;
    }
    if (time < Number(frames[0])) {
        if (blend === SETUP || blend === FIRST) pose.sequenceIndices[slot] = -1;

        return;
    }
    const i = search(frames, time, SEQUENCE_ENTRIES);
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
    pose.sequenceIndices[slot] = index;
}

/**
 * The official `EventTimeline.apply`: adds the events after `lastTime` up to `time` to `fired`.
 * A `lastTime` after `time` means the animation looped.
 */
export function applyEvents(timeline: LegacyTimeline, lastTime: number, time: number, fired: EventKey[]): void {
    const { frames, events } = timeline;
    const frameCount = frames.length;
    let last = lastTime;

    if (last > time) {
        // fire the events up to the end of the loop first
        applyEvents(timeline, last, Number.MAX_VALUE, fired);
        last = -1;
    } else if (last >= Number(frames[frameCount - 1])) {
        return;
    }
    if (time < Number(frames[0])) return;
    let i = 0;

    if (last < Number(frames[0])) {
        i = 0;
    } else {
        i = search(frames, last, 1) + 1;
        const frameTime = Number(frames[i]);

        // events with the same time fire together
        while (i > 0 && Number(frames[i - 1]) === frameTime) i--;
    }
    for (; i < frameCount && time >= Number(frames[i]); i++) {
        const event = events[i];

        if (event !== undefined) fired.push(event);
    }
}
