import type { EventKey, TimelineData } from '../../model/timelines';
import type { BinaryInput } from '../shared/binary-input';
import { TimelineWriter } from '../shared/timeline-writer';
import { type ImportState, invalid, readIndex } from './reader';
import { pushTimeline, readFrameCount, type TimelineSink } from './timelines-curve';

/**
 * Reads one draw order key: the order of `count` items, or null for the setup order.
 * The file stores each item that moves with the number of places it moves. The other items keep
 * their relative order and fill the places that are left.
 */
function readDrawOrder(input: BinaryInput, count: number): Int16Array | null {
    const changeCount = input.readInt(true);

    if (changeCount === 0) return null;
    if (changeCount > count) throw invalid(`A draw order key moves ${changeCount} slots, but only ${count} can move.`);
    const drawOrder = new Int16Array(count).fill(-1);
    const unchanged = new Int16Array(count - changeCount);
    let originalIndex = 0;
    let unchangedIndex = 0;

    for (let i = 0; i < changeCount; i++) {
        const index = input.readInt(true);

        if (index < originalIndex || index >= count) throw invalid(`A draw order key moves slot ${index} out of turn.`);
        while (originalIndex !== index) unchanged[unchangedIndex++] = originalIndex++;
        const place = originalIndex + input.readInt(true);

        if (place < 0 || place >= count || drawOrder[place] !== -1) {
            throw invalid(`A draw order key moves slot ${index} to place ${place}, which is taken or does not exist.`);
        }
        drawOrder[place] = originalIndex++;
    }
    while (originalIndex < count) unchanged[unchangedIndex++] = originalIndex++;
    for (let i = count - 1; i >= 0; i--) {
        if (drawOrder[i] === -1) drawOrder[i] = unchanged[--unchangedIndex] ?? -1;
    }

    return drawOrder;
}

/** Reads `frameCount` draw order keys over `count` items. */
function readDrawOrderKeys(
    input: BinaryInput,
    frameCount: number,
    count: number,
): { frames: Float32Array; drawOrders: (Int16Array | null)[] } {
    const writer = new TimelineWriter(frameCount, 1, null);
    const drawOrders: (Int16Array | null)[] = [];

    for (let frame = 0; frame < frameCount; frame++) {
        writer.frames[frame] = input.readFloat();
        drawOrders.push(readDrawOrder(input, count));
    }

    return { frames: writer.frames, drawOrders };
}

function readFolderTimeline(state: ImportState): TimelineData {
    const input = state.input;
    const folderSlots = new Int16Array(input.readInt(true));

    for (let i = 0; i < folderSlots.length; i++) folderSlots[i] = readIndex(input, state.slotCount, 'slot');
    const keys = readDrawOrderKeys(input, readFrameCount(input), folderSlots.length);

    return {
        kind: 'drawOrderFolder',
        target: -1,
        frames: keys.frames,
        curves: null,
        drawOrders: keys.drawOrders,
        folderSlots,
    };
}

/** Reads the draw order timeline of an animation, when it has one, and then its draw order folder timelines. */
export function readDrawOrderTimelines(state: ImportState, sink: TimelineSink): void {
    const input = state.input;
    const frameCount = input.readInt(true);

    if (frameCount > 0) {
        const keys = readDrawOrderKeys(input, frameCount, state.slotCount);

        pushTimeline(
            sink,
            { kind: 'drawOrder', target: -1, frames: keys.frames, curves: null, drawOrders: keys.drawOrders },
            1,
        );
    }
    for (let i = 0, n = input.readInt(true); i < n; i++) pushTimeline(sink, readFolderTimeline(state), 1);
}

function readEventKey(state: ImportState): EventKey {
    const input = state.input;
    const time = input.readFloat();
    const event = readIndex(input, state.events.length, 'event');
    const data = state.events[event];
    const int = input.readInt(false);
    const float = input.readFloat();
    const string = input.readString() ?? data?.string ?? '';
    let volume = 0;
    let balance = 0;

    // only an event with an audio path stores these
    if (data?.audioPath) {
        volume = input.readFloat();
        balance = input.readFloat();
    }

    return { time, event, int, float, string, volume, balance };
}

/** Reads the event timeline of an animation, when it has one. */
export function readEventTimeline(state: ImportState, sink: TimelineSink): void {
    const frameCount = state.input.readInt(true);

    if (frameCount <= 0) return;
    const writer = new TimelineWriter(frameCount, 1, null);
    const events: EventKey[] = [];

    for (let frame = 0; frame < frameCount; frame++) {
        const key = readEventKey(state);

        writer.frames[frame] = key.time;
        events.push(key);
    }
    pushTimeline(sink, { kind: 'event', target: -1, frames: writer.frames, curves: writer.curves, events }, 1);
}
