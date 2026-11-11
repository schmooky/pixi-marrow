import type { AttachmentData, AttachmentRef } from '../../model/attachments';
import type { BinaryInput } from '../shared/binary-input';
import { addTimeline, CURVE_BEZIER, CURVE_STEPPED, curveWriter, readDeformBezier, type TimelineList } from './curves';
import { type Geometry, type ImportState, invalid, readCount, readIndex, requireName } from './state';

const ATTACHMENT_DEFORM = 0;
const ATTACHMENT_SEQUENCE = 1;
const SEQUENCE_ENTRIES = 3;
/** The sequence modes run from hold, 0, to pingpongReverse, 6. */
const SEQUENCE_MODE_COUNT = 7;

/** The vertices a deform timeline of this attachment works on. A linked mesh has the ones of its parent. */
function deformGeometry(state: ImportState, attachment: AttachmentData, name: string): Geometry {
    if (attachment.type === 'region' || attachment.type === 'point') {
        throw invalid(`A deform timeline animates the attachment ${name}, which has no vertices.`);
    }
    if (attachment.type === 'mesh') return state.geometry.get(attachment) ?? attachment;

    return attachment;
}

/**
 * Reads the vertices of one deform key. The file stores the run of values that differ from the
 * setup pose. Without weights the key holds positions, with weights it holds offsets.
 */
function readDeformKey(input: BinaryInput, setup: Float32Array, weighted: boolean, length: number): Float32Array {
    const count = input.readInt(true);

    // no stored values: the setup positions, or offsets of zero
    if (count === 0) return weighted ? new Float32Array(length) : setup;
    const deform = new Float32Array(length);
    const start = input.readInt(true);
    const end = start + count;

    if (count < 0 || start < 0 || end > length) {
        throw invalid('A deform key moves vertices its attachment does not have.');
    }
    for (let v = start; v < end; v++) deform[v] = input.readFloat();
    if (!weighted) {
        for (let v = 0; v < length; v++) deform[v] = (deform[v] ?? 0) + (setup[v] ?? 0);
    }

    return deform;
}

function readDeform(
    state: ImportState,
    list: TimelineList,
    ref: AttachmentRef,
    attachment: AttachmentData,
    frameCount: number,
): void {
    const { input } = state;
    const geometry = deformGeometry(state, attachment, ref.name);
    const weighted = geometry.bones !== null;
    const setup = geometry.vertices;
    const length = weighted ? (setup.length / 3) * 2 : setup.length;
    const writer = curveWriter(state, frameCount, 1);
    const vertices: Float32Array[] = [];
    let time = input.readFloat();

    for (let frame = 0, bezier = 0; ; frame++) {
        vertices.push(readDeformKey(input, setup, weighted, length));
        writer.frames[frame] = time;
        if (frame === frameCount - 1) break;
        const time2 = input.readFloat();

        switch (input.readByte()) {
            case CURVE_STEPPED:
                writer.setStepped(frame);
                break;
            case CURVE_BEZIER:
                readDeformBezier(input, writer, bezier++, frame, time, time2);
        }
        time = time2;
    }
    const { frames, curves } = writer;

    addTimeline(list, { kind: 'deform', target: ref.slot, frames, curves, attachment: ref, vertices }, 1);
}

/** A sequence timeline has no curves. Each key is a time, a mode with an index, and a delay. */
function readSequence(
    state: ImportState,
    list: TimelineList,
    ref: AttachmentRef,
    attachment: AttachmentData,
    frameCount: number,
): void {
    const { input } = state;

    if ((attachment.type !== 'region' && attachment.type !== 'mesh') || attachment.sequence === null) {
        throw invalid(`A sequence timeline animates the attachment ${ref.name}, which has no sequence.`);
    }
    const frames = new Float32Array(frameCount * SEQUENCE_ENTRIES);

    for (let frame = 0; frame < frameCount; frame++) {
        const time = input.readFloat();
        const modeAndIndex = input.readInt32();
        const mode = modeAndIndex & 0xf;

        if (mode >= SEQUENCE_MODE_COUNT) throw invalid(`A sequence key has the unknown mode ${mode}.`);
        // the low four bits hold the mode, the bits above hold the index
        frames.set([time, mode | ((modeAndIndex >> 4) << 4), input.readFloat()], frame * SEQUENCE_ENTRIES);
    }
    addTimeline(list, { kind: 'sequence', target: ref.slot, frames, curves: null, attachment: ref }, SEQUENCE_ENTRIES);
}

function readAttachmentTimeline(state: ImportState, list: TimelineList, skin: number, slot: number): void {
    const { input } = state;
    const name = requireName(input.readStringRef(), 'a timeline attachment');
    const attachment = state.skins[skin]?.slots.get(slot)?.get(name);

    if (attachment === undefined) {
        throw invalid(`A timeline animates the attachment ${name}, which skin ${skin} does not have in slot ${slot}.`);
    }
    const type = input.readByte();
    const frameCount = readCount(state, 'timeline keys');
    const ref: AttachmentRef = { skin, slot, name };

    if (type === ATTACHMENT_DEFORM) readDeform(state, list, ref, attachment, frameCount);
    else if (type === ATTACHMENT_SEQUENCE) readSequence(state, list, ref, attachment, frameCount);
    else throw invalid(`An attachment timeline has the unknown type ${type}.`);
}

/** Reads the deform and sequence timelines, which the file groups by skin, slot and attachment. */
export function readAttachmentTimelines(state: ImportState, list: TimelineList): void {
    for (let i = 0, n = readCount(state, 'animated skins'); i < n; i++) {
        const skin = readIndex(state, state.skins.length, 'skin');

        for (let ii = 0, nn = readCount(state, 'animated skin slots'); ii < nn; ii++) {
            const slot = readIndex(state, state.slotCount, 'slot');

            for (let iii = 0, nnn = readCount(state, 'attachment timelines'); iii < nnn; iii++) {
                readAttachmentTimeline(state, list, skin, slot);
            }
        }
    }
}
