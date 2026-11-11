/*
 * The shape of a Spine 4.1 or 4.2 JSON skeleton. Every field is optional, because the editor
 * leaves out values that equal their default.
 */

/** The `skeleton` entry: editor information and the setup pose bounds. */
interface JsonSkeleton {
    hash?: string;
    spine?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    /** 4.2 only. */
    referenceScale?: number;
}

/** One entry of `bones`. */
interface JsonBone {
    name?: string;
    parent?: string;
    length?: number;
    x?: number;
    y?: number;
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
    shearX?: number;
    shearY?: number;
    /** 4.2 only. How the bone inherits its parent transform. */
    inherit?: string;
    /** 4.1 only. The same value under its old name, the transform mode. */
    transform?: string;
    /** True when the bone is active only with a skin that lists it. */
    skin?: boolean;
}

/** One entry of `slots`. */
interface JsonSlot {
    name?: string;
    bone?: string;
    color?: string;
    dark?: string;
    attachment?: string;
    blend?: string;
    /** 4.2 only. */
    visible?: boolean;
}

/** What every constraint entry has. */
export interface JsonConstraint {
    name?: string;
    order?: number;
    /** True when the constraint is active only with a skin that lists it. */
    skin?: boolean;
}

/** One entry of `ik`. */
export interface JsonIkConstraint extends JsonConstraint {
    bones?: string[];
    target?: string;
    mix?: number;
    softness?: number;
    bendPositive?: boolean;
    compress?: boolean;
    stretch?: boolean;
    uniform?: boolean;
}

/** One entry of `transform`. */
export interface JsonTransformConstraint extends JsonConstraint {
    bones?: string[];
    target?: string;
    local?: boolean;
    relative?: boolean;
    rotation?: number;
    x?: number;
    y?: number;
    scaleX?: number;
    scaleY?: number;
    shearY?: number;
    mixRotate?: number;
    mixX?: number;
    mixY?: number;
    mixScaleX?: number;
    mixScaleY?: number;
    mixShearY?: number;
}

/** One entry of `path`. */
export interface JsonPathConstraint extends JsonConstraint {
    bones?: string[];
    /** The name of the slot that holds the path. */
    target?: string;
    positionMode?: string;
    spacingMode?: string;
    rotateMode?: string;
    rotation?: number;
    position?: number;
    spacing?: number;
    mixRotate?: number;
    mixX?: number;
    mixY?: number;
}

/** One entry of `physics`. 4.2 only. */
export interface JsonPhysicsConstraint extends JsonConstraint {
    bone?: string;
    x?: number;
    y?: number;
    rotate?: number;
    scaleX?: number;
    shearX?: number;
    limit?: number;
    fps?: number;
    inertia?: number;
    strength?: number;
    damping?: number;
    mass?: number;
    wind?: number;
    gravity?: number;
    mix?: number;
    inertiaGlobal?: boolean;
    strengthGlobal?: boolean;
    dampingGlobal?: boolean;
    massGlobal?: boolean;
    windGlobal?: boolean;
    gravityGlobal?: boolean;
    mixGlobal?: boolean;
}

/** The `sequence` entry of a region or mesh attachment. */
export interface JsonSequence {
    count?: number;
    start?: number;
    digits?: number;
    setup?: number;
}

/** One attachment of a skin. `type` tells which fields it uses. Without `type` it is a region. */
export interface JsonAttachment {
    type?: string;
    name?: string;
    path?: string;
    color?: string;
    sequence?: JsonSequence;
    x?: number;
    y?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    width?: number;
    height?: number;
    /** Mesh. u, v per vertex. */
    uvs?: number[];
    triangles?: number[];
    /** x, y per vertex. With weights, per vertex a bone count, then bone, x, y, weight per bone. */
    vertices?: number[];
    vertexCount?: number;
    hull?: number;
    /** Linked mesh. The name of the mesh it takes its geometry from. */
    parent?: string;
    /** Linked mesh. The skin that holds the parent mesh. */
    skin?: string;
    /** Linked mesh. False when the mesh does not follow the deform timelines of its parent. */
    timelines?: boolean;
    /** Path. */
    closed?: boolean;
    constantSpeed?: boolean;
    lengths?: number[];
    /** Clipping. The name of the last slot that is clipped. */
    end?: string;
}

/** One entry of `skins`. */
export interface JsonSkin {
    name?: string;
    bones?: string[];
    ik?: string[];
    transform?: string[];
    path?: string[];
    /** 4.2 only. */
    physics?: string[];
    /** Attachments by slot name, then by the name the skin stores them under. */
    attachments?: Record<string, Record<string, JsonAttachment>>;
}

/** One entry of `events`: the default values of an event. */
interface JsonEvent {
    int?: number;
    float?: number;
    string?: string;
    audio?: string;
    volume?: number;
    balance?: number;
}

/** The curve from a key to the next one: `stepped`, or four Bezier handle numbers per value. */
export type JsonCurve = 'stepped' | number[];

/** What every key that can interpolate has. */
export interface JsonCurveKey {
    time?: number;
    curve?: JsonCurve;
}

/** A key with one value, or with an x and y pair. */
export interface JsonValueKey extends JsonCurveKey {
    value?: number;
    x?: number;
    y?: number;
}

/** A key of a bone timeline. An `inherit` key holds a mode name in place of numbers. */
export interface JsonBoneKey extends JsonValueKey {
    inherit?: string;
}

/** A key of a slot color timeline. One color timelines use `color`. Two color timelines use `light` and `dark`. */
export interface JsonColorKey extends JsonCurveKey {
    color?: string;
    light?: string;
    dark?: string;
}

/** A key of a slot attachment timeline. A missing or null name clears the slot. */
export interface JsonAttachmentKey {
    time?: number;
    name?: string | null;
}

/** The timelines of one slot in an animation, by timeline name. */
export interface JsonSlotTimelines {
    attachment?: JsonAttachmentKey[];
    rgba?: JsonColorKey[];
    rgb?: JsonColorKey[];
    alpha?: JsonValueKey[];
    rgba2?: JsonColorKey[];
    rgb2?: JsonColorKey[];
}

/** A key of an IK constraint timeline. */
export interface JsonIkKey extends JsonCurveKey {
    mix?: number;
    softness?: number;
    bendPositive?: boolean;
    compress?: boolean;
    stretch?: boolean;
}

/** A key of a transform constraint timeline, or of the mix timeline of a path constraint. */
export interface JsonMixKey extends JsonCurveKey {
    mixRotate?: number;
    mixX?: number;
    mixY?: number;
    mixScaleX?: number;
    mixScaleY?: number;
    mixShearY?: number;
}

/** The timelines of one path constraint in an animation, by timeline name. */
export interface JsonPathTimelines {
    position?: JsonValueKey[];
    spacing?: JsonValueKey[];
    mix?: JsonMixKey[];
}

/** A key of a deform timeline. `vertices` holds the changed run of values, starting at `offset`. */
export interface JsonDeformKey extends JsonCurveKey {
    offset?: number;
    vertices?: number[];
}

/** A key of a sequence timeline. */
export interface JsonSequenceKey {
    time?: number;
    delay?: number;
    mode?: string;
    index?: number;
}

/** The timelines of one attachment in an animation, by timeline name. */
export interface JsonAttachmentTimelines {
    deform?: JsonDeformKey[];
    sequence?: JsonSequenceKey[];
}

/** One slot move of a draw order key. `offset` is how far the slot moves in the draw order. */
export interface JsonDrawOrderOffset {
    slot?: string;
    offset?: number;
}

/** A key of the draw order timeline. Without `offsets` it restores the setup order. */
interface JsonDrawOrderKey {
    time?: number;
    offsets?: JsonDrawOrderOffset[];
}

/** A key of the event timeline. Values that are left out come from the event's defaults. */
export interface JsonEventKey {
    time?: number;
    name?: string;
    int?: number;
    float?: number;
    string?: string;
    volume?: number;
    balance?: number;
}

/** One entry of `animations`. */
export interface JsonAnimation {
    /** By slot name. */
    slots?: Record<string, JsonSlotTimelines>;
    /** By bone name, then by timeline name. */
    bones?: Record<string, Record<string, JsonBoneKey[]>>;
    /** By IK constraint name. */
    ik?: Record<string, JsonIkKey[]>;
    /** By transform constraint name. */
    transform?: Record<string, JsonMixKey[]>;
    /** By path constraint name. */
    path?: Record<string, JsonPathTimelines>;
    /** 4.2 only. By physics constraint name, then by timeline name. An empty name means every constraint. */
    physics?: Record<string, Record<string, JsonValueKey[]>>;
    /** By skin name, then slot name, then the name the skin stores the attachment under. */
    attachments?: Record<string, Record<string, Record<string, JsonAttachmentTimelines>>>;
    drawOrder?: JsonDrawOrderKey[];
    events?: JsonEventKey[];
}

/** The root of a Spine 4.1 or 4.2 JSON skeleton. */
export interface JsonRoot {
    skeleton?: JsonSkeleton;
    bones?: JsonBone[];
    slots?: JsonSlot[];
    ik?: JsonIkConstraint[];
    transform?: JsonTransformConstraint[];
    path?: JsonPathConstraint[];
    /** 4.2 only. */
    physics?: JsonPhysicsConstraint[];
    skins?: JsonSkin[];
    /** By event name. */
    events?: Record<string, JsonEvent>;
    /** By animation name. */
    animations?: Record<string, JsonAnimation>;
}
