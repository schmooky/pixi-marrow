/** A bone property a transform constraint or a slider reads or writes. */
export type TransformProperty = 'rotate' | 'x' | 'y' | 'scaleX' | 'scaleY' | 'shearY';

/** How a constraint scales a bone on Y when it scales it on X. 4.3 only. */
export type ScaleYMode = 'none' | 'uniform' | 'volume';

/** What every constraint has. */
export interface ConstraintBase {
    name: string;
    /** True when the constraint is active only while a skin that lists it is active. */
    skinRequired: boolean;
    /** 4.1 and 4.2 only. The position of the constraint in the update order. 4.3 uses the list order. */
    order?: number;
}

/** Points one or two bones at a target bone. */
export interface IkConstraintData extends ConstraintBase {
    type: 'ik';
    /** One or two bone indices. */
    bones: Int16Array;
    /** The index of the target bone. */
    target: number;
    mix: number;
    softness: number;
    /** 1 or -1. */
    bendDirection: number;
    compress: boolean;
    stretch: boolean;
    /** 4.1 and 4.2 only. */
    uniform?: boolean;
    /** 4.3 only. */
    scaleYMode?: ScaleYMode;
}

/** One property a 4.3 transform constraint writes, fed by the property it belongs to. */
export interface TransformTo {
    property: TransformProperty;
    offset: number;
    max: number;
    scale: number;
}

/** One property a 4.3 transform constraint reads from its source bone. */
export interface TransformFrom {
    property: TransformProperty;
    offset: number;
    to: TransformTo[];
}

/** Copies transform properties from a source bone to other bones. */
export interface TransformConstraintData extends ConstraintBase {
    type: 'transform';
    bones: Int16Array;
    /** The index of the bone that is copied from. 4.1 and 4.2 call it the target. */
    source: number;
    mixRotate: number;
    mixX: number;
    mixY: number;
    mixScaleX: number;
    mixScaleY: number;
    mixShearY: number;
    /** Six offsets in this order, rotation, x, y, scaleX, scaleY, shearY. */
    offsets: Float64Array;
    /** 4.1 and 4.2 only. */
    relative?: boolean;
    /** 4.1 and 4.2 only. */
    local?: boolean;
    /** 4.3 only. */
    localSource?: boolean;
    /** 4.3 only. */
    localTarget?: boolean;
    /** 4.3 only. */
    additive?: boolean;
    /** 4.3 only. */
    clamp?: boolean;
    /** 4.3 only. The property mappings, in file order. */
    properties?: TransformFrom[];
}

/** Places bones along a path attachment. */
export interface PathConstraintData extends ConstraintBase {
    type: 'path';
    bones: Int16Array;
    /** The index of the slot that holds the path. */
    slot: number;
    positionMode: 'fixed' | 'percent';
    spacingMode: 'length' | 'fixed' | 'percent' | 'proportional';
    rotateMode: 'tangent' | 'chain' | 'chainScale';
    offsetRotation: number;
    position: number;
    spacing: number;
    mixRotate: number;
    mixX: number;
    mixY: number;
}

/** Moves a bone with simulated physics. 4.2 and 4.3. */
export interface PhysicsConstraintData extends ConstraintBase {
    type: 'physics';
    /** The index of the bone that is moved. */
    bone: number;
    x: number;
    y: number;
    rotate: number;
    scaleX: number;
    shearX: number;
    limit: number;
    /** The length of one simulation step in seconds. */
    step: number;
    inertia: number;
    strength: number;
    damping: number;
    massInverse: number;
    wind: number;
    gravity: number;
    mix: number;
    inertiaGlobal: boolean;
    strengthGlobal: boolean;
    dampingGlobal: boolean;
    massGlobal: boolean;
    windGlobal: boolean;
    gravityGlobal: boolean;
    mixGlobal: boolean;
    /** 4.3 only. */
    scaleYMode?: ScaleYMode;
}

/** Drives an animation's time from a bone property or from its own time. 4.3 only. */
export interface SliderConstraintData extends ConstraintBase {
    type: 'slider';
    /** The index into the animation list of the animation the slider plays. */
    animation: number;
    additive: boolean;
    loop: boolean;
    mix: number;
    time: number;
    /** The index of the bone whose property drives the time, or -1 when no bone does. */
    bone: number;
    /** The bone property that drives the time, or null when no bone does. */
    property: TransformProperty | null;
    /** The offset of the bone property. */
    propertyOffset: number;
    offset: number;
    scale: number;
    max: number;
    local: boolean;
}

/** Any constraint. `type` tells which. */
export type ConstraintData =
    | IkConstraintData
    | TransformConstraintData
    | PathConstraintData
    | PhysicsConstraintData
    | SliderConstraintData;
