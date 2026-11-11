import type { AnimationData } from '../../model/model';
import type { EventKey } from '../../model/timelines';
import { readAttachmentTimelines } from './attachment-timelines';
import {
    readIkTimelines,
    readPathTimelines,
    readPhysicsTimelines,
    readTransformTimelines,
} from './constraint-timelines';
import { addTimeline, type TimelineList } from './curves';
import { readBoneTimelines, readSlotTimelines } from './pose-timelines';
import { type ImportState, invalid, readCount, readIndex, requireName } from './state';

/**
 * Reads the slot order of one draw order key. The file lists the slots that move, in setup
 * order, each with how far it moves. The slots that stay fill the free places in their setup order.
 */
function readDrawOrder(state: ImportState): Int16Array {
    const { input, slotCount } = state;
    const offsetCount = readCount(state, 'draw order offsets');

    if (offsetCount > slotCount) throw invalid('A draw order key moves more slots than the skeleton has.');
    const drawOrder = new Int16Array(slotCount).fill(-1);
    const unchanged = new Int16Array(slotCount - offsetCount);
    let originalIndex = 0;
    let unchangedIndex = 0;

    for (let i = 0; i < offsetCount; i++) {
        const slot = readIndex(state, slotCount, 'slot');

        if (slot < originalIndex) throw invalid('A draw order key lists its slots out of order.');
        // collect the slots that stay
        while (originalIndex !== slot) unchanged[unchangedIndex++] = originalIndex++;
        const place = originalIndex + input.readInt(true);

        if (place < 0 || place >= slotCount) throw invalid('A draw order key moves a slot out of the draw order.');
        drawOrder[place] = originalIndex++;
    }
    while (originalIndex < slotCount) unchanged[unchangedIndex++] = originalIndex++;
    for (let i = slotCount - 1; i >= 0; i--) {
        if (drawOrder[i] !== -1) continue;
        if (unchangedIndex === 0) throw invalid('A draw order key moves two slots to the same place.');
        drawOrder[i] = unchanged[--unchangedIndex] ?? 0;
    }

    return drawOrder;
}

/** Reads the draw order timeline, when the animation has one. */
function readDrawOrderTimeline(state: ImportState, list: TimelineList): void {
    const frameCount = readCount(state, 'draw order keys');

    if (frameCount === 0) return;
    const frames = new Float32Array(frameCount);
    const drawOrders: Int16Array[] = [];

    for (let frame = 0; frame < frameCount; frame++) {
        frames[frame] = state.input.readFloat();
        drawOrders.push(readDrawOrder(state));
    }
    addTimeline(list, { kind: 'drawOrder', target: -1, frames, curves: null, drawOrders }, 1);
}

/**
 * Reads the string of an event key. A key without one uses the string of its event.
 * 4.1 marks a stored string with a boolean. 4.2 stores no string instead.
 */
function readEventString(state: ImportState, fallback: string): string {
    const { input, version } = state;

    if (version === '4.2') return input.readString() ?? fallback;
    if (!input.readBoolean()) return fallback;

    return input.readString() ?? '';
}

/** Reads one event key. Only events with audio store a volume and a balance. */
function readEventKey(state: ImportState): EventKey {
    const { input } = state;
    const time = input.readFloat();
    const event = input.readInt(true);
    const data = state.events[event];

    if (data === undefined) {
        throw invalid(`The file points at event ${event}, but it has ${state.events.length} of them.`);
    }
    const int = input.readInt(false);
    const float = input.readFloat();
    const string = readEventString(state, data.string);
    let volume = 0;
    let balance = 0;

    if (data.audioPath) {
        volume = input.readFloat();
        balance = input.readFloat();
    }

    return { time, event, int, float, string, volume, balance };
}

/** Reads the event timeline, when the animation has one. */
function readEventTimeline(state: ImportState, list: TimelineList): void {
    const frameCount = readCount(state, 'event keys');

    if (frameCount === 0) return;
    const frames = new Float32Array(frameCount);
    const events: EventKey[] = [];

    for (let frame = 0; frame < frameCount; frame++) {
        const key = readEventKey(state);

        frames[frame] = key.time;
        events.push(key);
    }
    addTimeline(list, { kind: 'event', target: -1, frames, curves: null, events }, 1);
}

/** Reads one animation. The timelines come out in the order the official reader adds them. */
function readAnimation(state: ImportState, name: string): AnimationData {
    const list: TimelineList = { timelines: [], duration: 0 };

    // the number of timelines, which the official reader does not use
    state.input.readInt(true);
    readSlotTimelines(state, list);
    readBoneTimelines(state, list);
    readIkTimelines(state, list);
    readTransformTimelines(state, list);
    readPathTimelines(state, list);
    if (state.version === '4.2') readPhysicsTimelines(state, list);
    readAttachmentTimelines(state, list);
    readDrawOrderTimeline(state, list);
    readEventTimeline(state, list);

    return { name, duration: list.duration, timelines: list.timelines };
}

/** Reads every animation, in file order. */
export function readAnimations(state: ImportState): AnimationData[] {
    const animations: AnimationData[] = [];

    for (let i = 0, n = readCount(state, 'animations'); i < n; i++) {
        animations.push(readAnimation(state, requireName(state.input.readString(), 'an animation')));
    }

    return animations;
}
