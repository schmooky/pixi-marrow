import { MarrowError } from '../../base/errors';
import type { AttachmentData, AttachmentRef } from '../../model/attachments';
import type { AnimationData, SkeletonModel } from '../../model/model';
import type { TimelineData, TimelineKind } from '../../model/timelines';
import { type AttachmentLookup, createAttachmentLookup, meshSource } from '../shared/lookup';
import { applyInherit, applyPair, applyRelative, applyScale, applyScalePair } from './timelines-bone';
import { applyDeform } from './timelines-deform';
import { applyDrawOrder, applyDrawOrderFolder, applyEvent, applySequence } from './timelines-misc';
import { applyAlpha, applyAttachment, applyColor, applyColorWithoutDark } from './timelines-slot';
import {
    type AttachmentInfo,
    type Clip43,
    type Rig43,
    ROLE_ATTACHMENT,
    ROLE_DRAW_ORDER,
    ROLE_EVENT,
    ROLE_FOLDER,
    ROLE_PLAIN,
    ROLE_ROTATE,
    type Timeline43,
    type TimelineKernel,
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

/** What the timelines of one kind share. */
interface KindSpec {
    kernel: TimelineKernel;
    role: number;
    /** Floats per key in `frames`. */
    entries: number;
    /** The official `Property` numbers, each joined with the target index into a property id. */
    properties: readonly number[];
    offset: number;
    dark: boolean;
    additive: boolean;
    instant: boolean;
}

const spec = (
    kernel: TimelineKernel,
    entries: number,
    properties: readonly number[],
    more: Partial<KindSpec> = {},
): KindSpec => ({
    kernel,
    role: ROLE_PLAIN,
    entries,
    properties,
    offset: 0,
    dark: false,
    additive: false,
    instant: false,
    ...more,
});

/** A bone timeline. `offset` is the position of its first number among the local numbers of a bone. */
const bone = (kernel: TimelineKernel, entries: number, properties: readonly number[], offset: number): KindSpec =>
    spec(kernel, entries, properties, { offset, additive: true });

/** A slot color timeline with `light` light channels. */
const color = (entries: number, properties: readonly number[], light: number, dark: boolean): KindSpec =>
    spec(applyColor, entries, properties, { offset: light, dark });

/**
 * Stands in for a timeline that animates a constraint. This milestone has no constraints, so the
 * timeline changes nothing. It still counts where the player looks at the timelines of an entry.
 */
const applyNothing: TimelineKernel = () => {};

/** A timeline that animates a constraint. The entries are not used: the timeline is never read. */
const constraint = (property: number, additive = false): KindSpec => spec(applyNothing, 1, [property], { additive });

/** Every timeline kind of Spine 4.3. */
const SPECS: Record<TimelineKind, KindSpec> = {
    rotate: { ...bone(applyRelative, 2, [P_ROTATE], 2), role: ROLE_ROTATE },
    translate: bone(applyPair, 3, [P_X, P_Y], 0),
    translateX: bone(applyRelative, 2, [P_X], 0),
    translateY: bone(applyRelative, 2, [P_Y], 1),
    scale: bone(applyScalePair, 3, [P_SCALE_X, P_SCALE_Y], 3),
    scaleX: bone(applyScale, 2, [P_SCALE_X], 3),
    scaleY: bone(applyScale, 2, [P_SCALE_Y], 4),
    shear: bone(applyPair, 3, [P_SHEAR_X, P_SHEAR_Y], 5),
    shearX: bone(applyRelative, 2, [P_SHEAR_X], 5),
    shearY: bone(applyRelative, 2, [P_SHEAR_Y], 6),
    inherit: spec(applyInherit, 2, [P_INHERIT], { instant: true }),
    rgba: color(5, [P_RGB, P_ALPHA], 4, false),
    rgb: color(4, [P_RGB], 3, false),
    alpha: spec(applyAlpha, 2, [P_ALPHA]),
    rgba2: color(8, [P_RGB, P_ALPHA, P_RGB2], 4, true),
    rgb2: color(7, [P_RGB, P_RGB2], 3, true),
    attachment: spec(applyAttachment, 1, [P_ATTACHMENT], { role: ROLE_ATTACHMENT, instant: true }),
    deform: spec(applyDeform, 1, [], { additive: true }),
    sequence: spec(applySequence, 3, [], { instant: true }),
    event: spec(applyEvent, 1, [], { role: ROLE_EVENT, instant: true }),
    drawOrder: spec(applyDrawOrder, 1, [], { role: ROLE_DRAW_ORDER, instant: true }),
    drawOrderFolder: spec(applyDrawOrderFolder, 1, [], { role: ROLE_FOLDER, instant: true }),
    ikConstraint: constraint(P_IK_CONSTRAINT),
    transformConstraint: constraint(P_TRANSFORM_CONSTRAINT, true),
    pathConstraintPosition: constraint(P_PATH_CONSTRAINT_POSITION, true),
    pathConstraintSpacing: constraint(P_PATH_CONSTRAINT_SPACING),
    pathConstraintMix: constraint(P_PATH_CONSTRAINT_MIX),
    physicsConstraintInertia: constraint(P_PHYSICS_CONSTRAINT_INERTIA),
    physicsConstraintStrength: constraint(P_PHYSICS_CONSTRAINT_STRENGTH),
    physicsConstraintDamping: constraint(P_PHYSICS_CONSTRAINT_DAMPING),
    physicsConstraintMass: constraint(P_PHYSICS_CONSTRAINT_MASS),
    physicsConstraintWind: constraint(P_PHYSICS_CONSTRAINT_WIND, true),
    physicsConstraintGravity: constraint(P_PHYSICS_CONSTRAINT_GRAVITY, true),
    physicsConstraintMix: constraint(P_PHYSICS_CONSTRAINT_MIX),
    physicsConstraintReset: spec(applyNothing, 1, [], { instant: true }),
    slider: constraint(P_SLIDER_TIME),
    sliderMix: constraint(P_SLIDER_MIX, true),
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

function buildTimeline(build: Build, data: TimelineData, user: string): Timeline43 {
    const kind: KindSpec | undefined = SPECS[data.kind];

    if (kind === undefined) {
        throw new MarrowError('unsupported-feature', `${user} has a timeline of the kind "${data.kind}".`, {
            fix: 'The pose engine for Spine 4.3 does not know that kind. Update pixi-marrow.',
        });
    }
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
        apply: noDark ? applyColorWithoutDark : kind.kernel,
        offset: kind.offset,
        dark: kind.dark,
        names: data.attachmentNames ?? [],
        attachment,
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

    return { index, name: animation.name, duration: animation.duration, timelines, ids };
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
    const build: Build = { model, lookup, info: describeAttachments(model, lookup), ids };
    const clips = model.animations.map((animation, index) => buildClip(build, animation, index));
    const rig: Rig43 = {
        model,
        lookup,
        clips,
        empty: { index: -1, name: '<empty>', duration: 0, timelines: [], ids: new Set() },
        info: build.info,
        drawOrderId,
        scratch: {
            sample: new Float64Array(8),
            owners: new Int32Array(ids.count),
            stamps: new Float64Array(ids.count),
            generation: 0,
        },
    };

    rigs.set(model, rig);

    return rig;
}
