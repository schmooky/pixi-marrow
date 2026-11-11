import { INHERIT_MODES } from '../../model/model';
import type { TimelineData, TimelineKind } from '../../model/timelines';
import { TimelineWriter } from '../shared/timeline-writer';
import { checkChoice, type ImportState, pick, readIndex } from './reader';
import {
    pushTimeline,
    readColorValue,
    readCurveTimeline,
    readFloatValue,
    readFrameCount,
    type TimelineSink,
} from './timelines-curve';

/** A curve timeline type of the file: the kind it becomes and its values per key. */
type CurveType = readonly [kind: TimelineKind, valueCount: number];

const SLOT_ATTACHMENT = 0;
/** Slot timeline types by their number in the file. Type 0 is the attachment timeline. */
const SLOT_COLORS: readonly (CurveType | undefined)[] = [
    undefined,
    ['rgba', 4],
    ['rgb', 3],
    ['rgba2', 7],
    ['rgb2', 6],
    ['alpha', 1],
];

const BONE_INHERIT = 10;
/** Bone timeline types by their number in the file. Type 10 is the inherit timeline. */
const BONE_CURVES: readonly CurveType[] = [
    ['rotate', 1],
    ['translate', 2],
    ['translateX', 1],
    ['translateY', 1],
    ['scale', 2],
    ['scaleX', 1],
    ['scaleY', 1],
    ['shear', 2],
    ['shearX', 1],
    ['shearY', 1],
];

function readAttachmentNames(state: ImportState, slot: number, frameCount: number): TimelineData {
    const writer = new TimelineWriter(frameCount, 1, null);
    const attachmentNames: (string | null)[] = [];

    for (let frame = 0; frame < frameCount; frame++) {
        writer.frames[frame] = state.input.readFloat();
        attachmentNames.push(state.input.readStringRef());
    }

    return { kind: 'attachment', target: slot, frames: writer.frames, curves: writer.curves, attachmentNames };
}

/** Reads the attachment and color timelines of every slot an animation keys. */
export function readSlotTimelines(state: ImportState, sink: TimelineSink): void {
    const input = state.input;

    for (let i = 0, n = input.readInt(true); i < n; i++) {
        const slot = readIndex(input, state.slotCount, 'slot');

        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
            const type = input.readByte();
            const frameCount = readFrameCount(input);

            if (type === SLOT_ATTACHMENT) {
                pushTimeline(sink, readAttachmentNames(state, slot, frameCount), 1);
                continue;
            }
            const [kind, valueCount] = pick(SLOT_COLORS, type, 'slot timeline type');

            pushTimeline(
                sink,
                readCurveTimeline(input, kind, slot, frameCount, valueCount, readColorValue),
                valueCount + 1,
            );
        }
    }
}

function readInherit(state: ImportState, bone: number, frameCount: number): TimelineData {
    const writer = new TimelineWriter(frameCount, 2, null);

    for (let frame = 0; frame < frameCount; frame++) {
        writer.frames[frame * 2] = state.input.readFloat();
        writer.frames[frame * 2 + 1] = checkChoice(state.input.readByte(), INHERIT_MODES.length, 'inherit mode');
    }

    return { kind: 'inherit', target: bone, frames: writer.frames, curves: writer.curves };
}

/** Reads the transform and inherit timelines of every bone an animation keys. */
export function readBoneTimelines(state: ImportState, sink: TimelineSink): void {
    const input = state.input;

    for (let i = 0, n = input.readInt(true); i < n; i++) {
        const bone = readIndex(input, state.boneCount, 'bone');

        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
            const type = input.readByte();
            const frameCount = readFrameCount(input);

            if (type === BONE_INHERIT) {
                pushTimeline(sink, readInherit(state, bone, frameCount), 2);
                continue;
            }
            const [kind, valueCount] = pick(BONE_CURVES, type, 'bone timeline type');

            pushTimeline(
                sink,
                readCurveTimeline(input, kind, bone, frameCount, valueCount, readFloatValue),
                valueCount + 1,
            );
        }
    }
}
