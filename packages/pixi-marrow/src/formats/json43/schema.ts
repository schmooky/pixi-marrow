/*
 * The shape of a Spine 4.3 JSON export. The exporter leaves out every value that equals its
 * default, so nearly every field is optional. The readers apply the defaults.
 */

/** The curve of a key: the word `stepped`, or four numbers for each value the timeline curves. */
export type JsonCurve = string | number[];

/** The `skeleton` object: the header of the file. */
interface JsonSkeleton {
    hash?: string;
    spine?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    referenceScale?: number;
}

/** One entry of `bones`. */
export interface JsonBone {
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
    inherit?: string;
    /** True when the bone is active only with a skin that lists it. */
    skin?: boolean;
}

/** One entry of `slots`. */
export interface JsonSlot {
    name?: string;
    bone?: string;
    color?: string;
    dark?: string;
    attachment?: string;
    blend?: string;
    visible?: boolean;
}

/** One entry of `events`. The key is the event name. */
export interface JsonEvent {
    int?: number;
    float?: number;
    string?: string;
    audio?: string;
    volume?: number;
    balance?: number;
}

/** What every entry of `constraints` has besides its type. */
interface JsonConstraintBase {
    name?: string;
    /** True when the constraint is active only with a skin that lists it. */
    skin?: boolean;
}

/** An IK constraint. `scaleY` names a scale Y mode. */
export interface JsonIkConstraint extends JsonConstraintBase {
    type: 'ik';
    bones?: string[];
    target?: string;
    scaleY?: string;
    mix?: number;
    softness?: number;
    bendPositive?: boolean;
    compress?: boolean;
    stretch?: boolean;
}

/** One property a transform constraint writes. */
interface JsonTransformTo {
    offset?: number;
    max?: number;
    scale?: number;
}

/** One property a transform constraint reads. The keys of `to` are property names. */
interface JsonTransformFrom {
    offset?: number;
    to?: Record<string, JsonTransformTo>;
}

/** A transform constraint. `rotation` to `shearY` are offsets. The keys of `properties` are property names. */
export interface JsonTransformConstraint extends JsonConstraintBase {
    type: 'transform';
    bones?: string[];
    source?: string;
    localSource?: boolean;
    localTarget?: boolean;
    additive?: boolean;
    clamp?: boolean;
    properties?: Record<string, JsonTransformFrom>;
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

/** A path constraint. `rotation` is the rotation offset. */
export interface JsonPathConstraint extends JsonConstraintBase {
    type: 'path';
    bones?: string[];
    slot?: string;
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

/** A physics constraint. `scaleY` names a scale Y mode. */
export interface JsonPhysicsConstraint extends JsonConstraintBase {
    type: 'physics';
    bone?: string;
    x?: number;
    y?: number;
    rotate?: number;
    scaleX?: number;
    scaleY?: string;
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

/** A slider. `from` is the offset of the bone property and `to` the offset of the time. */
export interface JsonSliderConstraint extends JsonConstraintBase {
    type: 'slider';
    animation?: string;
    additive?: boolean;
    loop?: boolean;
    mix?: number;
    time?: number;
    bone?: string;
    property?: string;
    from?: number;
    to?: number;
    scale?: number;
    max?: number;
    local?: boolean;
}

/** One entry of `constraints`. */
export type JsonConstraint =
    | JsonIkConstraint
    | JsonTransformConstraint
    | JsonPathConstraint
    | JsonPhysicsConstraint
    | JsonSliderConstraint;

/** The `sequence` object of a region or mesh attachment. */
export interface JsonSequence {
    count?: number;
    start?: number;
    digits?: number;
    setup?: number;
}

/** A region attachment. A skin entry without a type is a region. */
export interface JsonRegion {
    type?: 'region';
    name?: string;
    path?: string;
    x?: number;
    y?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    width?: number;
    height?: number;
    color?: string;
    sequence?: JsonSequence;
}

/** A mesh. With `source` it is a linked mesh, and `skin`, `slot` and `source` name the mesh it follows. */
export interface JsonMesh {
    type: 'mesh' | 'linkedmesh';
    name?: string;
    path?: string;
    color?: string;
    width?: number;
    height?: number;
    source?: string;
    skin?: string;
    slot?: string;
    /** False when the linked mesh does not follow the deform timelines of its source. */
    timelines?: boolean;
    uvs?: number[];
    triangles?: number[];
    vertices?: number[];
    hull?: number;
    sequence?: JsonSequence;
}

/** A bounding box attachment. */
export interface JsonBoundingBox {
    type: 'boundingbox';
    name?: string;
    vertexCount?: number;
    vertices?: number[];
}

/** A path attachment. */
export interface JsonPath {
    type: 'path';
    name?: string;
    closed?: boolean;
    constantSpeed?: boolean;
    vertexCount?: number;
    vertices?: number[];
    lengths?: number[];
}

/** A point attachment. */
interface JsonPoint {
    type: 'point';
    name?: string;
    x?: number;
    y?: number;
    rotation?: number;
}

/** A clipping attachment. `end` names the last slot that is clipped. */
export interface JsonClipping {
    type: 'clipping';
    name?: string;
    end?: string;
    convex?: boolean;
    inverse?: boolean;
    vertexCount?: number;
    vertices?: number[];
}

/** One attachment of a skin. */
export type JsonAttachment = JsonRegion | JsonMesh | JsonBoundingBox | JsonPath | JsonPoint | JsonClipping;

/** One entry of `skins`. `attachments` is keyed by slot name, then by the name the skin stores the attachment under. */
export interface JsonSkin {
    name?: string;
    bones?: string[];
    ik?: string[];
    transform?: string[];
    path?: string[];
    physics?: string[];
    slider?: string[];
    attachments?: Record<string, Record<string, JsonAttachment>>;
}

/** What every key of a timeline that interpolates has. */
export interface JsonKey {
    time?: number;
    curve?: JsonCurve;
}

/** A key of a timeline with one value. */
export interface JsonValueKey extends JsonKey {
    value?: number;
}

/** A key of a slot timeline. Which fields it has depends on the timeline. */
export interface JsonSlotKey extends JsonValueKey {
    /** `attachment` timeline. Null clears the slot. */
    name?: string | null;
    /** `rgba` and `rgb` timelines. */
    color?: string;
    /** `rgba2` and `rgb2` timelines. */
    light?: string;
    dark?: string;
}

/** A key of a bone timeline. Which fields it has depends on the timeline. */
export interface JsonBoneKey extends JsonValueKey {
    x?: number;
    y?: number;
    inherit?: string;
}

/** A key of an IK constraint timeline. */
interface JsonIkKey extends JsonKey {
    mix?: number;
    softness?: number;
    bendPositive?: boolean;
    compress?: boolean;
    stretch?: boolean;
}

/** A key of a transform constraint timeline. */
interface JsonTransformKey extends JsonKey {
    mixRotate?: number;
    mixX?: number;
    mixY?: number;
    mixScaleX?: number;
    mixScaleY?: number;
    mixShearY?: number;
}

/** A key of a path constraint timeline. Which fields it has depends on the timeline. */
export interface JsonPathKey extends JsonValueKey {
    mixRotate?: number;
    mixX?: number;
    mixY?: number;
}

/** A key of a deform or sequence timeline. Which fields it has depends on the timeline. */
export interface JsonAttachmentKey extends JsonKey {
    /** `deform` timeline. Where `vertices` starts in the vertex array. */
    offset?: number;
    vertices?: number[];
    /** `sequence` timeline. */
    mode?: string;
    index?: number;
    delay?: number;
}

/** One slot that a draw order key moves, and how many places. */
interface JsonDrawOrderOffset {
    slot?: string;
    offset?: number;
}

/** A key of a draw order timeline. Without `offsets` it restores the setup order. */
export interface JsonDrawOrderKey {
    time?: number;
    offsets?: JsonDrawOrderOffset[];
}

/** One entry of `drawOrderFolder`: the timeline that orders the slots of one folder. */
interface JsonDrawOrderFolder {
    slots?: string[];
    keys?: JsonDrawOrderKey[];
}

/** A key of the event timeline. */
interface JsonEventKey {
    time?: number;
    name?: string;
    int?: number;
    float?: number;
    string?: string;
    volume?: number;
    balance?: number;
}

/** Timelines by attachment name, then by timeline name. */
type JsonAttachmentTimelines = Record<string, Record<string, JsonAttachmentKey[]>>;

/** One entry of `animations`. The outer keys are object names and the inner keys are timeline names. */
export interface JsonAnimation {
    slots?: Record<string, Record<string, JsonSlotKey[]>>;
    bones?: Record<string, Record<string, JsonBoneKey[]>>;
    ik?: Record<string, JsonIkKey[]>;
    transform?: Record<string, JsonTransformKey[]>;
    path?: Record<string, Record<string, JsonPathKey[]>>;
    /** The key `""` holds timelines that apply to every physics constraint. */
    physics?: Record<string, Record<string, JsonValueKey[]>>;
    slider?: Record<string, Record<string, JsonValueKey[]>>;
    /** Keyed by skin name, then by slot name. */
    attachments?: Record<string, Record<string, JsonAttachmentTimelines>>;
    drawOrder?: JsonDrawOrderKey[];
    drawOrderFolder?: JsonDrawOrderFolder[];
    events?: JsonEventKey[];
}

/** The whole file. */
export interface JsonRoot {
    skeleton?: JsonSkeleton;
    bones?: JsonBone[];
    slots?: JsonSlot[];
    constraints?: JsonConstraint[];
    skins?: JsonSkin[];
    events?: Record<string, JsonEvent>;
    animations?: Record<string, JsonAnimation>;
}
