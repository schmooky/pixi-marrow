import type { AttachmentRef } from './attachments';

/**
 * What a timeline animates. The name is the official timeline class name without `Timeline`,
 * with a lower case first letter.
 */
export type TimelineKind =
    | 'rotate'
    | 'translate'
    | 'translateX'
    | 'translateY'
    | 'scale'
    | 'scaleX'
    | 'scaleY'
    | 'shear'
    | 'shearX'
    | 'shearY'
    | 'inherit'
    | 'rgba'
    | 'rgb'
    | 'alpha'
    | 'rgba2'
    | 'rgb2'
    | 'attachment'
    | 'deform'
    | 'sequence'
    | 'event'
    | 'drawOrder'
    | 'drawOrderFolder'
    | 'ikConstraint'
    | 'transformConstraint'
    | 'pathConstraintPosition'
    | 'pathConstraintSpacing'
    | 'pathConstraintMix'
    | 'physicsConstraintInertia'
    | 'physicsConstraintStrength'
    | 'physicsConstraintDamping'
    | 'physicsConstraintMass'
    | 'physicsConstraintWind'
    | 'physicsConstraintGravity'
    | 'physicsConstraintMix'
    | 'physicsConstraintReset'
    | 'slider'
    | 'sliderMix';

/** One event key of an event timeline. */
export interface EventKey {
    time: number;
    /** The index into the model's event list. */
    event: number;
    int: number;
    float: number;
    string: string;
    volume: number;
    balance: number;
}

/**
 * One timeline of an animation.
 *
 * `frames` and `curves` hold the same numbers, in the same layout, as the `frames` and `curves`
 * arrays of the official timeline of that kind and version. The pose core reads them with the
 * same arithmetic as the official runtime, which is what makes poses match.
 */
export interface TimelineData {
    kind: TimelineKind;
    /**
     * The bone, slot or constraint index the timeline animates. Constraint indices point into the
     * model's constraint list. -1 when the kind has no target, and for a physics timeline that
     * applies to every physics constraint.
     */
    target: number;
    /** The official `frames` array: the time of each key and, for most kinds, its values. */
    frames: Float32Array;
    /** The official `curves` array, or null for kinds that do not interpolate. */
    curves: Float32Array | null;
    /** `attachment` kind. The attachment name of each key, or null to clear the slot. */
    attachmentNames?: (string | null)[];
    /** `deform` and `sequence` kinds. The attachment that is animated. */
    attachment?: AttachmentRef;
    /** `deform` kind. The vertex offsets or positions of each key. */
    vertices?: Float32Array[];
    /** `event` kind. One entry per key. */
    events?: EventKey[];
    /** `drawOrder` and `drawOrderFolder` kinds. The slot order of each key, or null for the setup order. */
    drawOrders?: (Int16Array | null)[];
    /** `drawOrderFolder` kind. The slots of the folder. */
    folderSlots?: Int16Array;
}
