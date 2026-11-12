import { MarrowError } from '../../base/errors';
import type { ConstraintData, PathConstraintData, PhysicsConstraintData } from '../../model/constraints';
import type { SkeletonModel } from '../../model/model';

/** Constraint kind code: an IK constraint. */
export const C_IK = 0;
/** Constraint kind code: a transform constraint. */
export const C_TRANSFORM = 1;
/** Constraint kind code: a path constraint. */
export const C_PATH = 2;
/** Constraint kind code: a physics constraint. */
export const C_PHYSICS = 3;

/**
 * Numbers per IK, transform or path constraint in the animated values of an instance and in the
 * setup values. A physics constraint keeps its values with its simulation state.
 */
export const CONSTRAINT_STRIDE = 6;

/** IK value offset: mix. Softness follows it. */
export const IK_MIX = 0;
/** IK value offset: softness. */
export const IK_SOFTNESS = 1;
/** IK value offset: the bend direction, 1 or -1. */
export const IK_BEND = 2;
/** IK value offset: compress, 0 or 1. */
export const IK_COMPRESS = 3;
/** IK value offset: stretch, 0 or 1. */
export const IK_STRETCH = 4;

/** Transform value offset: mixRotate. mixX, mixY, mixScaleX, mixScaleY and mixShearY follow it. */
export const TRANSFORM_MIX = 0;

/** Path value offset: mixRotate. mixX and mixY follow it. */
export const PATH_MIX = 0;
/** Path value offset: position. */
export const PATH_POSITION = 3;
/** Path value offset: spacing. */
export const PATH_SPACING = 4;

/** Numbers per physics constraint in {@link ConstraintPlan.physicsData}. */
export const PHYSICS_DATA_STRIDE = 15;
/** Physics data offset: the official `x`, how far the bone follows the simulation along x. */
export const PHYSICS_X = 0;
/** Physics data offset: the official `y`. */
export const PHYSICS_Y = 1;
/** Physics data offset: the official `rotate`. */
export const PHYSICS_ROTATE = 2;
/** Physics data offset: the official `scaleX`. */
export const PHYSICS_SCALE_X = 3;
/** Physics data offset: the official `shearX`. */
export const PHYSICS_SHEAR_X = 4;
/** Physics data offset: the official `limit`, the most a bone movement counts for in a second. */
export const PHYSICS_LIMIT = 5;
/** Physics data offset: the official `step`, the seconds of one simulation step. */
export const PHYSICS_STEP = 6;
/** Physics data offset: the setup length of the bone. */
export const PHYSICS_LENGTH = 7;
/** Physics data offset: the setup values, `PHYSICS_VALUES` numbers in the order of the animated values. */
export const PHYSICS_SETUP = 8;
/** The animated values of a physics constraint: inertia, strength, damping, the inverse of the mass, wind, gravity and mix. */
export const PHYSICS_VALUES = 7;

/** The official `PositionMode.Percent`. */
export const POSITION_PERCENT = 1;
/** The official `SpacingMode.Length`. */
export const SPACING_LENGTH = 0;
/** The official `SpacingMode.Percent`. */
export const SPACING_PERCENT = 2;
/** The official `SpacingMode.Proportional`. */
export const SPACING_PROPORTIONAL = 3;
/** The official `RotateMode.Tangent`. */
export const ROTATE_TANGENT = 0;
/** The official `RotateMode.Chain`. */
export const ROTATE_CHAIN = 1;
/** The official `RotateMode.ChainScale`. */
export const ROTATE_CHAIN_SCALE = 2;

const POSITION_MODES: readonly string[] = ['fixed', 'percent'];
const SPACING_MODES: readonly string[] = ['length', 'fixed', 'percent', 'proportional'];
const ROTATE_MODES: readonly string[] = ['tangent', 'chain', 'chainScale'];
const NO_OFFSETS = new Float64Array(6);

const EXPORT_FIX = 'Export the skeleton again from Spine 4.1 or 4.2.';

/**
 * One constraint, ready to sort and solve. Every kind has every field, so the engine sees one
 * object shape. Shared by all instances of a model.
 */
export interface LegacyConstraint {
    /** The index in the constraint list of the model. */
    readonly index: number;
    /** One of the `C_` codes. */
    readonly kind: number;
    readonly name: string;
    readonly skinRequired: boolean;
    /** The constrained bones. A physics constraint has its one bone here. */
    readonly bones: Int16Array;
    /** The target bone of an IK or transform constraint, or the slot of a path constraint. -1 for physics. */
    readonly target: number;
    /**
     * The bone that must be active for the constraint to be: the target bone, the bone of the path
     * slot, or the bone a physics constraint moves.
     */
    readonly targetBone: number;
    /**
     * Physics: the place of the constraint among the physics constraints of the model, as in the
     * official `skeleton.physicsConstraints`. Its data and its state start at this place times
     * their stride. -1 for the other kinds.
     */
    readonly physics: number;
    /** IK: the official `uniform`. */
    readonly uniform: boolean;
    /** Transform: the official `local`. */
    readonly local: boolean;
    /** Transform: the official `relative`. */
    readonly relative: boolean;
    /** Transform: the offsets of rotation, x, y, scaleX, scaleY and shearY. */
    readonly offsets: Float64Array;
    /** Path: the number of the official `PositionMode`. */
    readonly positionMode: number;
    /** Path: the number of the official `SpacingMode`. */
    readonly spacingMode: number;
    /** Path: the number of the official `RotateMode`. */
    readonly rotateMode: number;
    /** Path: the official `offsetRotation`. */
    readonly offsetRotation: number;
    /**
     * Path: per skin, the bones the path attachments of the slot in that skin follow. The update
     * cache sorts them before the constraint. A path without weights follows the bone of the slot.
     */
    readonly pathBones: readonly Int16Array[];
}

/** What every instance of a model shares about its constraints. */
export interface ConstraintPlan {
    readonly constraints: readonly LegacyConstraint[];
    /**
     * The setup values of the IK, transform and path constraints, in the layout of the animated
     * values. It ends after the last of them: the model lists physics constraints last.
     */
    readonly setup: Float64Array;
    /** The index of every physics constraint in `constraints`, in list order. */
    readonly physics: Int32Array;
    /**
     * What the physics constraints of every instance share, `PHYSICS_DATA_STRIDE` numbers each: the
     * numbers of the official `PhysicsConstraintData`, the length of the bone and the setup values.
     */
    readonly physicsData: Float64Array;
    /**
     * Per physics constraint, the animated values a timeline for all constraints changes. Bit `i`
     * stands for value `i`: the official `inertiaGlobal` is bit 0 and `mixGlobal` is bit 6.
     */
    readonly physicsGlobal: Uint8Array;
    /** Constraint indices in the order the official `updateCache` sorts them. */
    readonly order: Int32Array;
    /** Per bone, where its children start in `childList`. One more entry than bones. */
    readonly childStart: Int32Array;
    /** The children of every bone, in bone order. */
    readonly childList: Int16Array;
}

function nowhere(data: ConstraintData, what: string): MarrowError {
    return new MarrowError('invalid-data', `The ${data.type} constraint "${data.name}" ${what}.`, { fix: EXPORT_FIX });
}

/**
 * For every name the index of the first entry with that name. The official skeleton finds the
 * bones and the slot of a constraint by name, so the first of two equal names wins.
 */
function firstByName(names: readonly string[]): Int32Array {
    const first = new Map<string, number>();

    return Int32Array.from(names, (name, i) => {
        const known = first.get(name);

        if (known === undefined) first.set(name, i);

        return known ?? i;
    });
}

const inRange = (index: number, count: number): boolean => Number.isInteger(index) && index >= 0 && index < count;

/** The constrained bones of a constraint as the official skeleton resolves them. */
function boneList(data: ConstraintData, bones: Int16Array, firstBone: Int32Array): Int16Array {
    return Int16Array.from(bones, (bone) => {
        if (!inRange(bone, firstBone.length)) throw nowhere(data, `lists the bone ${bone}, which does not exist`);

        return firstBone[bone] ?? bone;
    });
}

function boneOf(data: ConstraintData, bone: number, firstBone: Int32Array, role: string): number {
    if (!inRange(bone, firstBone.length)) throw nowhere(data, `has the ${role} bone ${bone}, which does not exist`);

    return firstBone[bone] ?? bone;
}

/** Adds the bones a weighted attachment lists: per vertex a count, then that many bone indices. */
function addWeightBones(weights: Int16Array, boneCount: number, found: Set<number>): void {
    for (let i = 0; i < weights.length; ) {
        const end = i + 1 + (weights[i] ?? 0);

        for (i++; i < end; i++) {
            const bone = weights[i] ?? -1;

            if (inRange(bone, boneCount)) found.add(bone);
        }
    }
}

/**
 * Per skin, the bones the path attachments of a slot are weighted to, or the bone of the slot for
 * a path without weights.
 */
function pathBonesOf(model: SkeletonModel, slot: number, slotBone: number): Int16Array[] {
    return model.skins.map((skin) => {
        const found = new Set<number>();

        for (const entry of skin.attachments) {
            if (entry.slot !== slot || entry.attachment.type !== 'path') continue;
            const weights = entry.attachment.bones;

            if (weights === null) found.add(slotBone);
            else addWeightBones(weights, model.bones.count, found);
        }

        return Int16Array.from(found);
    });
}

interface Parts {
    bones: Int16Array;
    target: number;
    targetBone: number;
    pathBones?: Int16Array[];
}

function pathParts(model: SkeletonModel, data: PathConstraintData, firstBone: Int32Array): Parts {
    const { slots } = model;

    if (!inRange(data.slot, slots.count)) throw nowhere(data, `follows the slot ${data.slot}, which does not exist`);
    const slot = firstByName(slots.names)[data.slot] ?? data.slot;
    const slotBone = slots.bones[slot] ?? -1;

    if (!inRange(slotBone, model.bones.count)) throw nowhere(data, 'follows a slot whose bone does not exist');

    return {
        bones: boneList(data, data.bones, firstBone),
        target: slot,
        targetBone: slotBone,
        pathBones: pathBonesOf(model, slot, slotBone),
    };
}

function partsOf(model: SkeletonModel, data: ConstraintData, firstBone: Int32Array): Parts {
    if (data.type === 'ik') {
        // the official update cache reads the children of the first bone
        if (data.bones.length === 0) throw nowhere(data, 'has no bones');
        const target = boneOf(data, data.target, firstBone, 'target');

        return { bones: boneList(data, data.bones, firstBone), target, targetBone: target };
    }
    if (data.type === 'transform') {
        const target = boneOf(data, data.source, firstBone, 'target');

        return { bones: boneList(data, data.bones, firstBone), target, targetBone: target };
    }
    if (data.type === 'path') return pathParts(model, data, firstBone);
    if (data.type === 'physics' && model.version !== '4.1') {
        // the official physics constraint takes its bone by index, not by name
        if (!inRange(data.bone, model.bones.count)) {
            throw nowhere(data, `has the constrained bone ${data.bone}, which does not exist`);
        }
        // the official update subtracts the step from the time that passed until less than a step is left
        if (data.step <= 0) throw nowhere(data, `has the step ${data.step}, with which an update never ends`);

        return { bones: Int16Array.of(data.bone), target: -1, targetBone: data.bone };
    }
    throw new MarrowError('unsupported-feature', `Spine ${model.version} has no ${data.type} constraints.`, {
        fix: EXPORT_FIX,
    });
}

function kindOf(data: ConstraintData): number {
    if (data.type === 'ik') return C_IK;
    if (data.type === 'transform') return C_TRANSFORM;

    return data.type === 'path' ? C_PATH : C_PHYSICS;
}

function compile(
    model: SkeletonModel,
    data: ConstraintData,
    index: number,
    firstBone: Int32Array,
    physics: number,
): LegacyConstraint {
    const parts = partsOf(model, data, firstBone);
    const path = data.type === 'path' ? data : null;
    const transform = data.type === 'transform' ? data : null;

    return {
        index,
        kind: kindOf(data),
        name: data.name,
        skinRequired: data.skinRequired,
        bones: parts.bones,
        target: parts.target,
        targetBone: parts.targetBone,
        physics,
        uniform: data.type === 'ik' && data.uniform === true,
        local: transform?.local === true,
        relative: transform?.relative === true,
        offsets: transform?.offsets ?? NO_OFFSETS,
        positionMode: path === null ? 0 : POSITION_MODES.indexOf(path.positionMode),
        spacingMode: path === null ? 0 : SPACING_MODES.indexOf(path.spacingMode),
        rotateMode: path === null ? 0 : ROTATE_MODES.indexOf(path.rotateMode),
        offsetRotation: path === null ? 0 : path.offsetRotation,
        pathBones: parts.pathBones ?? [],
    };
}

/**
 * Writes the setup values of an IK, transform or path constraint: what the official
 * `setToSetupPose` of its kind sets.
 */
function writeSetup(data: ConstraintData, out: Float64Array, at: number): void {
    if (data.type === 'ik') {
        out.set([data.mix, data.softness, data.bendDirection, data.compress ? 1 : 0, data.stretch ? 1 : 0], at);
    } else if (data.type === 'transform') {
        out.set([data.mixRotate, data.mixX, data.mixY, data.mixScaleX, data.mixScaleY, data.mixShearY], at);
    } else if (data.type === 'path') {
        out.set([data.mixRotate, data.mixX, data.mixY, data.position, data.spacing], at);
    }
}

/** The numbers of a physics constraint in the layout of {@link ConstraintPlan.physicsData}. */
function physicsNumbers(data: PhysicsConstraintData, length: number): number[] {
    return [
        ...[data.x, data.y, data.rotate, data.scaleX, data.shearX, data.limit, data.step, length],
        // the setup values, from `PHYSICS_SETUP` on
        ...[data.inertia, data.strength, data.damping, data.massInverse, data.wind, data.gravity, data.mix],
    ];
}

/** The bits of {@link ConstraintPlan.physicsGlobal} for a physics constraint. */
function physicsGlobalBits(data: PhysicsConstraintData): number {
    const flags = [
        data.inertiaGlobal,
        data.strengthGlobal,
        data.dampingGlobal,
        data.massGlobal,
        data.windGlobal,
        data.gravityGlobal,
        data.mixGlobal,
    ];

    return flags.reduce((bits, flag, i) => (flag ? bits | (1 << i) : bits), 0);
}

/** What every instance shares about the physics constraints of a model. */
function physicsTables(model: SkeletonModel): Pick<ConstraintPlan, 'physics' | 'physicsData' | 'physicsGlobal'> {
    const physics: number[] = [];
    const numbers: number[] = [];
    const global: number[] = [];

    model.constraints.forEach((data, i) => {
        if (data.type !== 'physics') return;
        physics.push(i);
        numbers.push(...physicsNumbers(data, Number(model.bones.lengths[data.bone])));
        global.push(physicsGlobalBits(data));
    });

    return {
        physics: Int32Array.from(physics),
        physicsData: Float64Array.from(numbers),
        physicsGlobal: Uint8Array.from(global),
    };
}

/**
 * The order in which the official `updateCache` sorts constraints. For every number below the
 * constraint count it takes the first constraint with that `order`, IK first, then transform, path
 * and physics. A constraint whose order no pass asks for is never sorted and stays inactive.
 */
function sortOrder(constraints: readonly ConstraintData[]): Int32Array {
    const order: number[] = [];

    for (let i = 0; i < constraints.length; i++) {
        const found = constraints.findIndex((constraint) => constraint.order === i);

        if (found >= 0) order.push(found);
    }

    return Int32Array.from(order);
}

/** The children of every bone in bone order, as the official skeleton lists them. */
function childTable(parents: Int16Array, count: number): { childStart: Int32Array; childList: Int16Array } {
    const childStart = new Int32Array(count + 1);
    const childList = new Int16Array(count);
    const next = new Int32Array(count);

    for (let bone = 0; bone < count; bone++) {
        const parent = parents[bone] ?? -1;

        if (inRange(parent, count)) childStart[parent + 1] = (childStart[parent + 1] ?? 0) + 1;
    }
    for (let bone = 0; bone < count; bone++) {
        childStart[bone + 1] = (childStart[bone + 1] ?? 0) + (childStart[bone] ?? 0);
        next[bone] = childStart[bone] ?? 0;
    }
    for (let bone = 0; bone < count; bone++) {
        const parent = parents[bone] ?? -1;

        if (!inRange(parent, count)) continue;
        const at = next[parent] ?? 0;

        childList[at] = bone;
        next[parent] = at + 1;
    }

    return { childStart, childList };
}

/**
 * Compiles the constraints of a model. Throws a {@link MarrowError} that names the constraint
 * when it points at a bone or a slot the model does not have.
 */
export function createConstraintPlan(model: SkeletonModel): ConstraintPlan {
    const firstBone = firstByName(model.bones.names);
    let places = 0;
    const constraints = model.constraints.map((data, i) =>
        compile(model, data, i, firstBone, data.type === 'physics' ? places++ : -1),
    );
    const valued = constraints.findLastIndex((constraint) => constraint.kind !== C_PHYSICS) + 1;
    const setup = new Float64Array(valued * CONSTRAINT_STRIDE);

    model.constraints.slice(0, valued).forEach((data, i) => {
        writeSetup(data, setup, i * CONSTRAINT_STRIDE);
    });

    return {
        constraints,
        setup,
        order: sortOrder(model.constraints),
        ...physicsTables(model),
        ...childTable(model.bones.parents, model.bones.count),
    };
}
