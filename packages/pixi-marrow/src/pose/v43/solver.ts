import type {
    ConstraintData,
    IkConstraintData,
    PathConstraintData,
    PhysicsConstraintData,
    TransformConstraintData,
} from '../../model/constraints';
import type { SkeletonModel } from '../../model/model';
import type { AttachmentLookup } from '../shared/lookup';
import { WORLD_STRIDE } from '../state';
import { checkIndices, constraintError, PROPERTY_KINDS } from './plan-checks';
import { planSlider, planSliders } from './slider-plan';
import {
    IK_BEND_DIRECTION,
    IK_COMPRESS,
    IK_MIX,
    IK_SIZE,
    IK_SOFTNESS,
    IK_STRETCH,
    type IkPlan,
    PATH_MIX,
    PATH_POSITION,
    PATH_SIZE,
    PATH_SPACING,
    type PathPlan,
    PHYSICS_SIZE,
    PHYSICS_STATE,
    type PhysicsPlan,
    type Plan43,
    SLIDER_MIX,
    SLIDER_SIZE,
    SLIDER_TIME,
    type Solver43,
    type SolveScratch43,
    TRANSFORM_SIZE,
    type TransformPlan,
} from './solver-types';

const SCALE_Y_MODES: readonly string[] = ['none', 'uniform', 'volume'];
/** How many numbers the pose of a constraint takes, by the type of the constraint. */
const SIZES: Record<ConstraintData['type'], number> = {
    ik: IK_SIZE,
    transform: TRANSFORM_SIZE,
    path: PATH_SIZE,
    physics: PHYSICS_SIZE,
    slider: SLIDER_SIZE,
};
const SPACING_MODES: readonly string[] = ['length', 'fixed', 'percent', 'proportional'];
const ROTATE_MODES: readonly string[] = ['tangent', 'chain', 'chainScale'];
/** The position of a name in a list of official enum names. Throws for a name the list does not have. */
function modeOf(data: ConstraintData, modes: readonly string[], mode: string | undefined, fallback: string): number {
    const index = modes.indexOf(mode ?? fallback);

    if (index < 0) throw constraintError(data.type, data.name, `has the unknown mode "${mode}".`);

    return index;
}

function planIk(model: SkeletonModel, data: IkConstraintData, index: number, at: number): IkPlan {
    const { count } = model.bones;

    checkIndices(data, data.bones, count, 'bone');
    checkIndices(data, [data.target], count, 'bone', 'target bone');

    return {
        type: 'ik',
        index,
        name: data.name,
        skinRequired: data.skinRequired,
        at,
        bones: data.bones,
        target: data.target,
        scaleYMode: modeOf(data, SCALE_Y_MODES, data.scaleYMode, 'none'),
    };
}

function planTransform(model: SkeletonModel, data: TransformConstraintData, index: number, at: number): TransformPlan {
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
        at,
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

function planPath(model: SkeletonModel, data: PathConstraintData, index: number, at: number): PathPlan {
    checkIndices(data, data.bones, model.bones.count, 'bone');
    checkIndices(data, [data.slot], model.slots.count, 'slot');
    const slotBone = model.slots.bones[data.slot] ?? -1;

    checkIndices(data, [slotBone], model.bones.count, 'bone', 'a slot on bone');

    return {
        type: 'path',
        index,
        name: data.name,
        skinRequired: data.skinRequired,
        at,
        bones: data.bones,
        slot: data.slot,
        slotBone,
        percentPosition: data.positionMode === 'percent',
        spacingMode: modeOf(data, SPACING_MODES, data.spacingMode, 'length'),
        rotateMode: modeOf(data, ROTATE_MODES, data.rotateMode, 'tangent'),
        offsetRotation: data.offsetRotation,
    };
}

/**
 * The official `PhysicsConstraint` of the model. `ordinal` counts the physics constraints of the
 * model before it.
 */
function planPhysics(
    model: SkeletonModel,
    data: PhysicsConstraintData,
    index: number,
    at: number,
    ordinal: number,
): PhysicsPlan {
    checkIndices(data, [data.bone], model.bones.count, 'bone');
    const globals = [
        data.inertiaGlobal,
        data.strengthGlobal,
        data.dampingGlobal,
        data.massGlobal,
        data.windGlobal,
        data.gravityGlobal,
        data.mixGlobal,
    ];

    return {
        type: 'physics',
        index,
        name: data.name,
        skinRequired: data.skinRequired,
        at,
        bone: data.bone,
        state: ordinal * PHYSICS_STATE,
        x: data.x,
        y: data.y,
        rotate: data.rotate,
        scaleX: data.scaleX,
        shearX: data.shearX,
        limit: data.limit,
        step: data.step,
        scaleYMode: modeOf(data, SCALE_Y_MODES, data.scaleYMode, 'none'),
        globals: Uint8Array.from(globals, (flag) => (flag ? 1 : 0)),
    };
}

/** The plan of every constraint of a model. The pose of each starts where that of the one before ends. */
function planAll(model: SkeletonModel): Plan43[] {
    const plans: Plan43[] = [];
    let at = 0;
    let physics = 0;

    model.constraints.forEach((data, index) => {
        switch (data.type) {
            case 'ik':
                plans.push(planIk(model, data, index, at));
                break;
            case 'transform':
                plans.push(planTransform(model, data, index, at));
                break;
            case 'path':
                plans.push(planPath(model, data, index, at));
                break;
            case 'physics':
                plans.push(planPhysics(model, data, index, at, physics++));
                break;
            case 'slider':
                plans.push(planSlider(model, data, index, at));
                break;
        }
        at += SIZES[data.type];
    });

    return plans;
}

/** Writes the setup pose of one constraint from `i` on: the official `data.setupPose`. */
function writeSetup(setup: Float64Array, data: ConstraintData, i: number): void {
    switch (data.type) {
        case 'ik':
            setup[i + IK_MIX] = data.mix;
            setup[i + IK_SOFTNESS] = data.softness;
            setup[i + IK_BEND_DIRECTION] = data.bendDirection;
            setup[i + IK_COMPRESS] = data.compress ? 1 : 0;
            setup[i + IK_STRETCH] = data.stretch ? 1 : 0;
            break;
        case 'transform':
            setup.set([data.mixRotate, data.mixX, data.mixY, data.mixScaleX, data.mixScaleY, data.mixShearY], i);
            break;
        case 'path':
            setup[i + PATH_POSITION] = data.position;
            setup[i + PATH_SPACING] = data.spacing;
            setup.set([data.mixRotate, data.mixX, data.mixY], i + PATH_MIX);
            break;
        case 'physics':
            // in the order of the pose: see the `PHYSICS_` positions
            setup.set(
                [data.inertia, data.strength, data.damping, data.massInverse, data.wind, data.gravity, data.mix],
                i,
            );
            break;
        case 'slider':
            setup[i + SLIDER_TIME] = data.time;
            setup[i + SLIDER_MIX] = data.mix;
            break;
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
        wasActive: new Uint8Array(model.bones.count),
        items: [],
        spaces: new Float64Array(spaces),
        positions: new Float64Array(spaces * 3 + 2),
        lengths: new Float64Array(spaces),
        world: new Float64Array(vertices + 2),
        curves: new Float64Array(Math.ceil(vertices / 6)),
        segments: new Float64Array(10),
        seen: new Float64Array(plans.filter((item) => item.type === 'physics').length * WORLD_STRIDE),
        kept: new Float64Array(PHYSICS_STATE + WORLD_STRIDE),
        shown: null,
        unread: new Uint8Array(model.bones.count),
    };
}

/**
 * Prepares the constraints of a model for the 4.3 pose engine. Throws a `MarrowError` that names
 * the constraint when one points at a bone, a slot or an animation the skeleton does not have.
 */
export function prepareSolver(model: SkeletonModel, lookup: AttachmentLookup): Solver43 {
    const plans = planAll(model);
    const size = plans.reduce((sum, item) => sum + SIZES[item.type], 0);
    const setup = new Float64Array(size);

    plans.forEach((item, index) => {
        const data = model.constraints[index];

        if (data !== undefined) writeSetup(setup, data, item.at);
    });

    return {
        plans,
        physics: plans.filter((item) => item.type === 'physics'),
        setup,
        ...listChildren(model),
        sliders: planSliders(model, lookup, plans),
        free: new Uint8Array(model.bones.count),
        scratch: createScratch(model, plans),
    };
}
