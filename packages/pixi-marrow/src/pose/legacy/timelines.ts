import type { AttachmentData } from '../../model/attachments';
import type { EventKey } from '../../model/timelines';

/** The official `MixBlend.setup`. */
export const SETUP = 0;
/** The official `MixBlend.first`. */
export const FIRST = 1;
/** The official `MixBlend.replace`. */
export const REPLACE = 2;
/** The official `MixBlend.add`. */
export const ADD = 3;
/** The official `MixBlend` names in lower case. The index is the value. */
export const MIX_BLENDS: readonly string[] = ['setup', 'first', 'replace', 'add'];

/** The official `MixDirection.mixIn`. */
export const MIX_IN = 0;
/** The official `MixDirection.mixOut`. */
export const MIX_OUT = 1;

/** Timeline kind code: `RotateTimeline`. */
export const K_ROTATE = 0;
/** Timeline kind code: `TranslateTimeline`. */
export const K_TRANSLATE = 1;
/** Timeline kind code: `TranslateXTimeline`. */
export const K_TRANSLATE_X = 2;
/** Timeline kind code: `TranslateYTimeline`. */
export const K_TRANSLATE_Y = 3;
/** Timeline kind code: `ScaleTimeline`. */
export const K_SCALE = 4;
/** Timeline kind code: `ScaleXTimeline`. */
export const K_SCALE_X = 5;
/** Timeline kind code: `ScaleYTimeline`. */
export const K_SCALE_Y = 6;
/** Timeline kind code: `ShearTimeline`. */
export const K_SHEAR = 7;
/** Timeline kind code: `ShearXTimeline`. */
export const K_SHEAR_X = 8;
/** Timeline kind code: `ShearYTimeline`. */
export const K_SHEAR_Y = 9;
/** Timeline kind code: `InheritTimeline`. */
export const K_INHERIT = 10;
/** Timeline kind code: `RGBATimeline`. */
export const K_RGBA = 11;
/** Timeline kind code: `RGBTimeline`. */
export const K_RGB = 12;
/** Timeline kind code: `AlphaTimeline`. */
export const K_ALPHA = 13;
/** Timeline kind code: `RGBA2Timeline`. */
export const K_RGBA2 = 14;
/** Timeline kind code: `RGB2Timeline`. */
export const K_RGB2 = 15;
/** Timeline kind code: `AttachmentTimeline`. */
export const K_ATTACHMENT = 16;
/** Timeline kind code: `DeformTimeline`. */
export const K_DEFORM = 17;
/** Timeline kind code: `SequenceTimeline`. */
export const K_SEQUENCE = 18;
/** Timeline kind code: `EventTimeline`. */
export const K_EVENT = 19;
/** Timeline kind code: `DrawOrderTimeline`. */
export const K_DRAW_ORDER = 20;
/** Timeline kind code: `IkConstraintTimeline`. */
export const K_IK = 21;
/** Timeline kind code: `TransformConstraintTimeline`. */
export const K_TRANSFORM = 22;
/** Timeline kind code: `PathConstraintPositionTimeline`. */
export const K_PATH_POSITION = 23;
/** Timeline kind code: `PathConstraintSpacingTimeline`. */
export const K_PATH_SPACING = 24;
/** Timeline kind code: `PathConstraintMixTimeline`. */
export const K_PATH_MIX = 25;
/**
 * Timeline kind code: `PhysicsConstraintInertiaTimeline`. The codes of the six other timelines
 * that animate a value of a physics constraint follow it, in the order of the values.
 */
export const K_PHYSICS_INERTIA = 26;
/** Timeline kind code: `PhysicsConstraintStrengthTimeline`. */
export const K_PHYSICS_STRENGTH = 27;
/** Timeline kind code: `PhysicsConstraintDampingTimeline`. */
export const K_PHYSICS_DAMPING = 28;
/** Timeline kind code: `PhysicsConstraintMassTimeline`. */
export const K_PHYSICS_MASS = 29;
/** Timeline kind code: `PhysicsConstraintWindTimeline`. */
export const K_PHYSICS_WIND = 30;
/** Timeline kind code: `PhysicsConstraintGravityTimeline`. */
export const K_PHYSICS_GRAVITY = 31;
/** Timeline kind code: `PhysicsConstraintMixTimeline`. */
export const K_PHYSICS_MIX = 32;
/** Timeline kind code: `PhysicsConstraintResetTimeline`. */
export const K_PHYSICS_RESET = 33;

const NO_FLOATS = new Float32Array(0);

/** What {@link LegacyTimeline} takes from the model besides its kind and target. */
export interface TimelineParts {
    frames: Float32Array;
    curves: Float32Array | null;
    /** The property ids the timeline sets, as the official `getPropertyIds` lists them. */
    ids: readonly number[];
    attachmentNames?: readonly (string | null)[];
    attachment?: AttachmentData;
    sequenceCount?: number;
    vertices?: readonly Float32Array[];
    events?: readonly EventKey[];
    drawOrders?: readonly (Int16Array | null)[];
}

/**
 * One timeline, ready to apply. Every kind has every field, so the engine sees one object shape.
 * Shared by all instances of a model.
 */
export class LegacyTimeline {
    /** One of the `K_` codes. */
    readonly kind: number;
    /**
     * The bone, slot or constraint index. For a physics timeline the place of its constraint among
     * the physics constraints, or -1 for all of them. -1 for kinds without a target.
     */
    readonly target: number;
    /** Floats per key in `frames`. */
    readonly entries: number;

    readonly frames: Float32Array;
    /** Empty for kinds that do not interpolate. */
    readonly curves: Float32Array;
    readonly ids: readonly number[];
    /** `K_ATTACHMENT`: the attachment name of each key. */
    readonly attachmentNames: readonly (string | null)[];
    /**
     * `K_ATTACHMENT`: the attachment each key shows in a skin, found when the timeline is first
     * applied to a skeleton that wears the skin. The place of a skin is its index plus one.
     */
    readonly shown: (readonly (AttachmentData | null)[] | undefined)[];
    /** `K_DEFORM` and `K_SEQUENCE`: the attachment that is animated. */
    readonly attachment: AttachmentData | null;
    /** `K_SEQUENCE`: the region count of the attachment's sequence, or -1 when it has none. */
    readonly sequenceCount: number;
    /** `K_DEFORM`: the vertices of each key. */
    readonly vertices: readonly Float32Array[];
    /** `K_EVENT`: the event of each key. */
    readonly events: readonly EventKey[];
    /** `K_DRAW_ORDER`: the slot order of each key, or null for the setup order. */
    readonly drawOrders: readonly (Int16Array | null)[];

    constructor(kind: number, target: number, entries: number, parts: TimelineParts) {
        this.kind = kind;
        this.target = target;
        this.entries = entries;

        this.frames = parts.frames;
        this.curves = parts.curves ?? NO_FLOATS;
        this.ids = parts.ids;
        this.attachmentNames = parts.attachmentNames ?? [];
        this.shown = [];
        this.attachment = parts.attachment ?? null;
        this.sequenceCount = parts.sequenceCount ?? -1;
        this.vertices = parts.vertices ?? [];
        this.events = parts.events ?? [];
        this.drawOrders = parts.drawOrders ?? [];
    }
}

/** An animation, ready to play. Shared by all instances of a model. */
export interface Clip {
    /** The index of the animation in the model, or -1 for the empty animation. */
    readonly index: number;
    /** The official animation name. The empty animation is `<empty>`. */
    readonly name: string;
    readonly duration: number;
    readonly timelines: readonly LegacyTimeline[];
    /** Every property id a timeline of the animation sets: the official `timelineIds`. */
    readonly ids: ReadonlySet<number>;
    /** True when every timeline gives the same result at every time from `stillFrom` on: the animation is a pose. */
    readonly still: boolean;
    /** The latest first key of the timelines. Before it a timeline gives the setup value, not its key. */
    readonly stillFrom: number;
}
