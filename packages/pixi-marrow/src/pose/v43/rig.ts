import { MarrowError } from '../../base/errors';
import type { AttachmentData, AttachmentRef } from '../../model/attachments';
import type { ConstraintData } from '../../model/constraints';
import type { AnimationData, SkeletonModel } from '../../model/model';
import type { TimelineData, TimelineKind } from '../../model/timelines';
import { type AttachmentLookup, createAttachmentLookup, meshSource } from '../shared/lookup';
import { prepareSolver } from './solver';
import {
    PATH_MIX,
    PATH_POSITION,
    PATH_SPACING,
    PHYSICS_DAMPING,
    PHYSICS_GRAVITY,
    PHYSICS_INERTIA,
    PHYSICS_MASS_INVERSE,
    PHYSICS_MIX,
    PHYSICS_STRENGTH,
    PHYSICS_WIND,
    type Plan43,
    SLIDER_MIX,
    SLIDER_TIME,
} from './solver-types';
import {
    type AttachmentInfo,
    type Clip43,
    OP_ALPHA,
    OP_ATTACHMENT,
    OP_COLOR,
    OP_DEFORM,
    OP_DRAW_ORDER,
    OP_EVENT,
    OP_FOLDER,
    OP_IK,
    OP_INHERIT,
    OP_MIXES,
    OP_NO_DARK,
    OP_PAIR,
    OP_PHYSICS,
    OP_PHYSICS_MASS,
    OP_PHYSICS_RESET,
    OP_RELATIVE,
    OP_SCALE,
    OP_SCALE_PAIR,
    OP_SEQUENCE,
    OP_SLIDER,
    OP_VALUE,
    type Rig43,
    ROLE_ATTACHMENT,
    ROLE_DRAW_ORDER,
    ROLE_EVENT,
    ROLE_FOLDER,
    ROLE_PLAIN,
    ROLE_ROTATE,
    type Timeline43,
} from './types';

// The official `Property` numbers. A property id is one of them, then the index of what it animates.
const P_ROTATE = 0;
const P_X = 1;
const P_Y = 2;
const P_SCALE_X = 3;
const P_SCALE_Y = 4;
const P_SHEAR_X = 5;
const P_SHEAR_Y = 6;
const P_INHERIT = 7;
const P_RGB = 8;
const P_ALPHA = 9;
const P_RGB2 = 10;
const P_ATTACHMENT = 11;
const P_DEFORM = 12;
const P_EVENT = 13;
const P_DRAW_ORDER = 14;
const P_DRAW_ORDER_FOLDER = 15;
const P_IK_CONSTRAINT = 16;
const P_TRANSFORM_CONSTRAINT = 17;
const P_PATH_CONSTRAINT_POSITION = 18;
const P_PATH_CONSTRAINT_SPACING = 19;
const P_PATH_CONSTRAINT_MIX = 20;
const P_PHYSICS_CONSTRAINT_INERTIA = 21;
const P_PHYSICS_CONSTRAINT_STRENGTH = 22;
const P_PHYSICS_CONSTRAINT_DAMPING = 23;
const P_PHYSICS_CONSTRAINT_MASS = 24;
const P_PHYSICS_CONSTRAINT_WIND = 25;
const P_PHYSICS_CONSTRAINT_GRAVITY = 26;
const P_PHYSICS_CONSTRAINT_MIX = 27;
const P_PHYSICS_CONSTRAINT_RESET = 28;
const P_SEQUENCE = 29;
const P_SLIDER_TIME = 30;
const P_SLIDER_MIX = 31;

const NO_FLOATS = new Float32Array(0);
const NO_SLOTS = new Int16Array(0);
const NO_FLAGS = new Uint8Array(0);
/** The `shown` of a timeline that is no attachment timeline. Nothing writes to it. */
const NO_ROWS: Timeline43['shown'] = [];

/** What the timelines of one kind share. */
interface KindSpec {
    /** The kernel: one of the `OP_` constants. */
    op: number;
    role: number;
    /** Floats per key in `frames`. */
    entries: number;
    /** The official `Property` numbers, each joined with the target index into a property id. */
    properties: readonly number[];
    offset: number;
    dark: boolean;
    additive: boolean;
    instant: boolean;
    /** What has to be active for the timeline to apply: its bone, the bone of its slot, or nothing it can name. */
    gate: 'bone' | 'slot' | null;
}

const spec = (op: number, entries: number, properties: readonly number[], more: Partial<KindSpec> = {}): KindSpec => ({
    op,
    role: ROLE_PLAIN,
    entries,
    properties,
    offset: 0,
    dark: false,
    additive: false,
    instant: false,
    gate: null,
    ...more,
});

/** A bone timeline. `offset` is the position of its first number among the local numbers of a bone. */
const bone = (op: number, entries: number, properties: readonly number[], offset: number): KindSpec =>
    spec(op, entries, properties, { offset, additive: true, gate: 'bone' });

/** A slot color timeline with `light` light channels. */
const color = (entries: number, properties: readonly number[], light: number, dark: boolean): KindSpec =>
    spec(OP_COLOR, entries, properties, { offset: light, dark, gate: 'slot' });

/** A timeline for one number of the pose of a physics constraint. `offset` is its position in the pose. */
const physics = (property: number, offset: number, additive = false): KindSpec =>
    spec(OP_PHYSICS, 2, [property], { offset, additive });

/** The constraint type each constraint timeline kind animates. */
const CONSTRAINT_TYPES: Partial<Record<TimelineKind, ConstraintData['type']>> = {
    ikConstraint: 'ik',
    transformConstraint: 'transform',
    pathConstraintPosition: 'path',
    pathConstraintSpacing: 'path',
    pathConstraintMix: 'path',
    physicsConstraintInertia: 'physics',
    physicsConstraintStrength: 'physics',
    physicsConstraintDamping: 'physics',
    physicsConstraintMass: 'physics',
    physicsConstraintWind: 'physics',
    physicsConstraintGravity: 'physics',
    physicsConstraintMix: 'physics',
    physicsConstraintReset: 'physics',
    slider: 'slider',
    sliderMix: 'slider',
};

/** Every timeline kind of Spine 4.3. */
const SPECS: Record<TimelineKind, KindSpec> = {
    rotate: { ...bone(OP_RELATIVE, 2, [P_ROTATE], 2), role: ROLE_ROTATE },
    translate: bone(OP_PAIR, 3, [P_X, P_Y], 0),
    translateX: bone(OP_RELATIVE, 2, [P_X], 0),
    translateY: bone(OP_RELATIVE, 2, [P_Y], 1),
    scale: bone(OP_SCALE_PAIR, 3, [P_SCALE_X, P_SCALE_Y], 3),
    scaleX: bone(OP_SCALE, 2, [P_SCALE_X], 3),
    scaleY: bone(OP_SCALE, 2, [P_SCALE_Y], 4),
    shear: bone(OP_PAIR, 3, [P_SHEAR_X, P_SHEAR_Y], 5),
    shearX: bone(OP_RELATIVE, 2, [P_SHEAR_X], 5),
    shearY: bone(OP_RELATIVE, 2, [P_SHEAR_Y], 6),
    inherit: spec(OP_INHERIT, 2, [P_INHERIT], { instant: true, gate: 'bone' }),
    rgba: color(5, [P_RGB, P_ALPHA], 4, false),
    rgb: color(4, [P_RGB], 3, false),
    alpha: spec(OP_ALPHA, 2, [P_ALPHA], { gate: 'slot' }),
    rgba2: color(8, [P_RGB, P_ALPHA, P_RGB2], 4, true),
    rgb2: color(7, [P_RGB, P_RGB2], 3, true),
    attachment: spec(OP_ATTACHMENT, 1, [P_ATTACHMENT], { role: ROLE_ATTACHMENT, instant: true, gate: 'slot' }),
    deform: spec(OP_DEFORM, 1, [], { additive: true }),
    sequence: spec(OP_SEQUENCE, 3, [], { instant: true }),
    event: spec(OP_EVENT, 1, [], { role: ROLE_EVENT, instant: true }),
    drawOrder: spec(OP_DRAW_ORDER, 1, [], { role: ROLE_DRAW_ORDER, instant: true }),
    drawOrderFolder: spec(OP_FOLDER, 1, [], { role: ROLE_FOLDER, instant: true }),
    ikConstraint: spec(OP_IK, 6, [P_IK_CONSTRAINT]),
    transformConstraint: spec(OP_MIXES, 7, [P_TRANSFORM_CONSTRAINT], { additive: true }),
    pathConstraintPosition: spec(OP_VALUE, 2, [P_PATH_CONSTRAINT_POSITION], {
        offset: PATH_POSITION,
        additive: true,
    }),
    pathConstraintSpacing: spec(OP_VALUE, 2, [P_PATH_CONSTRAINT_SPACING], { offset: PATH_SPACING }),
    pathConstraintMix: spec(OP_MIXES, 4, [P_PATH_CONSTRAINT_MIX], { offset: PATH_MIX }),
    physicsConstraintInertia: physics(P_PHYSICS_CONSTRAINT_INERTIA, PHYSICS_INERTIA),
    physicsConstraintStrength: physics(P_PHYSICS_CONSTRAINT_STRENGTH, PHYSICS_STRENGTH),
    physicsConstraintDamping: physics(P_PHYSICS_CONSTRAINT_DAMPING, PHYSICS_DAMPING),
    physicsConstraintMass: { ...physics(P_PHYSICS_CONSTRAINT_MASS, PHYSICS_MASS_INVERSE), op: OP_PHYSICS_MASS },
    physicsConstraintWind: physics(P_PHYSICS_CONSTRAINT_WIND, PHYSICS_WIND, true),
    physicsConstraintGravity: physics(P_PHYSICS_CONSTRAINT_GRAVITY, PHYSICS_GRAVITY, true),
    physicsConstraintMix: physics(P_PHYSICS_CONSTRAINT_MIX, PHYSICS_MIX),
    physicsConstraintReset: spec(OP_PHYSICS_RESET, 1, [], { instant: true }),
    slider: spec(OP_SLIDER, 2, [P_SLIDER_TIME], { offset: SLIDER_TIME }),
    sliderMix: spec(OP_SLIDER, 2, [P_SLIDER_MIX], { offset: SLIDER_MIX, additive: true }),
};

const invalid = (message: string): MarrowError =>
    new MarrowError('invalid-data', message, { fix: 'Export the skeleton again from Spine.' });

/** Gives every official property id string a number. Equal strings get the same number. */
class PropertyIds {
    private readonly numbers = new Map<string, number>();

    get count(): number {
        return this.numbers.size;
    }

    of(key: string): number {
        let id = this.numbers.get(key);

        if (id === undefined) {
            id = this.numbers.size;
            this.numbers.set(key, id);
        }

        return id;
    }
}

/** What building the timelines of a model needs. */
interface Build {
    model: SkeletonModel;
    lookup: AttachmentLookup;
    info: Map<AttachmentData, AttachmentInfo>;
    ids: PropertyIds;
    /** The plan of every constraint of the model. */
    plans: readonly Plan43[];
}

const hasVertices = (attachment: AttachmentData): boolean =>
    attachment.type !== 'region' && attachment.type !== 'point';

function geometryOf(lookup: AttachmentLookup, attachment: AttachmentData): AttachmentInfo['geometry'] {
    if (attachment.type === 'region' || attachment.type === 'point') return null;

    return attachment.type === 'mesh' ? meshSource(lookup, attachment) : attachment;
}

/** The official sequence of a region or a mesh has one region when the file gives none. */
function sequenceCount(attachment: AttachmentData): number {
    if (attachment.type !== 'region' && attachment.type !== 'mesh') return -1;

    return attachment.sequence?.count ?? 1;
}

/** Describes every attachment of every skin. The same attachment object is described once. */
function describeAttachments(model: SkeletonModel, lookup: AttachmentLookup): Map<AttachmentData, AttachmentInfo> {
    const info = new Map<AttachmentData, AttachmentInfo>();

    for (const skin of model.skins) {
        for (const { attachment } of skin.attachments) {
            if (info.has(attachment)) continue;
            info.set(attachment, {
                id: info.size,
                vertex: hasVertices(attachment),
                timeline: attachment,
                geometry: geometryOf(lookup, attachment),
                timelineSlots: (attachment.type === 'mesh' ? attachment.timelineSlots : undefined) ?? NO_SLOTS,
                sequenceCount: sequenceCount(attachment),
            });
        }
    }
    // a linked mesh can take the timelines of its source
    for (const [attachment, entry] of info) {
        if (attachment.type !== 'mesh' || attachment.timelineAttachment === null) continue;
        const source = lookup.resolve(attachment.timelineAttachment);

        if (source === undefined)
            throw invalid(`The mesh "${attachment.name}" follows the timelines of a mesh that no skin has.`);
        entry.timeline = source;
    }

    return info;
}

/** The attachment a deform or sequence timeline animates, with what the engine knows about it. */
function animated(build: Build, ref: AttachmentRef | undefined, user: string): [AttachmentData, AttachmentInfo] {
    const attachment = ref === undefined ? undefined : build.lookup.resolve(ref);
    const info = attachment === undefined ? undefined : build.info.get(attachment);

    if (attachment === undefined || info === undefined)
        throw invalid(`${user} animates an attachment that no skin has.`);

    return [attachment, info];
}

/** The official property ids of a timeline, as numbers. */
function propertyIds(build: Build, data: TimelineData, kind: KindSpec, info: AttachmentInfo | null): Int32Array {
    const { ids } = build;

    switch (data.kind) {
        case 'deform':
            return Int32Array.of(ids.of(`${P_DEFORM}|${data.target}|${info?.id}`));
        case 'sequence':
            return Int32Array.of(ids.of(`${P_SEQUENCE}|${data.target}|${info?.id}`));
        case 'event':
            return Int32Array.of(ids.of(`${P_EVENT}`));
        case 'drawOrder':
            return Int32Array.of(ids.of(`${P_DRAW_ORDER}`));
        case 'drawOrderFolder':
            return Int32Array.from(data.folderSlots ?? NO_SLOTS, (slot) => ids.of(`${P_DRAW_ORDER_FOLDER}|${slot}`));
        case 'physicsConstraintReset':
            return Int32Array.of(ids.of(`${P_PHYSICS_CONSTRAINT_RESET}`));
        default:
            return Int32Array.from(kind.properties, (property) => ids.of(`${property}|${data.target}`));
    }
}

function folderFlags(model: SkeletonModel, slots: Int16Array): Uint8Array {
    const flags = new Uint8Array(model.slots.count);

    for (const slot of slots) flags[slot] = 1;

    return flags;
}

/**
 * Throws when a timeline animates a constraint the skeleton does not have, or one of another type.
 * A physics timeline with the target -1 is for every physics constraint.
 */
function checkConstraint(build: Build, data: TimelineData, user: string): void {
    const type = CONSTRAINT_TYPES[data.kind];

    if (type === undefined || build.model.constraints[data.target]?.type === type) return;
    if (type === 'physics' && data.target === -1) return;
    throw invalid(`${user} has a ${data.kind} timeline for constraint ${data.target}, which is no ${type} constraint.`);
}

/**
 * The `offset` of a timeline. For a timeline of one constraint it is where the first animated
 * number is among the constraint poses. For the other kinds it is that of the kind.
 */
function offsetOf(build: Build, data: TimelineData, kind: KindSpec): number {
    const plan = CONSTRAINT_TYPES[data.kind] === undefined ? undefined : build.plans[data.target];

    return plan === undefined ? kind.offset : plan.at + kind.offset;
}

/** An empty `shown` for an attachment timeline: one row per skin and one for no skin, none looked up yet. */
function skinRows(model: SkeletonModel): Timeline43['shown'] {
    const rows: Timeline43['shown'] = [];

    for (let i = 0; i <= model.skins.length; i++) rows.push(undefined);

    return rows;
}

/** The bone that has to be active for a timeline to apply: its bone, or the bone of its slot. -1 for none. */
function gateBone(model: SkeletonModel, kind: KindSpec, target: number): number {
    if (kind.gate === 'bone') return target;

    return kind.gate === 'slot' ? (model.slots.bones[target] ?? -1) : -1;
}

function buildTimeline(build: Build, data: TimelineData, user: string): Timeline43 {
    const kind: KindSpec | undefined = SPECS[data.kind];

    if (kind === undefined) {
        throw new MarrowError('unsupported-feature', `${user} has a timeline of the kind "${data.kind}".`, {
            fix: 'The pose engine for Spine 4.3 does not know that kind. Update pixi-marrow.',
        });
    }
    checkConstraint(build, data, user);
    const follows = data.kind === 'deform' || data.kind === 'sequence';
    const [attachment, info] = follows ? animated(build, data.attachment, user) : [null, null];
    const folder = data.kind === 'drawOrderFolder' ? (data.folderSlots ?? NO_SLOTS) : null;
    const noDark = kind.dark && build.model.slots.hasDark[data.target] !== 1;

    return {
        kind: data.kind,
        role: kind.role,
        target: data.target,
        frames: data.frames,
        curves: data.curves ?? NO_FLOATS,
        entries: kind.entries,
        ids: propertyIds(build, data, kind, info),
        additive: kind.additive,
        instant: kind.instant,
        op: noDark ? OP_NO_DARK : kind.op,
        bone: gateBone(build.model, kind, data.target),
        offset: offsetOf(build, data, kind),
        dark: kind.dark,
        names: data.attachmentNames ?? [],
        shown: data.kind === 'attachment' ? skinRows(build.model) : NO_ROWS,
        attachment,
        info,
        slots: folder ?? info?.timelineSlots ?? NO_SLOTS,
        inFolder: folder ? folderFlags(build.model, folder) : NO_FLAGS,
        vertices: data.vertices ?? [],
        events: data.events ?? [],
        orders: data.drawOrders ?? [],
    };
}

function buildClip(build: Build, animation: AnimationData, index: number): Clip43 {
    const user = `Animation "${animation.name}"`;
    const timelines = animation.timelines.map((timeline) => buildTimeline(build, timeline, user));
    const ids = new Set<number>();

    for (const timeline of timelines) for (const id of timeline.ids) ids.add(id);

    const resets = timelines.some((timeline) => timeline.kind === 'physicsConstraintReset');
    const posed = timelines
        .filter((timeline) => SPECS[timeline.kind].gate === 'bone')
        .map((timeline) => timeline.target);
    const bones = Int16Array.from(new Set(posed));

    return { index, name: animation.name, duration: animation.duration, timelines, ids, resets, bones };
}

const rigs = new WeakMap<SkeletonModel, Rig43>();

/**
 * Prepares a model for the 4.3 pose engine: its animations as timelines that are ready to apply,
 * and what the engine needs to know about its attachments. Every engine of a model shares one rig.
 */
export function prepareRig(model: SkeletonModel): Rig43 {
    const cached = rigs.get(model);

    if (cached !== undefined) return cached;
    const lookup = createAttachmentLookup(model);
    const ids = new PropertyIds();
    const drawOrderId = ids.of(`${P_DRAW_ORDER}`);
    const solver = prepareSolver(model, lookup);
    const build: Build = { model, lookup, info: describeAttachments(model, lookup), ids, plans: solver.plans };
    const clips = model.animations.map((animation, index) => buildClip(build, animation, index));
    const rig: Rig43 = {
        model,
        lookup,
        clips,
        empty: {
            index: -1,
            name: '<empty>',
            duration: 0,
            timelines: [],
            ids: new Set(),
            resets: false,
            bones: new Int16Array(0),
        },
        info: build.info,
        drawOrderId,
        solver,
        scratch: {
            owners: new Int32Array(ids.count),
            stamps: new Float64Array(ids.count),
            generation: 0,
        },
    };

    rigs.set(model, rig);

    return rig;
}
