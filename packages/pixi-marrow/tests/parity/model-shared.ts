import {
    type AttachmentRef,
    BONE_SETUP_STRIDE,
    type BoneTable,
    type ClippingAttachmentData,
    type EventData,
    type EventKey,
    type MeshAttachmentData,
    type PathAttachmentData,
    type RegionAttachmentData,
    type ScaleYMode,
    type SequenceData,
    type SlotTable,
    type TimelineData,
    type TimelineKind,
    type TransformProperty,
    type VertexData,
} from '../../src/core';

/*
 * Helpers for the three converters from official objects to the model. They take plain shapes,
 * so the classes of every official version fit. Nothing here reads a file.
 */

export const floats = (values: ArrayLike<number>): Float32Array => Float32Array.from(values);
/** A copy of official 64-bit numbers as they are, with no rounding to 32 bits on the way. */
export const doubles = (values: ArrayLike<number>): Float64Array => Float64Array.from(values);
export const shorts = (values: ArrayLike<number>): Int16Array => Int16Array.from(values);
/** 0 where the official loader left a number undefined or null. */
export const orZero = (value: number | null | undefined): number => value ?? 0;

/** Maps the objects of an official list to their position in it. An object from elsewhere throws. */
export function indexer<T extends object>(list: readonly T[], what: string): (item: T) => number {
    const positions = new Map<T, number>();

    list.forEach((item, i) => {
        if (!positions.has(item)) positions.set(item, i);
    });

    return (item) => {
        const index = positions.get(item);

        if (index === undefined) throw new Error(`An official ${what} is not in its list`);

        return index;
    };
}

/** The entry of a name list an official enum value points at. */
export function pick<T extends string>(names: readonly T[], value: number, what: string): T {
    const name = names[value];

    if (name === undefined) throw new Error(`Unknown official ${what}: ${value}`);

    return name;
}

interface OfficialColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

interface BoneRow {
    name: string;
    parent: number;
    pose: { x: number; y: number; rotation: number; scaleX: number; scaleY: number; shearX: number; shearY: number };
    length: number;
    inherit: number;
    skinRequired: boolean;
}

export function boneTable(rows: readonly BoneRow[]): BoneTable {
    const setup = new Float64Array(rows.length * BONE_SETUP_STRIDE);

    rows.forEach(({ pose }, i) => {
        const values = [pose.x, pose.y, pose.rotation, pose.scaleX, pose.scaleY, pose.shearX, pose.shearY];

        setup.set(values, i * BONE_SETUP_STRIDE);
    });

    return {
        count: rows.length,
        names: rows.map((row) => row.name),
        parents: shorts(rows.map((row) => row.parent)),
        setup,
        lengths: doubles(rows.map((row) => row.length)),
        inherit: Uint8Array.from(rows.map((row) => row.inherit)),
        skinRequired: Uint8Array.from(rows.map((row) => (row.skinRequired ? 1 : 0))),
    };
}

interface SlotRow {
    name: string;
    bone: number;
    color: OfficialColor;
    darkColor: OfficialColor | null;
    attachmentName: string | null;
    blendMode: number;
    visible: boolean;
}

export function slotTable(rows: readonly SlotRow[]): SlotTable {
    const colors = new Float64Array(rows.length * 4);
    const darkColors = new Float64Array(rows.length * 3);

    rows.forEach(({ color, darkColor }, i) => {
        colors.set([color.r, color.g, color.b, color.a], i * 4);
        if (darkColor) darkColors.set([darkColor.r, darkColor.g, darkColor.b], i * 3);
    });

    return {
        count: rows.length,
        names: rows.map((row) => row.name),
        bones: shorts(rows.map((row) => row.bone)),
        colors,
        darkColors,
        hasDark: Uint8Array.from(rows.map((row) => (row.darkColor ? 1 : 0))),
        attachments: rows.map((row) => row.attachmentName ?? null),
        blendModes: Uint8Array.from(rows.map((row) => row.blendMode)),
        visible: Uint8Array.from(rows.map((row) => (row.visible ? 1 : 0))),
    };
}

/** The values an official EventData or Event carries. */
interface OfficialEventValues {
    intValue: number;
    floatValue: number;
    stringValue: string | null;
    volume: number;
    balance: number;
}

export function eventData(name: string, values: OfficialEventValues, audioPath: string | null): EventData {
    return {
        name,
        int: values.intValue,
        float: values.floatValue,
        string: values.stringValue ?? '',
        audioPath: audioPath ?? null,
        volume: values.volume,
        balance: values.balance,
    };
}

export function eventKey(event: OfficialEventValues & { time: number }, index: number): EventKey {
    return {
        time: event.time,
        event: index,
        int: event.intValue,
        float: event.floatValue,
        string: event.stringValue ?? '',
        volume: event.volume,
        balance: event.balance,
    };
}

export const POSITION_MODES = ['fixed', 'percent'] as const;
export const SPACING_MODES = ['length', 'fixed', 'percent', 'proportional'] as const;
export const ROTATE_MODES = ['tangent', 'chain', 'chainScale'] as const;
export const SCALE_Y_MODES: readonly ScaleYMode[] = ['none', 'uniform', 'volume'];
const TRANSFORM_PROPERTIES: readonly TransformProperty[] = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];

/** The property a 4.3 `FromX` or `ToX` object stands for, from its class name without the prefix. */
export function transformProperty(mapping: object, prefix: 'From' | 'To'): TransformProperty {
    const className = mapping.constructor.name;
    const stem = className.startsWith(prefix) ? className.slice(prefix.length) : '';
    const name = stem.charAt(0).toLowerCase() + stem.slice(1);
    const property = TRANSFORM_PROPERTIES.find((known) => known === name);

    if (property === undefined) throw new Error(`Unknown official property class: ${className}`);

    return property;
}

interface OfficialVertices {
    bones: number[] | null;
    vertices: ArrayLike<number>;
    worldVerticesLength: number;
}

export function vertexData(a: OfficialVertices): VertexData {
    return {
        vertices: floats(a.vertices),
        bones: a.bones ? shorts(a.bones) : null,
        worldVerticesLength: a.worldVerticesLength,
    };
}

interface OfficialSequence {
    regions: ArrayLike<unknown>;
    start: number;
    digits: number;
    setupIndex: number;
}

export function sequenceData(sequence: OfficialSequence | null): SequenceData | null {
    if (!sequence) return null;

    return {
        count: sequence.regions.length,
        start: sequence.start,
        digits: sequence.digits,
        setupIndex: sequence.setupIndex,
    };
}

const rgba = (color: OfficialColor): Float64Array => Float64Array.of(color.r, color.g, color.b, color.a);

interface OfficialRegion {
    name: string;
    path?: string | undefined;
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    width: number;
    height: number;
    color: OfficialColor;
}

export function regionData(a: OfficialRegion, sequence: SequenceData | null): RegionAttachmentData {
    return {
        type: 'region',
        name: a.name,
        path: a.path ?? a.name,
        x: a.x,
        y: a.y,
        scaleX: a.scaleX,
        scaleY: a.scaleY,
        rotation: a.rotation,
        width: a.width,
        height: a.height,
        color: rgba(a.color),
        sequence,
    };
}

interface OfficialMesh extends OfficialVertices {
    name: string;
    path?: string | undefined;
    color: OfficialColor;
    width: number;
    height: number;
    regionUVs: ArrayLike<number>;
    triangles: ArrayLike<number>;
    hullLength: number;
}

/** The links of a mesh to other skin entries and slots, and its sequence. */
interface MeshLinks {
    parent: AttachmentRef | null;
    timelineAttachment: AttachmentRef | null;
    /** 4.3 only. Left out when the official list is empty. */
    timelineSlots?: Int16Array;
    sequence: SequenceData | null;
}

/** A linked mesh holds the arrays of its parent in the official object. The model leaves them empty. */
export function meshData(a: OfficialMesh, links: MeshLinks): MeshAttachmentData {
    const linked = links.parent !== null;
    const geometry: VertexData = linked
        ? { vertices: new Float32Array(0), bones: null, worldVerticesLength: 0 }
        : vertexData(a);

    return {
        type: 'mesh',
        name: a.name,
        path: a.path ?? a.name,
        color: rgba(a.color),
        width: orZero(a.width),
        height: orZero(a.height),
        regionUVs: linked ? new Float32Array(0) : floats(a.regionUVs),
        triangles: linked ? new Uint16Array(0) : Uint16Array.from(a.triangles),
        hullLength: linked ? 0 : a.hullLength,
        ...geometry,
        ...links,
    };
}

interface OfficialPath extends OfficialVertices {
    name: string;
    closed: boolean;
    constantSpeed: boolean;
    lengths: ArrayLike<number>;
}

export function pathData(a: OfficialPath): PathAttachmentData {
    return {
        type: 'path',
        name: a.name,
        closed: a.closed,
        constantSpeed: a.constantSpeed,
        lengths: doubles(a.lengths),
        ...vertexData(a),
    };
}

export function clippingData(
    a: OfficialVertices & { name: string },
    endSlot: number,
    flags: { convex: boolean; inverse: boolean },
): ClippingAttachmentData {
    return { type: 'clipping', name: a.name, endSlot, ...flags, ...vertexData(a) };
}

/** One entry of an official skin. */
interface SkinEntry<A> {
    slot: number;
    name: string;
    attachment: A;
}

function byName(a: string, b: string): number {
    if (a < b) return -1;

    return a > b ? 1 : 0;
}

/** The entries of an official skin, sorted by slot index and then by name. */
export function skinEntries<A>(attachments: readonly (Readonly<Record<string, A>> | undefined)[]): SkinEntry<A>[] {
    const entries: SkinEntry<A>[] = [];

    attachments.forEach((map, slot) => {
        for (const [name, attachment] of Object.entries(map ?? {})) entries.push({ slot, name, attachment });
    });

    return entries.sort((a, b) => a.slot - b.slot || byName(a.name, b.name));
}

/** Finds the skin entry that stores an official attachment object, by identity. */
export function attachmentRefs(skins: readonly SkinEntry<object>[][]): (attachment: object) => AttachmentRef {
    const refs = new Map<object, AttachmentRef>();

    skins.forEach((entries, skin) => {
        for (const { slot, name, attachment } of entries) {
            if (!refs.has(attachment)) refs.set(attachment, { skin, slot, name });
        }
    });

    return (attachment) => {
        const ref = refs.get(attachment);

        if (!ref) throw new Error('An official attachment is not stored in any skin');

        return { ...ref };
    };
}

/** Every timeline kind. The official class name is the kind with a capital and `Timeline` at the end. */
const TIMELINE_KINDS: readonly TimelineKind[] = [
    'rotate',
    'translate',
    'translateX',
    'translateY',
    'scale',
    'scaleX',
    'scaleY',
    'shear',
    'shearX',
    'shearY',
    'inherit',
    'rgba',
    'rgb',
    'alpha',
    'rgba2',
    'rgb2',
    'attachment',
    'deform',
    'sequence',
    'event',
    'drawOrder',
    'drawOrderFolder',
    'ikConstraint',
    'transformConstraint',
    'pathConstraintPosition',
    'pathConstraintSpacing',
    'pathConstraintMix',
    'physicsConstraintInertia',
    'physicsConstraintStrength',
    'physicsConstraintDamping',
    'physicsConstraintMass',
    'physicsConstraintWind',
    'physicsConstraintGravity',
    'physicsConstraintMix',
    'physicsConstraintReset',
    'slider',
    'sliderMix',
];
const officialClassName = (kind: TimelineKind): string =>
    `${kind.startsWith('rgb') ? kind.toUpperCase() : kind.charAt(0).toUpperCase() + kind.slice(1)}Timeline`;
const KIND_BY_CLASS = new Map(TIMELINE_KINDS.map((kind) => [officialClassName(kind), kind]));

/** The kind of an official timeline, from its class name. An unknown class throws. */
export function timelineKind(timeline: object): TimelineKind {
    const kind = KIND_BY_CLASS.get(timeline.constructor.name);

    if (kind === undefined) throw new Error(`Unknown official timeline class: ${timeline.constructor.name}`);

    return kind;
}

const isNumberList = (value: unknown): value is ArrayLike<number> =>
    value instanceof Float32Array || (Array.isArray(value) && value.every((item) => typeof item === 'number'));

/** A number array an official class keeps protected or private. */
function hiddenNumbers(owner: object, field: string): ArrayLike<number> {
    const value: unknown = Reflect.get(owner, field);

    if (!isNumberList(value)) throw new Error(`${owner.constructor.name}.${field} is not a number array`);

    return value;
}

/** The fields every timeline has. `curved` says whether the official class extends CurveTimeline. */
export function timelineBase(timeline: { frames: ArrayLike<number> }, target: number, curved: boolean): TimelineData {
    return {
        kind: timelineKind(timeline),
        target,
        frames: floats(timeline.frames),
        curves: curved ? floats(hiddenNumbers(timeline, 'curves')) : null,
    };
}

/** The bone or slot index of a bone or slot timeline, or -1 for the kinds that have no target. */
export function boneOrSlotIndex(timeline: object): number {
    if ('boneIndex' in timeline && typeof timeline.boneIndex === 'number') return timeline.boneIndex;
    if ('slotIndex' in timeline && typeof timeline.slotIndex === 'number') return timeline.slotIndex;
    const kind = timelineKind(timeline);

    if (kind !== 'event' && kind !== 'drawOrder' && kind !== 'drawOrderFolder') {
        throw new Error(`The official ${kind} timeline has no target index`);
    }

    return -1;
}

export function drawOrders(orders: readonly (ArrayLike<number> | null | undefined)[]): (Int16Array | null)[] {
    return Array.from(orders, (order) => (order ? shorts(order) : null));
}

/** The draw orders of an official timeline that keeps them private. */
export function hiddenDrawOrders(owner: object): (Int16Array | null)[] {
    const value: unknown = Reflect.get(owner, 'drawOrders');

    if (!Array.isArray(value)) throw new Error(`${owner.constructor.name}.drawOrders is not an array`);

    return Array.from(value, (order: unknown) => {
        if (order === null || order === undefined) return null;
        if (!isNumberList(order)) throw new Error(`${owner.constructor.name}.drawOrders holds a key without numbers`);

        return shorts(order);
    });
}
