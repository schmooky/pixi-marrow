import type { AttachmentData, AttachmentRef, VertexData } from '../../model/attachments';
import type { TimelineData } from '../../model/timelines';
import type { BinaryInput } from '../shared/binary-input';
import { TimelineWriter } from '../shared/timeline-writer';
import { checkChoice, findAttachment, type ImportState, invalid, readIndex } from './reader';
import { checkBezierRoom, pushTimeline, readCurveType, readFrameCount, type TimelineSink } from './timelines-curve';

const ATTACHMENT_DEFORM = 0;
const ATTACHMENT_SEQUENCE = 1;
const SEQUENCE_ENTRIES = 3;
/** Hold, once, loop, pingpong, and the last three in reverse. */
const SEQUENCE_MODE_COUNT = 7;

/** The vertices a deform timeline moves. A linked mesh uses the vertices of its parent. */
function geometryOf(state: ImportState, attachment: AttachmentData, name: string): VertexData {
    if (attachment.type === 'region' || attachment.type === 'point') {
        throw invalid(`A deform timeline points at attachment "${name}", which has no vertices.`);
    }

    return state.geometry.get(attachment) ?? attachment;
}

/**
 * Reads the vertices of one deform key. The file stores the run of values that differ from the
 * setup pose. Without weights the key holds positions, with weights it holds offsets.
 */
function readDeform(input: BinaryInput, geometry: VertexData, deformLength: number): Float32Array {
    const weighted = geometry.bones !== null;
    const vertices = geometry.vertices;
    const count = input.readInt(true);

    if (count === 0) return weighted ? new Float32Array(deformLength) : vertices;
    const deform = new Float32Array(deformLength);
    const start = input.readInt(true);

    for (let v = start, end = start + count; v < end; v++) deform[v] = input.readFloat();
    if (!weighted) {
        for (let v = 0; v < deform.length; v++) deform[v] = (deform[v] ?? 0) + (vertices[v] ?? 0);
    }

    return deform;
}

/** Reads the handles of the Bezier curve of a deform key and stores its samples. The curve runs from 0 to 1. */
function readDeformBezier(
    input: BinaryInput,
    writer: TimelineWriter,
    bezier: number,
    frame: number,
    time1: number,
    time2: number,
): void {
    checkBezierRoom(writer, bezier);
    const cx1 = input.readFloat();
    const cy1 = input.readFloat();
    const cx2 = input.readFloat();
    const cy2 = input.readFloat();

    writer.setDeformBezier(bezier, frame, 0, time1, cx1, cy1, cx2, cy2, time2);
}

function readDeformTimeline(
    input: BinaryInput,
    ref: AttachmentRef,
    geometry: VertexData,
    frameCount: number,
): TimelineData {
    const deformLength = geometry.bones === null ? geometry.vertices.length : (geometry.vertices.length / 3) * 2;
    const writer = new TimelineWriter(frameCount, 1, input.readInt(true));
    const vertices: Float32Array[] = [];
    let time = input.readFloat();

    for (let frame = 0, bezier = 0; ; frame++) {
        writer.frames[frame] = time;
        vertices.push(readDeform(input, geometry, deformLength));
        if (frame === frameCount - 1) break;
        const time2 = input.readFloat();

        if (readCurveType(input, writer, frame)) readDeformBezier(input, writer, bezier++, frame, time, time2);
        time = time2;
    }

    return {
        kind: 'deform',
        target: ref.slot,
        frames: writer.frames,
        curves: writer.curves,
        attachment: ref,
        vertices,
    };
}

/** Reads one sequence timeline. A key holds a time, the mode in the low 4 bits with the index above, and a delay. */
function readSequenceTimeline(input: BinaryInput, ref: AttachmentRef, frameCount: number): TimelineData {
    const writer = new TimelineWriter(frameCount, SEQUENCE_ENTRIES, null);

    for (let frame = 0; frame < frameCount; frame++) {
        const at = frame * SEQUENCE_ENTRIES;
        const time = input.readFloat();
        const modeAndIndex = input.readInt32();
        const mode = checkChoice(modeAndIndex & 0xf, SEQUENCE_MODE_COUNT, 'sequence mode');

        writer.frames[at] = time;
        writer.frames[at + 1] = mode | ((modeAndIndex >> 4) << 4);
        writer.frames[at + 2] = input.readFloat();
    }

    return { kind: 'sequence', target: ref.slot, frames: writer.frames, curves: writer.curves, attachment: ref };
}

function readAttachmentTimeline(state: ImportState, skin: number, slot: number): TimelineData {
    const input = state.input;
    const name = input.readStringRef();

    if (name === null) throw invalid('A timeline for an attachment does not name the attachment.');
    const attachment = findAttachment(state, skin, slot, name);
    const ref: AttachmentRef = { skin, slot, name };
    const type = input.readByte();
    const frameCount = readFrameCount(input);

    if (type === ATTACHMENT_DEFORM) {
        return readDeformTimeline(input, ref, geometryOf(state, attachment, name), frameCount);
    }
    if (type !== ATTACHMENT_SEQUENCE) {
        throw invalid(`The file holds attachment timeline type ${type}, which Spine 4.3 does not have.`);
    }
    if (attachment.type !== 'region' && attachment.type !== 'mesh') {
        throw invalid(`A sequence timeline points at attachment "${name}", which has no texture.`);
    }

    return readSequenceTimeline(input, ref, frameCount);
}

/** Reads the deform and sequence timelines of an animation, grouped by skin, slot and attachment. */
export function readAttachmentTimelines(state: ImportState, sink: TimelineSink): void {
    const input = state.input;

    for (let i = 0, n = input.readInt(true); i < n; i++) {
        const skin = readIndex(input, state.skins.length, 'skin');

        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
            const slot = readIndex(input, state.slotCount, 'slot');

            for (let iii = 0, nnn = input.readInt(true); iii < nnn; iii++) {
                const timeline = readAttachmentTimeline(state, skin, slot);

                pushTimeline(sink, timeline, timeline.kind === 'sequence' ? SEQUENCE_ENTRIES : 1);
            }
        }
    }
}
