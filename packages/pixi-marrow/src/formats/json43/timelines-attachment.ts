import type { AttachmentData, AttachmentRef, VertexData } from '../../model/attachments';
import { TimelineWriter } from '../shared/timeline-writer';
import { type ImportContext, invalid } from './context';
import type { JsonAnimation, JsonAttachmentKey, JsonCurve } from './schema';
import { addTimeline, type TimelineSink, unknownTimeline } from './timelines-curve';

/** The official `SequenceMode` names. A sequence key stores the position of its mode in this list. */
const SEQUENCE_MODES: readonly string[] = [
    'hold',
    'once',
    'loop',
    'pingpong',
    'onceReverse',
    'loopReverse',
    'pingpongReverse',
];

/** Stores the curve of one deform key. Returns the number of Bezier curves the timeline holds now. */
function writeDeformCurve(
    curve: JsonCurve,
    writer: TimelineWriter,
    bezier: number,
    frame: number,
    time1: number,
    time2: number,
    user: string,
): number {
    if (curve === 'stepped') {
        writer.setStepped(frame);

        return bezier;
    }
    const [cx1, cy1, cx2, cy2] = curve;

    if (typeof cx1 !== 'number' || typeof cy1 !== 'number' || typeof cx2 !== 'number' || typeof cy2 !== 'number') {
        throw invalid(`${user} has a deform key with a curve that is not "stepped" or four numbers.`);
    }
    writer.setDeformBezier(bezier, frame, 0, time1, cx1, cy1, cx2, cy2, time2);

    return bezier + 1;
}

/**
 * The vertices of one deform key, like the official parser computes them.
 *
 * Without weights a key holds positions: the setup vertices plus the offsets from the file.
 * With weights it holds the offsets alone. A key without vertices is the setup pose.
 */
function deformVertices(
    key: JsonAttachmentKey,
    geometry: VertexData,
    deformLength: number,
    user: string,
): Float32Array {
    const setup = geometry.vertices;
    const weighted = geometry.bones !== null;
    const values = key.vertices;

    if (!values) return weighted ? new Float32Array(deformLength) : setup;
    const start = key.offset ?? 0;

    if (!(start >= 0 && start + values.length <= deformLength)) {
        throw invalid(`${user} has a deform key with more vertices than its attachment.`);
    }
    if (weighted) {
        const deform = new Float32Array(deformLength);

        deform.set(values, start);

        return deform;
    }

    // the file value is rounded to a float before the setup vertex is added
    return setup.map((vertex, i) => Math.fround(values[i - start] ?? 0) + vertex);
}

function readDeform(
    sink: TimelineSink,
    keys: readonly JsonAttachmentKey[],
    first: JsonAttachmentKey,
    attachment: AttachmentRef,
    geometry: VertexData,
): void {
    const setup = geometry.vertices;
    const deformLength = geometry.bones === null ? setup.length : (setup.length / 3) * 2;
    const writer = new TimelineWriter(keys.length, 1, keys.length);
    const vertices: Float32Array[] = [];
    let key = first;
    let time = key.time ?? 0;

    for (let frame = 0, bezier = 0; ; frame++) {
        writer.frames[frame] = time;
        vertices.push(deformVertices(key, geometry, deformLength, sink.user));
        const nextKey = keys[frame + 1];

        if (!nextKey) {
            writer.shrink(bezier);
            break;
        }
        const time2 = nextKey.time ?? 0;

        if (key.curve) bezier = writeDeformCurve(key.curve, writer, bezier, frame, time, time2, sink.user);
        time = time2;
        key = nextKey;
    }
    const { frames, curves } = writer;

    addTimeline(sink, { kind: 'deform', target: attachment.slot, frames, curves, attachment, vertices }, 1);
}

function readSequence(sink: TimelineSink, keys: readonly JsonAttachmentKey[], attachment: AttachmentRef): void {
    const writer = new TimelineWriter(keys.length, 3, null);
    let lastDelay = 0;

    keys.forEach((key, frame) => {
        const delay = key.delay ?? lastDelay;
        const mode = SEQUENCE_MODES.indexOf(key.mode ?? 'hold');

        if (mode < 0) throw invalid(`${sink.user} has a sequence key with the unknown mode "${key.mode}".`);
        writer.frames.set([key.time ?? 0, mode | ((key.index ?? 0) << 4), delay], frame * 3);
        lastDelay = delay;
    });
    addTimeline(
        sink,
        { kind: 'sequence', target: attachment.slot, frames: writer.frames, curves: null, attachment },
        3,
    );
}

/** The vertices a deform timeline moves. A linked mesh has the ones the official parser copied from its source. */
function deformGeometry(attachment: AttachmentData, user: string, ctx: ImportContext): VertexData {
    if (attachment.type === 'region' || attachment.type === 'point') {
        throw invalid(`${user} has a deform timeline for the attachment "${attachment.name}", which has no vertices.`);
    }

    return ctx.geometry.get(attachment) ?? attachment;
}

function readAttachmentTimeline(
    sink: TimelineSink,
    name: string,
    keys: readonly JsonAttachmentKey[],
    first: JsonAttachmentKey,
    ref: AttachmentRef,
    attachment: AttachmentData,
    ctx: ImportContext,
): void {
    if (name === 'deform') {
        readDeform(sink, keys, first, ref, deformGeometry(attachment, sink.user, ctx));
    } else if (name !== 'sequence') {
        throw unknownTimeline(name, sink.user);
    } else if (attachment.type === 'region' || attachment.type === 'mesh') {
        readSequence(sink, keys, ref);
    } else {
        throw invalid(`${sink.user} has a sequence timeline for "${attachment.name}", which is no region or mesh.`);
    }
}

/** Reads the `attachments` timelines of an animation: deform and sequence, by skin, slot and attachment. */
export function readAttachmentTimelines(
    sink: TimelineSink,
    map: JsonAnimation['attachments'],
    ctx: ImportContext,
): void {
    const { user } = sink;

    for (const [skinName, slots] of Object.entries(map ?? {})) {
        const skin = ctx.skins.require(skinName, user);

        for (const [slotName, attachments] of Object.entries(slots)) {
            const slot = ctx.slots.require(slotName, user);

            for (const [key, timelines] of Object.entries(attachments)) {
                const attachment = skin.attachments.get(slot)?.get(key);

                if (!attachment) {
                    throw invalid(
                        `${user} refers to the attachment "${key}", which the skin "${skinName}" does not have in the slot "${slotName}".`,
                    );
                }
                const ref: AttachmentRef = { skin: skin.index, slot, name: key };

                for (const [name, keys] of Object.entries(timelines)) {
                    const first = keys[0];

                    if (first) readAttachmentTimeline(sink, name, keys, first, { ...ref }, attachment, ctx);
                }
            }
        }
    }
}
