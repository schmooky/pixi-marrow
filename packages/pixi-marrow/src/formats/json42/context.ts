import type { AttachmentData, VertexData } from '../../model/attachments';
import type { EventData } from '../../model/model';
import type { TimelineData } from '../../model/timelines';
import { invalid, type NameIndex } from './values';

/** The version lines this importer reads. */
export type Json42Version = '4.1' | '4.2';

/** Name lookups for the constraints, and where each kind starts in the one constraint list of the model. */
export interface ConstraintRefs {
    ik: NameIndex;
    transform: NameIndex;
    path: NameIndex;
    physics: NameIndex;
    /** The index of the first transform constraint in the model's constraint list. */
    transformOffset: number;
    /** The index of the first path constraint in the model's constraint list. */
    pathOffset: number;
    /** The index of the first physics constraint in the model's constraint list. */
    physicsOffset: number;
}

/** Name lookups for the bones, slots and constraints of the skeleton. */
export interface SkeletonRefs {
    version: Json42Version;
    bones: NameIndex;
    boneCount: number;
    slots: NameIndex;
    slotCount: number;
    constraints: ConstraintRefs;
}

/** The attachments of one skin, by slot index, then by the name the skin stores them under. */
export type SkinAttachments = Map<number, Map<string, AttachmentData>>;

/** Everything an animation can refer to. */
export interface AnimationRefs extends SkeletonRefs {
    skins: NameIndex;
    /** The attachments of each skin, in skin order. */
    attachments: readonly SkinAttachments[];
    /** The vertices a linked mesh took from its parent. The official parser copies them at load. */
    geometry: ReadonlyMap<AttachmentData, VertexData>;
    events: NameIndex;
    eventData: readonly EventData[];
}

/** Collects the timelines of one animation and tracks its duration. */
export interface TimelineSink {
    /** The name of the animation. */
    name: string;
    /** The animation, as the start of an error sentence. */
    user: string;
    timelines: TimelineData[];
    duration: number;
}

/**
 * Adds a timeline to an animation. The duration grows to the time of the last key, like the
 * official `getDuration`.
 *
 * @param entries floats per key in `frames`
 */
export function addTimeline(sink: TimelineSink, timeline: TimelineData, entries: number): void {
    const last = timeline.frames[timeline.frames.length - entries];

    // the official parser builds such a timeline and ends up with a duration that is not a number
    if (last === undefined) throw invalid(`${sink.user} has a ${timeline.kind} timeline without keys.`);
    sink.duration = Math.max(sink.duration, last);
    sink.timelines.push(timeline);
}
