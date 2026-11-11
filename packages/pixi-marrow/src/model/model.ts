import type { SpineVersion } from '../base/version';
import type { AttachmentData } from './attachments';
import type { ConstraintData } from './constraints';
import type { TimelineData } from './timelines';

/**
 * A skeleton as its file describes it. Immutable after import and shared by every instance.
 *
 * The model is a faithful import, not a conversion. A 4.1 file keeps its 4.1 constraint fields,
 * and the pose core decides later how to solve them. Lengths are in file units, without a scale.
 *
 * Setup values that the official runtime keeps as 64-bit numbers are stored in `Float64Array`,
 * so a pose can equal the official one exactly. Bulk vertex and timeline data is 32-bit, as in the
 * official runtime.
 *
 * Editor-only data is not imported: bone colors and icons, mesh edges, skin colors, colors of
 * attachments that are never drawn, and the image and audio paths.
 */
export interface SkeletonModel {
    /** The version line of the file. Fields that exist only for some versions say so. */
    version: SpineVersion;
    /** The full version string from the file, for example `4.2.22`. */
    editorVersion: string;
    /** The hash the editor wrote, or null. */
    hash: string | null;
    /** The setup pose bounds from the editor. */
    x: number;
    y: number;
    width: number;
    height: number;
    /** The reference scale for physics. 100 for 4.1 files, which have none. */
    referenceScale: number;
    bones: BoneTable;
    slots: SlotTable;
    events: EventData[];
    /**
     * Every constraint in one list. A 4.3 file gives the order. For 4.1 and 4.2 files the list
     * holds IK constraints first, then transform, path and physics constraints, each in file order.
     */
    constraints: ConstraintData[];
    skins: SkinData[];
    animations: AnimationData[];
}

/** How a bone inherits its parent transform. A bone stores the index into this list. */
export const INHERIT_MODES: readonly string[] = [
    'normal',
    'onlyTranslation',
    'noRotationOrReflection',
    'noScale',
    'noScaleOrReflection',
];

/** How a slot blends with what is behind it. A slot stores the index into this list. */
export const BLEND_MODES: readonly string[] = ['normal', 'additive', 'multiply', 'screen'];

/** Floats per bone in {@link BoneTable.setup}. */
export const BONE_SETUP_STRIDE = 7;

/** Every bone, one array per property. Parents come before their children. */
export interface BoneTable {
    count: number;
    names: string[];
    /** The parent bone index, or -1 for a root bone. */
    parents: Int16Array;
    /** The setup pose. Per bone, in this order, x, y, rotation, scaleX, scaleY, shearX, shearY. */
    setup: Float64Array;
    lengths: Float64Array;
    /** An index into {@link INHERIT_MODES}. 4.1 calls this the transform mode. */
    inherit: Uint8Array;
    /** 1 when the bone is active only while a skin that lists it is active. */
    skinRequired: Uint8Array;
}

/** Every slot, one array per property, in setup draw order. */
export interface SlotTable {
    count: number;
    names: string[];
    /** The bone index of each slot. */
    bones: Int16Array;
    /** The setup color. Per slot r, g, b, a. */
    colors: Float64Array;
    /** The setup dark color for two color tint. Per slot r, g, b. Read it only where hasDark is 1. */
    darkColors: Float64Array;
    hasDark: Uint8Array;
    /** The name of the setup attachment of each slot, or null. */
    attachments: (string | null)[];
    /** An index into {@link BLEND_MODES}. */
    blendModes: Uint8Array;
    /** 0 where the editor hid the slot. Files before 4.2 have no such flag and store 1. */
    visible: Uint8Array;
}

/** An event an animation can fire, with its default values. */
export interface EventData {
    name: string;
    int: number;
    float: number;
    string: string;
    /** The audio file of the event, or null. */
    audioPath: string | null;
    volume: number;
    balance: number;
}

/** One attachment of a skin, under the slot and the name the skin stores it at. */
export interface SkinAttachment {
    /** The slot index. */
    slot: number;
    /** The name the skin stores the attachment under. It can differ from the attachment's own name. */
    name: string;
    attachment: AttachmentData;
}

/** A skin: attachments by slot and name, plus the bones and constraints it turns on. */
export interface SkinData {
    name: string;
    /** Indices of the bones that are active with this skin. */
    bones: Int16Array;
    /** Indices into {@link SkeletonModel.constraints} of the constraints active with this skin, in file order. */
    constraints: Int16Array;
    /** Sorted by slot index, then by name in UTF-16 code unit order. */
    attachments: SkinAttachment[];
}

/** An animation: its timelines in the order the official runtime applies them. */
export interface AnimationData {
    name: string;
    /** The time of the last key of any timeline, in seconds. */
    duration: number;
    timelines: TimelineData[];
}
