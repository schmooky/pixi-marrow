import type { AttachmentData, AttachmentRef, VertexData } from '../../model/attachments';
import type { TimelineData } from '../../model/timelines';
import { TimelineWriter } from '../shared/timeline-writer';
import { type AnimationRefs, addTimeline, type TimelineSink } from './context';
import { readDeformCurve } from './curves';
import type { JsonAnimation, JsonAttachmentTimelines, JsonDeformKey, JsonSequenceKey } from './schema';
import { entries, enumIndex, invalid, names, pick, resolve, unknownTimeline } from './values';

const ATTACHMENT_TIMELINES: readonly string[] = ['deform', 'sequence'];
/** The official `SequenceMode` names in the order of their numbers. */
const SEQUENCE_MODES: readonly string[] = [
    'hold',
    'once',
    'loop',
    'pingpong',
    'onceReverse',
    'loopReverse',
    'pingpongReverse',
];
const SEQUENCE_ENTRIES = 3;

/** What a timeline of an attachment needs to know about the attachment it animates. */
interface AttachmentTarget {
    ref: AttachmentRef;
    /** The attachment the skin stores under the name, or nothing when the skin has none there. */
    attachment: AttachmentData | undefined;
    refs: AnimationRefs;
    /** The timeline, as the start of an error sentence. */
    what: string;
}

/** The vertices a deform timeline moves. A linked mesh is deformed with the vertices of its parent. */
function deformGeometry(target: AttachmentTarget): VertexData {
    const { attachment, refs, what } = target;

    if (attachment === undefined) {
        throw invalid(`${what} animates the attachment "${target.ref.name}", which the skin does not have.`);
    }
    if (attachment.type === 'region' || attachment.type === 'point') {
        throw invalid(`${what} deforms a ${attachment.type} attachment, which has no vertices.`);
    }

    return refs.geometry.get(attachment) ?? attachment;
}

/**
 * The vertices of one deform key, computed like the official parser.
 *
 * With weights a key holds offsets, so a key without vertices is all zeros. Without weights a key
 * holds positions: the offsets from the file plus the setup vertices.
 */
function readDeformVertices(key: JsonDeformKey, geometry: VertexData, deformLength: number): Float32Array {
    const weighted = geometry.bones !== null;
    const source = pick<readonly number[] | null>(key.vertices, null);

    if (!source) return weighted ? new Float32Array(deformLength) : geometry.vertices;
    const deform = new Float32Array(deformLength);
    const start = pick(key.offset, 0);

    // values past the end are dropped, as in the official copy
    for (let i = 0; i < source.length; i++) deform[start + i] = source[i] ?? 0;
    if (!weighted) {
        for (let i = 0; i < deformLength; i++) deform[i] = (deform[i] ?? 0) + (geometry.vertices[i] ?? 0);
    }

    return deform;
}

function readDeformTimeline(keys: readonly JsonDeformKey[], target: AttachmentTarget): TimelineData {
    const { ref, what } = target;
    const geometry = deformGeometry(target);
    const deformLength = geometry.bones !== null ? (geometry.vertices.length / 3) * 2 : geometry.vertices.length;
    const writer = new TimelineWriter(keys.length, 1, keys.length);
    const vertices: Float32Array[] = [];
    let bezier = 0;

    if (!Number.isInteger(deformLength)) throw invalid(`${what} deforms an attachment with broken weights.`);
    keys.forEach((key, frame) => {
        const next = keys[frame + 1];

        writer.frames[frame] = pick(key.time, 0);
        vertices.push(readDeformVertices(key, geometry, deformLength));
        if (next && key.curve) {
            bezier = readDeformCurve(key.curve, writer, bezier, frame, pick(key.time, 0), pick(next.time, 0), what);
        }
    });
    writer.shrink(bezier);

    return {
        kind: 'deform',
        target: ref.slot,
        frames: writer.frames,
        curves: writer.curves,
        attachment: ref,
        vertices,
    };
}

function readSequenceTimeline(keys: readonly JsonSequenceKey[], target: AttachmentTarget): TimelineData {
    const { ref, attachment, what } = target;
    const writer = new TimelineWriter(keys.length, SEQUENCE_ENTRIES, null);
    let lastDelay = 0;

    if (attachment === undefined) {
        throw invalid(`${what} animates the attachment "${ref.name}", which the skin does not have.`);
    }
    if ((attachment.type !== 'region' && attachment.type !== 'mesh') || attachment.sequence === null) {
        throw invalid(`${what} animates the attachment "${ref.name}", which has no sequence.`);
    }
    keys.forEach((key, frame) => {
        const delay = pick(key.delay, lastDelay);
        const mode = enumIndex(SEQUENCE_MODES, pick(key.mode, 'hold'), `The mode of a key of ${what}`);

        writer.frames.set([pick(key.time, 0), mode | (pick(key.index, 0) << 4), delay], frame * SEQUENCE_ENTRIES);
        lastDelay = delay;
    });

    return { kind: 'sequence', target: ref.slot, frames: writer.frames, curves: null, attachment: ref };
}

/** Reads the timelines of one attachment. The official parser skips a timeline without keys. */
function readTimelinesOf(map: JsonAttachmentTimelines, target: AttachmentTarget, sink: TimelineSink): void {
    for (const name of names(map, `The timelines of ${target.what}`)) {
        const what = `The ${name} timeline of ${target.what}`;

        if (name === 'deform') {
            if (map.deform?.length) addTimeline(sink, readDeformTimeline(map.deform, { ...target, what }), 1);
        } else if (name === 'sequence') {
            if (map.sequence?.length) {
                addTimeline(sink, readSequenceTimeline(map.sequence, { ...target, what }), SEQUENCE_ENTRIES);
            }
        } else {
            throw unknownTimeline(name, what, ATTACHMENT_TIMELINES);
        }
    }
}

/** Reads the attachment timelines of an animation: mesh deforms and sequences, by skin, slot and attachment. */
export function readAttachmentTimelines(map: JsonAnimation, refs: AnimationRefs, sink: TimelineSink): void {
    const where = `The attachment timelines of ${sink.user}`;

    for (const [skinName, skinMap] of entries(map.attachments, where)) {
        const skin = resolve(refs.skins, skinName, 'skin', sink.user);

        for (const [slotName, slotMap] of entries(skinMap, where)) {
            const slot = resolve(refs.slots, slotName, 'slot', sink.user);

            for (const [name, timelines] of entries(slotMap, where)) {
                const target = {
                    ref: { skin, slot, name },
                    attachment: refs.attachments[skin]?.get(slot)?.get(name),
                    refs,
                    what: `the attachment "${name}" of the slot "${slotName}" in the animation "${sink.name}"`,
                };

                readTimelinesOf(timelines, target, sink);
            }
        }
    }
}
