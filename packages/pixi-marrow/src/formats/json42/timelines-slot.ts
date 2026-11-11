import type { TimelineData } from '../../model/timelines';
import { TimelineWriter } from '../shared/timeline-writer';
import { addTimeline, type SkeletonRefs, type TimelineSink } from './context';
import { type CurveLayout, readCurveTimeline, valueLayout } from './curves';
import type { JsonAnimation, JsonAttachmentKey, JsonColorKey, JsonSlotTimelines } from './schema';
import { entries, names, pick, readHexColor, resolve, unknownTimeline } from './values';

const SLOT_TIMELINES: readonly string[] = ['attachment', 'rgba', 'rgb', 'alpha', 'rgba2', 'rgb2'];

/** Time, then r, g, b, a. */
const RGBA: CurveLayout<JsonColorKey> = {
    entries: 5,
    curved: 4,
    read(key, out, what) {
        readHexColor(key.color, out, 0, `A key of ${what}`);
    },
};

/** Time, then r, g, b. */
const RGB: CurveLayout<JsonColorKey> = { entries: 4, curved: 3, read: RGBA.read };

/** Time, then light r, g, b, a and dark r, g, b. */
const RGBA2: CurveLayout<JsonColorKey> = {
    entries: 8,
    curved: 7,
    read(key, out, what) {
        readHexColor(key.light, out, 0, `A key of ${what}`);
        readHexColor(key.dark, out, 4, `A key of ${what}`);
    },
};

/** Time, then light r, g, b and dark r, g, b. The dark color is written over the light alpha. */
const RGB2: CurveLayout<JsonColorKey> = {
    entries: 7,
    curved: 6,
    read(key, out, what) {
        readHexColor(key.light, out, 0, `A key of ${what}`);
        readHexColor(key.dark, out, 3, `A key of ${what}`);
    },
};

const ALPHA = valueLayout(0);

function readAttachmentTimeline(keys: readonly JsonAttachmentKey[], slot: number): TimelineData {
    const writer = new TimelineWriter(keys.length, 1, null);
    const attachmentNames = keys.map((key, frame) => {
        writer.frames[frame] = pick(key.time, 0);

        return pick(key.name, null);
    });

    return { kind: 'attachment', target: slot, frames: writer.frames, curves: null, attachmentNames };
}

/**
 * Reads one timeline of a slot. Returns its floats per key with it, for the duration.
 * Returns null for a timeline that holds nothing, which the official parser skips.
 */
function readSlotTimeline(
    name: string,
    map: JsonSlotTimelines,
    slot: number,
    what: string,
): [TimelineData, number] | null {
    switch (name) {
        case 'attachment':
            return map.attachment ? [readAttachmentTimeline(map.attachment, slot), 1] : null;
        case 'rgba':
            return map.rgba ? [readCurveTimeline('rgba', slot, map.rgba, RGBA, what), RGBA.entries] : null;
        case 'rgb':
            return map.rgb ? [readCurveTimeline('rgb', slot, map.rgb, RGB, what), RGB.entries] : null;
        case 'alpha':
            return map.alpha ? [readCurveTimeline('alpha', slot, map.alpha, ALPHA, what), ALPHA.entries] : null;
        case 'rgba2':
            return map.rgba2 ? [readCurveTimeline('rgba2', slot, map.rgba2, RGBA2, what), RGBA2.entries] : null;
        case 'rgb2':
            return map.rgb2 ? [readCurveTimeline('rgb2', slot, map.rgb2, RGB2, what), RGB2.entries] : null;
        default:
            throw unknownTimeline(name, what, SLOT_TIMELINES);
    }
}

/** Reads the slot timelines of an animation: attachment changes and the five kinds of color timeline. */
export function readSlotTimelines(map: JsonAnimation, refs: SkeletonRefs, sink: TimelineSink): void {
    for (const [slotName, slotMap] of entries(map.slots, `The slot timelines of ${sink.user}`)) {
        const slot = resolve(refs.slots, slotName, 'slot', sink.user);

        for (const name of names(slotMap, `The timelines of the slot "${slotName}" in the animation "${sink.name}"`)) {
            const what = `The ${name} timeline of the slot "${slotName}" in the animation "${sink.name}"`;
            const timeline = readSlotTimeline(name, slotMap, slot, what);

            if (timeline) addTimeline(sink, timeline[0], timeline[1]);
        }
    }
}
