import type { EventKey } from '../../model/timelines';
import { TimelineWriter } from '../shared/timeline-writer';
import { type AnimationRefs, addTimeline, type TimelineSink } from './context';
import type { JsonAnimation, JsonDrawOrderOffset, JsonEventKey } from './schema';
import { invalid, list, pick, requireNumber, resolve } from './values';

/**
 * Turns the slot moves of a draw order key into the slot index at each draw position, with the
 * algorithm of the official parser. The moves must be sorted by slot index.
 */
function readDrawOrder(offsets: readonly JsonDrawOrderOffset[], refs: AnimationRefs, what: string): Int16Array {
    const { slotCount } = refs;
    const drawOrder = new Int16Array(slotCount).fill(-1);
    const unchanged: number[] = [];
    let originalIndex = 0;

    for (const move of offsets) {
        const slot = resolve(refs.slots, move.slot, 'slot', what);
        const position = slot + requireNumber(move.offset, `An offset of ${what}`);

        // the official parser never returns from such a key
        if (slot < originalIndex) throw invalid(`${what} lists the slot "${move.slot}" out of order or twice.`);
        if (!Number.isInteger(position) || position < 0 || position >= slotCount) {
            throw invalid(`${what} moves the slot "${move.slot}" out of the draw order.`);
        }
        // collect unchanged items
        while (originalIndex !== slot) unchanged.push(originalIndex++);
        // set changed items
        drawOrder[position] = originalIndex++;
    }
    // collect remaining unchanged items
    while (originalIndex < slotCount) unchanged.push(originalIndex++);
    // fill in unchanged items
    for (let i = slotCount - 1; i >= 0; i--) {
        if (drawOrder[i] !== -1) continue;
        const slot = unchanged.pop();

        if (slot === undefined) throw invalid(`${what} moves two slots to the same place.`);
        drawOrder[i] = slot;
    }

    return drawOrder;
}

/** Reads the draw order timeline of an animation. A key without offsets restores the setup order. */
export function readDrawOrderTimeline(map: JsonAnimation, refs: AnimationRefs, sink: TimelineSink): void {
    if (!map.drawOrder) return;
    const what = `A draw order key of ${sink.user}`;
    const keys = list(map.drawOrder, `The draw order timeline of ${sink.user}`);
    const writer = new TimelineWriter(keys.length, 1, null);
    const drawOrders = keys.map((key, frame) => {
        writer.frames[frame] = pick(key.time, 0);

        return key.offsets ? readDrawOrder(key.offsets, refs, what) : null;
    });

    addTimeline(sink, { kind: 'drawOrder', target: -1, frames: writer.frames, curves: null, drawOrders }, 1);
}

/**
 * Reads one event key. Values the key leaves out come from the event. Volume and balance are
 * read only for an event with an audio file, as in the official parser.
 */
function readEventKey(key: JsonEventKey, refs: AnimationRefs, user: string): EventKey {
    const event = resolve(refs.events, key.name, 'event', user);
    const data = refs.eventData[event];

    if (data === undefined) throw invalid(`${user} refers to the event "${key.name}", which does not exist.`);

    return {
        // the official parser rounds the time of an event to a float
        time: Math.fround(pick(key.time, 0)),
        event,
        int: pick(key.int, data.int),
        float: pick(key.float, data.float),
        string: pick(key.string, data.string),
        volume: data.audioPath ? pick(key.volume, 1) : 0,
        balance: data.audioPath ? pick(key.balance, 0) : 0,
    };
}

/** Reads the event timeline of an animation. */
export function readEventTimeline(map: JsonAnimation, refs: AnimationRefs, sink: TimelineSink): void {
    if (!map.events) return;
    const keys = list(map.events, `The event timeline of ${sink.user}`);
    const writer = new TimelineWriter(keys.length, 1, null);
    const events = keys.map((key, frame) => {
        const event = readEventKey(key, refs, sink.user);

        writer.frames[frame] = event.time;

        return event;
    });

    addTimeline(sink, { kind: 'event', target: -1, frames: writer.frames, curves: null, events }, 1);
}
