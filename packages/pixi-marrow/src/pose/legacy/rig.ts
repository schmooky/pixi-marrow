import { MarrowError } from '../../base/errors';
import type { AttachmentData, AttachmentRef, VertexData } from '../../model/attachments';
import type { AnimationData, SkeletonModel } from '../../model/model';
import type { TimelineData, TimelineKind } from '../../model/timelines';
import { type AttachmentLookup, createAttachmentLookup, meshSource } from '../shared/lookup';
import type { UpdateCache } from './cache';
import { type ConstraintPlan, createConstraintPlan } from './constraints';
import {
    type Clip,
    K_ALPHA,
    K_ATTACHMENT,
    K_DEFORM,
    K_DRAW_ORDER,
    K_EVENT,
    K_IK,
    K_INHERIT,
    K_PATH_MIX,
    K_PATH_POSITION,
    K_PATH_SPACING,
    K_RGB,
    K_RGB2,
    K_RGBA,
    K_RGBA2,
    K_ROTATE,
    K_SCALE,
    K_SCALE_X,
    K_SCALE_Y,
    K_SEQUENCE,
    K_SHEAR,
    K_SHEAR_X,
    K_SHEAR_Y,
    K_SKIPPED,
    K_TRANSFORM,
    K_TRANSLATE,
    K_TRANSLATE_X,
    K_TRANSLATE_Y,
    LegacyTimeline,
} from './timelines';

const EXPORT_FIX = 'Export the skeleton again from Spine 4.1 or 4.2.';

/** What the engine needs to know about an attachment that a slot shows. */
export interface AttachmentFacts {
    /**
     * The official `timelineAttachment`: the attachment whose deform timelines move this one.
     * Null for an attachment without vertices.
     */
    readonly timeline: AttachmentData | null;
    /** The vertices and weights the attachment is drawn with. A linked mesh has those of its parent. */
    readonly geometry: VertexData | null;
}

/** What every instance of a model shares: lookups and the animations that were played so far. */
export interface Rig {
    readonly model: SkeletonModel;
    /** True for Spine 4.1. The official 4.1 runtime differs from 4.2 in a few formulas. */
    readonly v41: boolean;
    readonly lookup: AttachmentLookup;
    /** The official empty animation: no timelines, no duration. */
    readonly empty: Clip;
    /** Animations by model index, compiled when they are first played. */
    readonly clips: (Clip | undefined)[];
    /** Property names to the numbers the engine compares. */
    readonly propertyIds: Map<string, number>;
    readonly facts: Map<AttachmentData, AttachmentFacts>;
    /** The constraints, ready to sort and solve. */
    readonly plan: ConstraintPlan;
    /** The update cache of each skin that was active so far, by skin index. -1 is no skin. */
    readonly caches: Map<number, UpdateCache>;
}

/** What a timeline animates: a bone, a slot, a constraint of one type, or nothing with an index. */
type Target = 'bone' | 'slot' | 'none' | 'ik' | 'transform' | 'path';

interface KindSpec {
    code: number;
    entries: number;
    target: Target;
    /** The properties the timeline sets, by their official names. */
    properties: readonly string[];
}

const spec = (code: number, entries: number, target: Target, ...properties: string[]): KindSpec => ({
    code,
    entries,
    target,
    properties,
});

const SPECS: Partial<Record<TimelineKind, KindSpec>> = {
    rotate: spec(K_ROTATE, 2, 'bone', 'rotate'),
    translate: spec(K_TRANSLATE, 3, 'bone', 'x', 'y'),
    translateX: spec(K_TRANSLATE_X, 2, 'bone', 'x'),
    translateY: spec(K_TRANSLATE_Y, 2, 'bone', 'y'),
    scale: spec(K_SCALE, 3, 'bone', 'scaleX', 'scaleY'),
    scaleX: spec(K_SCALE_X, 2, 'bone', 'scaleX'),
    scaleY: spec(K_SCALE_Y, 2, 'bone', 'scaleY'),
    shear: spec(K_SHEAR, 3, 'bone', 'shearX', 'shearY'),
    shearX: spec(K_SHEAR_X, 2, 'bone', 'shearX'),
    shearY: spec(K_SHEAR_Y, 2, 'bone', 'shearY'),
    inherit: spec(K_INHERIT, 2, 'bone', 'inherit'),
    rgba: spec(K_RGBA, 5, 'slot', 'rgb', 'alpha'),
    rgb: spec(K_RGB, 4, 'slot', 'rgb'),
    alpha: spec(K_ALPHA, 2, 'slot', 'alpha'),
    rgba2: spec(K_RGBA2, 8, 'slot', 'rgb', 'alpha', 'rgb2'),
    rgb2: spec(K_RGB2, 7, 'slot', 'rgb', 'rgb2'),
    attachment: spec(K_ATTACHMENT, 1, 'slot', 'attachment'),
    deform: spec(K_DEFORM, 1, 'slot'),
    sequence: spec(K_SEQUENCE, 3, 'slot'),
    event: spec(K_EVENT, 1, 'none'),
    drawOrder: spec(K_DRAW_ORDER, 1, 'none'),
    ikConstraint: spec(K_IK, 6, 'ik'),
    transformConstraint: spec(K_TRANSFORM, 7, 'transform'),
    pathConstraintPosition: spec(K_PATH_POSITION, 2, 'path'),
    pathConstraintSpacing: spec(K_PATH_SPACING, 2, 'path'),
    pathConstraintMix: spec(K_PATH_MIX, 4, 'path'),
};

/** Timelines of these kinds animate physics constraints, which this engine does not solve. */
const SKIPPED = /^physicsConstraint/;

const rigs = new WeakMap<SkeletonModel, Rig>();

/** The shared data of a model. Built on the first call and kept while the model is alive. */
export function rigOf(model: SkeletonModel): Rig {
    let rig = rigs.get(model);

    if (rig === undefined) {
        if (model.version !== '4.1' && model.version !== '4.2') {
            throw new MarrowError('unsupported-version', `This pose engine does not play Spine ${model.version}.`, {
                fix: 'Create the engine with createPoseEngine, which picks the engine for the version.',
            });
        }
        rig = {
            model,
            v41: model.version === '4.1',
            lookup: createAttachmentLookup(model),
            empty: { index: -1, name: '<empty>', duration: 0, timelines: [], ids: new Set() },
            clips: [],
            propertyIds: new Map(),
            facts: new Map(),
            plan: createConstraintPlan(model),
            caches: new Map(),
        };
        rigs.set(model, rig);
    }

    return rig;
}

function invalid(message: string): MarrowError {
    return new MarrowError('invalid-data', message, { fix: EXPORT_FIX });
}

function propertyId(rig: Rig, name: string): number {
    let id = rig.propertyIds.get(name);

    if (id === undefined) {
        id = rig.propertyIds.size;
        rig.propertyIds.set(name, id);
    }

    return id;
}

function resolveRef(rig: Rig, ref: AttachmentRef | undefined, what: string): AttachmentData {
    const attachment = ref === undefined ? undefined : rig.lookup.resolve(ref);

    if (attachment === undefined) throw invalid(`${what} animates an attachment that its skin does not have.`);

    return attachment;
}

/** The property ids of a timeline. They partition timelines as the official property id strings do. */
function idsOf(rig: Rig, data: TimelineData, properties: readonly string[]): number[] {
    if (data.kind === 'event' || data.kind === 'drawOrder' || data.kind === 'physicsConstraintReset') {
        return [propertyId(rig, data.kind)];
    }
    if (data.kind === 'deform' || data.kind === 'sequence') {
        const ref = data.attachment;

        return [propertyId(rig, `${data.kind}|${data.target}|${ref?.skin}|${ref?.name}`)];
    }
    if (properties.length === 0) return [propertyId(rig, `${data.kind}|${data.target}`)];

    return properties.map((property) => propertyId(rig, `${property}|${data.target}`));
}

function checkTarget(rig: Rig, data: TimelineData, target: Target, what: string): void {
    if (target === 'none') return;
    if (target !== 'bone' && target !== 'slot') {
        // the official timeline reads its constraint from the list of that type and crashes without one
        if (rig.model.constraints[data.target]?.type === target) return;
        throw invalid(`${what} animates the ${target} constraint ${data.target}, which does not exist.`);
    }
    const count = target === 'bone' ? rig.model.bones.count : rig.model.slots.count;

    if (!Number.isInteger(data.target) || data.target < 0 || data.target >= count) {
        throw invalid(`${what} animates the ${target} ${data.target}, which does not exist.`);
    }
    if ((data.kind === 'rgba2' || data.kind === 'rgb2') && rig.model.slots.hasDark[data.target] !== 1) {
        const slot = rig.model.slots.names[data.target];

        throw invalid(`${what} animates the dark color of the slot "${slot}", which has none.`);
    }
}

function sequenceCount(attachment: AttachmentData): number {
    if (attachment.type !== 'region' && attachment.type !== 'mesh') return -1;

    return attachment.sequence === null ? -1 : attachment.sequence.count;
}

function compileTimeline(rig: Rig, data: TimelineData, what: string): LegacyTimeline {
    const kind = SPECS[data.kind];
    const { frames, curves } = data;

    if (kind === undefined) {
        if (SKIPPED.test(data.kind)) {
            return new LegacyTimeline(K_SKIPPED, data.target, 1, { frames, curves, ids: idsOf(rig, data, []) });
        }
        throw unsupportedKind(rig, data.kind, what);
    }
    if (kind.code === K_INHERIT && rig.v41) throw unsupportedKind(rig, data.kind, what);
    if (frames.length < kind.entries) throw invalid(`${what} has no keys.`);
    checkTarget(rig, data, kind.target, what);
    const ids = idsOf(rig, data, kind.properties);

    if (kind.code === K_DEFORM || kind.code === K_SEQUENCE) {
        const attachment = resolveRef(rig, data.attachment, what);
        const vertices = data.vertices ?? [];

        if (kind.code === K_DEFORM && vertices.length < frames.length)
            throw invalid(`${what} has keys without vertices.`);

        return new LegacyTimeline(kind.code, data.target, kind.entries, {
            frames,
            curves,
            ids,
            attachment,
            sequenceCount: sequenceCount(attachment),
            vertices,
        });
    }

    return new LegacyTimeline(kind.code, data.target, kind.entries, {
        frames,
        curves,
        ids,
        attachmentNames: data.attachmentNames ?? [],
        events: data.events ?? [],
        drawOrders: data.drawOrders ?? [],
    });
}

function unsupportedKind(rig: Rig, kind: string, what: string): MarrowError {
    return new MarrowError(
        'unsupported-feature',
        `${what} is a ${kind} timeline, which Spine ${rig.model.version} does not have.`,
        {
            fix: EXPORT_FIX,
        },
    );
}

function compileClip(rig: Rig, index: number, animation: AnimationData): Clip {
    const ids = new Set<number>();
    const timelines = animation.timelines.map((data, i) => {
        const timeline = compileTimeline(rig, data, `Timeline ${i} of the animation "${animation.name}"`);

        for (const id of timeline.ids) ids.add(id);

        return timeline;
    });

    return { index, name: animation.name, duration: animation.duration, timelines, ids };
}

/**
 * The animation at a model index, ready to play. Throws a {@link MarrowError} for an index the
 * model does not have and for an animation this engine cannot play.
 */
export function clipOf(rig: Rig, index: number): Clip {
    const animation = rig.model.animations[index];

    if (animation === undefined || !Number.isInteger(index)) {
        const count = rig.model.animations.length;

        throw new MarrowError('invalid-data', `The skeleton has no animation ${index}. It has ${count} animations.`, {
            fix: 'Pass an index into the animation list of the model.',
        });
    }
    let clip = rig.clips[index];

    if (clip === undefined) {
        clip = compileClip(rig, index, animation);
        rig.clips[index] = clip;
    }

    return clip;
}

function computeFacts(rig: Rig, attachment: AttachmentData): AttachmentFacts {
    if (attachment.type === 'region' || attachment.type === 'point') return { timeline: null, geometry: null };
    if (attachment.type !== 'mesh') return { timeline: attachment, geometry: attachment };
    const timeline =
        attachment.timelineAttachment === null
            ? attachment
            : resolveRef(rig, attachment.timelineAttachment, `The linked mesh "${attachment.name}"`);

    return { timeline, geometry: meshSource(rig.lookup, attachment) };
}

/** The facts of an attachment. Computed on the first call for each attachment. */
export function factsOf(rig: Rig, attachment: AttachmentData): AttachmentFacts {
    let facts = rig.facts.get(attachment);

    if (facts === undefined) {
        facts = computeFacts(rig, attachment);
        rig.facts.set(attachment, facts);
    }

    return facts;
}
