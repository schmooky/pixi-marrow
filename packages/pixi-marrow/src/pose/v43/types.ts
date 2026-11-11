import type { AttachmentData, VertexData } from '../../model/attachments';
import type { SkeletonModel } from '../../model/model';
import type { EventKey, TimelineKind } from '../../model/timelines';
import type { AttachmentLookup } from '../shared/lookup';
import type { PoseState } from '../state';

/** Official `MixFrom.current`. Alpha mixes from the current pose. Before the first key nothing changes. */
export const CURRENT = 0;
/** Official `MixFrom.setup`. Alpha mixes from the setup pose. Before the first key the setup pose is used. */
export const SETUP = 1;
/** Official `MixFrom.first`. Alpha mixes from the current pose. Before the first key it mixes to the setup pose. */
export const FIRST = 2;
/** Masks the `MixFrom` bits of a timeline mode. */
export const MODE = 3;
/** The bit of a timeline mode that holds a timeline at full alpha while its entry mixes out. */
export const HOLD = 4;

/** A timeline the player treats like any other. */
export const ROLE_PLAIN = 0;
/** The official `RotateTimeline`. The player can mix it along a remembered direction. */
export const ROLE_ROTATE = 1;
/** The official `AttachmentTimeline`. The player applies it with its own retain rules. */
export const ROLE_ATTACHMENT = 2;
/** The official `DrawOrderTimeline`. */
export const ROLE_DRAW_ORDER = 3;
/** The official `DrawOrderFolderTimeline`. */
export const ROLE_FOLDER = 4;
/** The official `EventTimeline`. */
export const ROLE_EVENT = 5;

/**
 * Applies one timeline to a pose. The arguments are those of the official `Timeline.apply`,
 * without the applied pose flag: this engine writes the animated pose only.
 */
export type TimelineKernel = (
    pose: Pose43,
    timeline: Timeline43,
    lastTime: number,
    time: number,
    events: EventKey[] | null,
    alpha: number,
    from: number,
    add: boolean,
    out: boolean,
) => void;

/**
 * One timeline, ready to apply. Every timeline has every field, so all of them share one shape.
 * A field a kind does not use is empty.
 */
export interface Timeline43 {
    readonly kind: TimelineKind;
    /** One of the `ROLE_` constants. */
    readonly role: number;
    /** The bone or slot index. -1 when the kind has none. */
    readonly target: number;
    /** The official `frames` array. */
    readonly frames: Float32Array;
    /** The official `curves` array. Empty for a kind that does not interpolate. */
    readonly curves: Float32Array;
    /** Floats per key in `frames`. */
    readonly entries: number;
    /** The official property ids, as numbers that are unique within the model. */
    readonly ids: Int32Array;
    /** The official `additive` flag. */
    readonly additive: boolean;
    /** The official `instant` flag. */
    readonly instant: boolean;
    readonly apply: TimelineKernel;
    /**
     * Bone timelines: the position of the first animated number among the local numbers of a bone.
     * Color timelines: the number of light channels, 3 or 4.
     */
    readonly offset: number;
    /** Color timelines: true when the keys hold a dark color too. */
    readonly dark: boolean;
    /** Attachment timelines: the name of each key. */
    readonly names: readonly (string | null)[];
    /** Deform and sequence timelines: the attachment that is animated. */
    readonly attachment: AttachmentData | null;
    /**
     * Deform and sequence timelines: the other slots the timeline applies to.
     * Draw order folder timelines: the slots of the folder.
     */
    readonly slots: Int16Array;
    /** Draw order folder timelines: 1 for each slot of the folder. */
    readonly inFolder: Uint8Array;
    /** Deform timelines: the vertices of each key. */
    readonly vertices: readonly Float32Array[];
    /** Event timelines: the event of each key. */
    readonly events: readonly EventKey[];
    /** Draw order timelines: the order of each key. */
    readonly orders: readonly (Int16Array | null)[];
}

/** An animation, ready to play. The official `Animation`. */
export interface Clip43 {
    /** The index of the animation in the model, or -1 for the empty animation. */
    readonly index: number;
    readonly name: string;
    readonly duration: number;
    readonly timelines: readonly Timeline43[];
    /** The property ids of every timeline. The official `timelineIds`. */
    readonly ids: ReadonlySet<number>;
}

/** What the engine needs to know about one attachment of a skin. */
export interface AttachmentInfo {
    /** A number unique to this attachment. The official `VertexAttachment.id` and `Sequence.id`. */
    readonly id: number;
    /** True for the official `VertexAttachment` classes: mesh, bounding box, path and clipping. */
    readonly vertex: boolean;
    /** The official `timelineAttachment`: the attachment whose timelines also move this one. */
    timeline: AttachmentData;
    /** The vertices a deform moves. For a linked mesh they are those of its source. Null without vertices. */
    readonly geometry: VertexData | null;
    /** The official `timelineSlots`. */
    readonly timelineSlots: Int16Array;
    /** The official `sequence.regions.length`. -1 for an attachment that cannot have a sequence. */
    readonly sequenceCount: number;
}

/** Working memory that every engine of one model shares. No call keeps it across a return. */
export interface Scratch43 {
    /** The values of one key. */
    readonly sample: Float64Array;
    /** Per property id: the track that set the property first. It counts while `stamps` holds `generation`. */
    readonly owners: Int32Array;
    readonly stamps: Float64Array;
    /** Counts the times the timeline modes were computed. A new count makes every owner stale. */
    generation: number;
}

/** What every engine of one model shares: the animations and the attachment tables. */
export interface Rig43 {
    readonly model: SkeletonModel;
    readonly lookup: AttachmentLookup;
    readonly clips: readonly Clip43[];
    /** The official `AnimationState.emptyAnimation`. */
    readonly empty: Clip43;
    readonly info: ReadonlyMap<AttachmentData, AttachmentInfo>;
    /** The property id of the official `DrawOrderTimeline`. */
    readonly drawOrderId: number;
    readonly scratch: Scratch43;
}

/** The pose of one engine and what its timelines need to write it. */
export interface Pose43 {
    readonly rig: Rig43;
    readonly state: PoseState;
}
