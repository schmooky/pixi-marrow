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
/** Timeline kind code: a timeline that animates a constraint. It counts for mixing and is not applied. */
export const K_SKIPPED = 21;

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
    /** The bone or slot index. -1 for kinds without a target. */
    readonly target: number;
    /** Floats per key in `frames`. */
    readonly entries: number;
    readonly frames: Float32Array;
    /** Empty for kinds that do not interpolate. */
    readonly curves: Float32Array;
    readonly ids: readonly number[];
    /** `K_ATTACHMENT`: the attachment name of each key. */
    readonly attachmentNames: readonly (string | null)[];
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
}
