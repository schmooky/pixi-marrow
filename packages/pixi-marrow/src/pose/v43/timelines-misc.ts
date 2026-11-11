import { MarrowError } from '../../base/errors';
import { f32, search } from './curves';
import { followerInfo, timelineActive } from './slots';
import { CURRENT, type Pose43, type Timeline43, type TimelineKernel } from './types';

// The official `SequenceMode` values. A sequence key holds one in its low four bits.
const HOLD = 0;
const ONCE = 1;
const LOOP = 2;
const PINGPONG = 3;
const ONCE_REVERSE = 4;
const LOOP_REVERSE = 5;
const PINGPONG_REVERSE = 6;

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

/** Writes the sequence index of one slot, when the slot shows an attachment the timeline applies to. */
function applySequenceToSlot(
    pose: Pose43,
    timeline: Timeline43,
    slot: number,
    time: number,
    before: number,
    modeAndIndex: number,
    delay: number,
): void {
    const info = followerInfo(pose, slot, timeline.attachment);

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
    const mode = modeAndIndex & 0xf;
    let index = modeAndIndex >> 4;

    if (mode !== HOLD) {
        index += ((time - before) / delay + 0.00001) | 0;
        index = sequenceIndex(mode, index, info.sequenceCount);
    }
    pose.state.sequenceIndices[slot] = index;
}

/** The official sequence timeline: the region of an attachment's sequence, in every slot that follows it. */
export const applySequence: TimelineKernel = (pose, timeline, _lastTime, time, _events, _alpha, from, _add, out) => {
    const { frames, target, slots } = timeline;

    if (!timelineActive(pose, target, timeline.attachment, slots)) return;
    if (out || time < f32(frames, 0)) {
        if (from === CURRENT) return;
        const indices = pose.state.sequenceIndices;

        if (followerInfo(pose, target, timeline.attachment) !== null) indices[target] = -1;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i] ?? -1;

            if (followerInfo(pose, slot, timeline.attachment) !== null) indices[slot] = -1;
        }

        return;
    }
    const i = search(frames, time, 3);
    const before = f32(frames, i);
    const modeAndIndex = f32(frames, i + 1);
    const delay = f32(frames, i + 2);

    applySequenceToSlot(pose, timeline, target, time, before, modeAndIndex, delay);
    for (let k = 0; k < slots.length; k++) {
        applySequenceToSlot(pose, timeline, slots[k] ?? -1, time, before, modeAndIndex, delay);
    }
};

/** The official event timeline: collects the events of the keys after `lastTime`, up to `time`. */
export const applyEvent: TimelineKernel = (pose, timeline, lastTime, time, events, alpha, from, add, out) => {
    if (!events) return;
    const frames = timeline.frames;
    const frameCount = frames.length;

    if (lastTime > time) {
        // the animation looped: first the events up to its end
        applyEvent(pose, timeline, lastTime, Number.MAX_VALUE, events, alpha, from, add, out);
        lastTime = -1;
    } else if (lastTime >= f32(frames, frameCount - 1)) return;
    if (time < f32(frames, 0)) return;
    let i = 0;

    if (!(lastTime < f32(frames, 0))) {
        i = search(frames, lastTime, 1) + 1;
        const frameTime = f32(frames, i);

        // keys at one time fire together
        while (i > 0 && f32(frames, i - 1) === frameTime) i--;
    }
    for (; i < frameCount && time >= f32(frames, i); i++) {
        const event = timeline.events[i];

        if (event !== undefined) events.push(event);
    }
};

/** The official draw order timeline: the order of every slot. A null key is the setup order. */
export const applyDrawOrder: TimelineKernel = (pose, timeline, _lastTime, time, _events, _alpha, from, _add, out) => {
    const drawOrder = pose.state.drawOrder;
    let order: Int16Array | null = null;

    if (out || time < f32(timeline.frames, 0)) {
        if (from === CURRENT) return;
    } else {
        order = timeline.orders[search(timeline.frames, time, 1)] ?? null;
    }
    if (order === null) {
        for (let i = 0; i < drawOrder.length; i++) drawOrder[i] = i;
    } else {
        drawOrder.set(order);
    }
};

/**
 * The official draw order folder timeline: the order of the slots of one folder among themselves.
 * The positions the folder takes in the draw order stay. A null key is the setup order.
 */
export const applyDrawOrderFolder: TimelineKernel = (
    pose,
    timeline,
    _lastTime,
    time,
    _events,
    _alpha,
    from,
    _add,
    out,
) => {
    const { slots, inFolder } = timeline;
    const drawOrder = pose.state.drawOrder;
    let order: Int16Array | null = null;

    if (out || time < f32(timeline.frames, 0)) {
        if (from === CURRENT) return;
    } else {
        order = timeline.orders[search(timeline.frames, time, 1)] ?? null;
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
};
