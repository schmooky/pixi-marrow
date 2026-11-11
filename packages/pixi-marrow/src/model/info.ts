import type { SpineVersion } from '../base/version';
import type { AttachmentData } from './attachments';
import type { ConstraintData } from './constraints';
import { BLEND_MODES, type SkeletonModel } from './model';
import type { TimelineData, TimelineKind } from './timelines';

/** Something a skeleton uses that costs time or memory, or that limits how it can be optimized. */
export type SkeletonFeature =
    | 'meshes'
    | 'weights'
    | 'linkedMeshes'
    | 'clipping'
    | 'paths'
    | 'sequences'
    | 'darkTint'
    | 'additiveBlend'
    | 'multiplyBlend'
    | 'screenBlend'
    | 'skinBones'
    | 'ik'
    | 'transform'
    | 'path'
    | 'physics'
    | 'slider';

/** Something an animation keys. */
export type AnimationFeature =
    | 'bones'
    | 'colors'
    | 'attachments'
    | 'deform'
    | 'sequences'
    | 'drawOrder'
    | 'events'
    | 'inherit'
    | 'constraints'
    | 'physics';

/** What one animation is made of. */
export interface AnimationInfo {
    name: string;
    /** Seconds. */
    duration: number;
    timelines: number;
    /** What the animation keys, in the order of {@link AnimationFeature}. */
    features: AnimationFeature[];
}

/** Numbers that drive the cost of a skeleton. */
export interface SkeletonCounts {
    bones: number;
    slots: number;
    skins: number;
    constraints: number;
    animations: number;
    /** Attachments over all skins. */
    attachments: number;
    regions: number;
    meshes: number;
    /** Vertices of all meshes over all skins. Linked meshes count the vertices of their parent. */
    meshVertices: number;
    /** The most bones that move one vertex. 0 when no mesh has weights. */
    maxBonesPerVertex: number;
}

/** A plain description of a skeleton: names, counts and what it uses. Safe to turn into JSON. */
export interface SkeletonInfo {
    version: SpineVersion;
    editorVersion: string;
    bones: string[];
    slots: string[];
    skins: string[];
    events: string[];
    constraints: { name: string; type: ConstraintData['type'] }[];
    animations: AnimationInfo[];
    counts: SkeletonCounts;
    /** What the skeleton uses, in the order of {@link SkeletonFeature}. */
    features: SkeletonFeature[];
}

const ANIMATION_FEATURES: readonly [AnimationFeature, (kind: TimelineKind) => boolean][] = [
    ['bones', (kind) => /^(rotate|translate|scale|shear)/.test(kind)],
    ['colors', (kind) => /^(rgb|alpha)/.test(kind)],
    ['attachments', (kind) => kind === 'attachment'],
    ['deform', (kind) => kind === 'deform'],
    ['sequences', (kind) => kind === 'sequence'],
    ['drawOrder', (kind) => kind === 'drawOrder' || kind === 'drawOrderFolder'],
    ['events', (kind) => kind === 'event'],
    ['inherit', (kind) => kind === 'inherit'],
    ['constraints', (kind) => /^(ikConstraint|transformConstraint|pathConstraint|slider)/.test(kind)],
    ['physics', (kind) => kind.startsWith('physicsConstraint')],
];

function animationFeatures(timelines: readonly TimelineData[]): AnimationFeature[] {
    return ANIMATION_FEATURES.filter(([, matches]) => timelines.some((timeline) => matches(timeline.kind))).map(
        ([feature]) => feature,
    );
}

/** The most bones that move one vertex of a weighted attachment. */
function maxInfluences(bones: Int16Array): number {
    let max = 0;

    // per vertex: a count, then that many bone indices
    for (let i = 0; i < bones.length; ) {
        const count = bones[i] ?? 0;

        max = Math.max(max, count);
        i += count + 1;
    }

    return max;
}

/** Twice the vertex count of a mesh. A linked mesh has the vertices of its parent. */
function meshVerticesLength(model: SkeletonModel, attachment: AttachmentData, depth = 0): number {
    if (attachment.type !== 'mesh') return 0;
    // a chain of parents longer than the skin list is a loop in a broken file
    if (attachment.parent === null || depth > model.skins.length) return attachment.worldVerticesLength;
    const { skin, slot, name } = attachment.parent;
    const parent = model.skins[skin]?.attachments.find((entry) => entry.slot === slot && entry.name === name);

    return parent ? meshVerticesLength(model, parent.attachment, depth + 1) : 0;
}

function skeletonFeatures(model: SkeletonModel, attachments: readonly AttachmentData[]): SkeletonFeature[] {
    const has = (type: AttachmentData['type']): boolean => attachments.some((attachment) => attachment.type === type);
    const meshes = attachments.filter((attachment) => attachment.type === 'mesh');
    const drawn = attachments.filter((attachment) => attachment.type === 'mesh' || attachment.type === 'region');
    const blend = (name: string): boolean => model.slots.blendModes.includes(BLEND_MODES.indexOf(name));
    const constraint = (type: ConstraintData['type']): boolean => model.constraints.some((c) => c.type === type);
    const checks: [SkeletonFeature, boolean][] = [
        ['meshes', meshes.length > 0],
        ['weights', meshes.some((mesh) => mesh.bones !== null)],
        ['linkedMeshes', meshes.some((mesh) => mesh.parent !== null)],
        ['clipping', has('clipping')],
        ['paths', has('path')],
        ['sequences', drawn.some((attachment) => attachment.sequence !== null)],
        ['darkTint', model.slots.hasDark.includes(1)],
        ['additiveBlend', blend('additive')],
        ['multiplyBlend', blend('multiply')],
        ['screenBlend', blend('screen')],
        ['skinBones', model.skins.some((skin) => skin.bones.length > 0)],
        ['ik', constraint('ik')],
        ['transform', constraint('transform')],
        ['path', constraint('path')],
        ['physics', constraint('physics')],
        ['slider', constraint('slider')],
    ];

    return checks.filter(([, used]) => used).map(([feature]) => feature);
}

/**
 * Describes a skeleton in plain data: every name, the counts that drive its cost, and what it uses.
 * The result holds no typed arrays, so it can be logged or sent as JSON.
 *
 * @example
 * const info = describeSkeleton(await importSkeleton(bytes));
 * console.log(info.animations.map((animation) => animation.name), info.features);
 */
export function describeSkeleton(model: SkeletonModel): SkeletonInfo {
    const attachments = model.skins.flatMap((skin) => skin.attachments.map((entry) => entry.attachment));
    const meshes = attachments.filter((attachment) => attachment.type === 'mesh');
    const weighted = meshes.flatMap((mesh) => (mesh.bones === null ? [] : [mesh.bones]));

    return {
        version: model.version,
        editorVersion: model.editorVersion,
        bones: [...model.bones.names],
        slots: [...model.slots.names],
        skins: model.skins.map((skin) => skin.name),
        events: model.events.map((event) => event.name),
        constraints: model.constraints.map(({ name, type }) => ({ name, type })),
        animations: model.animations.map((animation) => ({
            name: animation.name,
            duration: animation.duration,
            timelines: animation.timelines.length,
            features: animationFeatures(animation.timelines),
        })),
        counts: {
            bones: model.bones.count,
            slots: model.slots.count,
            skins: model.skins.length,
            constraints: model.constraints.length,
            animations: model.animations.length,
            attachments: attachments.length,
            regions: attachments.filter((attachment) => attachment.type === 'region').length,
            meshes: meshes.length,
            meshVertices: meshes.reduce((sum, mesh) => sum + meshVerticesLength(model, mesh) / 2, 0),
            maxBonesPerVertex: weighted.reduce((max, bones) => Math.max(max, maxInfluences(bones)), 0),
        },
        features: skeletonFeatures(model, attachments),
    };
}
