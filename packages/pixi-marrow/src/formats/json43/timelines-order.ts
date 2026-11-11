import type { EventKey } from '../../model/timelines';
import { TimelineWriter } from '../shared/timeline-writer';
import { type ImportContext, invalid } from './context';
import type { JsonAnimation, JsonDrawOrderKey } from './schema';
import { addTimeline, type TimelineSink } from './timelines-curve';

/**
 * Turns the offsets of a draw order key into an order, like the official `readDrawOrder`.
 *
 * The order holds, for each position, the slot drawn there. For a folder the positions and the
 * slots count within the folder. Null stands for the setup order.
 *
 * @param count the number of slots that are ordered
 * @param folderSlots the slot indices of the folder, or null when the key orders every slot
 */
function readDrawOrder(
    key: JsonDrawOrderKey,
    count: number,
    folderSlots: Int16Array | null,
    user: string,
    ctx: ImportContext,
): Int16Array | null {
    if (!key.offsets) return null;
    const order = new Int16Array(count).fill(-1);
    const unchanged: number[] = [];
    let original = 0;

    for (const { slot: slotName, offset } of key.offsets) {
        const slot = ctx.slots.require(slotName, user);
        const index = folderSlots ? folderSlots.indexOf(slot) : slot;

        if (index < 0) throw invalid(`${user} moves the slot "${slotName}" in a folder that does not hold it.`);
        // the official parser never returns from offsets that are not in slot order
        if (index < original) throw invalid(`${user} has a draw order key with offsets that are not in slot order.`);
        while (original !== index) unchanged.push(original++);
        const position = original + (offset ?? 0);

        if (order[position] !== -1) {
            throw invalid(
                `${user} has a draw order key that moves the slot "${slotName}" to a position that is not free.`,
            );
        }
        order[position] = original++;
    }
    while (original < count) unchanged.push(original++);
    // the slots that did not move fill the free positions, from the back
    let position = count;

    for (const slot of unchanged.reverse()) {
        do position--;
        while (order[position] !== -1);
        order[position] = slot;
    }

    return order;
}

/** Reads the `drawOrder` timeline of an animation. */
export function readDrawOrderTimeline(sink: TimelineSink, keys: JsonAnimation['drawOrder'], ctx: ImportContext): void {
    if (!keys) return;
    const writer = new TimelineWriter(keys.length, 1, null);
    const drawOrders = keys.map((key, frame) => {
        writer.frames[frame] = key.time ?? 0;

        return readDrawOrder(key, ctx.slotCount, null, sink.user, ctx);
    });

    addTimeline(sink, { kind: 'drawOrder', target: -1, frames: writer.frames, curves: null, drawOrders }, 1);
}

/** Reads the `drawOrderFolder` timelines of an animation. Each one orders the slots of one folder. */
export function readDrawOrderFolderTimelines(
    sink: TimelineSink,
    folders: JsonAnimation['drawOrderFolder'],
    ctx: ImportContext,
): void {
    for (const folder of folders ?? []) {
        const folderSlots = Int16Array.from(folder.slots ?? [], (name) => ctx.slots.require(name, sink.user));
        const keys = folder.keys ?? [];
        const writer = new TimelineWriter(keys.length, 1, null);
        const drawOrders = keys.map((key, frame) => {
            writer.frames[frame] = key.time ?? 0;

            return readDrawOrder(key, folderSlots.length, folderSlots, sink.user, ctx);
        });
        const { frames } = writer;

        addTimeline(sink, { kind: 'drawOrderFolder', target: -1, frames, curves: null, drawOrders, folderSlots }, 1);
    }
}

/**
 * Reads the `events` timeline of an animation. A key falls back to the values of its event.
 * Volume and balance are read only for an event with audio.
 */
export function readEventTimeline(sink: TimelineSink, keys: JsonAnimation['events'], ctx: ImportContext): void {
    if (!keys) return;
    const writer = new TimelineWriter(keys.length, 1, null);
    const events = keys.map((key, frame): EventKey => {
        const { index, data } = ctx.events.require(key.name, sink.user);
        const time = Math.fround(key.time ?? 0);
        const audio = Boolean(data.audioPath);

        writer.frames[frame] = time;

        return {
            time,
            event: index,
            int: key.int ?? data.int,
            float: key.float ?? data.float,
            string: key.string ?? data.string,
            volume: audio ? (key.volume ?? data.volume) : 0,
            // the official parser falls back to the volume of the event here, not to its balance
            balance: audio ? (key.balance ?? data.volume) : 0,
        };
    });

    addTimeline(sink, { kind: 'event', target: -1, frames: writer.frames, curves: null, events }, 1);
}
