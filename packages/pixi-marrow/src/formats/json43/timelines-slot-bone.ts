import { INHERIT_MODES } from '../../model/model';
import type { TimelineKind } from '../../model/timelines';
import { TimelineWriter } from '../shared/timeline-writer';
import { enumIndex, type ImportContext, invalid } from './context';
import type { JsonAnimation, JsonBoneKey, JsonSlotKey } from './schema';
import {
    addTimeline,
    readCurveTimeline,
    readValueTimeline,
    type TimelineSink,
    unknownTimeline,
} from './timelines-curve';

/**
 * Writes a hex color as numbers, the way the official `Color.setFromString` reads it. The numbers
 * stay in double precision, because the official parser computes the curves from them.
 *
 * @param channels 3 writes r, g, b. 4 also writes a, which is 1 when the string has no alpha.
 */
function writeColor(hex: string | undefined, out: number[], offset: number, channels: 3 | 4, user: string): void {
    if (typeof hex !== 'string') throw invalid(`${user} has a color key without a color.`);
    const digits = hex.charAt(0) === '#' ? hex.slice(1) : hex;

    out[offset] = Number.parseInt(digits.slice(0, 2), 16) / 255;
    out[offset + 1] = Number.parseInt(digits.slice(2, 4), 16) / 255;
    out[offset + 2] = Number.parseInt(digits.slice(4, 6), 16) / 255;
    if (channels === 4) out[offset + 3] = digits.length !== 8 ? 1 : Number.parseInt(digits.slice(6, 8), 16) / 255;
}

function readAttachmentNames(sink: TimelineSink, keys: readonly JsonSlotKey[], slot: number): void {
    const writer = new TimelineWriter(keys.length, 1, null);
    const attachmentNames = keys.map((key, frame) => {
        writer.frames[frame] = key.time ?? 0;

        return key.name ?? null;
    });

    addTimeline(sink, { kind: 'attachment', target: slot, frames: writer.frames, curves: null, attachmentNames }, 1);
}

function readSlotTimeline(sink: TimelineSink, name: string, keys: readonly JsonSlotKey[], slot: number): void {
    const { user } = sink;

    switch (name) {
        case 'attachment':
            readAttachmentNames(sink, keys, slot);
            break;
        case 'rgba':
            readCurveTimeline(sink, 'rgba', slot, keys, 5, 4, (key, out) => {
                out[0] = key.time ?? 0;
                writeColor(key.color, out, 1, 4, user);
            });
            break;
        case 'rgb':
            readCurveTimeline(sink, 'rgb', slot, keys, 4, 3, (key, out) => {
                out[0] = key.time ?? 0;
                writeColor(key.color, out, 1, 3, user);
            });
            break;
        case 'alpha':
            readValueTimeline(sink, 'alpha', slot, keys, 0);
            break;
        case 'rgba2':
            readCurveTimeline(sink, 'rgba2', slot, keys, 8, 7, (key, out) => {
                out[0] = key.time ?? 0;
                writeColor(key.light, out, 1, 4, user);
                writeColor(key.dark, out, 5, 3, user);
            });
            break;
        case 'rgb2':
            readCurveTimeline(sink, 'rgb2', slot, keys, 7, 6, (key, out) => {
                out[0] = key.time ?? 0;
                writeColor(key.light, out, 1, 3, user);
                writeColor(key.dark, out, 4, 3, user);
            });
            break;
        default:
            throw unknownTimeline(name, user);
    }
}

/** Reads the `slots` timelines of an animation. */
export function readSlotTimelines(sink: TimelineSink, map: JsonAnimation['slots'], ctx: ImportContext): void {
    for (const [slotName, timelines] of Object.entries(map ?? {})) {
        const slot = ctx.slots.require(slotName, sink.user);

        for (const [name, keys] of Object.entries(timelines)) {
            if (keys) readSlotTimeline(sink, name, keys, slot);
        }
    }
}

/** Bone timelines with one value per key: the kind and the value of a key that stores none. */
const VALUE_TIMELINES: ReadonlyMap<string, readonly [TimelineKind, number]> = new Map([
    ['rotate', ['rotate', 0]],
    ['translatex', ['translateX', 0]],
    ['translatey', ['translateY', 0]],
    ['scalex', ['scaleX', 1]],
    ['scaley', ['scaleY', 1]],
    ['shearx', ['shearX', 0]],
    ['sheary', ['shearY', 0]],
]);
/** Bone timelines with x and y per key: the kind and the value of a key that stores none. */
const VECTOR_TIMELINES: ReadonlyMap<string, readonly [TimelineKind, number]> = new Map([
    ['translate', ['translate', 0]],
    ['scale', ['scale', 1]],
    ['shear', ['shear', 0]],
]);

function readInherit(sink: TimelineSink, keys: readonly JsonBoneKey[], bone: number): void {
    const writer = new TimelineWriter(keys.length, 2, null);

    keys.forEach((key, frame) => {
        writer.frames[frame * 2] = key.time ?? 0;
        writer.frames[frame * 2 + 1] = enumIndex(
            INHERIT_MODES,
            key.inherit ?? 'normal',
            `An inherit key of ${sink.user}`,
        );
    });
    addTimeline(sink, { kind: 'inherit', target: bone, frames: writer.frames, curves: null }, 2);
}

function readBoneTimeline(sink: TimelineSink, name: string, keys: readonly JsonBoneKey[], bone: number): void {
    const value = VALUE_TIMELINES.get(name);
    const vector = VECTOR_TIMELINES.get(name);

    if (value) {
        readValueTimeline(sink, value[0], bone, keys, value[1]);
    } else if (vector) {
        const fallback = vector[1];

        // the official `readTimeline2`
        readCurveTimeline(sink, vector[0], bone, keys, 3, 2, (key, out) => {
            out[0] = key.time ?? 0;
            out[1] = key.x ?? fallback;
            out[2] = key.y ?? fallback;
        });
    } else if (name === 'inherit') {
        readInherit(sink, keys, bone);
    } else {
        throw unknownTimeline(name, sink.user);
    }
}

/** Reads the `bones` timelines of an animation. A timeline without keys is skipped. */
export function readBoneTimelines(sink: TimelineSink, map: JsonAnimation['bones'], ctx: ImportContext): void {
    for (const [boneName, timelines] of Object.entries(map ?? {})) {
        const bone = ctx.bones.require(boneName, sink.user);

        for (const [name, keys] of Object.entries(timelines)) {
            if (keys.length > 0) readBoneTimeline(sink, name, keys, bone);
        }
    }
}
