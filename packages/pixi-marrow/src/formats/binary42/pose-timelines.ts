import { INHERIT_MODES } from '../../model/model';
import type { TimelineKind } from '../../model/timelines';
import { addTimeline, curveTimeline, curveWriter, readCurveKeys, type TimelineList } from './curves';
import { type ImportState, invalid, readCount, readIndex, requireBelow } from './state';

/** A timeline kind and how many values each of its keys holds besides the time. */
export type KindRow = readonly [kind: TimelineKind, valueCount: number];

const SLOT_ATTACHMENT = 0;
/** The slot timeline types from 1 up. They animate color channels, stored as one byte each. */
const SLOT_COLOR_KINDS: readonly KindRow[] = [
    ['rgba', 4],
    ['rgb', 3],
    ['rgba2', 7],
    ['rgb2', 6],
    ['alpha', 1],
];
/** The bone timeline types from 0 up. */
const BONE_KINDS: readonly KindRow[] = [
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
/** 4.2 only. */
const BONE_INHERIT = 10;

/**
 * Reads a timeline whose keys are a time and some values with a curve type in between.
 * The file stores the Bezier count right before the keys.
 */
export function readKeyedTimeline(
    state: ImportState,
    list: TimelineList,
    row: KindRow,
    target: number,
    frameCount: number,
    colors: boolean,
): void {
    const [kind, valueCount] = row;
    const writer = curveWriter(state, frameCount, valueCount + 1);

    readCurveKeys(state.input, writer, valueCount, colors);
    addTimeline(list, curveTimeline(kind, target, writer), valueCount + 1);
}

function readAttachmentNames(state: ImportState, list: TimelineList, slot: number, frameCount: number): void {
    const { input } = state;
    const frames = new Float32Array(frameCount);
    const attachmentNames: (string | null)[] = [];

    for (let frame = 0; frame < frameCount; frame++) {
        frames[frame] = input.readFloat();
        attachmentNames.push(input.readStringRef());
    }
    addTimeline(list, { kind: 'attachment', target: slot, frames, curves: null, attachmentNames }, 1);
}

function readSlotTimeline(state: ImportState, list: TimelineList, slot: number): void {
    const type = state.input.readByte();
    const frameCount = readCount(state, 'timeline keys');

    if (type === SLOT_ATTACHMENT) {
        readAttachmentNames(state, list, slot, frameCount);

        return;
    }
    const row = SLOT_COLOR_KINDS[type - 1];

    if (row === undefined) throw invalid(`A slot timeline has the unknown type ${type}.`);
    readKeyedTimeline(state, list, row, slot, frameCount, true);
}

/** Reads the attachment and color timelines of every slot the animation changes. */
export function readSlotTimelines(state: ImportState, list: TimelineList): void {
    for (let i = 0, n = readCount(state, 'animated slots'); i < n; i++) {
        const slot = readIndex(state, state.slotCount, 'slot');

        for (let ii = 0, nn = readCount(state, 'slot timelines'); ii < nn; ii++) readSlotTimeline(state, list, slot);
    }
}

/** An inherit timeline has no curves. Each key is a time and an inherit mode. */
function readInherit(state: ImportState, list: TimelineList, bone: number, frameCount: number): void {
    const { input } = state;
    const frames = new Float32Array(frameCount * 2);

    for (let frame = 0; frame < frameCount; frame++) {
        frames[frame * 2] = input.readFloat();
        frames[frame * 2 + 1] = requireBelow(input.readByte(), INHERIT_MODES.length, 'inherit mode');
    }
    addTimeline(list, { kind: 'inherit', target: bone, frames, curves: null }, 2);
}

function readBoneTimeline(state: ImportState, list: TimelineList, bone: number): void {
    const type = state.input.readByte();
    const frameCount = readCount(state, 'timeline keys');

    if (type === BONE_INHERIT && state.version === '4.2') {
        readInherit(state, list, bone, frameCount);

        return;
    }
    const row = BONE_KINDS[type];

    if (row === undefined) throw invalid(`A bone timeline has the unknown type ${type}.`);
    readKeyedTimeline(state, list, row, bone, frameCount, false);
}

/** Reads the transform timelines of every bone the animation moves. */
export function readBoneTimelines(state: ImportState, list: TimelineList): void {
    for (let i = 0, n = readCount(state, 'animated bones'); i < n; i++) {
        const bone = readIndex(state, state.boneCount, 'bone');

        for (let ii = 0, nn = readCount(state, 'bone timelines'); ii < nn; ii++) readBoneTimeline(state, list, bone);
    }
}
