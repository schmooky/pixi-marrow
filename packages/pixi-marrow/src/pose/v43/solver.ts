import { MarrowError } from '../../base/errors';
import type {
    ConstraintData,
    IkConstraintData,
    PathConstraintData,
    SliderConstraintData,
    TransformConstraintData,
    TransformProperty,
} from '../../model/constraints';
import type { SkeletonModel } from '../../model/model';
import { LOCAL_STRIDE, WORLD_STRIDE } from '../state';
import {
    CONSTRAINT_STRIDE,
    IK_BEND_DIRECTION,
    IK_COMPRESS,
    IK_MIX,
    IK_SOFTNESS,
    IK_STRETCH,
    type IkPlan,
    PATH_MIX,
    PATH_POSITION,
    PATH_SPACING,
    type PathPlan,
    type Plan43,
    type SliderPlan,
    type Solve43,
    type Solver43,
    type SolveScratch43,
    type TransformPlan,
} from './solver-types';
import type { Rig43 } from './types';

/** The official `TransformConstraintData` property numbers, which are also the positions of the six mixes. */
const PROPERTY_KINDS: Record<TransformProperty, number> = { rotate: 0, x: 1, y: 2, scaleX: 3, scaleY: 4, shearY: 5 };
const SCALE_Y_MODES: readonly string[] = ['none', 'uniform', 'volume'];
const SPACING_MODES: readonly string[] = ['length', 'fixed', 'percent', 'proportional'];
const ROTATE_MODES: readonly string[] = ['tangent', 'chain', 'chainScale'];
const LABELS: Record<ConstraintData['type'], string> = {
    ik: 'IK',
    transform: 'transform',
    path: 'path',
    physics: 'physics',
    slider: 'slider',
};

/**
 * The error for constraint data the official runtime fails on. The message starts with the kind
 * and the name of the constraint.
 */
export function constraintError(type: ConstraintData['type'], name: string, problem: string): MarrowError {
    return new MarrowError('invalid-data', `The ${LABELS[type]} constraint "${name}" ${problem}`, {
        fix: 'Export the skeleton again from Spine.',
    });
}

/**
 * Throws unless every index is one of `count` bones or slots. `what` is "bone" or "slot" and
 * `role` says what the constraint uses it for, for example "target bone".
 */
function checkIndices(
    data: ConstraintData,
    indices: Iterable<number>,
    count: number,
    what: string,
    role: string = what,
): void {
    for (const index of indices) {
        if (Number.isInteger(index) && index >= 0 && index < count) continue;
        throw constraintError(
            data.type,
            data.name,
            `points at ${role} ${index}, but the skeleton has ${count} ${count === 1 ? what : `${what}s`}.`,
        );
    }
}

/** The position of a name in a list of official enum names. Throws for a name the list does not have. */
function modeOf(data: ConstraintData, modes: readonly string[], mode: string | undefined, fallback: string): number {
    const index = modes.indexOf(mode ?? fallback);

    if (index < 0) throw constraintError(data.type, data.name, `has the unknown mode "${mode}".`);

    return index;
}

function planIk(model: SkeletonModel, data: IkConstraintData, index: number): IkPlan {
    const { count } = model.bones;

    checkIndices(data, data.bones, count, 'bone');
    checkIndices(data, [data.target], count, 'bone', 'target bone');

    return {
        type: 'ik',
        index,
        name: data.name,
        skinRequired: data.skinRequired,
        bones: data.bones,
        target: data.target,
        scaleYMode: modeOf(data, SCALE_Y_MODES, data.scaleYMode, 'none'),
    };
}

function planTransform(model: SkeletonModel, data: TransformConstraintData, index: number): TransformPlan {
    const { count } = model.bones;
    const froms = data.properties ?? [];
    const tos = froms.flatMap((from) => from.to);
    const toStarts = new Int32Array(froms.length + 1);

    checkIndices(data, data.bones, count, 'bone');
    checkIndices(data, [data.source], count, 'bone', 'source bone');
    froms.forEach((from, i) => {
        toStarts[i + 1] = (toStarts[i] ?? 0) + from.to.length;
    });

    return {
        type: 'transform',
        index,
        name: data.name,
        skinRequired: data.skinRequired,
        bones: data.bones,
        source: data.source,
        localSource: data.localSource ?? false,
        localTarget: data.localTarget ?? false,
        additive: data.additive ?? false,
        clamp: data.clamp ?? false,
        offsets: data.offsets,
        fromKinds: Uint8Array.from(froms, (from) => PROPERTY_KINDS[from.property]),
        fromOffsets: Float64Array.from(froms, (from) => from.offset),
        toStarts,
        toKinds: Uint8Array.from(tos, (to) => PROPERTY_KINDS[to.property]),
        toOffsets: Float64Array.from(tos, (to) => to.offset),
        toMax: Float64Array.from(tos, (to) => to.max),
        toScales: Float64Array.from(tos, (to) => to.scale),
    };
}

function planPath(model: SkeletonModel, data: PathConstraintData, index: number): PathPlan {
    checkIndices(data, data.bones, model.bones.count, 'bone');
    checkIndices(data, [data.slot], model.slots.count, 'slot');
    const slotBone = model.slots.bones[data.slot] ?? -1;

    checkIndices(data, [slotBone], model.bones.count, 'bone', 'a slot on bone');

    return {
        type: 'path',
        index,
        name: data.name,
        skinRequired: data.skinRequired,
        bones: data.bones,
        slot: data.slot,
        slotBone,
        percentPosition: data.positionMode === 'percent',
        spacingMode: modeOf(data, SPACING_MODES, data.spacingMode, 'length'),
        rotateMode: modeOf(data, ROTATE_MODES, data.rotateMode, 'tangent'),
        offsetRotation: data.offsetRotation,
    };
}

const BONE_TIMELINES: readonly string[] = [
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
];

/** The official `Animation.bones`: the bones the timelines of an animation animate, each once, in timeline order. */
function animatedBones(model: SkeletonModel, data: SliderConstraintData): Int32Array {
    const animation = model.animations[data.animation];

    if (animation === undefined) {
        throw constraintError(
            'slider',
            data.name,
            `plays animation ${data.animation}, which the skeleton does not have.`,
        );
    }
    const bones = new Set<number>();

    for (const timeline of animation.timelines) if (BONE_TIMELINES.includes(timeline.kind)) bones.add(timeline.target);
    checkIndices(data, bones, model.bones.count, 'bone', 'an animation for bone');

    return Int32Array.from(bones);
}

function planSlider(model: SkeletonModel, data: SliderConstraintData, index: number): SliderPlan {
    if (data.bone !== -1) checkIndices(data, [data.bone], model.bones.count, 'bone');

    return {
        type: 'slider',
        index,
        name: data.name,
        skinRequired: data.skinRequired,
        bone: data.bone,
        local: data.local,
        bones: animatedBones(model, data),
    };
}

function plan(model: SkeletonModel, data: ConstraintData, index: number): Plan43 {
    switch (data.type) {
        case 'ik':
            return planIk(model, data, index);
        case 'transform':
            return planTransform(model, data, index);
        case 'path':
            return planPath(model, data, index);
        case 'physics':
            checkIndices(data, [data.bone], model.bones.count, 'bone');

            return { type: 'physics', index, name: data.name, skinRequired: data.skinRequired, bone: data.bone };
        case 'slider':
            return planSlider(model, data, index);
    }
}

/** Writes the setup pose of one constraint: the official `data.setupPose`. */
function writeSetup(setup: Float64Array, data: ConstraintData, index: number): void {
    const i = index * CONSTRAINT_STRIDE;

    if (data.type === 'ik') {
        setup[i + IK_MIX] = data.mix;
        setup[i + IK_SOFTNESS] = data.softness;
        setup[i + IK_BEND_DIRECTION] = data.bendDirection;
        setup[i + IK_COMPRESS] = data.compress ? 1 : 0;
        setup[i + IK_STRETCH] = data.stretch ? 1 : 0;
    } else if (data.type === 'transform') {
        setup.set([data.mixRotate, data.mixX, data.mixY, data.mixScaleX, data.mixScaleY, data.mixShearY], i);
    } else if (data.type === 'path') {
        setup[i + PATH_POSITION] = data.position;
        setup[i + PATH_SPACING] = data.spacing;
        setup.set([data.mixRotate, data.mixX, data.mixY], i + PATH_MIX);
    }
}

/** The children of every bone, as the official `Bone.children` lists hold them. */
function listChildren(model: SkeletonModel): Pick<Solver43, 'childStarts' | 'children'> {
    const { count, parents } = model.bones;
    const childStarts = new Int32Array(count + 1);
    const children = new Int32Array(count);
    const filled = new Int32Array(count);
    const parentOf = (bone: number): number => {
        const parent = parents[bone] ?? -1;

        return parent >= 0 && parent < count ? parent : -1;
    };

    for (let bone = 0; bone < count; bone++) {
        const parent = parentOf(bone);

        if (parent >= 0) childStarts[parent + 1] = (childStarts[parent + 1] ?? 0) + 1;
    }
    for (let bone = 0; bone < count; bone++)
        childStarts[bone + 1] = (childStarts[bone + 1] ?? 0) + (childStarts[bone] ?? 0);
    for (let bone = 0; bone < count; bone++) {
        const parent = parentOf(bone);

        if (parent < 0) continue;
        children[(childStarts[parent] ?? 0) + (filled[parent] ?? 0)] = bone;
        filled[parent] = (filled[parent] ?? 0) + 1;
    }

    return { childStarts, children };
}

/** Working memory that is long enough for every path constraint and every path attachment of the model. */
function createScratch(model: SkeletonModel, plans: readonly Plan43[]): SolveScratch43 {
    let spaces = 1;
    let vertices = 6;

    for (const item of plans) if (item.type === 'path') spaces = Math.max(spaces, item.bones.length + 1);
    for (const skin of model.skins) {
        for (const { attachment } of skin.attachments) {
            if (attachment.type === 'path') vertices = Math.max(vertices, attachment.worldVerticesLength);
        }
    }

    return {
        sorted: new Uint8Array(model.bones.count),
        previous: new Uint8Array(model.bones.count),
        items: [],
        spaces: new Float64Array(spaces),
        positions: new Float64Array(spaces * 3 + 2),
        lengths: new Float64Array(spaces),
        world: new Float64Array(vertices + 2),
        curves: new Float64Array(Math.ceil(vertices / 6)),
        segments: new Float64Array(10),
    };
}

/**
 * Prepares the constraints of a model for the 4.3 pose engine. Throws a {@link MarrowError} that
 * names the constraint when one points at a bone, a slot or an animation the skeleton does not have.
 */
export function prepareSolver(model: SkeletonModel): Solver43 {
    const plans = model.constraints.map((data, index) => plan(model, data, index));
    const setup = new Float64Array(plans.length * CONSTRAINT_STRIDE);

    model.constraints.forEach((data, index) => {
        writeSetup(setup, data, index);
    });

    return {
        plans,
        setup,
        solvable: plans.some((item) => item.type === 'ik' || item.type === 'transform' || item.type === 'path'),
        ...listChildren(model),
        scratch: createScratch(model, plans),
    };
}

/** Creates the constraint state of one engine: every constraint in its setup pose, and no update order yet. */
export function createSolve(rig: Rig43): Solve43 {
    const { solver } = rig;
    const constrained = solver.plans.length > 0 ? rig.model.bones.count : 0;
    const solved = solver.solvable ? rig.model.bones.count : 0;

    return {
        values: Float64Array.from(solver.setup),
        active: new Uint8Array(solver.plans.length),
        local: new Float64Array(solved * LOCAL_STRIDE),
        constrained: new Uint8Array(constrained),
        spare: new Float64Array(constrained * WORLD_STRIDE),
        stamp: 0,
        worldStamps: new Uint8Array(solved),
        localStamps: new Uint8Array(solved),
        cache: new Int32Array(0),
        cacheLength: 0,
        solved: 0,
    };
}
