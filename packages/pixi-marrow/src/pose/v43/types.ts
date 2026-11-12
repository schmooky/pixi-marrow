import type { AttachmentData, VertexData } from '../../model/attachments';
import type { SkeletonModel } from '../../model/model';
import type { EventKey, TimelineKind } from '../../model/timelines';
import type { AttachmentLookup } from '../shared/lookup';
import type { PoseState } from '../state';
import type { Solve43, Solver43 } from './solver-types';

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

/*
 * The kernels: the functions that apply a timeline. A timeline names its kernel with one of these
 * numbers, and `applyTimeline` calls it. The numbers are small and dense, so that the choice
 * compiles to a jump.
 */

/** Rotate, translateX, translateY, shearX and shearY timelines. */
export const OP_RELATIVE = 0;
/** Translate and shear timelines. */
export const OP_PAIR = 1;
/** The scale timeline. */
export const OP_SCALE_PAIR = 2;
/** ScaleX and scaleY timelines. */
export const OP_SCALE = 3;
/** Rgba, rgb, rgba2 and rgb2 timelines. */
export const OP_COLOR = 4;
/** The alpha timeline. */
export const OP_ALPHA = 5;
/** The attachment timeline, applied on its own. */
export const OP_ATTACHMENT = 6;
/** The deform timeline. */
export const OP_DEFORM = 7;
/** The sequence timeline. */
export const OP_SEQUENCE = 8;
/** The event timeline. */
export const OP_EVENT = 9;
/** The draw order timeline. */
export const OP_DRAW_ORDER = 10;
/** The draw order folder timeline. */
export const OP_FOLDER = 11;
/** The inherit timeline. */
export const OP_INHERIT = 12;
/** The IK constraint timeline. */
export const OP_IK = 13;
/** Transform constraint and path constraint mix timelines. */
export const OP_MIXES = 14;
/** Path constraint position and spacing timelines. */
export const OP_VALUE = 15;
/** A two color timeline on a slot without a dark color. It throws. */
export const OP_NO_DARK = 16;
/** Physics constraint inertia, strength, damping, wind, gravity and mix timelines. */
export const OP_PHYSICS = 17;
/** The physics constraint mass timeline. */
export const OP_PHYSICS_MASS = 18;
/** The physics constraint reset timeline. */
export const OP_PHYSICS_RESET = 19;
/** Slider time and slider mix timelines. */
export const OP_SLIDER = 20;

/**
 * One timeline, ready to apply. Every timeline has every field, so all of them share one shape.
 * A field a kind does not use is empty.
 */
export interface Timeline43 {
    readonly kind: TimelineKind;
    /** One of the `ROLE_` constants. */
    readonly role: number;
    /** The bone, slot or constraint index. -1 when the kind has none. */
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
    /** The kernel that applies the timeline: one of the `OP_` constants. */
    readonly op: number;
    /**
     * The bone that has to be active for the timeline to apply. A bone timeline names its bone and
     * a slot timeline the bone of its slot. -1 when the kind has none.
     */
    readonly bone: number;
    /**
     * Bone timelines: the position of the first animated number among the local numbers of a bone.
     * Color timelines: the number of light channels, 3 or 4.
     * Constraint timelines: where the first animated number is among the constraint poses. For a
     * timeline of every physics constraint it is the position among the numbers of one constraint.
     */
    readonly offset: number;
    /** Color timelines: true when the keys hold a dark color too. */
    readonly dark: boolean;
    /** Attachment timelines: the name of each key. */
    readonly names: readonly (string | null)[];
    /**
     * Attachment timelines: per skin, the attachment each key shows. The first row is for no skin,
     * then one row per skin of the model. A row is filled in when its skin first plays the timeline,
     * and an entry when its key is first reached. Undefined stands for not looked up yet.
     */
    readonly shown: ((AttachmentData | null | undefined)[] | undefined)[];
    /** Deform and sequence timelines: the attachment that is animated. */
    readonly attachment: AttachmentData | null;
    /** Deform and sequence timelines: what the engine knows about `attachment`. */
    readonly info: AttachmentInfo | null;
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
    /** The constraints of the model, ready to solve. */
    readonly solver: Solver43;
}

/**
 * One pose of an engine, as the timelines write it, with what every pose of the engine shares.
 *
 * An engine without sliders has one pose. Its arrays are those of `state` and the constraint
 * poses of `solve`. An engine with sliders has two. The player writes the animated pose and the
 * sliders write the applied pose. The two share the arrays that no slider of the model animates.
 */
export interface Pose43 {
    readonly rig: Rig43;
    /** The public pose state: where the skeleton is, its skin and its time, and the pose that is drawn. */
    readonly state: PoseState;
    /** The constraint state and the update order of the engine. */
    readonly solve: Solve43;
    /** The local numbers of every bone, in the layout of `PoseState.local`. */
    readonly local: Float64Array;
    /** The inherit mode of every bone. */
    readonly inherit: Uint8Array;
    /** The color of every slot: r, g, b, a. */
    readonly colors: Float64Array;
    /** The dark color of every slot: r, g, b. */
    readonly darkColors: Float64Array;
    /** The attachment of every slot, or null. */
    readonly attachments: (AttachmentData | null)[];
    readonly sequenceIndices: Int32Array;
    /** The deform of every slot. Only the first `deformLengths[slot]` numbers count. */
    readonly deform: Float64Array[];
    readonly deformLengths: Int32Array;
    readonly drawOrder: Int16Array;
    /** The pose of every constraint, each at `at` of its plan. */
    readonly values: Float64Array;
}
